import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'
import NotificationsBuilder from '../../../../app/src/Features/Notifications/NotificationsBuilder.mjs'
import TpdsUpdateHandler from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs'
import WebdavCredentials from './WebdavCredentials.mjs'
import WebdavClient from './WebdavClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import { remotePath } from './WebdavPaths.mjs'

const syncLocks = new Map()
const recentlyInboundProjects = new Map()

/**
 * Serializes all remote-touching operations for one user (pull, push, link,
 * conflict resolution, project move/delete sync). Prevents interleaved
 * list/delete/upload sequences from tearing remote state (shared lock,
 * ARC-03/WD-04).
 */
async function withUserSyncLock(userId, task) {
  const key = `webdav-sync:${userId.toString()}`
  const previous = syncLocks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => {
    release = resolve
  })
  syncLocks.set(key, current)
  try {
    // Swallow previous rejections — this task must start even if the prior
    // holder failed (a rejected mutex promise would otherwise poison all
    // future syncs for the user).
    await previous.catch(() => {})
    return await task()
  } finally {
    release()
    if (syncLocks.get(key) === current) syncLocks.delete(key)
  }
}

function sha256(content) {
  if (!content) return null
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// D2: keep in sync with DropboxClient.isSyncExcluded (dropbox module) and
// datamanipulator's fileUtils.isSyncExcluded — same rules: hidden entry (ANY
// path segment starting with a dot), transient LaTeX build outputs
// (aux/log/out/toc/fls/idx/vrb), and .synctex.gz files.
const SYNC_EXCLUDED_EXT = /\.(aux|log|out|toc|fls|idx|vrb)$/i
function isSyncExcluded(nameOrPath) {
  if (!nameOrPath || typeof nameOrPath !== 'string') return false
  const parts = nameOrPath.split('/').filter(Boolean)
  if (!parts.length) return false
  for (const part of parts) {
    if (part.startsWith('.')) return true
  }
  const base = parts[parts.length - 1]
  if (base.endsWith('.synctex.gz')) return true
  return SYNC_EXCLUDED_EXT.test(base)
}

/**
 * Two remote file identities are "unchanged" when etag matches, or (when no
 * etag is available) modifiedAt+size both match.
 */
function sameIdentity(prev, current) {
  if (!prev || !current) return false
  if (prev.etag) return current.etag === prev.etag
  return prev.modifiedAt === current.modifiedAt && prev.size === current.size
}

async function notifyWebdav(userId, event, details) {
  try {
    await NotificationsBuilder.promises.webdavSync(userId).create(event, details)
  } catch (error) {
    logger.warn({ err: error, userId, event }, 'failed to create WebDAV notification')
  }
}

function inboundProjectKey(userId, projectId) {
  return `${userId.toString()}:${projectId.toString()}`
}

function markInboundProject(userId, projectId) {
  recentlyInboundProjects.set(inboundProjectKey(userId, projectId), Date.now() + 10_000)
}

function isRecentlyInbound(userId, projectId) {
  const key = inboundProjectKey(userId, projectId)
  const inboundUntil = recentlyInboundProjects.get(key)
  if (!inboundUntil) return false
  if (inboundUntil > Date.now()) return true
  recentlyInboundProjects.delete(key)
  return false
}

function putProjectFile(client, resourcePath, body, filePath, options) {
  return client.put(resourcePath, body, options).catch(error => {
    error.projectPath = filePath
    throw error
  })
}

async function ensureDirectories(
  client,
  rootPath,
  projectName,
  folders,
  filePaths = []
) {
  const rootParts = rootPath.split('/').filter(Boolean)
  let currentRoot = ''
  for (const rootPart of rootParts) {
    currentRoot = remotePath(currentRoot, rootPart)
    await client.createDirectory(currentRoot)
  }
  await client.createDirectory(remotePath(rootPath, projectName))
  const folderPaths = new Set(
    folders
      .map(folder => folder.path)
      .filter(folderPath => folderPath !== '/')
  )
  for (const filePath of filePaths) {
    const parts = filePath.split('/').filter(Boolean)
    parts.pop()
    for (let index = 1; index <= parts.length; index++) {
      folderPaths.add(`/${parts.slice(0, index).join('/')}`)
    }
  }
  const nestedFolders = [...folderPaths]
    .sort((left, right) => {
      const lengthDifference = left.length - right.length
      return lengthDifference || left.localeCompare(right)
    })
  for (const folderPath of nestedFolders) {
    await client.createDirectory(remotePath(rootPath, projectName, folderPath))
  }
}

async function collectEntries(client, resourcePath) {
  const files = []
  const directories = []
  const entries = await client.list(resourcePath)
  for (const entry of entries) {
    if (entry.path === resourcePath || entry.path.endsWith(`${resourcePath}/`)) continue
    if (entry.isDirectory) {
      directories.push(entry)
      const nested = await collectEntries(client, entry.path)
      files.push(...nested.files)
      directories.push(...nested.directories)
    } else {
      files.push(entry)
    }
  }
  return { files, directories }
}

async function getFileBody(project, file) {
  const historyId = project.overleaf?.history?.id
  if (!historyId) throw new Error('project has no history id')
  const response = await fetch(
    `${Settings.apis.project_history.url}/project/${historyId}/blob/${file.hash}`
  )
  if (!response.ok) throw new Error(`failed to fetch project file: ${response.status}`)
  return response.arrayBuffer()
}

async function syncProject(userId, projectId, { force = false } = {}) {
  return withUserSyncLock(userId, async () => {
  const startedAt = Date.now()
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) throw new Error('WebDAV is not connected')
  const hadSyncIssue = Boolean(
    credentials.lastSyncError || credentials.lastConflict
  )
  const project = await ProjectGetter.promises.getProject(projectId, {
    name: 1,
    overleaf: 1,
  })
  if (!project) throw new Error('project not found')

  const client = new WebdavClient(credentials)
  const rootPath = credentials.rootPath || Settings.webdav.rootPath
  logger.info(
    { userId, projectId, projectName: project.name, rootPath, force },
    'WebDAV project sync started'
  )
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
  const [{ docs, files }, entities] = await Promise.all([
    Promise.all([
      ProjectEntityHandler.promises.getAllDocs(projectId),
      ProjectEntityHandler.promises.getAllFiles(projectId),
    ]).then(([docs, files]) => ({ docs, files })),
    ProjectEntityHandler.promises.getAllEntities(projectId),
  ])

  const projectRoot = remotePath(rootPath, project.name)
  await ensureDirectories(client, rootPath, project.name, entities.folders, [
    ...Object.keys(docs),
    ...Object.keys(files),
  ])
  const localPaths = new Set([
    ...Object.keys(docs),
    ...Object.keys(files),
  ])
  // State of the remote as recorded at the LAST successful sync (per file):
  // { etag, modifiedAt, size, localHash?, entityId?, type? }
  const previousState = (credentials.remoteState || {})[project.name] || {}
  const existingRemote = await collectEntries(client, projectRoot)
  const existingRemoteByPath = new Map(
    existingRemote.files.map(entry => [entry.path, entry])
  )

  // --- Un-mirror the remote (project-level export, user decision 2026-08-17) ---
  // Export = the local project wins: afterwards the remote folder is a full
  // mirror of the local project tree, so every remote entry that is not
  // present locally is deleted. Sync-excluded entries (hidden, LaTeX
  // transients) are never touched. The listing below comes from collectEntries
  // above — a failed listing already aborted the sync, so deletions never run
  // against a partial view of the remote.
  // Key format note: the local doc/file keys and entity folder paths carry a
  // leading slash ("/main.tex"), while this push lane's projectRoot ends
  // with a slash, so slice() yields slash-less relatives — normalize both
  // remote looksups to the leading-slash form used by localPaths.
  let deletedRemote = 0
  for (const entry of existingRemote.files) {
    const rawRelative = entry.path.slice(projectRoot.length) || '/'
    const relativePath = rawRelative.startsWith('/') ? rawRelative : `/${rawRelative}`
    if (isSyncExcluded(relativePath)) continue
    if (localPaths.has(relativePath)) continue
    try {
      await client.removeRetry(entry.path)
      deletedRemote += 1
    } catch (error) {
      logger.warn({ err: error, path: entry.path }, 'WebDAV push: skip remote deletion')
    }
  }
  // Directories come AFTER their (possibly deleted) children, deepest first.
  for (const directory of existingRemote.directories.sort(
    (left, right) => right.path.length - left.path.length
  )) {
    const rawRelative = directory.path.slice(projectRoot.length) || '/'
    const relativePath = rawRelative.startsWith('/') ? rawRelative : `/${rawRelative}`
    if (isSyncExcluded(relativePath)) continue
    const localDirectory = entities.folders.some(folder => folder.path === relativePath)
    if (localDirectory) continue
    try {
      await client.removeRetry(directory.path)
    } catch (error) {
      logger.warn({ err: error, path: directory.path }, 'WebDAV push: skip remote directory deletion')
    }
  }

  // --- Push local files (project-level export) ---
  // User decision (2026-08-16): like Dropbox, sync is project-level one-way.
  // Export = the local project wins: every local file is uploaded as an
  // UNCONDITIONAL overwrite (no If-Match — conditional puts 412 on the user's
  // Nextcloud and were the source of the per-file conflict churn) and every
  // remote-only entry below, so afterwards the remote folder is a full
  // mirror of the local project. No per-file conflict state is produced.
  const nextState = { ...previousState }
  for (const [filePath, doc] of Object.entries(docs)) {
    // D2/RF.5: never push sync-excluded entries (hidden, LaTeX transients).
    if (isSyncExcluded(filePath)) continue
    const resourcePath = remotePath(rootPath, project.name, filePath)
    const localContent = doc.lines.join('\n')
    const localHash = sha256(localContent)
    const remoteEntry = existingRemoteByPath.get(resourcePath)
    const prev = previousState[filePath]
    // Project-level export: unconditional overwrite, always.
    await putProjectFile(client, resourcePath, localContent, filePath, {})
    nextState[filePath] = {
      ...(remoteEntry ? { etag: remoteEntry.etag ?? null, modifiedAt: remoteEntry.modifiedAt ?? null, size: remoteEntry.size ?? 0 } : {}),
      localHash,
      ...(prev?.entityId ? { entityId: prev.entityId, type: prev.type || 'doc' } : {}),
    }
  }
  for (const [filePath, file] of Object.entries(files)) {
    // D2/RF.5: never push sync-excluded entries (hidden, LaTeX transients).
    if (isSyncExcluded(filePath)) continue
    const resourcePath = remotePath(rootPath, project.name, filePath)
    const localContent = await getFileBody(project, file)
    const localHash = sha256(localContent)
    const remoteEntry = existingRemoteByPath.get(resourcePath)
    const prev = previousState[filePath]
    // Project-level export: unconditional overwrite, always.
    await putProjectFile(client, resourcePath, localContent, filePath, {})
    nextState[filePath] = {
      ...(remoteEntry ? { etag: remoteEntry.etag ?? null, modifiedAt: remoteEntry.modifiedAt ?? null, size: remoteEntry.size ?? 0 } : {}),
      localHash,
      ...(prev?.entityId ? { entityId: prev.entityId, type: prev.type || 'file' } : {}),
    }
  }

  // Drop state entries for local files we no longer pushed (they were deleted locally)
  for (const key of Object.keys(nextState)) {
    if (!localPaths.has(key)) delete nextState[key]
  }

  // Project-level export produces no per-file conflicts: always record a
  // clean sync and clear any previously recorded conflict ($set/$unset as
  // separate operators; no-op if the doc has none).
  await WebdavCredentials.updateSyncStatus(userId, {
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
    lastConflict: null,
  })
  await SyncStateManager.updateProjectState(projectId, {
    $set: { mergeStatus: 'clean', lastSyncAt: new Date() },
    $unset: { lastConflict: 1 },
  })
  if (hadSyncIssue) {
    await notifyWebdav(userId, 'recovered', { projectName: project.name, projectId })
  }
  await WebdavCredentials.updateRemoteState(userId, project.name, nextState)
  await WebdavCredentials.markProjectSynced(userId, project.name)
  logger.info(
    {
      userId,
      projectId,
      projectName: project.name,
      localDocCount: Object.keys(docs).length,
      localFileCount: Object.keys(files).length,
      localFolderCount: entities.folders.length,
      remoteFileCount: existingRemote.files.length,
      remoteDirectoryCount: existingRemote.directories.length,
      deletedRemote,
      durationMs: Date.now() - startedAt,
    },
    'WebDAV project sync completed'
  )
  })
}

