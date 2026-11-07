// A stand-in for the reference managers of the tpr-webmodule module: Zotero
// (www.zotero.org for OAuth 1.0a, api.zotero.org for the API) and Mendeley
// (api.mendeley.com for OAuth 2.0 and the API). Libraries and groups are lists
// of BibTeX entries the tests set; everything lives in memory.
//
// Port 443 serves the three hosts over TLS, see services/lib/mock-server.mjs.
// Port 8080 is the control API for the tests
// (http://tpr-mock:8080/_mock/<zotero|mendeley>/...): reset, set the library
// and the groups, list and revoke keys and tokens, see what the app asked
// for, refuse the next authorization, fail the next API call, and shorten
// Mendeley's token lifetime.

import crypto from 'node:crypto'
import { HttpError, listen, send } from './lib/mock-server.mjs'

const ZOTERO_USER = { id: '7777', username: 'e2e-zotero' }

const ZOTERO = {
  key: process.env.TPR_MOCK_ZOTERO_CLIENT_ID,
  secret: process.env.TPR_MOCK_ZOTERO_CLIENT_SECRET,
}
const MENDELEY = {
  id: process.env.TPR_MOCK_MENDELEY_CLIENT_ID,
  secret: process.env.TPR_MOCK_MENDELEY_CLIENT_SECRET,
}

let state

function reset() {
  state = {
    zotero: {
      requestTokens: new Map(), // token -> { secret, callback, verifier }
      keys: new Map(), // api key -> { revoked }
      library: [],
      groups: [], // [{ id, name, entries }]
      lastAuthorize: null,
      denyNextAuthorize: false,
      failNext: null,
    },
    mendeley: {
      codes: new Map(), // code -> redirect_uri
      accessTokens: new Map(), // token -> { revoked, expiresAt }
      refreshTokens: new Map(), // token -> { revoked }
      tokenRequests: [], // grant types, in order
      expiresIn: 3600,
      library: [],
      groups: [],
      lastAuthorize: null,
      denyNextAuthorize: false,
      failNext: null,
    },
  }
}
reset()

function randomToken() {
  return crypto.randomBytes(16).toString('hex')
}

// Answers the next API call of the provider with the status set through the
// control API, once
function failIfAsked(provider) {
  const status = state[provider].failNext
  if (status) {
    state[provider].failNext = null
    throw new HttpError(status, 'failing as asked')
  }
}

// The page of entries a paginated export returns
function bibtexPage(entries, start, limit) {
  return entries.slice(start, start + limit).join('\n\n')
}

// ------------------------------------------------------------------ zotero

function rfc3986(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

// Checks an OAuth 1.0a HMAC-SHA1 signature and returns the signed parameters
function verifyOAuth1(req, url, tokenSecret = '') {
  const header = req.headers.authorization || ''
  if (!header.startsWith('OAuth ')) {
    throw new HttpError(401, 'missing OAuth header')
  }
  const params = {}
  for (const [, key, value] of header.matchAll(/([\w]+)="([^"]*)"/g)) {
    params[decodeURIComponent(key)] = decodeURIComponent(value)
  }
  const { oauth_signature: signature, ...signed } = params
  if (signed.oauth_consumer_key !== ZOTERO.key) {
    throw new HttpError(401, 'unknown consumer key')
  }
  const paramString = Object.keys(signed)
    .sort()
    .map(k => `${rfc3986(k)}=${rfc3986(signed[k])}`)
    .join('&')
  const base = [
    req.method,
    rfc3986(`https://${url.host}${url.pathname}`),
    rfc3986(paramString),
  ].join('&')
  const expected = crypto
    .createHmac('sha1', `${rfc3986(ZOTERO.secret)}&${rfc3986(tokenSecret)}`)
    .update(base)
    .digest('base64')
  if (signature !== expected) {
    throw new HttpError(401, 'invalid OAuth signature')
  }
  return signed
}

function requireZoteroKey(req) {
  failIfAsked('zotero')
  const key = req.headers['zotero-api-key']
  const found = key && state.zotero.keys.get(key)
  if (!found || found.revoked) throw new HttpError(403, 'Forbidden')
  return key
}

function zoteroItems({ req, res, url }, entries) {
  requireZoteroKey(req)
  if (url.searchParams.get('format') !== 'bibtex') {
    throw new HttpError(400, 'only format=bibtex is mocked')
  }
  const start = Number(url.searchParams.get('start') || 0)
  const limit = Number(url.searchParams.get('limit') || 25)
  send(res, 200, bibtexPage(entries, start, limit), {
    'Content-Type': 'application/x-bibtex',
    'Total-Results': String(entries.length),
  })
}

