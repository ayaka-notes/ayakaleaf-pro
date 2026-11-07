import Settings from '@overleaf/settings'
import { Dropbox, DropboxAuth } from 'dropbox'
import nodeFetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { CustomHttpsAgent } from '@overleaf/fetch-utils'
import LRU from 'lru-cache'
import TokenManager from './TokenManager.mjs'

const { appKey, appSecret, domain, proxyUrl } = Settings.dropbox

// Optional egress proxy for the Dropbox API, as GITHUB_SYNC_PROXY_URL;
// direct requests get a 3s connect timeout, as in the web module (#106)
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null
const directAgent = new CustomHttpsAgent({ connectTimeout: 3000 })

// A request that never ends would hold the user's queue for good. Calls get
// 60s; file contents (the content host, at most one chunk per upload) more
const CALL_TIMEOUT_MS = 60 * 1000
const CONTENT_TIMEOUT_MS = 10 * 60 * 1000
function fetch(url, options = {}) {
  // content.dropboxapi.com, or api-content-<domain> with DROPBOX_API_DOMAIN
  const content = new URL(url).hostname.split(/[.-]/).includes('content')
  return nodeFetch(url, {
    ...options,
    agent: proxyAgent || directAgent,
    signal: AbortSignal.timeout(content ? CONTENT_TIMEOUT_MS : CALL_TIMEOUT_MS),
  })
}

// Larger files go through an upload session, in chunks, so that no single
// request carries more than a chunk
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024
const SINGLE_UPLOAD_LIMIT = UPLOAD_CHUNK_SIZE

// One SDK client per user, kept while the stored token is unchanged, so that
// the short-lived access token is refreshed only when it expires
const clients = new LRU({ max: 1000 })

async function forUser(userId) {
  const tokens = await TokenManager.getUserTokens(userId)
  if (!tokens) {
    clients.del(userId)
    return null
  }
  const cached = clients.get(userId)
  if (cached?.encrypted === tokens.encrypted) {
    return cached.client
  }
  const auth = new DropboxAuth({
    fetch,
    domain,
    clientId: appKey,
    clientSecret: appSecret,
    refreshToken: tokens.refreshToken,
  })
  const client = new DropboxClient(new Dropbox({ auth, fetch, domain }))
  clients.set(userId, { encrypted: tokens.encrypted, client })
  return client
}

function forget(userId) {
  clients.del(userId)
}

// error_summary of a DropboxResponseError, e.g. 'path/not_found/..'
function errorSummary(err) {
  const body = err?.error
  if (typeof body === 'string') {
    return body
  }
  // only 409 bodies are sure to have error_summary; others are JSON or
  // plain text (Dropbox error handling docs)
  const summary = body?.error_summary ?? body?.error
  return typeof summary === 'string' ? summary : ''
}

class DropboxClient {
  constructor(dbx) {
    this.dbx = dbx
  }

  // Overleaf is the source of the upload. With the rev last synced, Dropbox
  // refuses it (conflict) when the file changed in Dropbox since, so that the
  // poll queued for that change brings it to Overleaf instead
  async upload(path, contents, rev) {
    const mode = rev ? { '.tag': 'update', update: rev } : { '.tag': 'overwrite' }
    const commit = { path, mode, mute: true }
    if (contents.length > SINGLE_UPLOAD_LIMIT) {
      return await this._uploadSession(contents, commit)
    }
    const { result } = await this.dbx.filesUpload({ ...commit, contents })
    return result
  }

  async _uploadSession(contents, commit) {
    const { result } = await this.dbx.filesUploadSessionStart({
      close: false,
      contents: contents.subarray(0, UPLOAD_CHUNK_SIZE),
    })
    let offset = Math.min(UPLOAD_CHUNK_SIZE, contents.length)
    while (contents.length - offset > UPLOAD_CHUNK_SIZE) {
      await this.dbx.filesUploadSessionAppendV2({
        cursor: { session_id: result.session_id, offset },
        close: false,
        contents: contents.subarray(offset, offset + UPLOAD_CHUNK_SIZE),
      })
      offset += UPLOAD_CHUNK_SIZE
    }
    const { result: metadata } = await this.dbx.filesUploadSessionFinish({
      cursor: { session_id: result.session_id, offset },
      commit,
      contents: contents.subarray(offset),
    })
    return metadata
  }

  // autorename: when the target is taken, Dropbox appends a number to the
  // name, e.g. 'Thesis (1)', and returns the metadata it used
  async move(fromPath, toPath, autorename = false) {
    const { result } = await this.dbx.filesMoveV2({
      from_path: fromPath,
      to_path: toPath,
      autorename,
    })
    return result.metadata
  }

  async delete(path) {
    await this.dbx.filesDeleteV2({ path })
  }

  async createFolder(path, autorename = false) {
    const { result } = await this.dbx.filesCreateFolderV2({
      path,
      autorename,
    })
    return result.metadata
  }

  async getMetadata(path) {
    const { result } = await this.dbx.filesGetMetadata({ path })
    return result
  }

  async download(path) {
    const { result } = await this.dbx.filesDownload({ path })
    return { metadata: result, contents: result.fileBinary }
  }

  // The app folder is the root of an app-folder Dropbox app
  async latestCursor() {
    const { result } = await this.dbx.filesListFolderGetLatestCursor({
      path: '',
      recursive: true,
    })
    return result.cursor
  }

  async listFolder() {
    const { result } = await this.dbx.filesListFolder({
      path: '',
      recursive: true,
    })
    return result
  }

  async listFolderContinue(cursor) {
    const { result } = await this.dbx.filesListFolderContinue({ cursor })
    return result
  }
}

export default { forUser, forget, errorSummary }
