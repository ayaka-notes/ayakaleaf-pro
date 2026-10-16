// A stand-in for Dropbox, covering the calls Dropbox sync makes: the OAuth
// flow of an app-folder app (with expiring access tokens and a refresh
// token), the files API of the app folder (upload, upload sessions,
// download, move, delete, create folder, metadata, list_folder with cursors)
// and token revocation. Like Dropbox, it sends a signed webhook to Overleaf
// after each change of an account. Everything lives in memory.
//
// Port 443 serves the hosts the dropbox SDK derives from its `domain`
// option (DROPBOX_API_DOMAIN=dropbox.example.com): meta-dropbox.example.com
// for the authorization page, api-dropbox.example.com for the RPC calls and
// the token endpoint, api-content-dropbox.example.com for file contents.
//
// Port 8080 is plain HTTP for the tests (http://dropbox-mock:8080/_mock/...):
// reset, read the app folder back, change it the way the user would, make
// the next calls fail, read the call counters and refuse the next
// authorization.

import crypto from 'node:crypto'
import { HttpError, listen, NoResponse, send } from './lib/mock-server.mjs'

const APP_KEY = process.env.DROPBOX_MOCK_APP_KEY
const APP_SECRET = process.env.DROPBOX_MOCK_APP_SECRET
const WEBHOOK_URL = 'http://sharelatex/dropbox/webhook'
const ACCOUNT_ID = 'dbid:e2e-dropbox-account'
const PAGE_SIZE = 50

let state

function reset() {
  state = {
    accountId: ACCOUNT_ID, // the account the next authorization is for
    codes: new Map(), // code -> accountId
    tokens: new Map(), // access token -> { accountId, revoked, expiresAt }
    refreshTokens: new Map(), // refresh token -> { accountId, revoked }
    tokenTtl: 14400, // seconds, like Dropbox
    accounts: new Map(), // accountId -> account
    uploadSessions: new Map(), // session id -> Buffer[]
    denyNextAuthorize: false,
    failures: [], // { endpoint, status, summary, count }
    webhooks: true,
    calls: {}, // endpoint -> count
    refreshes: 0,
  }
}
reset()

function account(accountId) {
  if (!state.accounts.has(accountId)) {
    state.accounts.set(accountId, {
      // path_lower -> { tag: 'file'|'folder', id, path_display, contents, rev }
      entries: new Map(),
      // every change, for list_folder/continue
      log: [],
      // cursors from an older epoch are reset
      epoch: 0,
      notifyTimer: null,
    })
  }
  return state.accounts.get(accountId)
}

// ----------------------------------------------------------------- helpers

// https://www.dropbox.com/developers/reference/content-hash
function contentHash(contents) {
  const BLOCK = 4 * 1024 * 1024
  const blocks = []
  for (let i = 0; i < contents.length || i === 0; i += BLOCK) {
    blocks.push(
      crypto.createHash('sha256').update(contents.subarray(i, i + BLOCK)).digest()
    )
    if (contents.length === 0) break
  }
  return crypto.createHash('sha256').update(Buffer.concat(blocks)).digest('hex')
}

function dropboxError(status, summary) {
  const tag = summary.split('/')[0]
  return new HttpError(status, summary, {
    error_summary: summary,
    error: { '.tag': tag },
  })
}

function normalize(path) {
  if (!path.startsWith('/')) {
    throw dropboxError(400, 'path/malformed_path/')
  }
  return path.replace(/\/+$/, '')
}

function parent(path) {
  return path.slice(0, path.lastIndexOf('/'))
}

function metadata(entry) {
  const name = entry.path_display.slice(entry.path_display.lastIndexOf('/') + 1)
  const base = {
    '.tag': entry.tag,
    name,
    id: entry.id,
    path_lower: entry.path_display.toLowerCase(),
    path_display: entry.path_display,
  }
  if (entry.tag === 'folder') return base
  return {
    ...base,
    rev: entry.rev,
    size: entry.contents.length,
    content_hash: contentHash(entry.contents),
    server_modified: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    client_modified: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    is_downloadable: true,
  }
}