const zoteroWww = [
  [
    'POST',
    /^\/oauth\/request$/,
    ({ req, res, url }) => {
      const params = verifyOAuth1(req, url)
      const token = randomToken()
      const secret = randomToken()
      state.zotero.requestTokens.set(token, {
        secret,
        callback: params.oauth_callback,
      })
      send(
        res,
        200,
        `oauth_token=${token}&oauth_token_secret=${secret}&oauth_callback_confirmed=true`
      )
    },
  ],
  // Grants access right away, like for a user who approved the app before
  [
    'GET',
    /^\/oauth\/authorize$/,
    ({ res, url }) => {
      const token = url.searchParams.get('oauth_token')
      const request = state.zotero.requestTokens.get(token)
      if (!request) throw new HttpError(400, 'unknown request token')
      state.zotero.lastAuthorize = Object.fromEntries(url.searchParams)
      const callback = new URL(request.callback)
      callback.searchParams.set('oauth_token', token)
      if (state.zotero.denyNextAuthorize) {
        state.zotero.denyNextAuthorize = false
      } else {
        request.verifier = randomToken()
        callback.searchParams.set('oauth_verifier', request.verifier)
      }
      send(res, 302, undefined, { Location: callback.toString() })
    },
  ],
  [
    'POST',
    /^\/oauth\/access$/,
    ({ req, res, url }) => {
      const token = /oauth_token="([^"]*)"/.exec(req.headers.authorization)?.[1]
      const request = token && state.zotero.requestTokens.get(token)
      if (!request) throw new HttpError(401, 'unknown request token')
      const params = verifyOAuth1(req, url, request.secret)
      if (!request.verifier || params.oauth_verifier !== request.verifier) {
        throw new HttpError(401, 'invalid verifier')
      }
      state.zotero.requestTokens.delete(token)
      const apiKey = randomToken()
      state.zotero.keys.set(apiKey, { revoked: false })
      send(
        res,
        200,
        `oauth_token=${apiKey}&oauth_token_secret=${apiKey}&userID=${ZOTERO_USER.id}&username=${ZOTERO_USER.username}`
      )
    },
  ],
]

const zoteroApi = [
  [
    'GET',
    /^\/keys\/([^/]+)$/,
    ({ res, params: [key] }) => {
      const found = state.zotero.keys.get(key)
      if (!found || found.revoked) throw new HttpError(404, 'Key not found')
      send(res, 200, {
        key,
        userID: Number(ZOTERO_USER.id),
        username: ZOTERO_USER.username,
        access: { user: { library: true }, groups: { all: { library: true } } },
      })
    },
  ],
  [
    'DELETE',
    /^\/keys\/([^/]+)$/,
    ({ req, res, params: [key] }) => {
      if (requireZoteroKey(req) !== key) throw new HttpError(403, 'Forbidden')
      state.zotero.keys.get(key).revoked = true
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/users\/([^/]+)\/groups$/,
    ({ req, res, params: [userId] }) => {
      requireZoteroKey(req)
      if (userId !== ZOTERO_USER.id) throw new HttpError(403, 'Forbidden')
      send(
        res,
        200,
        state.zotero.groups.map(g => ({
          id: Number(g.id),
          data: { name: g.name },
        }))
      )
    },
  ],
  [
    'GET',
    /^\/users\/([^/]+)\/items$/,
    context => {
      if (context.params[0] !== ZOTERO_USER.id) {
        throw new HttpError(403, 'Forbidden')
      }
      zoteroItems(context, state.zotero.library)
    },
  ],
  [
    'GET',
    /^\/groups\/([^/]+)\/items$/,
    context => {
      const group = state.zotero.groups.find(g => g.id === context.params[0])
      if (!group) throw new HttpError(404, 'Group not found')
      zoteroItems(context, group.entries)
    },
  ],
]

// ---------------------------------------------------------------- mendeley

function issueMendeleyTokens() {
  const accessToken = randomToken()
  const refreshToken = randomToken()
  const { expiresIn } = state.mendeley
  state.mendeley.accessTokens.set(accessToken, {
    revoked: false,
    expiresAt: Date.now() + expiresIn * 1000,
  })
  state.mendeley.refreshTokens.set(refreshToken, { revoked: false })
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: expiresIn,
  }
}

function requireMendeleyToken(req) {
  failIfAsked('mendeley')
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
  const found = token && state.mendeley.accessTokens.get(token)
  if (!found || found.revoked || found.expiresAt < Date.now()) {
    throw new HttpError(401, 'Unauthorized')
  }
}

