import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import AccessTokenEncryptor from '@overleaf/access-token-encryptor'
import {
  CustomHttpAgent,
  CustomHttpsAgent,
  fetchJson,
  fetchNothing,
} from '@overleaf/fetch-utils'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'
import NotificationsHandler from '../../../../app/src/Features/Notifications/NotificationsHandler.mjs'
import NotificationsBuilder from '../../../../app/src/Features/Notifications/NotificationsBuilder.mjs'

// Dropbox endpoints, the way the dropbox SDK used by third-party-datastore
// derives them from its `domain` option
const { domain } = Settings.dropbox
const AUTHORIZE_URL = domain
  ? `https://meta-${domain}/oauth2/authorize`
  : 'https://www.dropbox.com/oauth2/authorize'
const API_URL = domain ? `https://api-${domain}` : 'https://api.dropboxapi.com'
const REQUEST_TIMEOUT_MS = 60 * 1000

const dropboxProxyAgent = process.env.DROPBOX_SYNC_PROXY_URL
  ? new HttpsProxyAgent(process.env.DROPBOX_SYNC_PROXY_URL)
  : undefined

// fetch-utils' default agent gives up connecting after 1s, too short for
// external APIs, so direct requests get a 3s connect timeout instead
const MAX_CONNECT_TIME = 3000
const httpAgent = new CustomHttpAgent({ connectTimeout: MAX_CONNECT_TIME })
const httpsAgent = new CustomHttpsAgent({ connectTimeout: MAX_CONNECT_TIME })

function withProxy(options) {
  return {
    ...options,
    agent:
      dropboxProxyAgent ||
      (url => (url.protocol === 'https:' ? httpsAgent : httpAgent)),
  }
}

// third-party-datastore decrypts the token with the same cipher
const cipherLabel = process.env.DROPBOX_TOKEN_CIPHER_LABEL || '2026.3-v3'
const accessTokenEncryptor = new AccessTokenEncryptor({
  cipherLabel,
  cipherPasswords: {
    [cipherLabel]: process.env.DROPBOX_TOKEN_CIPHER_PASSWORD,
  },
})

export class DropboxAlreadyLinkedError extends OError {}

function getAuthorizeUrl(state) {
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: Settings.dropbox.appKey,
    redirect_uri: Settings.dropbox.callbackURL,
    response_type: 'code',
    // a refresh token, for syncing while the user is away
    token_access_type: 'offline',
    state,
  }).toString()
  return url
}

async function fetchToken(params) {
  return await fetchJson(
    `${API_URL}/oauth2/token`,
    withProxy({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Settings.dropbox.appKey,
        client_secret: Settings.dropbox.appSecret,
        ...params,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  )
}

// { access_token, refresh_token, account_id, ... }
async function exchangeCodeForToken(code) {
  return await fetchToken({
    code,
    grant_type: 'authorization_code',
    redirect_uri: Settings.dropbox.callbackURL,
  })
}

// users.dropbox.access_token.uid is what web looks for to sync a user
// (TpdsUpdateSender), and has a unique index: one Overleaf account per
// Dropbox account
async function linkUser(userId, token) {
  const encrypted = await accessTokenEncryptor.promises.encryptJson({
    refresh_token: token.refresh_token,
  })
  try {
    // user.dropbox is not in the User schema, write it directly
    await db.users.updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          dropbox: {
            access_token: { uid: token.account_id },
            access_token_oauth2: { encrypted },
          },
        },
      }
    )
  } catch (err) {
    if (err.code === 11000) {
      throw new DropboxAlreadyLinkedError('dropbox account linked to another user', {
        userId,
      })
    }
    throw err
  }
  // what a job still running at the last unlink wrote back
  await removeUserState(userId)
  // the notices why it was unlinked: of third-party-datastore's QueueWorker,
  // and of TpdsUpdateHandler for projects with the same name
  await Promise.all([
    NotificationsHandler.promises.markAsReadWithKey(userId, 'dropbox-unlinked'),
    NotificationsBuilder.promises.dropboxDuplicateProjectNames(userId).read(),
  ]).catch(err => logger.warn({ err, userId }, 'failed to clear the dropbox notices'))
}

async function isLinked(userId) {
  const user = await db.users.findOne(
    { _id: new ObjectId(userId) },
    { projection: { 'dropbox.access_token.uid': 1 } }
  )
  return Boolean(user?.dropbox?.access_token?.uid)
}

async function removeUserState(userId) {
  const uid = new ObjectId(userId)
  await db.dropboxEntities.deleteMany({ 'overleaf.userId': uid })
  await db.dropboxProjects.deleteMany({ userId: uid })
}