function deletedMetadata(pathDisplay) {
  return {
    '.tag': 'deleted',
    name: pathDisplay.slice(pathDisplay.lastIndexOf('/') + 1),
    path_lower: pathDisplay.toLowerCase(),
    path_display: pathDisplay,
  }
}

// Like Dropbox, the webhook says which accounts changed, a moment later
function changed(accountId, acct, entry) {
  acct.log.push(entry)
  if (!state.webhooks || acct.notifyTimer) return
  acct.notifyTimer = setTimeout(() => {
    acct.notifyTimer = null
    notify([accountId]).catch(err => console.error('webhook failed', err))
  }, 300)
}

async function notify(accountIds) {
  const body = JSON.stringify({
    list_folder: { accounts: accountIds },
    delta: { users: [] },
  })
  const signature = crypto
    .createHmac('sha256', APP_SECRET)
    .update(body)
    .digest('hex')
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dropbox-Signature': signature,
    },
    body,
  })
  return res.status
}

function ensureFolders(accountId, acct, pathDisplay) {
  const parts = pathDisplay.split('/').filter(Boolean)
  for (let i = 1; i < parts.length; i++) {
    const folder = '/' + parts.slice(0, i).join('/')
    const existing = acct.entries.get(folder.toLowerCase())
    if (existing?.tag === 'file') {
      throw dropboxError(409, 'path/conflict/file/')
    }
    if (!existing) {
      const entry = { tag: 'folder', id: newId(), path_display: folder }
      acct.entries.set(folder.toLowerCase(), entry)
      changed(accountId, acct, metadata(entry))
    }
  }
}

function newId() {
  return 'id:' + crypto.randomBytes(8).toString('hex')
}

function newRev() {
  return crypto.randomBytes(9).toString('hex')
}

// mode: the WriteMode of an upload, absent for the user's own changes
function writeFile(accountId, pathDisplay, contents, mode) {
  const acct = account(accountId)
  const path = normalize(pathDisplay)
  const existing = acct.entries.get(path.toLowerCase())
  if (existing?.tag === 'folder') {
    throw dropboxError(409, 'path/conflict/folder/')
  }
  ensureFolders(accountId, acct, path)
  if (existing && existing.contents.equals(contents)) {
    // the same contents: no new revision, like Dropbox
    return existing
  }
  if (existing && mode?.['.tag'] === 'update' && mode.update !== existing.rev) {
    // update overwrites only the given rev
    throw dropboxError(409, 'path/conflict/file/')
  }
  const entry = {
    tag: 'file',
    id: existing?.id || newId(),
    path_display: existing?.path_display || path,
    contents,
    rev: newRev(),
  }
  acct.entries.set(path.toLowerCase(), entry)
  changed(accountId, acct, metadata(entry))
  return entry
}

function subtree(acct, pathLower) {
  return [...acct.entries.keys()].filter(
    key => key === pathLower || key.startsWith(pathLower + '/')
  )
}

function deletePath(accountId, pathDisplay) {
  const acct = account(accountId)
  const path = normalize(pathDisplay)
  const entry = acct.entries.get(path.toLowerCase())
  if (!entry) {
    throw dropboxError(409, 'path_lookup/not_found/')
  }
  for (const key of subtree(acct, path.toLowerCase())) {
    acct.entries.delete(key)
  }
  changed(accountId, acct, deletedMetadata(entry.path_display))
  return entry
}

// Like Dropbox's autorename for folders: 'Thesis' is taken, 'Thesis (1)' is
// tried next, then 'Thesis (2)', ...
function freePath(acct, path) {
  let candidate = path
  for (let n = 1; acct.entries.has(candidate.toLowerCase()); n++) {
    candidate = `${path} (${n})`
  }
  return candidate
}

