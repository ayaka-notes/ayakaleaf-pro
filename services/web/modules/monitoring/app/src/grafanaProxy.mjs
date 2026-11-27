import { Readable } from 'node:stream'

// Request headers we never forward to the upstream Grafana (hopping headers,
// the client's own credentials, and content-encoding the response must match).
export const SKIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'authorization',
  'accept-encoding',
])

// Response headers we drop before copying them through:
// - hopping headers and content-encoding (we stream the body as-is)
// - the app's own security headers (see below)
// - the upstream CSP/XFO: the app's global CSP middleware sets frame-ancestors
//   'none' on every response before the handler runs, and the embedded
//   dashboard must be allowed to render in our own iframe
const SKIP_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'content-encoding',
  'content-security-policy',
  'reporting-endpoints',
  'x-frame-options',
  'x-xss-protection',
])

// The embedded dashboard is served same-origin on purpose: the proxy's admin
// gate needs the session cookie, which the browser only sends same-origin.
// Consequence: a script that executes inside the Grafana UI runs under the
// app's origin. Full isolation (iframe sandbox without allow-same-origin, or a
// separate Grafana origin) is not possible while the proxy authenticates with
// the session, so we harden the document with the strictest CSP that keeps it
// working:
//  - Grafana's boot HTML uses inline <script> tags with empty nonces, so
//    script-src must allow 'unsafe-inline' (a nonce-based policy would break
//    the dashboard);
//  - everything else stays locked down to 'self', which blocks the realistic
//    injection/exfil vectors: remote <script src> injection, cross-origin
//    fetch/XHR exfiltration (connect-src), <img>/<object> exfiltration and
//    plugins, <base> hijacking (Grafana sets a same-origin <base> at boot,
//    hence 'self' rather than 'none'), form escape, and third-party framing.
export const DOCUMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'", // same-origin includes the same-origin Grafana live WebSocket; bare ws:/wss: would allow cross-origin exfil
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ')

export function buildUpstreamRequest(req, { target, auth }) {
  const headers = {}
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (!SKIP_REQUEST_HEADERS.has(k.toLowerCase())) headers[k] = v
  }
  headers.Authorization = `Basic ${auth}`
  let body
  if (!['GET', 'HEAD'].includes(req.method)) {
    // express body parsers may have consumed the request; re-serialize what
    // is left (object -> JSON, string/Buffer -> as-is)
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
}

// Copies the upstream response to `res` (express- or node:http-compatible
// response object), applying the hardening headers described above.
export function applyUpstreamToResponse(upstream, res) {
  res.statusCode = upstream.status
  // the app's global CSP middleware (frame-ancestors 'none') set these
  // before the handler ran; clear them before we decide what the embedded
  // document gets
  res.removeHeader?.('content-security-policy')
  res.removeHeader?.('reporting-endpoints')
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (!SKIP_RESPONSE_HEADERS.has(k)) res.setHeader(k, value)
  })
  res.setHeader('x-content-type-options', 'nosniff')
  const contentType = (upstream.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('text/html')) {
    res.setHeader('content-security-policy', DOCUMENT_CSP)
  }
  if (!contentType) {
    res.setHeader('content-type', 'application/octet-stream')
  }
  if (!upstream.body) {
    return upstream
      .text()
      .then(text => res.end(text))
      .catch(() => res.end())
  }
  return Readable.fromWeb(upstream.body).pipe(res)
}