// The project's folders stay in Dropbox, no longer tied to it: an edit there
// is read as a new project, as for a folder made in Dropbox
async function removeProjectState(projectId) {
  const pid = new ObjectId(projectId)
  await db.dropboxEntities.deleteMany({ 'overleaf.projectId': pid })
  await db.dropboxProjects.deleteMany({ projectId: pid })
}

// Revoke the token at Dropbox, best effort
async function revokeToken(encrypted) {
  try {
    const { refresh_token: refreshToken } =
      await accessTokenEncryptor.promises.decryptToJson(encrypted)
    const { access_token: accessToken } = await fetchToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
    await fetchNothing(
      `${API_URL}/2/auth/token/revoke`,
      withProxy({
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    )
  } catch (err) {
    logger.warn({ err }, 'failed to revoke Dropbox token')
  }
}

async function unlinkUser(userId) {
  const user = await db.users.findOneAndUpdate(
    { _id: new ObjectId(userId), dropbox: { $exists: true } },
    { $unset: { dropbox: 1 } }
  )
  await removeUserState(userId)
  const encrypted = user?.dropbox?.access_token_oauth2?.encrypted
  if (encrypted) {
    revokeToken(encrypted).catch(() => {})
  }
}

// A Dropbox folder of no project finds its project by name, so the projects
// web looks among (owned and read-write, TpdsUpdateHandler) must have distinct
// names, active, archived and trashed alike
// (dropbox_duplicate_project_names_suggestion)
async function getDuplicateProjectNames(userId) {
  const { owned, readAndWrite } = await ProjectGetter.promises.findAllUsersProjects(
    userId,
    'name'
  )
  const seenIds = new Set()
  const seen = new Map()
  const duplicates = new Set()
  for (const project of owned.concat(readAndWrite)) {
    // owned and a collaboration is one project (findUsersProjectsByName)
    const id = project._id.toString()
    if (seenIds.has(id)) {
      continue
    }
    seenIds.add(id)
    const key = project.name.toLowerCase()
    if (seen.has(key)) {
      duplicates.add(seen.get(key))
    } else {
      seen.set(key, project.name)
    }
  }
  return [...duplicates]
}

// The name of the project's folder, e.g. 'Thesis (1)' that Dropbox numbered
// next to another project's 'Thesis'. third-party-datastore stores only the
// lower-cased path, so the project name gives back the case; before the first
// sync, the folder is named after the project.
async function getProjectFolderName(userId, projectId) {
  const [project, mapped] = await Promise.all([
    ProjectGetter.promises.getProject(projectId, { name: 1 }),
    db.dropboxProjects.findOne(
      { userId: new ObjectId(userId), projectId: new ObjectId(projectId) },
      { projection: { pathLower: 1 } }
    ),
  ])
  if (!mapped) {
    return project.name
  }
  const folderName = mapped.pathLower.slice(1)
  const lowerName = project.name.toLowerCase()
  return folderName.startsWith(lowerName)
    ? project.name + folderName.slice(lowerName.length)
    : folderName
}

// The projects web sends the changes of to the user's Dropbox: those the user
// is invited to (TpdsUpdateSender.getProjectUsersIds), not link-shared ones,
// unless archived or trashed by the user
async function getSyncedProjectIds(userId) {
  const { owned, readAndWrite, readOnly, review } =
    await ProjectGetter.promises.findAllUsersProjects(userId, 'archived trashed')
  const ids = new Map()
  for (const project of [...owned, ...readAndWrite, ...readOnly, ...review]) {
    if (!ProjectHelper.isArchivedOrTrashed(project, userId)) {
      ids.set(project._id.toString(), project._id)
    }
  }
  return [...ids.values()]
}

// The job of TpdsUpdateSender.pollDropboxForUser, whose enqueue only logs a
// failure. The webhook needs it to answer an error, so that Dropbox retries.
async function queuePoll(userId) {
  const { url } = Settings.apis.thirdPartyDataStore
  await fetchNothing(new URL('/enqueue/web_to_tpds_http_requests', url), {
    method: 'POST',
    json: {
      group: userId,
      method: 'standardHttpRequest',
      job: {
        method: 'post',
        uri: `${url}/user/poll`,
        json: { user_ids: [userId] },
      },
    },
    signal: AbortSignal.timeout(5 * 1000),
  })
}

export default {
  getAuthorizeUrl,
  exchangeCodeForToken,
  linkUser,
  unlinkUser,
  isLinked,
  removeUserState,
  removeProjectState,
  getDuplicateProjectNames,
  getProjectFolderName,
  getSyncedProjectIds,
  queuePoll,
}
