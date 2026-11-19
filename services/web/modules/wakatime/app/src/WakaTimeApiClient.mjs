import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import {
  fetchNothing,
  fetchJson,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import {
  NotFoundError,
  TooManyRequestsError,
  ServiceNotConfiguredError,
  ForbiddenError,
} from '../../../../app/src/Features/Errors/Errors.js'
import TokenManager from './TokenManager.mjs'

const DEFAULT_API_URL = 'https://wakatime.com/api/v1'
const REQUEST_TIMEOUT_MS = 15 * 1000

/**
 * Resolve how to authenticate on behalf of a user, WITHOUT storing anything:
 *   1. stored credentials (wakatime.com OAuth token / API key / custom server)
 *   2. nothing (caller decides the error)
 */
async function resolveAuth(userId) {
  const credentials = await TokenManager.getCredentials(userId)
  if (credentials) {
    const { headers, authQuery } = buildAuth(credentials.apiKey)
    return {
      kind: 'key',
      url: normalizeApiUrl(credentials.apiUrl),
      headers,
      authQuery,
    }
  }
  return { kind: 'none', url: null, headers: null, authQuery: '' }
}

function normalizeApiUrl(apiUrl) {
  return (apiUrl || DEFAULT_API_URL).replace(/\/+$/, '')
}

// Shared UA/Content-Type for all API calls.
const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  // Must start with "wakatime/" and have a recognized OS token in
  // parens next, or WakaTime/Wakapi's user-agent parser bails out and
  // reports the editor as "unknown" — see wakapi/utils/http.go
  // ParseUserAgent, which requires this exact shape.
  'User-Agent': 'wakatime/1.0.0 (linux) overleaf/1.0 overleaf-wakatime/1.0',
}

/**
 * Build the auth for a credential: returns { headers, authQuery }.
 *
 * WakaTime OAuth access tokens (waka_tok_*) are sent via the documented
 * `?access_token=` query parameter — NOT as Basic credentials. Two
 * reasons: (1) wakatime.com's current API wants Bearer/access_token for
 * OAuth tokens (Basic is for API keys only), and (2) some egress
 * firewalls RST connections whose Authorization header carries a long
 * base64 credential — query params pass through reliably.
 * API keys (wakatime.com `waka_*` keys, Wakapi 32-char keys) stay in
 * `Authorization: Basic` (short enough to pass anywhere).
 */
function buildAuth(apiKey, opts = {}) {
  if (/^waka_tok_/i.test(apiKey || '')) {
    return {
      headers: { ...COMMON_HEADERS, ...opts },
      authQuery: `access_token=${encodeURIComponent(apiKey)}`,
    }
  }
  return {
    headers: {
      ...COMMON_HEADERS,
      Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
      ...opts,
    },
    authQuery: '',
  }
}

function buildHeaders(apiKey, opts = {}) {
  return buildAuth(apiKey, opts).headers
}

/**
 * auth.url + path, with the auth query param and any extra query string
 * joined correctly.
 */
function authUrl(auth, path, qs) {
  const q = [auth.authQuery || '', qs || ''].filter(Boolean).join('&')
  return q ? `${auth.url}${path}?${q}` : `${auth.url}${path}`
}

/**
 * Verify a (apiUrl, apiKey) pair works, without persisting anything.
 * Uses GET /users/current, which every WakaTime-compatible server
 * (wakatime.com and Wakapi) implements for auth verification.
 */