async function resolveConflict(userId, projectId, filePath, resolution) {
  return withUserSyncLock(userId, async () => {
  if (!['keep-local', 'keep-remote'].includes(resolution)) {
    throw new Error('invalid WebDAV conflict resolution')
  }
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) throw new Error('WebDAV is not connected')
  const project = await ProjectGetter.promises.getProject(projectId, {
    name: 1,
    overleaf: 1,
  })
  if (!project) throw new Error('project not found')

  const client = new WebdavClient(credentials)
  const rootPath = credentials.rootPath || Settings.webdav.rootPath
  const projectRoot = remotePath(rootPath, project.name)
  const rawLocalFilePath = filePath.startsWith(`${projectRoot}/`)
    ? filePath.slice(projectRoot.length)
    : filePath
  // projectRoot ends with '/' (remotePath()), so re-add the leading slash:
  // TPDS paths are project-absolute ('/main.tex').
  const localFilePath = rawLocalFilePath.startsWith('/')
    ? rawLocalFilePath
    : `/${rawLocalFilePath}`
  const resourcePath = remotePath(rootPath, project.name, localFilePath)
  if (resolution === 'keep-remote') {
    markInboundProject(userId, projectId)
    const body = await client.get(resourcePath)
    await TpdsUpdateHandler.promises.newUpdate(
      userId,
      projectId,
      project.name,
      localFilePath,
      Readable.from([Buffer.from(body)]),
      'webdav'
    )
  } else {
    // Keep-local = the user explicitly chose the local version after seeing
    // the conflict — forced overwrite (no If-Match). The detection-time etag
    // is stale by definition here (that staleness IS the conflict); passing
    // it would 412 forever and make the conflict unresolvable.
    await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
    const [docs, files] = await Promise.all([
      ProjectEntityHandler.promises.getAllDocs(projectId),
      ProjectEntityHandler.promises.getAllFiles(projectId),
    ])
    if (docs[localFilePath]) {
      await client.put(resourcePath, docs[localFilePath].lines.join('\n'), {})
    } else if (files[localFilePath]) {
      await client.put(resourcePath, await getFileBody(project, files[localFilePath]), {})
    } else {
      throw new Error(`local WebDAV conflict path not found: ${localFilePath}`)
    }
  }
  await WebdavCredentials.updateSyncStatus(userId, {
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
    lastConflict: null,
  })
  })
}

