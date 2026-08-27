import fs from 'node:fs'
import Path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import archiver from 'archiver'
import settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import urlValidator from 'valid-url'
import { fetchStream, RequestFailedError } from '@overleaf/fetch-utils'
import UrlHelper from '../../../../app/src/Features/Helpers/UrlHelper.mjs'
import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import ProjectUploadManager from '../../../../app/src/Features/Uploads/ProjectUploadManager.mjs'
import ProjectOptionsHandler from '../../../../app/src/Features/Project/ProjectOptionsHandler.mjs'
import ProjectRootDocManager from '../../../../app/src/Features/Project/ProjectRootDocManager.mjs'
import ProjectDetailsHandler from '../../../../app/src/Features/Project/ProjectDetailsHandler.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'

// "Open in Overleaf" / Prefilled-Project API (POST|GET /docs), documented on the
// official /devs page. External sites load LaTeX content into a new project by
// posting a snippet, a file/zip URL, or a base64 data URL. The SaaS module is
// not shipped in open-source, so this reproduces the same contract on top of the
// existing project-creation infrastructure.
//
// Security: user-supplied snip_uri / zip_uri are fetched THROUGH the
// linked-url-proxy (UrlHelper.wrapUrlWithProxy) — the same SSRF-guarded path
// LinkedFiles/UrlAgent uses (ipaddr.js unicast-only + blockedNetworks + DNS
// re-validation). data: URLs are decoded in-process (no network fetch).

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // "PK\x03\x04"
const DEFAULT_PROJECT_NAME = 'Open in Overleaf project'
// Generous: the proxy already applies its own 30s timeout per hop, and a
// redirect chain plus a slow origin must not be cut off by us first.
const FETCH_TIMEOUT_MS = 60 * 1000
// Upper bound on snip_uri[] entries; each is a remote download.
const MAX_SNIP_URIS = 50

class OpenInOverleafError extends Error {}

// "Decoration" + "Encoding" features from the /devs docs: normalise Windows
// newlines to unix, and — if a bare snippet has no \documentclass — wrap it in a
// standard compilable document so the imported project builds out of the box.
const DOCUMENT_WRAPPER_HEAD = [
  '\\documentclass[12pt]{article}',
  '\\usepackage[english]{babel}',
  '\\usepackage{amsmath}',
  '\\usepackage{tikz}',
  '\\begin{document}',
]
const DOCUMENT_WRAPPER_TAIL = ['\\end{document}']

function prepareSnippet(content) {
  const normalised = content.replace(/\r\n/g, '\n')
  if (/\\documentclass/.test(normalised)) {
    return normalised
  }
  return [...DOCUMENT_WRAPPER_HEAD, normalised, ...DOCUMENT_WRAPPER_TAIL].join(
    '\n'
  )
}

function dumpPath(suffix = '') {
  return `${settings.path.dumpFolder}/${crypto.randomUUID()}_open-in-overleaf${suffix}`
}

function looksLikeZip(buffer) {
  return buffer.subarray(0, 4).equals(ZIP_MAGIC)
}

function tooLarge(what) {
  const mb = Math.round(settings.maxUploadSize / 1024 / 1024)
  return new OpenInOverleafError(
    `${what} exceeds the ${mb} MB upload limit (all files combined)`
  )
}

function cleanFileName(candidate) {
  if (typeof candidate !== 'string') return undefined
  // Directory parts are dropped so a name can never escape the project root.
  const base = Path.posix.basename(candidate.replace(/\\/g, '/')).trim()
  return base && base !== '.' && base !== '..' ? base : undefined
}

// File name for an uploaded snippet: snip_name[] if given (explicit), otherwise
// the last path segment of the URL, otherwise a numbered default.
function safeFileName(name, url, index) {
  const explicit = cleanFileName(name)
  if (explicit) return { name: explicit, explicit: true }
  if (/^https?:\/\//i.test(url)) {
    try {
      const fromUrl = cleanFileName(decodeURIComponent(new URL(url).pathname))
      if (fromUrl) return { name: fromUrl, explicit: false }
    } catch (e) {
      // unparsable url, fall through to the default name
    }
  }
  return { name: `snippet-${index + 1}.tex`, explicit: false }
}

