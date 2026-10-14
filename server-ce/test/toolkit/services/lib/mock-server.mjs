// Plumbing shared by the mocks of external services (github-mock, tpr-mock,
// ai-mock): a tiny router, request and response helpers, and the two servers
// every mock runs. Port 443 serves the impersonated hosts over TLS, with the
// certificate from bin/make-tls; port 8080 is the plain HTTP control API
// the tests use.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { promisify } from 'node:util'

const run = promisify(execFile)

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

// Thrown by a handler to leave the request unanswered, like a service that
// stops responding
export class NoResponse extends Error {}

// Buffers and strings go out as they are, anything else as JSON
export function send(res, status, body, headers = {}) {
  if (body === undefined) {
    res.writeHead(status, headers)
    res.end()
  } else if (Buffer.isBuffer(body) || typeof body === 'string') {
    res.writeHead(status, { 'Content-Type': 'text/plain', ...headers })
    res.end(body)
  } else {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  // File contents stay bytes
  if ((req.headers['content-type'] || '').includes('octet-stream')) {
    return Buffer.concat(chunks)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  if ((req.headers['content-type'] || '').includes('json')) {
    return JSON.parse(raw)
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

function route(routes, method, pathname) {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue
    const match = pattern.exec(pathname)
    if (match) {
      // Optional groups that did not match stay undefined
      const params = match.slice(1).map(p => p && decodeURIComponent(p))
      return { handler, params }
    }
  }
  return null
}

// routes is a list of [method, pattern, handler], or an object of such lists
// keyed by host name, for hosts that share paths
function serve(routes) {
  return async (req, res) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '')
    const url = new URL(req.url, `https://${host}`)
    try {
      const found = route(
        Array.isArray(routes) ? routes : routes[host] || [],
        req.method,
        url.pathname
      )
      if (!found) throw new HttpError(404, 'Not Found')
      const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)
        ? await readBody(req)
        : {}
      await found.handler({ req, res, url, body, params: found.params })
    } catch (err) {
      if (err instanceof NoResponse) return
      if (!(err instanceof HttpError)) {
        console.error(err)
        err = new HttpError(500, err.message)
      }
      send(res, err.status, { message: err.message, ...err.extra })
    }
  }
}

// Makes connecting to the mock slow, like a far away service: its SYN-ACKs
// from port 443 leave ms later, everything else at full speed. 0 turns it
// off. Needs NET_ADMIN (lib/start-mock) and tc, installed on first use.
async function setConnectDelay(ms) {
  if (ms) {
    await run('sh', ['-c', 'command -v tc || apk add --no-cache iproute2-tc'])
  }
  // Fails when there is nothing to remove, or no tc as it was never used
  await run('tc', ['qdisc', 'del', 'dev', 'eth0', 'root']).catch(() => {})
  if (!ms) return
  const tc = args => run('tc', args.split(' '))
  await tc('qdisc add dev eth0 root handle 1: prio')
  await tc(`qdisc add dev eth0 parent 1:3 handle 30: netem delay ${ms}ms`)
  // IPv4 without options, TCP from port 443 with only SYN and ACK set
  await tc(
    'filter add dev eth0 parent 1: protocol ip u32 match ip protocol 6 0xff ' +
      'match u8 0x05 0x0f at 0 match u16 443 0xffff at 20 ' +
      'match u8 0x12 0xff at 33 flowid 1:3'
  )
}

// Body: { ms }
const connectDelay = [
  'POST',
  /^\/_mock\/connect-delay$/,
  async ({ res, body }) => {
    await setConnectDelay(Number(body.ms) || 0)
    send(res, 204)
  },
]

export function listen({ name, routes, control, tlsDir = '/tls' }) {
  https
    .createServer(
      {
        key: fs.readFileSync(`${tlsDir}/tls.key`),
        cert: fs.readFileSync(`${tlsDir}/tls.crt`),
      },
      serve(routes)
    )
    .listen(443)
  http.createServer(serve([connectDelay, ...control])).listen(8080)
  console.log(`${name} listening on 443 (TLS) and 8080 (control)`)
}
