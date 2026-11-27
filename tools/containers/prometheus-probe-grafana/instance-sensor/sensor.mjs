// overleaf-instance-sensor
// Live Prometheus gauges for the Overleaf instance statistics, ported from
// PR yu-i-i/overleaf-cep#178 (services/web/modules/instance-stats): computed
// fresh on every scrape instead of hourly Mongo snapshots.
//
// Probes (all isolated — a failing probe emits probe_up{source}=0 and bumps
// its error counter; the rest of the endpoint still answers):
//   mongo     users total/active, projects total/active, files total,
//             mongodb storage (dbStats.totalSize)
//   filestore byte-exact `du -sb` of the SeaweedFS (S3 filestore) data dir
//   redis     used_memory (RAM) + aof_current_size (disk)
//
// Design notes:
//   * Persistent MongoClient / ioredis connections — no per-scrape handshake.
//   * Probes run concurrently (Promise.allSettled) and every phase is wrapped
//     in a timeout (per-probe + overall collect), so a hung probe can never
//     wedge the endpoint.
//   * Single-flight: concurrent scrapes share one collect.
//   * /healthz is cheap (no probes) — use it for container healthchecks.
//
// Recommended indexes (the active-window counts are filtered queries):
//   db.users.createIndex({ lastActive: 1 })
//   db.projects.createIndex({ lastUpdated: 1 })
//   db.users.createIndex({ adminRoles: 1 })   // only with SEGMENTATION=true

import http from 'node:http'
import { execFile } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { MongoClient } from 'mongodb'
import Redis from 'ioredis'

const execFileAsync = promisify(execFile)

const PORT = Number(process.env.PORT || 9464)
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:27017/sharelatex'
const REDIS_ADDR = process.env.REDIS_ADDR || 'redis://redis:6379'
// Empty/unset disables the filestore probe (generic deployments without an
// S3/SeaweedFS filestore).
const FILESTORE_DATA_DIR = process.env.FILESTORE_DATA_DIR || ''
const SEGMENTATION = String(process.env.SEGMENTATION || 'false') === 'true'
const WINDOW_HOURS = Number(process.env.ACTIVE_WINDOW_HOURS || 24)
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 8000)
const COLLECT_TIMEOUT_MS = Number(process.env.COLLECT_TIMEOUT_MS || 20000)
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || 5000)

const GUEST_ADMIN_ROLE = 'guest-user' // PR#176/PR#178 guest definition

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const state = {
  errors: new Map(), // source -> cumulative failed probe count (counter)
  probeOk: new Map(), // source -> success of the most recent collect
  lastSuccessSeconds: null,
  lastDurationSeconds: null,
}
let inFlight = null // single-flight collect promise

const PROBE_SOURCES = FILESTORE_DATA_DIR
  ? ['mongo', 'filestore', 'redis']
  : ['mongo', 'redis']

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

let mongoClient = null
function getMongo() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URL, {
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    })
  }
  return mongoClient
}

let redisClient = null
function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(REDIS_ADDR, {
      maxRetriesPerRequest: 1,
      connectTimeout: CONNECT_TIMEOUT_MS,
    })
  }
  return redisClient
}

async function duBytes(path) {
  // byte-exact du (same semantics as PR#178's duBytes())
  const { stdout } = await execFileAsync('du', ['-sb', path])
  const m = String(stdout).match(/(\d+)/)
  return m ? Number(m[1]) : 0
}

function redisInfoInt(info, key) {
  const m = String(info || '').match(new RegExp(`^${key}:(\\d+)`, 'm'))
  return m ? Number(m[1]) : 0
}

// ---------------------------------------------------------------------------
// probes — each returns an array of exposition-format metric lines
// ---------------------------------------------------------------------------
const STORAGE_HELP =
  '# HELP overleaf_instance_storage_bytes Storage used, bytes. component: mongodb | filestore | redis_ram | redis_disk.'
const STORAGE_TYPE = '# TYPE overleaf_instance_storage_bytes gauge'

