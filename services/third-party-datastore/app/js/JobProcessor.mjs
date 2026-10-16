import { buffer } from 'node:stream/consumers'
import logger from '@overleaf/logger'
import { fetchStream, RequestFailedError } from '@overleaf/fetch-utils'
import DropboxClient from './DropboxClient.mjs'
import StateManager from './StateManager.mjs'
import PullManager from './PullManager.mjs'
import { isConflict, isNotFound } from './Errors.mjs'

// Jobs are built by web's TpdsUpdateSender as requests against this service:
//   POST   /user/:userId/entity/:path        addDoc/addFile (pipeStreamFrom)
//   DELETE /user/:userId/entity/:path        deleteEntity
//   PUT    /user/:userId/entity              moveEntity ({ startPath, endPath })
//   POST   /user/:userId/project/new/:name   createProject
//   POST   /user/poll                        pollDropboxForUser ({ user_ids })
// where :path is the encoded '<project name>/<path in project>'
const ROUTES = [
  { method: 'post', re: /^\/user\/([^/]+)\/entity\/(.+)$/, handler: addEntity },
  { method: 'delete', re: /^\/user\/([^/]+)\/entity\/(.+)$/, handler: deleteEntity },
  { method: 'put', re: /^\/user\/([^/]+)\/entity$/, handler: moveEntity },
  { method: 'post', re: /^\/user\/([^/]+)\/project\/new\/(.+)$/, handler: createProject },
  { method: 'post', re: /^\/user\/poll$/, handler: poll },
]

async function processJob(job) {
  const { pathname } = new URL(job.uri)
  for (const route of ROUTES) {
    const match = pathname.match(route.re)
    if (match && job.method?.toLowerCase() === route.method) {
      const [, userId, path] = match
      return await route.handler(job, userId, path && decodeURIComponent(path))
    }
  }
  throw new Error(`unknown tpds job: ${job.method} ${pathname}`)
}

// '<project name>/<path>' -> '/<project name>/<path>'
function dropboxPath(entityPath) {
  return '/' + entityPath.split('/').filter(Boolean).join('/')
}

async function fetchContents(job) {
  for (const url of [job.streamOrigin, job.streamFallback].filter(Boolean)) {
    try {
      return await buffer(await fetchStream(url))
    } catch (err) {
      if (!(err instanceof RequestFailedError && err.response.status === 404)) {
        throw err
      }
    }
  }
  return null
}

// Each project has a folder of its own, found by project id (web sends it in
// x-project-id), as web names the paths of its jobs after the project. A new
// project gets the folder of its name, unless another project of the user
// has it: then Dropbox appends a number (autorename), e.g. 'Thesis (1)'.
async function projectFolder(userId, client, projectId, projectName) {
  const mapped = await StateManager.getFolderOfProject(userId, projectId)
  if (mapped) {
    return mapped.pathLower
  }
  const path = dropboxPath(projectName)
  let folder
  if (await StateManager.getProjectByFolder(userId, path)) {
    folder = await client.createFolder(path, true)
  } else {
    try {
      folder = await client.createFolder(path)
    } catch (err) {
      if (!isConflict(err)) {
        throw err
      }
      // in Dropbox already, but no project's (e.g. synced before an unlink)
      folder = await client.getMetadata(path)
      if (folder['.tag'] !== 'folder') {
        // a file of that name at the top level: a folder of its own
        folder = await client.createFolder(path, true)
      }
    }
  }
  await StateManager.setProjectFolder(
    userId,
    projectId,
    folder.id,
    folder.path_display
  )
  return folder.path_display
}

// The path in Dropbox of '<project name>/<path>' of a job, or null when the
// project has no folder yet and create is false
async function projectPath(userId, client, job, entityPath, create) {
  const [projectName, ...rest] = entityPath.split('/').filter(Boolean)
  const projectId = job.headers['x-project-id']
  const folder = create
    ? await projectFolder(userId, client, projectId, projectName)
    : (await StateManager.getFolderOfProject(userId, projectId))?.pathLower
  return folder && [folder, ...rest].join('/')
}

