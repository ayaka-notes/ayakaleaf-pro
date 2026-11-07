import Settings from '@overleaf/settings'
import { fetchJson, fetchNothing } from '@overleaf/fetch-utils'

// web's private TPDS routes (router.mjs, requirePrivateApiAuth)
const { url: webUrl, user, pass } = Settings.apis.web
const basicAuth = { user, password: pass }
const headers = { 'x-update-source': 'dropbox' }

function encodePath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

// { status: 'success', projectId } or { status: 'rejected' }. By name, a
// project is created when none matches (TpdsUpdateHandler.getOrCreateProject)
async function resolveProject(userId, { projectId, projectName }) {
  return await fetchJson(`${webUrl}/user/${userId}/project/resolve`, {
    method: 'POST',
    basicAuth,
    json: projectId ? { projectId } : { projectName },
  })
}

// { status: 'applied', projectId, entityId, entityType, ... } or
// { status: 'rejected' } (no write access, archived, ignored file name)
async function mergeUpdate(userId, projectId, path, contents) {
  return await fetchJson(
    `${webUrl}/project/${projectId}/user/${userId}/update/${encodePath(path)}`,
    {
      method: 'POST',
      basicAuth,
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: contents,
    }
  )
}

async function deleteUpdate(userId, projectId, path) {
  await fetchNothing(
    `${webUrl}/project/${projectId}/user/${userId}/update/${encodePath(path)}`,
    { method: 'DELETE', basicAuth, headers }
  )
}

// By project name, for folders that are not mapped to a project. Without a
// path, the project folder itself was deleted: web marks the project as
// deleted by an external source
async function deleteUpdateByName(userId, projectName, path) {
  await fetchNothing(
    `${webUrl}/user/${userId}/update/${encodePath(`${projectName}/${path}`)}`,
    { method: 'DELETE', basicAuth, headers }
  )
}

async function createFolder(userId, projectId, path) {
  await fetchJson(`${webUrl}/tpds/folder-update`, {
    method: 'POST',
    basicAuth,
    json: { userId, projectId, path },
  })
}

export default {
  resolveProject,
  mergeUpdate,
  deleteUpdate,
  deleteUpdateByName,
  createFolder,
}
