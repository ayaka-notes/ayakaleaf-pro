import crypto from 'node:crypto'
import { InvalidNameError } from './Errors.js'

const FIXED_FILENAMES = [
  'output.blg',
  'output.log',
  'output.pdf',
  'output.synctex.gz',
  'output.overleaf.json',
  'output.tar.gz',
  // Only read/written by clsi, web blocks it from users.
  'history-resync.json.gz',
]

/**
 * Keep in sync with isAllowedFilename in services/web/app/src/Features/Compile/ClsiCacheHandler.mjs
 *
 * @param {string} filename
 * @return {boolean}
 */
export function isAllowedFilename(filename) {
  return FIXED_FILENAMES.includes(filename) || filename.endsWith('.blg')
}

/**
 * Keep in sync with validateFilename in services/web/app/src/Features/Compile/ClsiCacheHandler.mjs
 *
 * @param {string} filename
 */
export function validateFilename(filename) {
  if (filename.split('/').includes('..')) {
    throw new InvalidNameError('path traversal', { filename })
  }
  if (!isAllowedFilename(filename)) {
    throw new InvalidNameError('bad filename', { filename })
  }
}

/**
 * Keep in sync with getEgressLabel in services/web/app/src/Features/Compile/ClsiCacheHandler.mjs
 *
 * @param {string} fsPath
 * @return {string}
 */
export function getIngressLabel(fsPath) {
  if (fsPath.endsWith('.blg')) {
    // .blg files may have custom names and can be in nested folders.
    return 'output.blg'
  }
  return fsPath
}

// editorId is a uuid, buildId is HEXDATE-HEXRANDOM (OutputCacheManager.generateBuildId in clsi).
export const EDITOR_BUILD_ID_REGEX = /^[a-f0-9-]{36}-[0-9a-f]+-[0-9a-f]+$/
export const BUILD_ID_REGEX = /^[0-9a-f]+-[0-9a-f]+$/
// Mongo ObjectIds for projects, free-form ids for submissions (external compiles).
export const PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]+$/
export const USER_ID_REGEX = /^[0-9a-f]{24}$/

/**
 * @param {string} editorBuildId
 * @return {{editorId: string, buildId: string}}
 */
export function splitEditorBuildId(editorBuildId) {
  return {
    editorId: editorBuildId.slice(0, 36),
    buildId: editorBuildId.slice(37),
  }
}

/**
 * The build timestamp doubles as compile time: clsi generates it from Date.now()
 * when the compile starts, which is what "last compiled" has to be compared
 * against the project's lastUpdated.
 *
 * @param {string} buildId
 * @return {number}
 */
export function getBuildTimestamp(buildId) {
  return parseInt(buildId.split('-')[0], 16)
}

/**
 * @param {number} timestamp
 * @return {string}
 */
export function generateBuildId(timestamp = Date.now()) {
  return `${timestamp.toString(16)}-${crypto.randomBytes(8).toString('hex')}`
}

/**
 * Same layout as clsi uses on disk: per-user compiles live in "projectId-userId".
 *
 * @param {string} projectId
 * @param {string} [userId]
 * @return {string}
 */
export function getProjectKey(projectId, userId) {
  return userId ? `${projectId}-${userId}` : projectId
}