async function syncProjectForLinkedUsers(projectId) {
  // Per-user locks are acquired inside syncProject; iterate users without
  // a shared project Set (removes the previous global guard).
  const projectKey = projectId.toString()

  const users = await WebdavCredentials.getLinkedUserIds()
  const results = await Promise.allSettled(
    users.map(async userId => {
      if (isRecentlyInbound(userId, projectId)) return
      const projects = await ProjectGetter.promises.findAllUsersProjects(
        userId,
        '_id archived trashed'
      )
      const writableProjects = [
        ...projects.owned,
        ...projects.readAndWrite,
      ].filter(project => !ProjectHelper.isArchivedOrTrashed(project, userId))
      if (
        writableProjects.some(project => project._id.toString() === projectKey)
      ) {
        await syncProject(userId, projectId)
      }
    })
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason, projectId }, 'WebDAV sync failed')
      const conflict = result.reason?.status === 412
        ? {
          projectId: projectId.toString(),
          path: result.reason.projectPath || null,
          detectedAt: new Date().toISOString(),
        }
        : null
      await WebdavCredentials.updateSyncStatus(users[index], {
        lastSyncError: conflict
          ? 'A remote file changed before it could be synchronized.'
          : result.reason?.message || 'sync failed',
        lastConflict: conflict,
      })
      await notifyWebdav(
        users[index],
        conflict ? 'conflict' : 'failure',
        { projectId, path: conflict?.path }
      )
    }
  }
}

