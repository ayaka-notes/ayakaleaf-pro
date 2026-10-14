import { db, ObjectId } from './mongodb.mjs'

// Sync state, in the collections and indexes that web's tools/migrations
// create:
//  - dropboxEntities: one entry per synced file, unique on
//    (overleaf.userId, overleaf.id) and (overleaf.userId, dropbox.id). The
//    content hash recognises our own uploads when Dropbox reports them back.
//    Tombstones (no overleaf.id/dropbox.id) mark paths that we deleted or
//    moved away in Dropbox ourselves, until the next pull has seen them.
//  - dropboxProjects: project <-> Dropbox folder, unique on
//    (userId, projectId) and (userId, dropboxId)
//  - users.dropbox.cursor: the list_folder cursor of the user's app folder

function lower(path) {
  return path.toLowerCase().replace(/\/+$/, '')
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// the path itself and everything below it
function subtreeQuery(pathLower) {
  return {
    $in: [pathLower, new RegExp('^' + escapeRegExp(pathLower) + '/')],
  }
}

// '/a/b/c' -> ['/a', '/a/b', '/a/b/c']
function selfAndAncestors(pathLower) {
  const parts = pathLower.split('/').filter(Boolean)
  return parts.map((_, i) => '/' + parts.slice(0, i + 1).join('/'))
}

async function recordEntity(userId, overleaf, metadata) {
  const uid = new ObjectId(userId)
  const pathLower = lower(metadata.path_lower)
  const sameEntity = [
    { 'dropbox.id': metadata.id },
    { 'dropbox.pathLower': pathLower },
  ]
  if (overleaf.entityId) {
    sameEntity.push({ 'overleaf.id': new ObjectId(overleaf.entityId) })
  }
  await db.dropboxEntities.deleteMany({ 'overleaf.userId': uid, $or: sameEntity })
  await db.dropboxEntities.insertOne({
    overleaf: {
      userId: uid,
      ...(overleaf.projectId && {
        projectId: new ObjectId(overleaf.projectId),
      }),
      ...(overleaf.entityId && { id: new ObjectId(overleaf.entityId) }),
      ...(overleaf.entityType && { type: overleaf.entityType }),
    },
    dropbox: {
      id: metadata.id,
      pathLower,
      rev: metadata.rev,
      contentHash: metadata.content_hash,
    },
  })
}

async function findEntityByPath(userId, path) {
  return await db.dropboxEntities.findOne({
    'overleaf.userId': new ObjectId(userId),
    'dropbox.pathLower': lower(path),
    tombstone: { $exists: false },
  })
}

async function removeEntities(userId, path) {
  await db.dropboxEntities.deleteMany({
    'overleaf.userId': new ObjectId(userId),
    'dropbox.pathLower': subtreeQuery(lower(path)),
    tombstone: { $exists: false },
  })
}

async function moveEntities(userId, fromPath, toPath) {
  const from = lower(fromPath)
  const to = lower(toPath)
  const entities = db.dropboxEntities.find({
    'overleaf.userId': new ObjectId(userId),
    'dropbox.pathLower': subtreeQuery(from),
    tombstone: { $exists: false },
  })
  for await (const entity of entities) {
    await db.dropboxEntities.updateOne(
      { _id: entity._id },
      { $set: { 'dropbox.pathLower': to + entity.dropbox.pathLower.slice(from.length) } }
    )
  }
}

async function addTombstone(userId, path) {
  await db.dropboxEntities.insertOne({
    overleaf: { userId: new ObjectId(userId) },
    dropbox: { pathLower: lower(path) },
    tombstone: true,
    createdAt: new Date(),
  })
}

// A deletion that we made ourselves, at the path or one of its parents
async function findTombstone(userId, path) {
  return await db.dropboxEntities.findOne({
    'overleaf.userId': new ObjectId(userId),
    'dropbox.pathLower': { $in: selfAndAncestors(lower(path)) },
    tombstone: true,
  })
}

// After a pull, Dropbox has reported every deletion made before it started
async function clearTombstones(userId, before) {
  await db.dropboxEntities.deleteMany({
    'overleaf.userId': new ObjectId(userId),
    tombstone: true,
    createdAt: { $lt: before },
  })
}

async function getProjectByFolder(userId, folderPath) {
  return await db.dropboxProjects.findOne({
    userId: new ObjectId(userId),
    pathLower: lower(folderPath),
  })
}

async function getFolderOfProject(userId, projectId) {
  return await db.dropboxProjects.findOne({
    userId: new ObjectId(userId),
    projectId: new ObjectId(projectId),
  })
}

async function setProjectFolder(userId, projectId, dropboxId, folderPath) {
  const uid = new ObjectId(userId)
  const pid = new ObjectId(projectId)
  await db.dropboxProjects.deleteMany({
    userId: uid,
    $or: [{ projectId: pid }, { dropboxId }, { pathLower: lower(folderPath) }],
  })
  await db.dropboxProjects.insertOne({
    userId: uid,
    projectId: pid,
    dropboxId,
    pathLower: lower(folderPath),
  })
}

async function removeProjectFolder(userId, folderPath) {
  await db.dropboxProjects.deleteMany({
    userId: new ObjectId(userId),
    pathLower: lower(folderPath),
  })
}

// Only while the user is still linked to the same Dropbox account, so that a
// pull finishing after an unlink cannot write the cursor back
async function setCursor(userId, accountId, cursor) {
  await db.users.updateOne(
    { _id: new ObjectId(userId), 'dropbox.access_token.uid': accountId },
    { $set: { 'dropbox.cursor': cursor } }
  )
}

async function removeUserState(userId) {
  const uid = new ObjectId(userId)
  await db.dropboxEntities.deleteMany({ 'overleaf.userId': uid })
  await db.dropboxProjects.deleteMany({ userId: uid })
}

export default {
  recordEntity,
  findEntityByPath,
  removeEntities,
  moveEntities,
  addTombstone,
  findTombstone,
  clearTombstones,
  getProjectByFolder,
  getFolderOfProject,
  setProjectFolder,
  removeProjectFolder,
  setCursor,
  removeUserState,
}