function movePath(accountId, from, to, autorename = false) {
  const acct = account(accountId)
  const fromPath = normalize(from)
  let toPath = normalize(to)
  const entry = acct.entries.get(fromPath.toLowerCase())
  if (!entry) {
    throw dropboxError(409, 'from_lookup/not_found/')
  }
  if (acct.entries.has(toPath.toLowerCase())) {
    if (!autorename) {
      throw dropboxError(409, `to/conflict/${entry.tag}/`)
    }
    toPath = freePath(acct, toPath)
  }
  ensureFolders(accountId, acct, toPath)
  const moved = subtree(acct, fromPath.toLowerCase()).map(key => [
    key,
    acct.entries.get(key),
  ])
  for (const [key] of moved) acct.entries.delete(key)
  changed(accountId, acct, deletedMetadata(entry.path_display))
  for (const [, e] of moved) {
    e.path_display = toPath + e.path_display.slice(fromPath.length)
    acct.entries.set(e.path_display.toLowerCase(), e)
    changed(accountId, acct, metadata(e))
  }
  return acct.entries.get(toPath.toLowerCase())
}

function createFolder(accountId, pathDisplay, autorename = false) {
  const acct = account(accountId)
  let path = normalize(pathDisplay)
  if (acct.entries.has(path.toLowerCase())) {
    if (!autorename) {
      const { tag } = acct.entries.get(path.toLowerCase())
      throw dropboxError(409, `path/conflict/${tag}/`)
    }
    path = freePath(acct, path)
  }
  ensureFolders(accountId, acct, path)
  const entry = { tag: 'folder', id: newId(), path_display: path }
  acct.entries.set(path.toLowerCase(), entry)
  changed(accountId, acct, metadata(entry))
  return entry
}

function cursorFor(accountId, seq) {
  const { epoch } = account(accountId)
  return Buffer.from(JSON.stringify({ accountId, seq, epoch })).toString(
    'base64url'
  )
}

function readCursor(accountId, cursor) {
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString())
  } catch {
    throw dropboxError(400, 'cursor/malformed/')
  }
  if (parsed.accountId !== accountId) {
    throw dropboxError(409, 'reset/')
  }
  if (parsed.epoch !== account(accountId).epoch) {
    throw dropboxError(409, 'reset/')
  }
  return parsed.seq
}

function page(accountId, entries, seq) {
  const acct = account(accountId)
  const end = Math.min(acct.log.length, seq + PAGE_SIZE)
  return {
    entries: entries ?? acct.log.slice(seq, end),
    cursor: cursorFor(accountId, entries ? acct.log.length : end),
    has_more: !entries && end < acct.log.length,
  }
}

// ------------------------------------------------------------------- auth

function requireToken(req) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '')
  const token = match && state.tokens.get(match[1])
  if (!token) {
    throw dropboxError(401, 'invalid_access_token/')
  }
  if (token.revoked) {
    throw dropboxError(401, 'invalid_access_token/')
  }
  if (token.expiresAt < Date.now()) {
    throw dropboxError(401, 'expired_access_token/')
  }
  return { accessToken: match[1], accountId: token.accountId }
}

function issueAccessToken(accountId) {
  const accessToken = 'sl.' + crypto.randomBytes(20).toString('hex')
  state.tokens.set(accessToken, {
    accountId,
    revoked: false,
    expiresAt: Date.now() + state.tokenTtl * 1000,
  })
  return accessToken
}

// Calls made, and failures injected with /_mock/fail
function call(endpoint) {
  state.calls[endpoint] = (state.calls[endpoint] || 0) + 1
  const failure = state.failures.find(f => f.endpoint === endpoint && f.count > 0)
  if (failure) {
    if (failure.skip > 0) {
      failure.skip -= 1
      return
    }
    failure.count -= 1
    if (failure.hang) throw new NoResponse()
    if (failure.body) throw new HttpError(failure.status, 'failure', failure.body)
    throw dropboxError(failure.status, failure.summary || `${failure.status}/`)
  }
}

