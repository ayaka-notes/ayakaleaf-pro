import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import Path from 'node:path'
import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import { fetchJson, RequestFailedError } from '@overleaf/fetch-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import WakaTimeApiClient from './WakaTimeApiClient.mjs'
import TokenManager from './TokenManager.mjs'

const MAX_BULK_HEARTBEATS = 50
const OAUTH_REQUEST_TIMEOUT_MS = 15 * 1000

function sendError(res, err, operation) {
  const info = OError.getFullInfo(err)
  const status = info?.status || 500
  logger.error(OError.getFullStack(err))
  logger.error({ info, operation }, 'WakaTime request failed')
  res.status(status).json({ message: err.message })
}

/**
 * GET /user/wakatime/status
 */
async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    const status = await WakaTimeApiClient.getConnectionStatus(userId)
    res.json(status)
  } catch (err) {
    sendError(res, err, 'getConnectionStatus')
  }
}

/**
 * PUT /user/wakatime
 * body: { apiUrl, apiKey }
 * Verifies the credentials against the target server before storing them.
 */
async function link(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { apiUrl, apiKey } = req.body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ message: 'apiKey is required' })
  }

  try {
    await WakaTimeApiClient.verifyCredentials(apiUrl, apiKey)
    await TokenManager.storeCredentials(userId, apiUrl, apiKey)
    res.sendStatus(200)
  } catch (err) {
    sendError(res, err, 'link')
  }
}

/**
 * DELETE /user/wakatime
 */
async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await WakaTimeApiClient.unlinkAccount(userId)
    res.sendStatus(200)
  } catch (err) {
    sendError(res, err, 'unlink')
  }
}

/**
 * POST /project/:project_id/wakatime/heartbeat
 * body: a single WakaTime heartbeat payload (entity, type, time, ...)
 * Forwards the heartbeat to the user's configured WakaTime/Wakapi server,
 * filling in the project name server-side so the client never needs to
 * know (or spoof) it.
 */
async function heartbeat(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { project_id: projectId } = req.params

  try {
    const project = await Project.findById(projectId, 'name').exec()
    if (!project) return res.sendStatus(404)

    await WakaTimeApiClient.sendHeartbeat(userId, {
      ...req.body,
      project: project.name,
    })
    res.sendStatus(202)
  } catch (err) {
    sendError(res, err, 'heartbeat')
  }
}

/**
 * POST /project/:project_id/wakatime/heartbeats/bulk
 * body: an array of WakaTime heartbeat payloads
 */
async function heartbeatsBulk(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { project_id: projectId } = req.params
  const heartbeats = Array.isArray(req.body) ? req.body : []

  if (heartbeats.length === 0) return res.sendStatus(204)
  if (heartbeats.length > MAX_BULK_HEARTBEATS) {
    return res.status(400).json({ message: 'too many heartbeats in one batch' })
  }

  try {
    const project = await Project.findById(projectId, 'name').exec()
    if (!project) return res.sendStatus(404)

    await WakaTimeApiClient.sendHeartbeatsBulk(userId, heartbeats.map(h => ({ ...h, project: project.name })))
    res.sendStatus(202)
  } catch (err) {
    sendError(res, err, 'heartbeatsBulk')
  }
}

/**
 * GET /project/:project_id/wakatime/summary
 * Returns total tracked time (in seconds) for this project over the last
 * `range` days (query param, default 7).
 */
async function summary(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { project_id: projectId } = req.params
  const range = Math.min(parseInt(req.query.range, 10) || 7, 90)

  try {
    const project = await Project.findById(projectId, 'name').exec()
    if (!project) return res.sendStatus(404)

    const result = await WakaTimeApiClient.getProjectSummary(userId, project.name, range)
    if (!result) return res.json({ connected: false })

    res.json({ connected: true, ...result })
  } catch (err) {
    sendError(res, err, 'summary')
  }
}