async function syncAllProjectsForUser(userId, { force = false } = {}) {
  const projects = await ProjectGetter.promises.findAllUsersProjects(
    userId,
    '_id name archived trashed'
  )
  const writableProjects = [
    ...projects.owned,
    ...projects.readAndWrite,
  ].filter(project => !ProjectHelper.isArchivedOrTrashed(project, userId))
  const results = await Promise.allSettled(
    writableProjects.map(project =>
      syncProject(userId, project._id, { force })
    )
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      const project = writableProjects[index]
      const conflict = result.reason?.status === 412
      await WebdavCredentials.updateSyncStatus(userId, {
        lastSyncError: conflict
          ? 'A remote file changed before it could be synchronized.'
          : result.reason?.message || 'sync failed',
        lastConflict: conflict
          ? {
            projectId: project._id.toString(),
            path: result.reason.projectPath || null,
            detectedAt: new Date().toISOString(),
          }
          : null,
      })
      logger.error(
        {
          err: result.reason,
          userId,
          projectId: project._id,
          resourcePath: result.reason?.resourcePath,
          status: result.reason?.status,
        },
        'WebDAV initial project sync failed'
      )
    }
  }
  logger.info(
    { userId, projectCount: writableProjects.length },
    'WebDAV initial project sync complete'
  )
}