async function probeMongo() {
  const client = getMongo()
  await withTimeout(client.connect(), PROBE_TIMEOUT_MS, 'mongo connect')
  const db = client.db() // db name comes from MONGO_URL
  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000)
  const users = db.collection('users')
  const projects = db.collection('projects')
  const docs = db.collection('docs')

  const [
    totalUsers,
    activeUsers,
    totalProjects,
    activeProjects,
    totalFiles,
  ] = await withTimeout(
    Promise.all([
      users.countDocuments(),
      users.countDocuments({ lastActive: { $gte: since } }),
      projects.countDocuments(),
      projects.countDocuments({ lastUpdated: { $gte: since } }),
      docs.countDocuments(),
    ]),
    PROBE_TIMEOUT_MS,
    'mongo counts'
  )

  const lines = [
    '# HELP overleaf_instance_users_total Total registered users.',
    '# TYPE overleaf_instance_users_total gauge',
    `overleaf_instance_users_total{segment="all"} ${totalUsers}`,
    '# HELP overleaf_instance_users_active Users active in the configured window (users.lastActive).',
    '# TYPE overleaf_instance_users_active gauge',
    `overleaf_instance_users_active{segment="all",window_hours="${WINDOW_HOURS}"} ${activeUsers}`,
  ]

  if (SEGMENTATION) {
    const guest = { adminRoles: { $in: [GUEST_ADMIN_ROLE] } }
    const [guestUsers, activeGuest] = await withTimeout(
      Promise.all([
        users.countDocuments(guest),
        users.countDocuments({ ...guest, lastActive: { $gte: since } }),
      ]),
      PROBE_TIMEOUT_MS,
      'mongo segmentation'
    )
    lines.push(
      `overleaf_instance_users_total{segment="standard"} ${totalUsers - guestUsers}`,
      `overleaf_instance_users_total{segment="guest"} ${guestUsers}`,
      `overleaf_instance_users_active{segment="standard",window_hours="${WINDOW_HOURS}"} ${activeUsers - activeGuest}`,
      `overleaf_instance_users_active{segment="guest",window_hours="${WINDOW_HOURS}"} ${activeGuest}`,
    )
  }

  lines.push(
    '# HELP overleaf_instance_projects_total Total projects.',
    '# TYPE overleaf_instance_projects_total gauge',
    `overleaf_instance_projects_total ${totalProjects}`,
    '# HELP overleaf_instance_projects_active Projects updated in the configured window (projects.lastUpdated).',
    '# TYPE overleaf_instance_projects_active gauge',
    `overleaf_instance_projects_active{window_hours="${WINDOW_HOURS}"} ${activeProjects}`,
    '# HELP overleaf_instance_files_total Total documents (files) in the docs collection.',
    '# TYPE overleaf_instance_files_total gauge',
    `overleaf_instance_files_total ${totalFiles}`,
  )

  // PR#178: mongodb_storage = dbStats.totalSize (bytes)
  let mongoBytes = 0
  try {
    const stats = await withTimeout(db.stats(), 3000, 'mongo dbStats')
    mongoBytes = Number(stats?.totalSize ?? 0)
  } catch {
    /* keep 0 — dbStats failing is not fatal for the rest of the probe */
  }
  lines.push(
    STORAGE_HELP,
    STORAGE_TYPE,
    `overleaf_instance_storage_bytes{component="mongodb"} ${mongoBytes}`,
  )
  return lines
}

async function probeFilestore() {
  const bytes = await withTimeout(
    duBytes(FILESTORE_DATA_DIR),
    PROBE_TIMEOUT_MS,
    `du ${FILESTORE_DATA_DIR}`
  )
  return [
    STORAGE_HELP,
    STORAGE_TYPE,
    `overleaf_instance_storage_bytes{component="filestore"} ${bytes}`,
  ]
}

async function probeRedis() {
  const r = getRedis()
  const [memInfo, persInfo] = await withTimeout(
    Promise.all([
      r.info('memory'),
      r.info('persistence').catch(() => null), // aof may be disabled — 0 is the true value
    ]),
    PROBE_TIMEOUT_MS,
    'redis info'
  )
  return [
    STORAGE_HELP,
    STORAGE_TYPE,
    `overleaf_instance_storage_bytes{component="redis_ram"} ${redisInfoInt(memInfo, 'used_memory')}`,
    `overleaf_instance_storage_bytes{component="redis_disk"} ${redisInfoInt(persInfo, 'aof_current_size')}`,
  ]
}