function arg(req) {
  return JSON.parse(req.headers['dropbox-api-arg'] || '{}')
}

function rpc(endpoint, handler) {
  return [
    'POST',
    new RegExp(`^/2/${endpoint}$`),
    ({ req, res, body }) => {
      const { accountId, accessToken } = requireToken(req)
      call(endpoint)
      send(res, 200, handler({ accountId, accessToken, body }))
    },
  ]
}

// ------------------------------------------------------------------ hosts

const meta = [
  [
    'GET',
    /^\/oauth2\/authorize$/,
    ({ res, url }) => {
      if (url.searchParams.get('client_id') !== APP_KEY) {
        throw new HttpError(400, 'unknown client_id')
      }
      const redirect = new URL(url.searchParams.get('redirect_uri'))
      if (state.denyNextAuthorize) {
        state.denyNextAuthorize = false
        redirect.searchParams.set('error', 'access_denied')
      } else {
        const code = crypto.randomBytes(10).toString('hex')
        state.codes.set(code, state.accountId)
        redirect.searchParams.set('code', code)
      }
      redirect.searchParams.set('state', url.searchParams.get('state'))
      send(res, 302, undefined, { Location: redirect.toString() })
    },
  ],
]

const api = [
  // The authorization code grant posts a form, the SDK's refresh puts the
  // parameters in the query string
  [
    'POST',
    /^\/oauth2\/token$/,
    ({ res, url, body }) => {
      const params = { ...Object.fromEntries(url.searchParams), ...body }
      if (params.client_id !== APP_KEY || params.client_secret !== APP_SECRET) {
        return send(res, 400, { error: 'invalid_client' })
      }
      if (params.grant_type === 'authorization_code') {
        const accountId = state.codes.get(params.code)
        if (!accountId) {
          return send(res, 400, { error: 'invalid_grant' })
        }
        state.codes.delete(params.code)
        const refreshToken = crypto.randomBytes(20).toString('hex')
        state.refreshTokens.set(refreshToken, { accountId, revoked: false })
        return send(res, 200, {
          access_token: issueAccessToken(accountId),
          token_type: 'bearer',
          expires_in: state.tokenTtl,
          refresh_token: refreshToken,
          account_id: accountId,
          uid: '4242',
          scope: 'account_info.read files.content.read files.content.write files.metadata.read files.metadata.write',
        })
      }
      if (params.grant_type === 'refresh_token') {
        const refresh = state.refreshTokens.get(params.refresh_token)
        if (!refresh || refresh.revoked) {
          return send(res, 400, { error: 'invalid_grant' })
        }
        state.refreshes += 1
        return send(res, 200, {
          access_token: issueAccessToken(refresh.accountId),
          token_type: 'bearer',
          expires_in: state.tokenTtl,
        })
      }
      send(res, 400, { error: 'unsupported_grant_type' })
    },
  ],
  // Revokes the access token and the refresh token it came from
  rpc('auth/token/revoke', ({ accessToken, accountId }) => {
    state.tokens.get(accessToken).revoked = true
    for (const refresh of state.refreshTokens.values()) {
      if (refresh.accountId === accountId) refresh.revoked = true
    }
    return null
  }),
  rpc('files/get_metadata', ({ accountId, body }) => {
    const entry = account(accountId).entries.get(normalize(body.path).toLowerCase())
    if (!entry) throw dropboxError(409, 'path/not_found/')
    return metadata(entry)
  }),
  rpc('files/delete_v2', ({ accountId, body }) => ({
    metadata: metadata(deletePath(accountId, body.path)),
  })),
  rpc('files/move_v2', ({ accountId, body }) => ({
    metadata: metadata(
      movePath(accountId, body.from_path, body.to_path, body.autorename)
    ),
  })),
  rpc('files/create_folder_v2', ({ accountId, body }) => ({
    metadata: metadata(createFolder(accountId, body.path, body.autorename)),
  })),
  // Only the whole app folder, recursively, which is what Dropbox sync lists
  rpc('files/list_folder', ({ accountId, body }) => {
    if (body.path !== '' || !body.recursive) {
      throw dropboxError(400, 'path/unsupported/')
    }
    return page(
      accountId,
      [...account(accountId).entries.values()].map(metadata),
      0
    )
  }),
  rpc('files/list_folder/get_latest_cursor', ({ accountId }) => ({
    cursor: cursorFor(accountId, account(accountId).log.length),
  })),
  rpc('files/list_folder/continue', ({ accountId, body }) =>
    page(accountId, null, readCursor(accountId, body.cursor))
  ),
]

