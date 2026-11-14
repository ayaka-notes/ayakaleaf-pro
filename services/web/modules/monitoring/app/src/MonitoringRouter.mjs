import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'

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

function statusPage(req, res) {
  const { internalUrl, user, password } = grafanaConfig()
  const enabled = Boolean(internalUrl && user && password)
  res.render(STATUS_VIEW, {
    title: 'instance_status',
    // Same-origin through the /admin/status/grafana/ proxy below (this
    // Grafana build has no /kiosk route — use the plain dashboard route)
    grafanaPath: enabled ? `/admin/status/grafana/d/${DASHBOARD_UID}` : '',
  })
}

// /admin/status/grafana/** -> Grafana /**, server-side Basic auth.
// Grafana is configured with GF_SERVER_ROOT_URL=<app>/admin/status/grafana/
// (serve-from-subpath), so every asset/API call the embedded UI makes stays
// under this prefix and gets the admin credentials attached server-side.
const SKIP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'authorization',
  'accept-encoding',
])

function proxyGrafana(req, res) {
  const { internalUrl, user, password } = grafanaConfig()
  if (!internalUrl || !user || !password) {
    return res.status(503).send('grafana embed is not configured')
  }
  const rest = (req.params[0] || '').replace(/^\/+/, '')
  const qs = req.originalUrl.includes('?') ? `?${req.originalUrl.split('?')[1]}` : ''
  const target = `${internalUrl}/admin/status/grafana/${rest}${qs}`
  const auth = Buffer.from(`${user}:${password}`).toString('base64')
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!SKIP_HEADERS.has(k.toLowerCase())) headers[k] = v
  }
  headers.Authorization = `Basic ${auth}`
  let body
  if (!['GET', 'HEAD'].includes(req.method)) {
    // express body parsers may have consumed the request; re-serialize what
    // is left (object -> JSON, string -> as-is)
    if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer)) {
      body = JSON.stringify(req.body)
      headers['content-type'] = 'application/json'
    } else if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      body = req.body
    }
  }
  return fetch(target, {
    method: req.method,
    headers,
    body,
    redirect: 'follow',
  })
    .then(upstream => {
      if (!upstream.body) {
        res.status(upstream.status)
        upstream
          .text()
          .then(text => res.send(text))
          .catch(() => res.end())
        return
      }
      const responseHeaders = {}
      upstream.headers.forEach((value, key) => {
        const k = key.toLowerCase()
        if (
          !SKIP_HEADERS.has(k) &&
          !['transfer-encoding', 'content-encoding'].includes(k) &&
          // the app's own security headers apply to the embedded document;
          // upstream Grafana CSP carries frame-ancestors 'none', which would
          // break the same-origin iframe
          !['content-security-policy', 'x-frame-options', 'x-xss-protection'].includes(k)
        ) {
          responseHeaders[k] = value
        }
      })
      res.status(upstream.status)
      // the app's global CSP middleware sets a default policy (frame-ancestors
      // 'none') on every response before the handler runs; the embedded
      // Grafana document must be allowed to render in our same-origin iframe
      res.removeHeader('content-security-policy')
      res.removeHeader('reporting-endpoints')
      for (const [k, v] of Object.entries(responseHeaders)) res.setHeader(k, v)
      if (!responseHeaders['content-type']) {
        res.setHeader('content-type', 'application/octet-stream')
      }
      Readable.fromWeb(upstream.body).pipe(res)
    })
    .catch(err => {
      logger.error({ err, target }, 'grafana proxy request failed')
      res.status(502).send('grafana upstream error')
    })
}

// The whole module is for site admins, like the rest of /admin/*.
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
