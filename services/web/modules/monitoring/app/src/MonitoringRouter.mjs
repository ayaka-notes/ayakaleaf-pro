import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import { buildUpstreamRequest, applyUpstreamToResponse } from './grafanaProxy.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))
const STATUS_VIEW = Path.resolve(__dirname, '../views/status')

// The provisioned "Overleaf — instance overview" dashboard (its uid).
const DASHBOARD_UID = 'overleaf-overview'

function grafanaConfig() {
  const g = Settings.grafana || {}
  return {
    internalUrl: (g.internal_url || '').replace(/\/+$/, ''),
    publicBase: (g.public_base_url || '').replace(/\/+$/, ''),
    user: g.admin_user || 'admin',
    password: g.admin_password || '',
  }
}

// Two embed modes, in order of preference:
//  1. ISOLATED (recommended): public_base_url points the browser straight at
//     Grafana's own origin (e.g. https://grafana.<internal-domain>), where
//     the instance is configured with anonymous read-only (Viewer) access.
//     The app's admin session never enters the iframe, so a Grafana-side
//     compromise cannot touch Overleaf. Trade-off: anyone who can reach
//     that origin can read the monitoring dashboards — keep it internal.
//  2. PROXY (fallback): internal_url + admin credentials; the module proxies
//     Grafana under /admin/status/grafana/** with server-side Basic auth.
//     Session-gated (admins only), but same-origin — hence the CSP
//     hardening in grafanaProxy.mjs. Use when the Grafana origin must not
//     be reachable without a session.
export function isStatusEnabled() {
  const { internalUrl, publicBase, user, password } = grafanaConfig()
  return Boolean(publicBase) || Boolean(internalUrl && user && password)
}

function statusPage(req, res) {
  const { internalUrl, publicBase, user, password } = grafanaConfig()
  const isolated = Boolean(publicBase)
  const proxied = Boolean(internalUrl && user && password)
  res.render(STATUS_VIEW, {
    title: 'instance_status',
    // Isolated mode frames Grafana's own origin; proxy mode stays
    // same-origin under /admin/status/grafana/ (this Grafana build has no
    // /kiosk route — use the plain dashboard route).
    grafanaPath: isolated
      ? `${publicBase}/d/${DASHBOARD_UID}`
      : proxied
        ? `/admin/status/grafana/d/${DASHBOARD_UID}`
        : '',
    isolated,
  })
}

// /admin/status/grafana/** -> Grafana /**, server-side Basic auth.
// Grafana is configured with GF_SERVER_ROOT_URL=<app>/admin/status/grafana/
// (serve-from-subpath), so every asset/API call the embedded UI makes stays
// under this prefix and gets the admin credentials attached server-side.
function proxyGrafana(req, res) {
  const { internalUrl, user, password } = grafanaConfig()
  if (!internalUrl || !user || !password) {
    return res.status(503).send('grafana embed is not configured')
  }
  const rest = (req.params[0] || '').replace(/^\/+/, '')
  const qs = req.originalUrl.includes('?') ? `?${req.originalUrl.split('?')[1]}` : ''
  const target = `${internalUrl}/admin/status/grafana/${rest}${qs}`
  const auth = Buffer.from(`${user}:${password}`).toString('base64')
  return buildUpstreamRequest(req, { target, auth })
    .then(upstream => applyUpstreamToResponse(upstream, res))
    .catch(err => {
      logger.error({ err, target }, 'grafana proxy request failed')
      res.status(502).send('grafana upstream error')
    })
}

// PROXY MODE (fallback, see isStatusEnabled above): the whole module below
// is for site admins, like the rest of /admin/*. In isolated mode the
// browser never uses these routes; they stay for deployments that gate
// access with the session instead of exposing the Grafana origin.
export default {
  apply(webRouter) {
    logger.debug({}, 'Init Monitoring router')
    const admin = [
      AuthenticationController.requireLogin(),
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
    ]
    webRouter.get('/admin/status', admin, statusPage)
    webRouter.all('/admin/status/grafana/*', admin, proxyGrafana)

    // The embedded Grafana UI issues token-less same-origin POSTs (panel
    // queries, telemetry); the browser never sees a foreign origin, so the
    // session-based CSRF check has nothing to verify here. Exempt the
    // proxied API paths, exactly like other proxied APIs do.
    if (webRouter.csrf) {
      for (const p of [
        '/admin/status/grafana/api/ds/query',
        '/admin/status/grafana/api/frontend-metrics',
        '/admin/status/grafana/api/annotations',
        '/admin/status/grafana/api/ds/resource',
      ]) {
        webRouter.csrf.disableDefaultCsrfProtection(p, 'POST')
        webRouter.csrf.disableDefaultCsrfProtection(p, 'PUT')
      }
    }
  },
}