// Decode a `data:[<mime>][;base64],<payload>` URL into a Buffer.
function decodeDataUrl(url, maxBytes) {
  const match = /^data:([^,]*?),(.*)$/s.exec(url)
  if (!match) {
    throw new OpenInOverleafError('invalid data url')
  }
  const [, meta, rawPayload] = match
  let payload
  try {
    payload = decodeURIComponent(rawPayload)
  } catch (e) {
    payload = rawPayload
  }
  let buffer
  if (/;base64/i.test(meta)) {
    // A '+' in a query string arrives as a space unless the caller encoded it.
    const b64 = payload.replace(/ /g, '+').replace(/\s/g, '')
    // Node's decoder silently skips invalid characters, so validate the
    // alphabet ourselves: otherwise garbage becomes a project.
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 === 1) {
      throw new OpenInOverleafError('invalid base64 data url')
    }
    buffer = Buffer.from(b64, 'base64')
  } else {
    buffer = Buffer.from(payload, 'utf8')
  }
  if (buffer.length > maxBytes) {
    throw tooLarge('data url')
  }
  return buffer
}

async function readStreamToBuffer(stream, maxBytes, what) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > maxBytes) {
      stream.destroy()
      throw tooLarge(what)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// Fetch a snippet/zip URL into a Buffer. http(s) go through the SSRF proxy;
// data: URLs are decoded locally.
// maxBytes lets callers importing several files share one upload budget.
async function fetchUrlToBuffer(rawUrl, maxBytes = settings.maxUploadSize) {
  if (/^data:/i.test(rawUrl)) {
    return decodeDataUrl(rawUrl, maxBytes)
  }
  const url = UrlHelper.prependHttpIfNeeded(rawUrl.trim())
  if (!urlValidator.isWebUri(url)) {
    throw new OpenInOverleafError(`invalid url: ${rawUrl}`)
  }
  if (!settings.apis.linkedUrlProxy?.url) {
    throw new OpenInOverleafError(
      'downloading from external URLs is not enabled on this server'
    )
  }
  const proxied = UrlHelper.wrapUrlWithProxy(url)
  let stream
  try {
    stream = await fetchStream(proxied, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof RequestFailedError) {
      // The proxy answers 4xx for blocked, unreachable or oversized targets.
      throw new OpenInOverleafError(
        `could not download ${url} (HTTP ${err.response.status})`
      )
    }
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new OpenInOverleafError(`timed out downloading ${url}`)
    }
    throw err
  }
  return await readStreamToBuffer(stream, maxBytes, url)
}

// createProjectFromZipArchive names the project from the archive's \title
// (projectName is only a fallback); createProjectFromZipArchiveWithName forces
// the given name and returns a richer object. Pick per preserveName — set when
// the caller gave an explicit name — and always return the project.
async function importZipArchive(ownerId, projectName, zipPath, preserveName) {
  if (preserveName) {
    const { project } =
      await ProjectUploadManager.promises.createProjectFromZipArchiveWithName(
        ownerId,
        projectName,
        zipPath
      )
    return project
  }
  return await ProjectUploadManager.promises.createProjectFromZipArchive(
    ownerId,
    projectName,
    zipPath
  )
}

// Zip a set of in-memory files and import them, keeping their names (so
// main_document can refer to them).
async function importFilesAsZip(files, ownerId, projectName, preserveName) {
  const zipPath = await buildZipFromFiles(files)
  try {
    return await importZipArchive(ownerId, projectName, zipPath, preserveName)
  } finally {
    fs.promises.unlink(zipPath).catch(() => {})
  }
}

async function importZipBuffer(buffer, ownerId, projectName, preserveName) {
  const path = await writeBufferToDump(buffer, '.zip')
  try {
    return await importZipArchive(ownerId, projectName, path, preserveName)
  } finally {
    fs.promises.unlink(path).catch(() => {})
  }
}

async function writeBufferToDump(buffer, suffix) {
  const path = dumpPath(suffix)
  await fs.promises.writeFile(path, buffer)
  return path
}

// Zip a set of in-memory files ({ name, buffer }) so multi-file submissions can
// reuse the standard zip-import path.
async function buildZipFromFiles(files) {
  const path = dumpPath('.zip')
  const output = fs.createWriteStream(path)
  const archive = archiver('zip')
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve)
    archive.on('error', reject)
  })
  archive.pipe(output)
  for (const file of files) {
    archive.append(file.buffer, { name: file.name })
  }
  await archive.finalize()
  await done
  return path
}

