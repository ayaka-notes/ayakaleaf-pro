import { randomUUID, createHash } from 'node:crypto'
import Metrics from '@overleaf/metrics'
import ProjectSnapshotReader from './ProjectSnapshotReader.mjs'
import AnalysisWorkerService from './AnalysisWorkerService.mjs'

// In-process result cache. The analysis is a pure function of the project
// snapshot, so a result stays valid until the project content changes. We key
// on the lightweight snapshot fingerprint (document revisions, file hashes)
// plus the selected entry points. A hit skips the binary-bibliography blob
// reads and the worker run. The cache is per-process (not shared across web
// processes) and bounded by TTL + size.
const CACHE_TTL_MS = parsePositiveInteger(
  process.env.PROJECT_INSPECTION_CACHE_TTL_MS,
  60 * 1000
)
const CACHE_MAX_ENTRIES = parsePositiveInteger(
  process.env.PROJECT_INSPECTION_CACHE_MAX_ENTRIES,
  100
)
const cache = new Map()

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function cacheKey(projectId, snapshot, entryPointIds) {
  // A robust content fingerprint: any document edit bumps its revision, and
  // any file/bibliography change changes its hash, so the key covers every
  // input the analysis depends on. (Keying only on the max doc revision would
  // go stale when a .bib or image file changes.)
  const documents = snapshot.documents
    .map(doc => `${doc.path}:${doc.revision}`)
    .sort()
  const files = snapshot.files
    .map(file => `${file.path}:${file.hash ?? ''}`)
    .sort()
  const material = [
    projectId,
    [...entryPointIds].sort().join(','),
    documents.join(','),
    files.join(','),
  ].join('|')
  return createHash('sha256').update(material).digest('hex')
}

function getCached(key, now) {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (now >= entry.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return entry.result
}

function setCached(key, result, now) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldestKey = cache.keys().next().value
    cache.delete(oldestKey)
  }
  cache.set(key, { result, expiresAt: now + CACHE_TTL_MS })
}

async function analyze(projectId, entryPointIds, { signal } = {}) {
  // `read` loads documents, files and validates entry points, but NOT the
  // binary bibliography blobs: the cache key only needs the fingerprint
  // (paths, revisions, hashes), so a hit skips that blob I/O as well.
  const snapshot = await ProjectSnapshotReader.read(projectId, entryPointIds, {
    signal,
  })

  const key = cacheKey(projectId, snapshot, entryPointIds)
  const now = Date.now()
  const cached = getCached(key, now)
  if (cached) {
    Metrics.inc('project-inspection-cache', 1, { status: 'hit' })
    return cached
  }
  Metrics.inc('project-inspection-cache', 1, { status: 'miss' })

  const binaryBibliographies = await ProjectSnapshotReader.loadBibliographies(
    projectId,
    snapshot.files,
    { signal }
  )
  const result = await AnalysisWorkerService.run(
    { ...snapshot, binaryBibliographies },
    { signal }
  )
  const envelope = {
    schemaVersion: 1,
    analysisId: randomUUID(),
    analyzedAt: new Date().toISOString(),
    ...result,
  }
  setCached(key, envelope, now)
  return envelope
}

export default { analyze }