async function moveEntityForLinkedUsers(params) {
  if (!params.newProjectName) {
    await syncProjectForLinkedUsers(params.projectId)
    return
  }

  const users = await WebdavCredentials.getLinkedUserIds()
  const results = await Promise.allSettled(
    users.map(async userId => {
      const projects = await ProjectGetter.promises.findAllUsersProjects(
        userId,
        '_id archived trashed'
      )
      const writableProjects = [
        ...projects.owned,
        ...projects.readAndWrite,
      ].filter(project => !ProjectHelper.isArchivedOrTrashed(project, userId))
      if (
        !writableProjects.some(
          project => project._id.toString() === params.projectId.toString()
        )
      ) {
        return
      }

      const credentials = await WebdavCredentials.get(userId)
      if (!credentials) return
      const client = new WebdavClient(credentials)
      const rootPath = credentials.rootPath || Settings.webdav.rootPath
      try {
        await client.move(
          remotePath(rootPath, params.projectName),
          remotePath(rootPath, params.newProjectName)
        )
      } catch (error) {
        if (error.status !== 404) throw error
      }
      await syncProject(userId, params.projectId)
      await WebdavCredentials.renameProject(
        userId,
        params.projectName,
        params.newProjectName
      )
    })
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error(
        { err: result.reason, projectId: params.projectId },
        'WebDAV move sync failed'
      )
    }
  }
}

async function deleteProjectForUsers({ projectId, projectName, userIds }) {
  const results = await Promise.allSettled(
    userIds.map(async userId => {
      const credentials = await WebdavCredentials.get(userId)
      if (!credentials || !credentials.syncedProjects?.includes(projectName)) {
        return
      }
      const client = new WebdavClient(credentials)
      const rootPath = credentials.rootPath || Settings.webdav.rootPath
      const resourcePath = remotePath(rootPath, projectName)
      try {
        await client.removeRetry(resourcePath)
        logger.info(
          { userId, projectId, projectName, resourcePath },
          'WebDAV project folder deleted'
        )
      } catch (error) {
        logger.error(
          { err: error, userId, projectId, projectName, resourcePath },
          'WebDAV project folder deletion failed'
        )
        throw error
      } finally {
        await WebdavCredentials.forgetProject(userId, projectName)
      }
    })
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.error(
        { err: result.reason, userId: userIds[index], projectId, projectName },
        'WebDAV project deletion sync failed'
      )
    }
  }
}

async function walk(client, resourcePath, callback) {
  const entries = await client.list(resourcePath)
  for (const entry of entries) {
    if (
      entry.path === resourcePath ||
      !entry.path.startsWith(`${resourcePath}/`)
    ) {
      continue
    }
    if (entry.isDirectory) {
      await walk(client, entry.path, callback)
    } else {
      await callback(entry)
    }
  }
}