/**
 * GET /user/wakatime/summary
 * The logged-in user's OWN coding statistics across all projects over the
 * last `range` days (query param, default 30, capped at 365). Aggregated
 * server-side so the coding-statistics page can render it with a single
 * call — no separate WakaTime login needed.
 */
async function getUserSummary(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const range = Math.min(Math.max(parseInt(req.query.range, 10) || 30, 1), 365)

  try {
    const result = await WakaTimeApiClient.getUserSummary(userId, range)
    if (!result) return res.json({ connected: false })
    res.json({ connected: true, ...result })
  } catch (err) {
    sendError(res, err, 'getUserSummary')
  }
}

/**
 * GET /user/coding-statistics
 * The dedicated in-Overleaf coding statistics page (no WakaTime login
 * required; the browser is already authenticated here).
 */
async function codingStatisticsPage(req, res) {
  res.render(Path.resolve(import.meta.dirname, '../views/coding-statistics'))
}

/**
 * GET /user/wakatime/oauth/authorize
 * Step 1 of the WakaTime.com OAuth2 handshake: redirect the browser to
 * wakatime.com with our client id + a session-bound `state` (CSRF guard).
 */
async function oauthAuthorize(req, res) {
  const oauth = Settings.wakatime?.oauth
  if (!oauth?.clientId) {
    return res.status(503).json({
      message: 'WakaTime.com connection is not configured on this deployment',
    })
  }

  const state = crypto.randomBytes(24).toString('hex')
  req.session.wakatimeOAuth = { state }

  const params = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: 'code',
    state,
  })
  // WakaTime scopes are resource-action pairs picked at app creation; omit
  // the param to request exactly the scopes the app was created with.
  if (oauth.scope) params.set('scope', oauth.scope)
  res.redirect(`${oauth.authorizeUrl}?${params.toString()}`)
}

/**
 * GET /user/wakatime/oauth/callback?code=...&state=...
 * Step 2: exchange the authorization code for an access token against
 * wakatime.com (server-to-server, client secret never leaves the backend),
 * store it encrypted for the logged-in user, then go to the stats page.
 */
async function oauthCallback(req, res) {
  const oauth = Settings.wakatime?.oauth
  if (!oauth?.clientId || !oauth?.clientSecret) {
    return res.redirect('/user/coding-statistics?waka_error=not_configured')
  }

  const code = req.query.code
  const state = req.query.state
  const pending = req.session.wakatimeOAuth
  delete req.session.wakatimeOAuth

  if (!code) {
    const reason = req.query.error || 'missing_code'
    logger.warn({ reason }, 'WakaTime OAuth callback failed')
    return res.redirect(`/user/coding-statistics?waka_error=${encodeURIComponent(reason)}`)
  }

  // state guard: reject callbacks that don't match the pending flow
  if (!pending?.state || pending.state !== state) {
    logger.warn({}, 'WakaTime OAuth callback state mismatch, rejected')
    return res.redirect('/user/coding-statistics?waka_error=state_mismatch')
  }

  const userId = SessionManager.getLoggedInUserId(req.session)

  try {
    const token = await fetchJson(oauth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        code,
        redirect_uri: oauth.redirectUri,
      }),
      signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
    })

    const accessToken = token.access_token
    if (!accessToken) {
      throw new OError('WakaTime.com did not return an access token', {
        status: 502,
      })
    }

    await TokenManager.storeCredentials(userId, oauth.apiBaseUrl, accessToken)
    res.redirect('/user/coding-statistics?waka_linked=1')
  } catch (err) {
    if (err instanceof RequestFailedError) {
      logger.error({ status: err.response?.status }, 'WakaTime OAuth token exchange failed')
      return res.redirect('/user/coding-statistics?waka_error=token_exchange_failed')
    }
    logger.error(OError.getFullStack(err))
    res.redirect('/user/coding-statistics?waka_error=token_exchange_failed')
  }
}

export default {
  getConnectionStatus,
  link,
  unlink,
  heartbeat,
  heartbeatsBulk,
  summary,
  getUserSummary,
  codingStatisticsPage,
  oauthAuthorize,
  oauthCallback,
}