const content = [
  [
    'POST',
    /^\/2\/files\/upload$/,
    ({ req, res, body }) => {
      const { accountId } = requireToken(req)
      call('files/upload')
      const { path, mode } = arg(req)
      send(res, 200, metadata(writeFile(accountId, path, body, mode)))
    },
  ],
  [
    'POST',
    /^\/2\/files\/upload_session\/start$/,
    ({ req, res, body }) => {
      requireToken(req)
      call('files/upload_session/start')
      const sessionId = crypto.randomBytes(8).toString('hex')
      state.uploadSessions.set(sessionId, [body])
      send(res, 200, { session_id: sessionId })
    },
  ],
  [
    'POST',
    /^\/2\/files\/upload_session\/append_v2$/,
    ({ req, res, body }) => {
      requireToken(req)
      call('files/upload_session/append_v2')
      const { cursor } = arg(req)
      const chunks = state.uploadSessions.get(cursor.session_id)
      if (Buffer.concat(chunks).length !== cursor.offset) {
        throw dropboxError(409, 'incorrect_offset/')
      }
      chunks.push(body)
      send(res, 200, null)
    },
  ],
  [
    'POST',
    /^\/2\/files\/upload_session\/finish$/,
    ({ req, res, body }) => {
      const { accountId } = requireToken(req)
      call('files/upload_session/finish')
      const { cursor, commit } = arg(req)
      const chunks = state.uploadSessions.get(cursor.session_id)
      if (Buffer.concat(chunks).length !== cursor.offset) {
        throw dropboxError(409, 'lookup_failed/incorrect_offset/')
      }
      chunks.push(body)
      state.uploadSessions.delete(cursor.session_id)
      send(
        res,
        200,
        metadata(writeFile(accountId, commit.path, Buffer.concat(chunks), commit.mode))
      )
    },
  ],
  [
    'POST',
    /^\/2\/files\/download$/,
    ({ req, res }) => {
      const { accountId } = requireToken(req)
      call('files/download')
      const { path } = arg(req)
      const entry = account(accountId).entries.get(normalize(path).toLowerCase())
      if (!entry || entry.tag !== 'file') {
        throw dropboxError(409, 'path/not_found/')
      }
      send(res, 200, entry.contents, {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Result': JSON.stringify(metadata(entry)),
      })
    },
  ],
]

const routes = {
  'meta-dropbox.example.com': meta,
  'api-dropbox.example.com': api,
  'api-content-dropbox.example.com': content,
}

// ---------------------------------------------------------------- control

function decode(file) {
  if (file.size != null) {
    // a large file without sending it over the control API
    return Buffer.alloc(file.size, 'x')
  }
  return file.base64 != null
    ? Buffer.from(file.base64, 'base64')
    : Buffer.from(file.content ?? '')
}

