import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import UserAuditLogHandler from '../../../../app/src/Features/User/UserAuditLogHandler.mjs'
import TpdsUpdateSender from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateSender.mjs'
import TpdsProjectFlusher from '../../../../app/src/Features/ThirdPartyDataStore/TpdsProjectFlusher.mjs'
import Csrf from '../../../../app/src/infrastructure/Csrf.mjs'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import DropboxHandler, { DropboxAlreadyLinkedError } from './DropboxHandler.mjs'

const SETTINGS_URL = '/user/settings?oauth-complete=dropbox#project-sync'

function redirectWithError(req, res, message) {
  req.session.projectSyncErrorMessage = message
  res.redirect(SETTINGS_URL)
}

// Redirect the user to the Dropbox authorization page
async function oauth2(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const user = await UserGetter.promises.getUser(userId, { features: 1 })
  if (!user?.features?.dropbox) {
    return HttpErrorHandler.forbidden(req, res)
  }
  // another account would keep the sync state of this one: unlink first
  if (await DropboxHandler.isLinked(userId)) {
    return res.redirect(SETTINGS_URL)
  }
  const duplicates = await DropboxHandler.getDuplicateProjectNames(userId)
  if (duplicates.length > 0) {
    return redirectWithError(
      req,
      res,
      req.i18n.translate('dropbox_duplicate_names_error') + duplicates.join(', ')
    )
  }
  res.redirect(DropboxHandler.getAuthorizeUrl(req.csrfToken()).toString())
}

// Poll first, which sets the cursor the changes in Dropbox are read from
// before any upload, so that edits made in Dropbox while the user's projects
// are sent are read by a later poll; then send them and poll again
async function initialSync(userId) {
  await TpdsUpdateSender.promises.pollDropboxForUser(userId)
  for (const projectId of await DropboxHandler.getSyncedProjectIds(userId)) {
    try {
      await TpdsProjectFlusher.promises.flushProjectToTpds(projectId)
    } catch (err) {
      logger.warn({ err, userId, projectId }, 'failed to send project to Dropbox')
    }
  }
  await TpdsUpdateSender.promises.pollDropboxForUser(userId)
}

async function oauth2Callback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { code, state, error } = req.query

  try {
    await Csrf.promises.validateToken(state, req.session)
  } catch {
    return HttpErrorHandler.forbidden(req, res, 'Invalid CSRF token')
  }
  if (error) {
    // the user did not allow access
    return res.redirect(SETTINGS_URL)
  }

  try {
    const token = await DropboxHandler.exchangeCodeForToken(code)
    await DropboxHandler.linkUser(userId, token)
  } catch (err) {
    if (err instanceof DropboxAlreadyLinkedError) {
      return redirectWithError(
        req,
        res,
        req.i18n.translate('dropbox_already_linked_error')
      )
    }
    logger.error({ err, userId }, 'failed to link Dropbox account')
    return redirectWithError(
      req,
      res,
      req.i18n.translate('generic_something_went_wrong')
    )
  }

  await UserAuditLogHandler.promises.addEntry(
    userId,
    'link-dropbox',
    userId,
    req.ip
  )
  initialSync(userId).catch(err =>
    logger.error({ err, userId }, 'failed to start the initial Dropbox sync')
  )

  req.session.projectSyncSuccessMessage = req.i18n.translate(
    'dropbox_successfully_linked_description',
    { appName: Settings.appName }
  )
  res.redirect(SETTINGS_URL)
}

async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  await DropboxHandler.unlinkUser(userId)
  await UserAuditLogHandler.promises.addEntry(
    userId,
    'unlink-dropbox',
    userId,
    req.ip
  )
  res.sendStatus(204)
}

async function getStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  res.json(await DropboxHandler.isLinked(userId))
}

// The project's folder in the user's Dropbox app folder, for the sync modal
async function getProjectFolder(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { Project_id: projectId } = req.params
  res.json({
    dropboxFolderName: await DropboxHandler.getProjectFolderName(
      userId,
      projectId
    ),
  })
}

// 'Changes not appearing in Dropbox? ... sync this project now': send the
// project as it is now, then read the changes from Dropbox
async function syncNow(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { Project_id: projectId } = req.params
  if (!(await DropboxHandler.isLinked(userId))) {
    return res.sendStatus(404)
  }
  await TpdsProjectFlusher.promises.flushProjectToTpds(projectId)
  await TpdsUpdateSender.promises.pollDropboxForUser(userId)
  res.sendStatus(204)
}

// GET: Dropbox checks the endpoint by having its challenge echoed back
function verifyWebhook(req, res) {
  res.set('Content-Type', 'text/plain')
  res.set('X-Content-Type-Options', 'nosniff')
  res.send(String(req.query.challenge ?? ''))
}

function hasValidSignature(req) {
  const signature = req.get('X-Dropbox-Signature') || ''
  const expected = crypto
    .createHmac('sha256', Settings.dropbox.appSecret)
    .update(req.body)
    .digest('hex')
  return (
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
}

// POST: the listed accounts have changes. Dropbox expects an answer within
// 10 seconds, so only a poll is queued for each of their users.
async function notifyWebhook(req, res) {
  if (!Buffer.isBuffer(req.body) || !hasValidSignature(req)) {
    return res.sendStatus(403)
  }
  let accounts
  try {
    accounts = JSON.parse(req.body.toString()).list_folder?.accounts
  } catch {
    return res.sendStatus(400)
  }
  if (!Array.isArray(accounts)) {
    return res.sendStatus(400)
  }
  const users = await db.users
    .find(
      { 'dropbox.access_token.uid': { $in: accounts.map(String) } },
      { projection: { _id: 1 } }
    )
    .toArray()
  for (const user of users) {
    await DropboxHandler.queuePoll(user._id.toString())
  }
  res.sendStatus(200)
}

export default {
  oauth2: expressify(oauth2),
  oauth2Callback: expressify(oauth2Callback),
  unlink: expressify(unlink),
  getStatus: expressify(getStatus),
  getProjectFolder: expressify(getProjectFolder),
  syncNow: expressify(syncNow),
  verifyWebhook,
  notifyWebhook: expressify(notifyWebhook),
}
