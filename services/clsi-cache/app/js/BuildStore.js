import Path from 'node:path'
import { Readable } from 'node:stream'
import Settings from '@overleaf/settings'
import { Errors as PersistorErrors } from '@overleaf/object-persistor'
import persistor from './Persistor.js'
import { NotFoundError } from './Errors.js'
import {
  EDITOR_BUILD_ID_REGEX,
  getBuildTimestamp,
  splitEditorBuildId,
} from './utils.js'

const LOCATION = Settings.path.cacheDir
export const META_FILE = 'output.overleaf.json'
export const isFsBackend = Settings.persistor.backend === 'fs'

/**
 * @typedef {Object} Build
 * @property {string} editorBuildId
 * @property {string} buildId
 * @property {number} timestamp
 * @property {string} prefix
 * @property {string[]} files
 */

export function projectPrefix(projectKey) {
  return `project/${projectKey}`
}

export function buildPrefix(projectKey, editorBuildId) {
  return `${projectPrefix(projectKey)}/build/${editorBuildId}`
}

export function templatePrefix(templateVersionId, imageName) {
  return `template/${templateVersionId}/${imageName}`
}

/**
 * Absolute path of a key on disk. Only meaningful with the fs backend.
 *
 * @param {string} key
 * @return {string}
 */
export function fsPath(key) {
  return Path.join(LOCATION, key)
}

/**
 * The fs backend lists absolute paths, object stores list keys.
 *
 * @param {string} entry
 * @return {string}
 */
function toKey(entry) {
  const base = LOCATION.replace(/\/$/, '') + '/'
  return entry.startsWith(base) ? entry.slice(base.length) : entry
}

async function listKeys(prefix) {
  const entries = await persistor.listDirectoryKeys(LOCATION, prefix)
  return entries.map(toKey).filter(key => key.startsWith(prefix + '/'))
}

/**
 * Files below a prefix, relative to it.
 *
 * @param {string} prefix
 * @return {Promise<string[]>}
 */
export async function listFiles(prefix) {
  const keys = await listKeys(prefix)
  return keys.map(key => key.slice(prefix.length + 1)).sort()
}

/**
 * All builds of a project, newest first. Stable for builds with the same
 * timestamp, so that repeated lookups return the same "latest" build.
 *
 * @param {string} projectKey
 * @return {Promise<Build[]>}
 */
export async function listBuilds(projectKey) {
  const prefix = `${projectPrefix(projectKey)}/build`
  const keys = await listKeys(prefix)
  const builds = new Map()
  for (const key of keys) {
    const rest = key.slice(prefix.length + 1)
    const idx = rest.indexOf('/')
    if (idx === -1) continue
    const editorBuildId = rest.slice(0, idx)
    if (!EDITOR_BUILD_ID_REGEX.test(editorBuildId)) continue
    let build = builds.get(editorBuildId)
    if (!build) {
      const { buildId } = splitEditorBuildId(editorBuildId)
      build = {
        editorBuildId,
        buildId,
        timestamp: getBuildTimestamp(buildId),
        prefix: `${prefix}/${editorBuildId}`,
        files: [],
      }
      builds.set(editorBuildId, build)
    }
    build.files.push(rest.slice(idx + 1))
  }
  const list = Array.from(builds.values())
  for (const build of list) build.files.sort()
  list.sort(
    (a, b) =>
      b.timestamp - a.timestamp || b.editorBuildId.localeCompare(a.editorBuildId)
  )
  return list
}

/**
 * Most recent build that has the given file.
 *
 * @param {string} projectKey
 * @param {string} filename
 * @return {Promise<Build|undefined>}
 */
export async function findLatestBuild(projectKey, filename) {
  const builds = await listBuilds(projectKey)
  return builds.find(build => build.files.includes(filename))
}

/**
 * A specific build, provided it has the given file.
 *
 * @param {string} projectKey
 * @param {string} editorBuildId
 * @param {string} filename
 * @return {Promise<Build|undefined>}
 */
export async function findBuild(projectKey, editorBuildId, filename) {
  const builds = await listBuilds(projectKey)
  return builds.find(
    build =>
      build.editorBuildId === editorBuildId && build.files.includes(filename)
  )
}

/**
 * @return {Promise<string[]>}
 */
export async function listProjectKeys() {
  const keys = await listKeys('project')
  const projectKeys = new Set()
  for (const key of keys) {
    projectKeys.add(key.split('/')[1])
  }
  return Array.from(projectKeys)
}

function wrapNotFound(err, key) {
  if (err instanceof PersistorErrors.NotFoundError) {
    return new NotFoundError('object not found', { key })
  }
  return err
}

export async function getObjectSize(key) {
  try {
    return await persistor.getObjectSize(LOCATION, key)
  } catch (err) {
    throw wrapNotFound(err, key)
  }
}

export async function getObjectStream(key, opts = {}) {
  try {
    return await persistor.getObjectStream(LOCATION, key, opts)
  } catch (err) {
    throw wrapNotFound(err, key)
  }
}

export async function getRedirectUrl(key) {
  return await persistor.getRedirectUrl(LOCATION, key)
}

export async function sendStream(key, stream) {
  await persistor.sendStream(LOCATION, key, stream)
}

export async function sendFile(key, path) {
  await persistor.sendFile(LOCATION, key, path)
}

export async function writeJSON(key, obj) {
  await sendStream(key, Readable.from([Buffer.from(JSON.stringify(obj))]))
}

export async function readJSON(key) {
  const stream = await getObjectStream(key)
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}

export async function deleteObject(key) {
  await persistor.deleteObject(LOCATION, key)
}

export async function deleteDirectory(prefix) {
  await persistor.deleteDirectory(LOCATION, prefix)
}

/**
 * Copy every file below a prefix to another prefix.
 *
 * @param {string} srcPrefix
 * @param {string} dstPrefix
 * @return {Promise<string[]>} copied files, relative to the prefixes
 */
export async function copyPrefix(srcPrefix, dstPrefix) {
  const files = await listFiles(srcPrefix)
  for (const file of files) {
    await persistor.copyObject(
      LOCATION,
      `${srcPrefix}/${file}`,
      `${dstPrefix}/${file}`
    )
  }
  return files
}
