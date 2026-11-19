import { zz } from '@overleaf/validation-tools'
import Settings from '@overleaf/settings'

// A project's compiler ("typst" vs a TeX engine) selects which compile
// service serves the build outputs: Typst projects use clsi-typst, all
// other projects use clsi (the TeX service).
function clsiBaseURL(compiler) {
  return compiler === 'typst' && Settings.apis.clsi_typst?.url
    ? Settings.apis.clsi_typst.url
    : Settings.apis.clsi.url
}

function downloadBaseURL(compiler) {
  return compiler === 'typst' && Settings.apis.clsi_typst?.downloadHost
    ? Settings.apis.clsi_typst.downloadHost
    : Settings.apis.clsi.downloadHost
}

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
 * @param {string} [compiler] project compiler ("typst" selects clsi-typst)
 * @return {URL}
 */
export function getOutputZipURL(
  projectIdOrSubmissionId,
  userId,
  buildId,
  compileBackendClass,
  clsiServerId,
  compiler
) {
  compileBackendClass = schema.compileBackendClass.parse(compileBackendClass)
  clsiServerId = schema.optionalClsiServerId.parse(clsiServerId)
  const url = new URL(clsiBaseURL(compiler))
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
 * @param {string} [compiler] project compiler ("typst" selects clsi-typst)
 * @return {URL}
 */
export function getOutputFileURL(
  projectIdOrSubmissionId,
  userId,
  buildId,
  file,
  clsiServerId,
  compiler
) {
  clsiServerId = schema.optionalClsiServerId.parse(clsiServerId)
  const url = new URL(downloadBaseURL(compiler))
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