const OpenInOverleafManager = {
  // params: {
  //   snippet?, snipUris?: [{ url, name }], zipUri?,
  //   engine?, mainDocument?, projectName?
  // }
  async createProject(params, ownerId) {
    // An archive's \title wins over the fallback name; only override it when the
    // caller explicitly supplied a project name.
    const preserveName = Boolean(params.projectName)
    const projectName = ProjectDetailsHandler.fixProjectName(
      params.projectName || DEFAULT_PROJECT_NAME
    )

    let project
    if (params.zipUri) {
      project = await OpenInOverleafManager._createFromZipUrl(
        params.zipUri,
        ownerId,
        projectName,
        preserveName
      )
    } else if (params.snipUris && params.snipUris.length) {
      project = await OpenInOverleafManager._createFromUrls(
        params.snipUris,
        ownerId,
        projectName,
        preserveName
      )
    } else if (params.snippet != null) {
      project = await ProjectCreationHandler.promises.createProjectFromSnippet(
        ownerId,
        projectName,
        prepareSnippet(params.snippet).split('\n')
      )
    } else {
      throw new OpenInOverleafError('no snippet, snip_uri or zip_uri provided')
    }

    await OpenInOverleafManager._applyOptions(project, params)
    return project
  },

  async _createFromZipUrl(zipUri, ownerId, projectName, preserveName) {
    const buffer = await fetchUrlToBuffer(zipUri)
    if (!looksLikeZip(buffer)) {
      throw new OpenInOverleafError('zip_uri did not resolve to a zip archive')
    }
    return await importZipBuffer(buffer, ownerId, projectName, preserveName)
  },

  async _createFromUrls(snipUris, ownerId, projectName, preserveName) {
    if (snipUris.length > MAX_SNIP_URIS) {
      throw new OpenInOverleafError(
        `too many snip_uri entries (maximum ${MAX_SNIP_URIS})`
      )
    }

    // All files of one submission share the single upload budget, so a request
    // cannot multiply the limit by listing many URLs.
    let remaining = settings.maxUploadSize
    const files = []
    for (const [index, { url, name }] of snipUris.entries()) {
      const buffer = await fetchUrlToBuffer(url, remaining)
      remaining -= buffer.length
      files.push({
        buffer,
        ...safeFileName(name, url, index),
        isZip: looksLikeZip(buffer),
      })
    }

    if (files.length === 1) {
      const [file] = files
      if (file.isZip) {
        return await importZipBuffer(file.buffer, ownerId, projectName, preserveName)
      }
      if (!file.explicit) {
        // A single .tex file → straight snippet project as main.tex.
        return await ProjectCreationHandler.promises.createProjectFromSnippet(
          ownerId,
          projectName,
          prepareSnippet(file.buffer.toString('utf8')).split('\n')
        )
      }
      // snip_name given: import under that name so main_document can select it.
      return await importFilesAsZip(files, ownerId, projectName, preserveName)
    }

    if (files.some(file => file.isZip)) {
      throw new OpenInOverleafError(
        'a zip archive must be the only snip_uri; use zip_uri for projects'
      )
    }
    return await importFilesAsZip(files, ownerId, projectName, preserveName)
  },

  async _applyOptions(project, params) {
    if (params.engine) {
      const compiler =
        ProjectHelper.compilerFromV1Engine(params.engine) || params.engine
      try {
        await ProjectOptionsHandler.promises.setCompiler(project._id, compiler)
      } catch (err) {
        logger.warn(
          { err, projectId: project._id, engine: params.engine },
          'open-in-overleaf: failed to set compiler'
        )
      }
    }
    if (params.mainDocument) {
      try {
        await ProjectRootDocManager.promises.setRootDocFromName(
          project._id,
          params.mainDocument
        )
      } catch (err) {
        logger.warn(
          { err, projectId: project._id, mainDocument: params.mainDocument },
          'open-in-overleaf: failed to set main document'
        )
      }
    }
  },
}

export default OpenInOverleafManager
export { OpenInOverleafError }