async function addEntity(job, userId, entityPath) {
  const client = await DropboxClient.forUser(userId)
  if (!client) {
    return
  }
  const contents = await fetchContents(job)
  if (contents == null) {
    // deleted since it was queued, its deletion follows in the queue
    logger.debug({ userId, uri: job.uri }, 'tpds: entity gone, skipping')
    return
  }
  const path = await projectPath(userId, client, job, entityPath, true)
  const rev = (await StateManager.findEntityByPath(userId, path))?.dropbox.rev
  let metadata
  try {
    metadata = await client.upload(path, contents, rev)
  } catch (err) {
    if (rev && isConflict(err)) {
      logger.debug({ userId, uri: job.uri }, 'tpds: changed in Dropbox, skipping')
      return
    }
    throw err
  }
  await StateManager.recordEntity(
    userId,
    {
      projectId: job.headers['x-project-id'],
      entityId: job.headers['x-entity-id'],
      entityType: job.headers['x-entity-type'],
    },
    metadata
  )
}

async function deleteEntity(job, userId, entityPath) {
  const client = await DropboxClient.forUser(userId)
  if (!client) {
    return
  }
  const path = await projectPath(userId, client, job, entityPath, false)
  if (!path) {
    return // nothing of the project in Dropbox
  }
  try {
    await client.delete(path)
  } catch (err) {
    if (!isNotFound(err)) {
      throw err
    }
  }
  await StateManager.removeEntities(userId, path)
  await StateManager.addTombstone(userId, path)
}

// Dropbox ignores case: a move that only changes it conflicts with the entity
// itself, so it goes through another name. The name is fixed per move, so
// that a retry after the first step only does the second one.
async function moveChangingCase(client, startPath, endPath) {
  const temporaryPath = `${endPath}.case-rename`
  try {
    await client.move(startPath, temporaryPath)
  } catch (err) {
    if (!isNotFound(err)) {
      throw err
    }
    // an earlier attempt got as far as the temporary name
  }
  return await client.move(temporaryPath, endPath)
}

// Renaming a project moves its folder ('/old/' -> '/new/'); a name another
// project's folder has gets a number appended, as for a new project
async function renameProject(job, userId, client, newName) {
  const projectId = job.headers['x-project-id']
  const mapped = await StateManager.getFolderOfProject(userId, projectId)
  const endPath = dropboxPath(newName)
  if (!mapped) {
    return // its folder is made, under the new name, on its next update
  }
  let folder
  try {
    folder =
      mapped.pathLower === endPath.toLowerCase()
        ? await moveChangingCase(client, mapped.pathLower, endPath)
        : await client.move(mapped.pathLower, endPath, true)
  } catch (err) {
    if (isNotFound(err)) {
      // gone from Dropbox, made again on the project's next update
      await StateManager.removeProjectFolder(userId, mapped.pathLower)
      return
    }
    throw err
  }
  await StateManager.moveEntities(userId, mapped.pathLower, folder.path_display)
  await StateManager.setProjectFolder(
    userId,
    projectId,
    folder.id,
    folder.path_display
  )
  await StateManager.addTombstone(userId, mapped.pathLower)
}

async function moveEntity(job, userId) {
  const client = await DropboxClient.forUser(userId)
  if (!client) {
    return
  }
  const end = job.json.endPath.split('/').filter(Boolean)
  if (end.length === 1) {
    return await renameProject(job, userId, client, end[0])
  }
  const startPath = await projectPath(userId, client, job, job.json.startPath, false)
  const endPath = await projectPath(userId, client, job, job.json.endPath, false)
  if (!startPath || startPath === endPath) {
    return // not in Dropbox (yet), its contents are sent on their next update
  }
  try {
    if (startPath.toLowerCase() === endPath.toLowerCase()) {
      await moveChangingCase(client, startPath, endPath)
    } else {
      await client.move(startPath, endPath)
    }
  } catch (err) {
    if (isNotFound(err)) {
      // not in Dropbox (yet), its contents are sent on their next update
      return
    }
    // a case-only move conflicts at its temporary name, and its target is the
    // entity itself: nothing to delete
    if (!isConflict(err) || startPath.toLowerCase() === endPath.toLowerCase()) {
      throw err
    }
    // something is in the way at the target in Dropbox: Overleaf wins
    await client.delete(endPath)
    await client.move(startPath, endPath)
  }
  await StateManager.moveEntities(userId, startPath, endPath)
  await StateManager.addTombstone(userId, startPath)
}

// Web asks for the folder of a new project, and of a project the user was
// added to (CollaboratorsHandler: 'a dedicated folder for this "new" project')
async function createProject(job, userId, projectName) {
  const client = await DropboxClient.forUser(userId)
  if (!client) {
    return
  }
  await projectFolder(userId, client, job.headers['x-project-id'], projectName)
}

async function poll(job) {
  for (const userId of job.json.user_ids) {
    await PullManager.pullForUser(userId)
  }
}

export default { processJob }