async function verifyCredentials(apiUrl, apiKey) {
  const { headers, authQuery } = buildAuth(apiKey)
  const url = normalizeApiUrl(apiUrl)
  const target = authQuery
    ? `${url}/users/current?${authQuery}`
    : `${url}/users/current`
  try {
    await fetchJson(target, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return true
  } catch (err) {
    normalizeApiError(err, 'verifyCredentials')
  }
}

/**
 * Checks whether the user has linked (and can still authenticate with)
 * a WakaTime-compatible account.
 */
async function getConnectionStatus(userId) {
  const auth = await resolveAuth(userId)
  if (auth.kind === 'none') return { connected: false }

  try {
    await fetchJson(authUrl(auth, '/users/current'), {
      headers: auth.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return {
      connected: true,
      apiUrl: auth.url,
    }
  } catch (err) {
    logger.warn({ userId, kind: auth.kind, err }, 'WakaTime connection check failed')
    return { connected: false, apiUrl: auth.url, error: true }
  }
}

/**
 * Send a single heartbeat on behalf of a user.
 * https://wakatime.com/developers#heartbeats
 */
async function sendHeartbeat(userId, heartbeat) {
  const auth = await resolveAuth(userId)
  if (auth.kind === 'none') {
    throw new ServiceNotConfiguredError({
      message: 'WakaTime credentials missing',
      info: { userId, status: 400 },
    })
  }

  try {
    await fetchNothing(authUrl(auth, '/users/current/heartbeats'), {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify(heartbeat),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    normalizeApiError(err, 'sendHeartbeat')
  }
}

/**
 * Send a batch of heartbeats on behalf of a user.
 * https://wakatime.com/developers#heartbeats (bulk)
 */
async function sendHeartbeatsBulk(userId, heartbeats) {
  const auth = await resolveAuth(userId)
  if (auth.kind === 'none') {
    throw new ServiceNotConfiguredError({
      message: 'WakaTime credentials missing',
      info: { userId, status: 400 },
    })
  }

  try {
    // WakaTime's /heartbeats.bulk endpoint accepts ONE heartbeat object per
    // request (same contract on wakapi: the .bulk route uses the single
    // heartbeat handler — batch semantics are throughput, not array body).
    // So a "bulk" send is a loop over the .bulk endpoint: sequential, at
    // most MAX_BULK_HEARTBEATS (50) per call, each 2xx-counting.
    for (const heartbeat of heartbeats) {
      await fetchNothing(authUrl(auth, '/users/current/heartbeats.bulk'), {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(heartbeat),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    }
  } catch (err) {
    normalizeApiError(err, 'sendHeartbeatsBulk')
  }
}

/**
 * Get total tracked time for a single project, over the last `range` days
 * (default 7), by requesting a summaries range and summing the per-project
 * breakdown. Works against wakatime.com and WakaTime-compatible servers.
 */
async function getProjectSummary(userId, projectName, range = 7) {
  const auth = await resolveAuth(userId)
  if (auth.kind === 'none') return null

  const end = new Date()
  const start = new Date(end.getTime() - range * 24 * 60 * 60 * 1000)
  const qs = new URLSearchParams({
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    project: projectName,
  })

  try {
    const summary = await fetchJson(
      authUrl(auth, '/users/current/summaries', qs.toString()),
      {
        headers: auth.headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )

    const totalSeconds = (summary.data || []).reduce((sum, day) => {
      const projectEntry = (day.projects || []).find(
        p => p.name === projectName
      )
      return sum + (projectEntry?.total_seconds || 0)
    }, 0)

    return { totalSeconds, rangeDays: range }
  } catch (err) {
    normalizeApiError(err, 'getProjectSummary')
  }
}

async function unlinkAccount(userId) {
  await TokenManager.removeCredentials(userId)
}

/**
 * Get the user's coding statistics across ALL projects over the last
 * `range` days (default 30, capped by the caller), aggregated server-side
 * so the stats page gets one compact payload:
 *   { totalSeconds, rangeDays, activeDays, dailyAverageSeconds,
 *     days: [{date, seconds, languages: [{name, seconds}]}],
 *     projects: [{name, seconds}], languages: [{name, seconds}],
 *     editors: [{name, seconds}], operatingSystems: [{name, seconds}] }
 * Works against both wakatime.com and Wakapi (both expose
 * /users/current/summaries with per-day breakdowns).
 */
async function getUserSummary(userId, range = 30) {
  const auth = await resolveAuth(userId)
  if (auth.kind === 'none') return null

  const end = new Date()
  const start = new Date(end.getTime() - range * 24 * 60 * 60 * 1000)
  const qs = new URLSearchParams({
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  })

  let summary
  try {
    summary = await fetchJson(authUrl(auth, '/users/current/summaries', qs.toString()), {
      headers: auth.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    normalizeApiError(err, 'getUserSummary')
  }

  const rawDays = summary.data || []

  // Per day: total + top-5 language split (for the stacked daily chart)
  const days = rawDays
    .map(day => ({
      date: (day.range?.start || '').slice(0, 10),
      seconds: day.grand_total?.total_seconds || 0,
      languages: (day.languages || [])
        .filter(l => l?.name && (l.total_seconds || 0) > 0)
        .sort((a, b) => (b.total_seconds || 0) - (a.total_seconds || 0))
        .slice(0, 5)
        .map(l => ({ name: l.name, seconds: l.total_seconds || 0 })),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  const totalSeconds = days.reduce((sum, d) => sum + d.seconds, 0)
  const activeDays = days.filter(d => d.seconds > 0).length
  const dailyAverageSeconds = activeDays > 0 ? Math.round(totalSeconds / activeDays) : 0

  const aggregate = key => {
    const byName = new Map()
    for (const day of rawDays) {
      for (const entry of day[key] || []) {
        if (!entry?.name) continue
        byName.set(entry.name, (byName.get(entry.name) || 0) + (entry.total_seconds || 0))
      }
    }
    return [...byName.entries()]
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10)
  }

  return {
    totalSeconds,
    rangeDays: range,
    activeDays,
    dailyAverageSeconds,
    days,
    projects: aggregate('projects'),
    languages: aggregate('languages'),
    editors: aggregate('editors'),
    operatingSystems: aggregate('operating_systems'),
  }
}

function normalizeApiError(err, operation) {
  logger.error({ operation }, 'WakaTime API request failed')

  if (err.name === 'AbortError') {
    throw new OError('WakaTime request timed out', {
      operation,
      status: 504,
    }).withCause(err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new OError('Something wrong with WakaTime request', {
      operation,
      status: 500,
    }).withCause(err)
  }

  const status = err.response?.status || 500

  if (status === 401 || status === 403) {
    throw new ForbiddenError({
      message: 'Access denied',
      info: { operation, status },
    }).withCause(err)
  }

  if (status === 404) {
    throw new NotFoundError({
      message: 'Not found',
      info: { operation, status },
    }).withCause(err)
  }

  if (status === 429) {
    throw new TooManyRequestsError({
      message: 'Rate limit exceeded',
      info: { operation, status },
    }).withCause(err)
  }

  throw new OError('WakaTime request error', { operation, status }).withCause(
    err
  )
}

export default {
  verifyCredentials,
  getConnectionStatus,
  sendHeartbeat,
  sendHeartbeatsBulk,
  getProjectSummary,
  getUserSummary,
  unlinkAccount,
}
