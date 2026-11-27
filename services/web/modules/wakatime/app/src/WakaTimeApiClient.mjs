import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import Settings from '@overleaf/settings'
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
    // SSRF guard for stored credentials too, so accounts linked before
    // a policy change can never trigger internal fetches either.
    validateApiUrl(credentials.apiUrl)
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

/**
 * SSRF guard for user-supplied WakaTime/Wakapi API URLs.
 *
 * By default only public http(s) endpoints are accepted: loopback
 * names (localhost, *.local), and IP literals in private, link-local,
 * reserved, multicast or CGNAT ranges are rejected, so a linked account
 * can never make the backend fetch internal addresses (cloud metadata,
 * LAN services, ...) or ship auth material to an attacker-chosen host.
 *
 * Deployment overrides (Settings.wakatime, see settings.defaults.js):
 *   - allowedHosts: explicit allowlist of host / host:port entries
 *     (e.g. a self-hosted Wakapi by name on the internal network).
 *   - allowInternalHosts: trust every host, including internal ones.
 *
 * Throws an OError with status 400 on a rejected URL.
 */
function validateApiUrl(apiUrl) {
  if (typeof apiUrl !== 'string' || !apiUrl.trim()) {
    throw new OError('A valid WakaTime API URL is required', { status: 400 })
  }

  let url
  try {
    url = new URL(apiUrl)
  } catch {
    throw new OError(
      'The WakaTime API URL must be a valid absolute URL, e.g. https://wakatime.com/api/v1',
      { status: 400 }
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OError('The WakaTime API URL must use http or https', {
      status: 400,
    })
  }

  if (url.username || url.password) {
    throw new OError('The WakaTime API URL must not contain credentials', {
      status: 400,
    })
  }

  const host = url.hostname
  if (!host) {
    throw new OError('The WakaTime API URL must include a host', {
      status: 400,
    })
  }

  if (policyExempt(url)) return

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new OError(
      'This deployment does not allow WakaTime API URLs pointing at internal hostnames',
      { status: 400 }
    )
  }

  if (isBlockedIpLiteral(host)) {
    throw new OError(
      'This deployment does not allow WakaTime API URLs pointing at private or internal network addresses',
      { status: 400 }
    )
  }
}

const BLOCKED_IPV4_RANGES = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 this network
  [0x0a000000, 0x0affffff], // 10.0.0.0/8 private
  [0x64400000, 0x647fffff], // 100.64.0.0/10 carrier-grade NAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local
  [0xac100000, 0xac1fffff], // 172.16.0.0/12 private
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 private
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 benchmarking
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 multicast
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 reserved
]

function ipv4ToLong(ip) {
  return ip
    .split('.')
    .reduce((acc, part) => acc * 256 + parseInt(part, 10), 0)
}

function isBlockedV4Long(long) {
  return BLOCKED_IPV4_RANGES.some(([start, end]) => long >= start && long <= end)
}

function isBlockedIPv4(ip) {
  return isBlockedV4Long(ipv4ToLong(ip))
}

function isBlockedIPv6(ip) {
  const host = ip.toLowerCase()
  if (host === '::' || host === '::1') return true

  // IPv4-embedded dotted tails: ::ffff:127.0.0.1, ::10.0.0.1, ...
  const v4Tail = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.[1]
  if (v4Tail && isBlockedV4Long(ipv4ToLong(v4Tail))) return true

  const groups = expandIpv6Groups(host)
  if (!groups) return false
  const first = groups[0]
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local

  // URL-normalized IPv4-mapped/compatible form, where the last 32 bits
  // hold the IPv4 address as two hex groups (::ffff:7f00:1, ::a01:203):
  // the upper 80 bits must be zero for that interpretation to hold.
  const ipv4Compat =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0
  if (ipv4Compat) return isBlockedV4Long((groups[6] << 16) | groups[7])
  return false
}

function expandIpv6Groups(ip) {
  if (ip.includes('%')) return null
  const parts = ip.split('::')
  if (parts.length > 2) return null
  const head = parts[0] ? parts[0].split(':') : []
  const tail =
    parts.length === 2 && parts[1] ? parts[1].split(':') : []
  for (const part of [...head, ...tail]) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null
  }
  const missing = 8 - head.length - tail.length
  if (missing < 0) return null
  const groups = [
    ...head.map(p => parseInt(p, 16)),
    ...Array(missing).fill(0),
    ...tail.map(p => parseInt(p, 16)),
  ]
  return groups.length === 8 ? groups : null
}

function isBlockedIpLiteral(host) {
  // URL.hostname keeps IPv6 literals bracketed ('[::1]'); strip for checks.
  const ip =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (net.isIPv4(ip)) return isBlockedIPv4(ip)
  if (net.isIPv6(ip)) return isBlockedIPv6(ip)
  return false
}

/**
 * Deployment policy override for a specific URL: an allowlisted host
 * (Settings.wakatime.allowedHosts) or a deployment that opts into internal
 * hosts. Such URLs skip the internal-address checks.
 */
function policyExempt(url) {
  const wt = Settings.wakatime || {}
  if (wt.allowInternalHosts === true) return true
  const allowedHosts = (Array.isArray(wt.allowedHosts) ? wt.allowedHosts : [])
    .map(h => String(h).toLowerCase())
    .filter(Boolean)
  const host = (url.hostname || '').toLowerCase()
  const hostWithPort = url.port ? `${host}:${url.port}` : host
  return allowedHosts.includes(host) || allowedHosts.includes(hostWithPort)
}