const mendeley = [
  [
    'GET',
    /^\/oauth\/authorize$/,
    ({ res, url }) => {
      if (url.searchParams.get('client_id') !== MENDELEY.id) {
        throw new HttpError(400, 'unknown client_id')
      }
      state.mendeley.lastAuthorize = Object.fromEntries(url.searchParams)
      const redirectUri = url.searchParams.get('redirect_uri')
      const callback = new URL(redirectUri)
      if (state.mendeley.denyNextAuthorize) {
        state.mendeley.denyNextAuthorize = false
        callback.searchParams.set('error', 'access_denied')
      } else {
        const code = randomToken()
        state.mendeley.codes.set(code, redirectUri)
        callback.searchParams.set('code', code)
      }
      callback.searchParams.set('state', url.searchParams.get('state'))
      send(res, 302, undefined, { Location: callback.toString() })
    },
  ],
  [
    'POST',
    /^\/oauth\/token$/,
    ({ req, res, body }) => {
      const expected = Buffer.from(
        `${MENDELEY.id}:${MENDELEY.secret}`
      ).toString('base64')
      if (req.headers.authorization !== `Basic ${expected}`) {
        throw new HttpError(401, 'invalid client credentials')
      }
      state.mendeley.tokenRequests.push(body.grant_type)
      const invalidGrant = new HttpError(400, 'invalid grant', {
        error: 'invalid_grant',
      })
      if (body.grant_type === 'authorization_code') {
        const redirectUri = state.mendeley.codes.get(body.code)
        if (!redirectUri || redirectUri !== body.redirect_uri)
          throw invalidGrant
        state.mendeley.codes.delete(body.code)
      } else if (body.grant_type === 'refresh_token') {
        const found = state.mendeley.refreshTokens.get(body.refresh_token)
        if (!found || found.revoked) throw invalidGrant
      } else {
        throw new HttpError(400, 'unsupported grant type', {
          error: 'unsupported_grant_type',
        })
      }
      send(res, 200, issueMendeleyTokens())
    },
  ],
  [
    'GET',
    /^\/groups$/,
    ({ req, res }) => {
      requireMendeleyToken(req)
      send(
        res,
        200,
        state.mendeley.groups.map(g => ({ id: g.id, name: g.name }))
      )
    },
  ],
  [
    'GET',
    /^\/documents$/,
    ({ req, res, url }) => {
      requireMendeleyToken(req)
      if (url.searchParams.get('view') !== 'bib') {
        throw new HttpError(400, 'only view=bib is mocked')
      }
      const groupId = url.searchParams.get('group_id')
      const group = groupId && state.mendeley.groups.find(g => g.id === groupId)
      if (groupId && !group) throw new HttpError(404, 'Group not found')
      const entries = group ? group.entries : state.mendeley.library
      const limit = Number(url.searchParams.get('limit') || 20)
      const page = Number(url.searchParams.get('page') || 0)
      const headers = { 'Content-Type': 'application/x-bibtex' }
      if ((page + 1) * limit < entries.length) {
        const next = new URL(url)
        next.searchParams.set('page', String(page + 1))
        headers.Link = `<${next}>; rel="next"`
      }
      send(res, 200, bibtexPage(entries, page * limit, limit), headers)
    },
  ],
]

// ----------------------------------------------------------------- control

// Same calls for both providers, /_mock/<provider>/...
const control = [
  [
    'POST',
    /^\/_mock\/reset$/,
    ({ res }) => {
      reset()
      send(res, 204)
    },
  ],
  // Body: { entries: [bibtex entry] }
  [
    'PUT',
    /^\/_mock\/(zotero|mendeley)\/library$/,
    ({ res, body, params: [provider] }) => {
      state[provider].library = body.entries
      send(res, 204)
    },
  ],
  // Body: { groups: [{ id, name, entries }] }
  [
    'PUT',
    /^\/_mock\/(zotero|mendeley)\/groups$/,
    ({ res, body, params: [provider] }) => {
      state[provider].groups = body.groups.map(g => ({
        ...g,
        id: String(g.id),
      }))
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/_mock\/(zotero|mendeley)\/last-authorize$/,
    ({ res, params: [provider] }) => {
      send(res, 200, state[provider].lastAuthorize)
    },
  ],
  [
    'POST',
    /^\/_mock\/(zotero|mendeley)\/deny-next-authorize$/,
    ({ res, params: [provider] }) => {
      state[provider].denyNextAuthorize = true
      send(res, 204)
    },
  ],
  // Body: { status } - the next API call answers with it
  [
    'POST',
    /^\/_mock\/(zotero|mendeley)\/fail-next$/,
    ({ res, body, params: [provider] }) => {
      state[provider].failNext = body.status
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/_mock\/zotero\/keys$/,
    ({ res }) => {
      send(
        res,
        200,
        [...state.zotero.keys.values()].map(({ revoked }) => ({ revoked }))
      )
    },
  ],
  // The user revokes the app's access on the provider's website
  [
    'POST',
    /^\/_mock\/zotero\/keys\/revoke$/,
    ({ res }) => {
      for (const key of state.zotero.keys.values()) key.revoked = true
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/_mock\/mendeley\/tokens$/,
    ({ res }) => {
      send(res, 200, { requests: state.mendeley.tokenRequests })
    },
  ],
  [
    'POST',
    /^\/_mock\/mendeley\/tokens\/revoke$/,
    ({ res }) => {
      for (const tokens of [
        state.mendeley.accessTokens,
        state.mendeley.refreshTokens,
      ]) {
        for (const token of tokens.values()) token.revoked = true
      }
      send(res, 204)
    },
  ],
  // Body: { seconds } - lifetime of the access tokens issued from now on
  [
    'PUT',
    /^\/_mock\/mendeley\/expires-in$/,
    ({ res, body }) => {
      state.mendeley.expiresIn = body.seconds
      send(res, 204)
    },
  ],
]

listen({
  name: 'tpr mock',
  routes: {
    'www.zotero.org': zoteroWww,
    'api.zotero.org': zoteroApi,
    'api.mendeley.com': mendeley,
  },
  control,
})