async function pollUser(userId, { onlyProjectName = null } = {}) {
  return withUserSyncLock(userId, async () => {
  const startedAt = Date.now()
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) return
  const client = new WebdavClient(credentials)
  const rootPath = credentials.rootPath || Settings.webdav.rootPath
  let changedFileCount = 0
  let conflictCount = 0
  let deletedLocalCount = 0
  let createdLocalFolderCount = 0
  logger.info({ userId, rootPath, onlyProjectName }, 'WebDAV poll started')
  const rootEntries = await client.list(rootPath)
  const remoteProjects = rootEntries
    .filter(entry => entry.isDirectory && entry.path !== rootPath)
    .map(entry => ({
      projectName: entry.path.split('/').filter(Boolean).pop(),
      projectRoot: entry.path.replace(/\/$/, ''),
    }))
    .filter(({ projectName }) => (onlyProjectName ? projectName === onlyProjectName : true))

  if (onlyProjectName && remoteProjects.length === 0) {
    // Remote project folder is missing. Do NOT treat a missing folder as
    // confirmation that the project should be deleted (ARC-06): record the
    // suspicion, notify, and let the user decide.
    await WebdavCredentials.updateSyncStatus(userId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncError: `Remote project folder "${onlyProjectName}" not found`,
    })
    await notifyWebdav(userId, 'remote-missing', { projectName: onlyProjectName })
    return
  }

  for (const { projectName, projectRoot } of remoteProjects) {
    const projects = await ProjectGetter.promises.findUsersProjectsByName(
      userId,
      projectName
    )
    // WD-19: mark ALL same-name projects inbound so the auto-sync echo is
    // suppressed even when multiple projects share the name
    projects.forEach(project => markInboundProject(userId, project._id))

    // C3: unlink must stop the poller — a project receives remote changes
    // ONLY while it is still linked: a WebdavSyncProjectStates doc exists for
    // it AND the user's credentials still list it in syncedProjects. (Before
    // this gate, unlinking the project was cosmetic: the poll kept applying
    // remote changes to "unlinked" projects.)
    if (projects.length === 1) {
      const stillLinked = Boolean(credentials.syncedProjects?.includes(projectName))
      const stateDoc = stillLinked
        ? await SyncStateManager.getProjectState(projects[0]._id, { _id: 1 })
        : null
      if (!stillLinked || !stateDoc) {
        logger.info(
          { userId, projectName, stillLinked, hasStateDoc: Boolean(stateDoc) },
          'C3: poller skipping unlinked project'
        )
        if (stillLinked) {
          // State doc is gone (e.g. unlink removed it) but the credentials
          // still list the project — drop the orphan entry so it cannot
          // resurface on a later poll. Best-effort: never fail the poll for it.
          try {
            await WebdavCredentials.forgetProject(userId, projectName)
          } catch (cleanupErr) {
            logger.warn(
              { err: cleanupErr, userId, projectName },
              'C3: orphan syncedProjects cleanup failed'
            )
          }
        }
        continue
      }
    }

    const previousState = credentials.remoteState?.[projectName] || {}
    const nextState = { ...previousState }
    // Note (2026-08-16, project-level sync): the pull lane no longer reads
    // local content for per-file conflict detection — Import applies every
    // changed/new remote entry unconditionally (remote folder wins).

    // Local entity presence at import time: needed so a remote file that is
    // unchanged since the last sync but was DELETED locally afterwards still
    // gets re-applied (remote wins — after Import both trees must be
    // identical). For the rare multi-project name collision, legacy behavior
    // (no local-presence check) is kept.
    let localPresentPaths = null
    if (projects.length === 1) {
      const [importLocalDocs, importLocalFiles] = await Promise.all([
        ProjectEntityHandler.promises.getAllDocs(projects[0]._id),
        ProjectEntityHandler.promises.getAllFiles(projects[0]._id),
      ])
      localPresentPaths = new Set(
        [...Object.keys(importLocalDocs), ...Object.keys(importLocalFiles)].map(
          p => (p.startsWith('/') ? p : `/${p}`)
        )
      )
    }
    // Remote directories (folder presence), so a local empty folder that the
    // remote tree also has is NOT deleted (identical trees after Import).
    const remoteRelativeDirs = new Set()
    // Remote FILES collected by THIS walk. (Do NOT derive the delete set from
    // nextState: previousState carries ghost entries for paths that were
    // removed remotely since the last sync — those would wrongly protect
    // local-only files from mirror deletion.)
    const remoteRelativeFiles = new Set()

    await walk(client, projectRoot, async entry => {
      let relativePath = entry.path.slice(projectRoot.length) || '/'
      // projectRoot (remotePath()) ends with '/', so re-add the leading
      // slash: TPDS paths are project-absolute and dirname() of a bare
      // name is '.' (fails the element-name check).
      if (!relativePath.startsWith('/')) relativePath = `/${relativePath}`
      if (entry.isDirectory) {
        remoteRelativeDirs.add(relativePath.startsWith('/') ? relativePath : `/${relativePath}`)
      } else {
        remoteRelativeFiles.add(relativePath.startsWith('/') ? relativePath : `/${relativePath}`)
      }
      // D2/RF.5: never process sync-excluded remote entries (hidden, LaTeX
      // transients) — they are neither applied, baselined, nor reported.
      if (isSyncExcluded(relativePath)) return
      const remoteState = {
        etag: entry.etag,
        modifiedAt: entry.modifiedAt,
        size: entry.size,
      }
      const prev = previousState[relativePath]
      const localStillPresent = localPresentPaths
        ? localPresentPaths.has(relativePath)
        : true

      if (prev && sameIdentity(prev, remoteState) && localStillPresent) {
        // Remote unchanged since last sync AND still present locally — keep
        // what we had. (If it was deleted locally since the last sync, fall
        // through and re-apply: remote wins.)
        nextState[relativePath] = prev
        return
      }

      // Project-level import (user decision 2026-08-17): Import = the remote
      // folder wins. Any remote entry that changed, is new, or was deleted
      // locally since the last sync is applied unconditionally; local files
      // the remote tree does not contain are deleted afterwards, so after
      // Import the local project and the remote folder are identical.

      const body = await client.get(entry.path)
      // H3: no-phantom-update guard — if the remote body is byte-identical to
      // what we last synced locally, the "remote changed" flag is a stale-etag
      // artifact (the post-put etag was never recorded). Refresh the identity
      // record and SKIP the apply: no project update, no history churn —
      // EXCEPT when the local entity was deleted since the last sync, then
      // the remote file must be re-applied (remote wins).
      if (prev?.localHash && prev.localHash === sha256(body) && localStillPresent) {
        nextState[relativePath] = {
          ...remoteState,
          localHash: prev.localHash,
          ...(prev?.entityId ? { entityId: prev.entityId, type: prev.type } : {}),
        }
        return
      }
      changedFileCount++
      if (projects.length === 1) {
        // String projectId required: TpdsUpdateHandler does string comparisons
        // against project._id.toString() — ObjectId args silently no-op.
        await TpdsUpdateHandler.promises.newUpdate(
          userId,
          String(projects[0]._id),
          projectName,
          relativePath,
          Readable.from([Buffer.from(body)]),
          'webdav'
        )
      }
      nextState[relativePath] = {
        ...remoteState,
        localHash: sha256(body),
        ...(prev?.entityId ? { entityId: prev.entityId, type: prev.type } : {}),
      }
    })

    if (projects.length === 1) {
      const project = projects[0]
      await ProjectDeleter.promises.unmarkAsDeletedByExternalSource(project._id)
      const entities = await ProjectEntityHandler.promises.getAllEntities(project._id)
      for (const entity of entities.docs) {
        const normalizedEntityPath = entity.path.startsWith('/') ? entity.path : '/' + entity.path
        if (nextState[normalizedEntityPath]) {
          nextState[normalizedEntityPath].entityId = entity.doc._id.toString()
          nextState[normalizedEntityPath].type = 'doc'
        }
      }
      for (const entity of entities.files) {
        const normalizedEntityPath = entity.path.startsWith('/') ? entity.path : '/' + entity.path
        if (nextState[normalizedEntityPath]) {
          nextState[normalizedEntityPath].entityId = entity.file._id.toString()
          nextState[normalizedEntityPath].type = 'file'
        }
      }
      // --- Un-mirror local (project-level import, user decision 2026-08-17) ---
      // Import = the remote folder wins: afterwards the local project is a
      // full mirror of the remote tree, so local docs/files (and folders) the
      // remote tree does not contain are deleted. Sync-excluded entries
      // (hidden, LaTeX transients) are never touched; a folder is only
      // removed if it no longer holds any surviving local entry. This runs
      // only because the full remote walk above completed — a failed walk
      // (network error, missing remote folder) aborts before any local
      // deletion.
      // Remote file set = what THIS walk actually saw (see remoteRelativeFiles
      // above).
      const remoteRelativePaths = new Set(remoteRelativeFiles)
      const localPaths = [
        ...entities.docs.map(entity => (entity.path.startsWith('/') ? entity.path : `/${entity.path}`)),
        ...entities.files.map(entity => (entity.path.startsWith('/') ? entity.path : `/${entity.path}`)),
      ]
      const toDelete = localPaths.filter(
        p => !remoteRelativePaths.has(p) && !isSyncExcluded(p)
      )
      let deletedLocal = 0
      for (const localPath of toDelete) {
        try {
          await TpdsUpdateHandler.promises.deleteUpdate(
            userId,
            String(project._id),
            project.name,
            localPath,
            'webdav'
          )
          deletedLocal += 1
        } catch (error) {
          logger.warn({ err: error, path: localPath }, 'WebDAV import: failed to delete local-only entry')
        }
      }
      const survivingLocalPaths = localPaths.filter(p => !toDelete.includes(p))
      // Local folders: deepest first, only when absent remotely and not
      // still containing a surviving local entry (e.g. sync-excluded files).
      for (const folder of [...entities.folders].sort(
        (a, b) => b.path.length - a.path.length
      )) {
        const folderPath = folder.path.startsWith('/') ? folder.path : `/${folder.path}`
        if (folderPath === '/') continue
        if (remoteRelativePaths.has(folderPath) || remoteRelativeDirs.has(folderPath)) continue
        if (isSyncExcluded(folderPath)) continue
        if (survivingLocalPaths.some(p => p.startsWith(`${folderPath}/`))) continue
        try {
          await TpdsUpdateHandler.promises.deleteUpdate(
            userId,
            String(project._id),
            project.name,
            folderPath,
            'webdav'
          )
          deletedLocal += 1
        } catch (error) {
          logger.warn({ err: error, path: folderPath }, 'WebDAV import: failed to delete local-only folder')
        }
      }
      // Create local folders for remote directories the local project lacks
      // (full tree parity after Import; shallowest first so parents exist).
      let createdLocalFolders = 0
      const localFolderPaths = new Set(
        entities.folders.map(folder =>
          folder.path.startsWith('/') ? folder.path : `/${folder.path}`)
      )
      for (const dir of [...remoteRelativeDirs].sort((a, b) => a.length - b.length)) {
        if (dir === '/') continue
        if (localFolderPaths.has(dir)) continue
        if (isSyncExcluded(dir)) continue
        try {
          await TpdsUpdateHandler.promises.createFolder(
            userId,
            String(project._id),
            project.name,
            dir
          )
          createdLocalFolders += 1
        } catch (error) {
          logger.warn({ err: error, path: dir }, 'WebDAV import: failed to create local folder')
        }
      }
      createdLocalFolderCount += createdLocalFolders
      deletedLocalCount += deletedLocal
    }

    // Project-level import produces no per-file conflicts: a successful poll
    // always records a clean sync and clears any previously recorded conflict
    // (separate operators; updateOne is a no-op if no doc exists).
    if (projects.length === 1) {
      await SyncStateManager.updateProjectState(projects[0]._id, {
        $set: { mergeStatus: 'clean', lastSyncAt: new Date() },
        $unset: { lastConflict: 1 },
      })
    }

    await WebdavCredentials.updateRemoteState(userId, projectName, nextState)
    await WebdavCredentials.markProjectSynced(userId, projectName)
  }

  // Projects that were synced but whose remote folder no longer exists:
  // unlink the sync state + notify — never mark the Overleaf project as
  // deleted by an external source (ARC-06).
  for (const projectName of credentials.syncedProjects || []) {
    if (remoteProjects.some(({ projectName: p }) => p === projectName)) continue
    if (onlyProjectName && projectName !== onlyProjectName) continue
    await WebdavCredentials.forgetProject(userId, projectName)
    await notifyWebdav(userId, 'remote-missing', { projectName })
  }
  if (conflictCount === 0) {
    await WebdavCredentials.updateSyncStatus(userId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncError: null,
      lastConflict: null,
    })
  }
  logger.info(
    {
      userId,
      rootPath,
      remoteProjectCount: remoteProjects.length,
      changedFileCount,
      deletedLocalCount,
      createdLocalFolderCount,
      conflictCount,
      durationMs: Date.now() - startedAt,
    },
    'WebDAV poll completed'
  )
  })
}

/**
 * Pull remote changes for a SINGLE project (per-project scope, WD-05).
 *
 * @param {string} userId
 * @param {string|ObjectId} projectId
 */
async function pollProject(userId, projectId) {
  const credentials = await WebdavCredentials.get(userId)
  if (!credentials) {
    throw Object.assign(new Error('WebDAV is not connected'), { status: 409 })
  }
  const project = await ProjectGetter.promises.getProject(projectId, { name: 1 })
  if (!project) throw new Error('project not found')
  await pollUser(userId, { onlyProjectName: project.name })
}

export default {
  syncProject,
  resolveConflict,
  syncAllProjectsForUser,
  syncProjectForLinkedUsers,
  moveEntityForLinkedUsers,
  deleteProjectForUsers,
  pollUser,
  pollProject,
}