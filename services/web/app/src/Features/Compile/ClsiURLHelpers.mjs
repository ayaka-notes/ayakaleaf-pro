import { zz } from '@overleaf/validation-tools'
import Settings from '@overleaf/settings'

// Build zod schema once and use it below.
const schema = {
  compileBackendClass: zz.compileBackendClass(),
  optionalClsiServerId: zz.clsiServerId().optional(),
  projectIdOrSubmissionId: zz.objectId().or(zz.submissionId()),
  optionalUserId: zz.objectId().optional(),
  buildId: zz.buildId(),
  filepath: zz.filepath(),
}

/**
 * @param {string} projectIdOrSubmissionId
 * @param {string|null} userId
 * @param {string} buildId
 * @param {string} compileBackendClass
 * @param {string} clsiServerId
 * @return {URL}
 */
export function getOutputZipURL(
  projectIdOrSubmissionId,
  userId,
  buildId,
  compileBackendClass,
  clsiServerId
) {
  compileBackendClass = schema.compileBackendClass.parse(compileBackendClass)
  clsiServerId = schema.optionalClsiServerId.parse(clsiServerId)
  const url = new URL(Settings.apis.clsi.url)
  url.pathname = getFilePath(
    projectIdOrSubmissionId,
    userId,
    buildId,
    'output.zip'
  )
  url.searchParams.set('compileBackendClass', compileBackendClass)
  if (clsiServerId) url.searchParams.set('clsiserverid', clsiServerId)
  return url
}

/**
 * @param {string} projectIdOrSubmissionId
 * @param {string|null} userId
 * @param {string} buildId
 * @param {string} file
 * @param {string} clsiServerId
 * @return {URL}
 */
export function getOutputFileURL(
  projectIdOrSubmissionId,
  userId,
  buildId,
  file,
  clsiServerId
) {
  clsiServerId = schema.optionalClsiServerId.parse(clsiServerId)
  const url = new URL(Settings.apis.clsi.downloadHost)
  url.pathname = getFilePath(projectIdOrSubmissionId, userId, buildId, file)
  if (clsiServerId) url.searchParams.set('clsiserverid', clsiServerId)
  return url
}

/**
 * @param {string} projectIdOrSubmissionId
 * @param {string|null} userId
 * @param {string} buildId
 * @param {string} file
 * @return {string}
 */
export function getFilePath(projectIdOrSubmissionId, userId, buildId, file) {
  projectIdOrSubmissionId = schema.projectIdOrSubmissionId.parse(
    projectIdOrSubmissionId.toString()
  )
  userId = schema.optionalUserId.parse(userId?.toString())
  buildId = schema.buildId.parse(buildId)
  file = schema.filepath.parse(file)
  let path = `/project/${projectIdOrSubmissionId}`
  if (userId) {
    path += `/user/${userId}`
  }
  path += `/build/${buildId}/output/${file}`
  return path
}