const control = [
  [
    'POST',
    /^\/_mock\/reset$/,
    ({ res }) => {
      reset()
      send(res, 204)
    },
  ],
  // Body: { accountId } - the Dropbox account the next authorizations are for
  [
    'POST',
    /^\/_mock\/account$/,
    ({ res, body }) => {
      state.accountId = body.accountId
      send(res, 204)
    },
  ],
  // The app folder: { files: { path: text }, folders: [path] }
  [
    'GET',
    /^\/_mock\/files$/,
    ({ res, url }) => {
      const acct = account(url.searchParams.get('account') || state.accountId)
      // Paths are case-insensitive and path_display is only sure of its last
      // component: the user sees each folder with its own casing
      const cased = pathLower =>
        pathLower
          .split('/')
          .filter(Boolean)
          .map((_, i, parts) => {
            const own = acct.entries.get('/' + parts.slice(0, i + 1).join('/'))
            return own.path_display.slice(own.path_display.lastIndexOf('/') + 1)
          })
          .reduce((path, name) => `${path}/${name}`, '')
      const files = {}
      const folders = []
      for (const [pathLower, entry] of acct.entries) {
        if (entry.tag === 'file') {
          files[cased(pathLower)] = entry.contents.toString('utf8')
        } else {
          folders.push(cased(pathLower))
        }
      }
      send(res, 200, { files, folders: folders.sort() })
    },
  ],
  // The user changes the app folder. Body: { path, content | base64 | size }
  [
    'PUT',
    /^\/_mock\/files$/,
    ({ res, body }) => {
      send(res, 200, metadata(writeFile(state.accountId, body.path, decode(body))))
    },
  ],
  // Body: { path }
  [
    'DELETE',
    /^\/_mock\/files$/,
    ({ res, body }) => {
      deletePath(state.accountId, body.path)
      send(res, 204)
    },
  ],
  // Body: { path }
  [
    'POST',
    /^\/_mock\/folders$/,
    ({ res, body }) => {
      send(res, 200, metadata(createFolder(state.accountId, body.path)))
    },
  ],
  // Body: { from, to }
  [
    'POST',
    /^\/_mock\/move$/,
    ({ res, body }) => {
      send(res, 200, metadata(movePath(state.accountId, body.from, body.to)))
    },
  ],
  // Body: { endpoint, status, summary?, count?, skip?, body? } - the next
  // calls of the endpoint (e.g. 'files/upload') fail with that status and
  // error_summary, after skip calls that pass; with body, that body is sent
  // as it is (e.g. Dropbox's 429 with an empty error_summary); with
  // hang: true instead of a status, they are never answered
  [
    'POST',
    /^\/_mock\/fail$/,
    ({ res, body }) => {
      state.failures.push({ count: 1, ...body })
      send(res, 204)
    },
  ],
  // Body: { enabled } - whether changes send the webhook
  [
    'POST',
    /^\/_mock\/webhooks$/,
    ({ res, body }) => {
      state.webhooks = body.enabled
      send(res, 204)
    },
  ],
  // Sends the webhook for the current account now; answers with the status
  // Overleaf returned
  [
    'POST',
    /^\/_mock\/notify$/,
    async ({ res }) => {
      send(res, 200, { status: await notify([state.accountId]) })
    },
  ],
  // Cursors handed out so far get the reset error
  [
    'POST',
    /^\/_mock\/reset-cursors$/,
    ({ res }) => {
      account(state.accountId).epoch += 1
      send(res, 204)
    },
  ],
  // Call counters, token state
  [
    'GET',
    /^\/_mock\/stats$/,
    ({ res }) => {
      send(res, 200, {
        calls: state.calls,
        refreshes: state.refreshes,
        tokens: [...state.tokens.values()].map(({ revoked }) => ({ revoked })),
      })
    },
  ],
  // Seconds an access token lives
  [
    'POST',
    /^\/_mock\/token-ttl$/,
    ({ res, body }) => {
      state.tokenTtl = body.seconds
      send(res, 204)
    },
  ],
  [
    'POST',
    /^\/_mock\/deny-next-authorize$/,
    ({ res }) => {
      state.denyNextAuthorize = true
      send(res, 204)
    },
  ],
]

listen({ name: 'dropbox mock', routes, control })
