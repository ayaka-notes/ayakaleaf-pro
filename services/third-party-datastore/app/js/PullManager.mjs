import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { RequestFailedError } from '@overleaf/fetch-utils'
import DropboxClient from './DropboxClient.mjs'
import TokenManager from './TokenManager.mjs'
import StateManager from './StateManager.mjs'
import QueueManager from './QueueManager.mjs'
import WebApiClient from './WebApiClient.mjs'
import { classify, Action } from './Errors.mjs'

// Dropbox → Overleaf. Runs as the 'poll' job in the user's queue, so it is
// ordered with the user's Overleaf → Dropbox jobs. The cursor only advances
// past a page once every change on it has been applied or skipped; a
// transient failure throws and the whole poll is retried from the cursor.
async function pullForUser(userId) {
  // changes made from now on need another poll
  await QueueManager.clearPollPending(userId)
  const startedAt = new Date()
  const dropbox = await TokenManager.getUserDropbox(userId)
  const client = dropbox && (await DropboxClient.forUser(userId))
  if (!client) {
    return
  }
  const accountId = dropbox.access_token.uid

  if (!dropbox.cursor) {
    // first poll after linking: the projects were just sent to Dropbox
    const cursor = await client.latestCursor()
    await StateManager.setCursor(userId, accountId, cursor)
    await StateManager.clearTombstones(userId, startedAt)
    return
  }

  let page
  // the paths of a listing of the whole folder, after a cursor reset
  let listed = null
  try {
    page = await client.listFolderContinue(dropbox.cursor)
  } catch (err) {
    if (!DropboxClient.errorSummary(err).startsWith('reset')) {
      throw err
    }
    // the cursor expired: go over the whole folder again, files that are
    // already in sync are skipped by their content hash
    logger.warn({ userId }, 'tpds: dropbox cursor reset, listing all files')
    page = await client.listFolder()
    listed = new Set()
  }
  for (;;) {
    for (const entry of page.entries) {
      await applyEntry(userId, client, entry)
      listed?.add(entry.path_lower)
    }
    // after a reset the cursor waits for the deletions below, so that a
    // retry lists the whole folder again
    if (!listed) {
      await StateManager.setCursor(userId, accountId, page.cursor)
    }
    if (!page.has_more) {
      break
    }
    page = await client.listFolderContinue(page.cursor)
  }
  if (listed) {
    await applyUnlistedDeletions(userId, client, listed)
    await StateManager.setCursor(userId, accountId, page.cursor)
  }
  await StateManager.clearTombstones(userId, startedAt)
}

// A listing has no deletions in it: what is synced but was not listed has
// been deleted in Dropbox. A missing project folder covers its files.
async function applyUnlistedDeletions(userId, client, listed) {
  const { folders, files } = await StateManager.getSyncedPaths(userId)
  const goneFolders = folders.filter(folder => !listed.has(folder))
  const goneFiles = files.filter(
    file =>
      !listed.has(file) &&
      !goneFolders.some(folder => file.startsWith(folder + '/'))
  )
  for (const path of [...goneFolders, ...goneFiles]) {
    await applyEntry(userId, client, { '.tag': 'deleted', path_lower: path })
  }
}

async function applyEntry(userId, client, entry) {
  try {
    switch (entry['.tag']) {
      case 'file':
        return await applyFile(userId, client, entry)
      case 'folder':
        return await applyFolder(userId, client, entry)
      case 'deleted':
        return await applyDeletion(userId, entry)
    }
  } catch (err) {
    // web refused it for good (e.g. an invalid file name): skip the change
    const status = err instanceof RequestFailedError && err.response.status
    if ((status >= 400 && status < 500) || classify(err).action === Action.SKIP) {
      logger.warn(
        { err, userId, path: entry.path_display },
        'tpds: skipping dropbox change'
      )
      return
    }
    throw err
  }
}

// '/Project/a/b.tex' -> { folder: '/Project', projectName: 'Project', path: 'a/b.tex' }
function splitPath(pathDisplay) {
  const [projectName, ...rest] = pathDisplay.split('/').filter(Boolean)
  return { folder: '/' + projectName, projectName, path: rest.join('/') }
}

// The project of a Dropbox folder: the mapped one (where web checks write
// access) or else the project of that name, created when there is none
async function resolveProject(userId, client, folder, projectName) {
  const mapped = await StateManager.getProjectByFolder(userId, folder)
  if (mapped) {
    return mapped.projectId.toString()
  }
  const { status, projectId } = await WebApiClient.resolveProject(userId, {
    projectName,
  })
  if (status !== 'success') {
    return null
  }
  if (await StateManager.getFolderOfProject(userId, projectId)) {
    // that project syncs with a folder of its own, e.g. 'Thesis (1)': this
    // one is not its folder (left by a deleted project, made in Dropbox)
    return null
  }
  const metadata = await client.getMetadata(folder)
  await StateManager.setProjectFolder(userId, projectId, metadata.id, folder)
  return projectId
}

async function applyFile(userId, client, entry) {
  const { folder, projectName, path } = splitPath(entry.path_display)
  if (!path) {
    return // files at the top level are not in a project
  }
  const known = await StateManager.findEntityByPath(userId, entry.path_lower)
  if (known?.dropbox.contentHash === entry.content_hash) {
    return // our own upload, or already applied
  }
  if (entry.size > Settings.maxUploadSize) {
    // web would refuse it, and the download is held in memory
    logger.warn(
      { userId, path: entry.path_display, size: entry.size },
      'tpds: skipping dropbox file over the upload limit'
    )
    return
  }
  const projectId = await resolveProject(userId, client, folder, projectName)
  if (!projectId) {
    return
  }
  const { contents, metadata } = await client.download(entry.path_lower)
  const result = await WebApiClient.mergeUpdate(userId, projectId, path, contents)
  if (result.status !== 'applied') {
    return
  }
  await StateManager.recordEntity(
    userId,
    {
      projectId: result.projectId,
      entityId: result.entityId,
      entityType: result.entityType,
    },
    metadata
  )
}

async function applyFolder(userId, client, entry) {
  const { folder, projectName, path } = splitPath(entry.path_display)
  const projectId = await resolveProject(userId, client, folder, projectName)
  if (!projectId || !path) {
    return
  }
  await WebApiClient.createFolder(userId, projectId, path)
}

async function applyDeletion(userId, entry) {
  const tombstone = await StateManager.findTombstone(userId, entry.path_lower)
  if (tombstone) {
    return // deleted or moved away by us
  }
  // deleted entries may only carry the lower-cased path
  const { folder, projectName, path } = splitPath(
    entry.path_display || entry.path_lower
  )
  const mapped = path && (await StateManager.getProjectByFolder(userId, folder))
  if (mapped) {
    await WebApiClient.deleteUpdate(userId, mapped.projectId.toString(), path)
  } else {
    await WebApiClient.deleteUpdateByName(userId, projectName, path)
  }
  if (!path) {
    await StateManager.removeProjectFolder(userId, folder)
  }
  await StateManager.removeEntities(userId, entry.path_lower)
}

export default { pullForUser }