/**
 * Resolve a hostname and vet the destination IP(s) at request time.
 *
 * String-level checks (validateApiUrl) only see the name the user typed:
 * a public hostname can still resolve to internal addresses (split-horizon
 * DNS, rebinding), so before every request we resolve the host and reject
 * the link if ANY address it resolves to is private/link-local/loopback.
 * The returned `target` is the vetted address the connection is pinned to
 * (below), so resolution and connection can not diverge.
 */
async function resolveVettedHost(url) {
  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname
  if (policyExempt(url)) {
    return { host: hostname, target: hostname }
  }

  const isIp = net.isIPv4(hostname) || net.isIPv6(hostname)
  let addresses
  if (isIp) {
    addresses = [hostname]
  } else {
    try {
      const lookedUp = await dns.promises.lookup(hostname, {
        all: true,
        verbatim: true,
      })
      addresses = lookedUp.map(a => a.address)
    } catch (err) {
      throw new OError(`Could not resolve ${hostname}`, {
        status: 400,
      }).withCause(err)
    }
  }

  for (const addr of addresses) {
    if (isBlockedIpLiteral(addr)) {
      throw new OError(
        'This deployment does not allow WakaTime API URLs resolving to private or internal network addresses',
        { status: 400, hostname }
      )
    }
  }

  // Connect to the vetted address (prefer IPv4 when both are offered).
  const target = addresses.find(a => net.isIPv4(a)) || addresses[0]
  return { host: hostname, target }
}

/**
 * Run a fetchJson/fetchNothing call with transport-level SSRF protection:
 *
 *  - the host is resolved and EVERY resolved address vetted, and the
 *    connection is pinned to that vetted address (SNI/Host keep the
 *    original name), so DNS rebinding cannot swap in an internal IP
 *    between the check and the connect;
 *  - redirects are rejected (redirect: 'manual'). The WakaTime/Wakapi
 *    API endpoints are not expected to redirect, and following one would
 *    send the user's credentials to a host this deployment has not
 *    vetted. fetchJson/fetchNothing surface a 3xx as a
 *    RequestFailedError, which is rethrown as an explicit 400.
 */
async function guardedFetch(url, fetcher, fetchOpts = {}) {
  const target = url instanceof URL ? url : new URL(url)
  validateApiUrl(target.href)

  const isHttps = target.protocol === 'https:'
  const { host: hostname, target: targetHost } = await resolveVettedHost(target)

  const agent = new (isHttps ? https.Agent : http.Agent)({
    createConnection: options => {
      const connOpts = { ...options, host: targetHost }
      if (isHttps) {
        // Pin SNI to the original hostname, not the IP.
        connOpts.servername = hostname
        return tls.connect(connOpts)
      }
      return net.connect(connOpts)
    },
  })

  try {
    return await fetcher(target, {
      ...fetchOpts,
      agent,
      redirect: 'manual',
    })
  } catch (err) {
    if (
      err instanceof RequestFailedError &&
      [301, 302, 303, 307, 308].includes(err.response?.status)
    ) {
      throw new OError(
        'The WakaTime server redirected the request, which this deployment does not allow',
        {
          status: 400,
          from: target.href,
          location: err.response?.headers?.get?.('location') || null,
        }
      ).withCause(err)
    }
    throw err
  } finally {
    agent.destroy()
  }
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
  validateApiUrl(apiUrl)
  const { headers, authQuery } = buildAuth(apiKey)
  const url = normalizeApiUrl(apiUrl)
  const target = authQuery
    ? `${url}/users/current?${authQuery}`
    : `${url}/users/current`
  try {
    await guardedFetch(target, fetchJson, {
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
  let auth
  try {
    auth = await resolveAuth(userId)
  } catch (err) {
    logger.warn({ userId, err }, 'WakaTime credentials rejected, treating as not connected')
    return { connected: false, error: true }
  }
  if (auth.kind === 'none') return { connected: false }

  try {
    await guardedFetch(
      authUrl(auth, '/users/current'),
      fetchJson,
      {
        headers: auth.headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
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
    await guardedFetch(
      authUrl(auth, '/users/current/heartbeats'),
      fetchNothing,
      {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(heartbeat),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
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
      await guardedFetch(
        authUrl(auth, '/users/current/heartbeats.bulk'),
        fetchNothing,
        {
          method: 'POST',
          headers: auth.headers,
          body: JSON.stringify(heartbeat),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      )
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
    const summary = await guardedFetch(
      authUrl(auth, '/users/current/summaries', qs.toString()),
      fetchJson,
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
    summary = await guardedFetch(
      authUrl(auth, '/users/current/summaries', qs.toString()),
      fetchJson,
      {
        headers: auth.headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
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

  // Policy errors (SSRF guard, rejected redirects, unresolvable hosts)
  // are OErrors that already carry an explicit status — pass them
  // through instead of downgrading to a generic 500. RequestFailedError
  // extends OError too, but it keeps its own status mapping below.
  if (err instanceof OError && !(err instanceof RequestFailedError)) {
    const info = OError.getFullInfo(err)
    if (info?.status) throw err
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
  validateApiUrl,
  verifyCredentials,
  getConnectionStatus,
  sendHeartbeat,
  sendHeartbeatsBulk,
  getProjectSummary,
  getUserSummary,
  unlinkAccount,
}