const PROBE_FUNCS = { mongo: probeMongo, filestore: probeFilestore, redis: probeRedis }

// ---------------------------------------------------------------------------
// collect — concurrent probes, bounded time, single-flight
// ---------------------------------------------------------------------------
async function collect() {
  const t0 = performance.now()
  const results = await withTimeout(
    Promise.allSettled(PROBE_SOURCES.map(source => PROBE_FUNCS[source]())),
    COLLECT_TIMEOUT_MS,
    'collect'
  )

  const lines = []
  results.forEach((result, i) => {
    const source = PROBE_SOURCES[i]
    if (result.status === 'fulfilled') {
      state.probeOk.set(source, true)
      lines.push(...result.value)
    } else {
      state.probeOk.set(source, false)
      state.errors.set(source, (state.errors.get(source) || 0) + 1)
      console.error(
        `[sensor] probe "${source}" failed: ${
          result.reason && result.reason.message
        }`
      )
    }
  })

  const allUp = PROBE_SOURCES.every(source => state.probeOk.get(source) === true)
  if (allUp) state.lastSuccessSeconds = Math.floor(Date.now() / 1000)
  const durationSeconds = (performance.now() - t0) / 1000
  state.lastDurationSeconds = durationSeconds

  lines.push(
    '# HELP overleaf_instance_sensor_probe_up 1 when the most recent collect computed this probe successfully.',
    '# TYPE overleaf_instance_sensor_probe_up gauge',
    ...PROBE_SOURCES.map(
      source =>
        `overleaf_instance_sensor_probe_up{source="${source}"} ${
          state.probeOk.get(source) ? 1 : 0
        }`
    ),
    '# HELP overleaf_instance_sensor_scrape_duration_seconds Duration of the most recent collect, seconds.',
    '# TYPE overleaf_instance_sensor_scrape_duration_seconds gauge',
    `overleaf_instance_sensor_scrape_duration_seconds ${durationSeconds.toFixed(3)}`,
  )
  if (state.lastSuccessSeconds !== null) {
    lines.push(
      '# HELP overleaf_instance_sensor_last_success_timestamp_seconds Unix time of the last fully successful collect.',
      '# TYPE overleaf_instance_sensor_last_success_timestamp_seconds gauge',
      `overleaf_instance_sensor_last_success_timestamp_seconds ${state.lastSuccessSeconds}`,
    )
  }
  lines.push(
    '# HELP overleaf_instance_sensor_errors_total Failed probe count since start (source=mongo|filestore|redis).',
    '# TYPE overleaf_instance_sensor_errors_total counter',
  )
  for (const source of PROBE_SOURCES) {
    const n = state.errors.get(source)
    if (n) lines.push(`overleaf_instance_sensor_errors_total{source="${source}"} ${n}`)
  }
  return `${lines.join('\n')}\n`
}

function scrape() {
  if (!inFlight) {
    inFlight = collect().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed\n')
    return
  }
  if (req.url === '/healthz') {
    // cheap liveness: the process answers and reports last-known probe state;
    // it does NOT trigger a collect
    const body =
      JSON.stringify({
        status: 'ok',
        probes: Object.fromEntries(state.probeOk),
        lastSuccessSeconds: state.lastSuccessSeconds,
        lastDurationSeconds:
          state.lastDurationSeconds === null
            ? null
            : Number(state.lastDurationSeconds.toFixed(3)),
      }) + '\n'
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
    return
  }
  if (req.url !== '/metrics') {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found\n')
    return
  }
  scrape().then(
    body => {
      res.writeHead(200, {
        'content-type': 'text/plain; version=0.0.4; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      })
      res.end(body)
    },
    err => {
      console.error('[sensor] collect failed:', err)
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(`sensor internal error: ${err.message}\n`)
    }
  )
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `overleaf-instance-sensor listening on :${PORT} ` +
      `(window=${WINDOW_HOURS}h, segmentation=${SEGMENTATION ? 'on' : 'off'}, ` +
      `filestore=${FILESTORE_DATA_DIR || 'disabled'}, sources=${PROBE_SOURCES.join(',')})`
  )
})
