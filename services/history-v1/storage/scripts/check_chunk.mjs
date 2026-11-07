import commandLineArgs from 'command-line-args'
import {
  loadAtVersion,
  getProjectChunksFromVersion,
} from '../lib/chunk_store/index.js'
import { client } from '../lib/mongodb.js'
import knex from '../lib/knex.js'
import redis from '../lib/redis.js'
import { loadGlobalBlobs, BlobStore } from '../lib/blob_store/index.js'
import { getContentHash } from '../lib/content_hash.js'
import core from 'overleaf-editor-core'
import Events from 'node:events'
Events.setMaxListeners(20)

const { StringFileData, LazyStringFileData } = core

const optionDefinitions = [
  { name: 'historyId', alias: 'p', type: String },
  { name: 'version', alias: 'v', type: Number },
  { name: 'persistedOnly', alias: 'o', type: Boolean },
]

async function ensureFileLoaded(file, blobStore, currentVersion, path) {
  if (
    typeof file.load === 'function' &&
    file.data instanceof LazyStringFileData
  ) {
    if (file.data.rangesHash) {
      console.log(
        `Loading rangesHash ${file.data.rangesHash} for ${path} at version ${currentVersion}`
      )
    } else {
      console.log(
        `No rangesHash found for ${path} at version ${currentVersion}`
      )
    }
    await file.load('eager', blobStore)
    console.log('=> file', file.toRaw())
  }
}

function checkFileTrackedChanges(path, file, currentVersion) {
  let violations = false
  const positions = []
  if (!(file.data instanceof StringFileData)) {
    return { violations, positions }
  }

  let tcList
  try {
    tcList = file.getTrackedChanges()
  } catch (err) {
    return { violations, positions }
  }

  if (!tcList) return { violations, positions }

  const changesArr = Array.from(tcList)
  let prevTc = null

  for (const tc of changesArr) {
    positions.push(`(${tc.range.start}, ${tc.range.end})`)
    if (prevTc) {
      if (prevTc.range.start > tc.range.start) {
        console.error(
          `VIOLATION: Unsorted ranges in ${path} at version ${currentVersion}: [${prevTc.range.start}, ${prevTc.range.end}] comes before [${tc.range.start}, ${tc.range.end}]`
        )
        violations = true
      }
      if (prevTc.range.overlaps(tc.range)) {
        console.error(
          `VIOLATION: Overlapping ranges in ${path} at version ${currentVersion}: [${prevTc.range.start}, ${prevTc.range.end}] overlaps [${tc.range.start}, ${tc.range.end}]`
        )
        violations = true
      }
    }
    prevTc = tc
  }

  return { violations, positions }
}

async function checkSnapshot(snapshot, blobStore, currentVersion) {
  let containsViolations = false
  const pathnames = snapshot.getFilePathnames()
  const diagnostics = []

  for (const path of pathnames) {
    const file = snapshot.getFile(path)
    if (!file) continue

    try {
      await ensureFileLoaded(file, blobStore, currentVersion, path)
    } catch (err) {
      console.error(
        `Failed to load file ${path} at version ${currentVersion}:`,
        err
      )
      continue
    }

    const { violations, positions } = checkFileTrackedChanges(
      path,
      file,
      currentVersion
    )
    if (violations) containsViolations = true
    if (positions.length > 0) {
      diagnostics.push(`  ${path}: changes at [${positions.join(', ')}]`)
    }
  }

  if (diagnostics.length > 0) {
    console.log(`Version ${currentVersion} tracked changes summary:`)
    console.log(diagnostics.join('\n'))
  }

  return containsViolations
}

async function validateContentHash(
  operation,
  snapshot,
  currentVersion,
  blobStore
) {
  if (operation instanceof core.EditFileOperation) {
    const editOperation = operation.getOperation()
    if (
      editOperation instanceof core.TextOperation &&
      editOperation.contentHash != null
    ) {
      const path = operation.getPathname()
      const file = snapshot.getFile(path)
      if (file == null) {
        console.error(
          `VIOLATION: file ${path} not found for hash validation at version ${currentVersion}`
        )
        return true
      }
      try {
        await ensureFileLoaded(file, blobStore, currentVersion, path)
      } catch (err) {
        console.error(
          `Failed to load file ${path} for hash validation at version ${currentVersion}:`,
          err
        )
        return true
      }
      const content = file.getContent({ filterTrackedDeletes: true })
      const expectedHash = editOperation.contentHash
      const actualHash = content != null ? getContentHash(content) : null

      if (actualHash !== expectedHash) {
        console.error(
          `VIOLATION: content hash mismatch in ${path} at version ${currentVersion}: expected ${expectedHash}, got ${actualHash}`
        )
        return true
      }
    }
  }
  return false
}

async function checkChunkChanges(historyId, chunk) {
  const snapshot = chunk.getSnapshot().clone()
  const blobStore = new BlobStore(historyId)

  const changes = chunk.getChanges()
  let currentVersion = chunk.getStartVersion()
  console.log(
    `Checking chunk starting at version ${currentVersion} with ${changes.length} changes.`
  )

  const initialViolations = await checkSnapshot(
    snapshot,
    blobStore,
    currentVersion
  )
  if (initialViolations) {
    console.log(
      `Tracked changes corrupted at initial snapshot version ${currentVersion}`
    )
  }

  for (const change of changes) {
    currentVersion += 1
    let localViolations = false
    if (change?.origin?.kind === 'history-resync') {
      console.log('-'.repeat(16), 'history-resync', '-'.repeat(16))
    }
    console.log(
      `Version ${currentVersion} change:`,
      JSON.stringify(change.toRaw())
    )
    if (change?.origin?.kind === 'history-resync') {
      process.exit()
    }

    try {
      for (const _operation of change.iterativelyApplyTo(snapshot, {
        strict: true,
      })) {
        console.log(
          `Version ${currentVersion} operation:`,
          JSON.stringify(_operation.toRaw())
        )
        const hashErr = await validateContentHash(
          _operation,
          snapshot,
          currentVersion,
          blobStore
        )
        if (hashErr) localViolations = true
      }
    } catch (err) {
      console.error(`Failed to apply change at version ${currentVersion}:`, err)
      continue
    }

    const snapViolations = await checkSnapshot(
      snapshot,
      blobStore,
      currentVersion
    )
    if (snapViolations) localViolations = true

    if (localViolations) {
      console.log(
        `Tracked changes corrupted or hash mismatch at version ${currentVersion}`
      )
      console.log('Change was:', JSON.stringify(change.toRaw(), null, 2))
    }
  }
}

async function main() {
  const options = commandLineArgs(optionDefinitions)
  const { historyId, version, persistedOnly } = options

  if (!historyId) {
    console.error('Error: --historyId is required.')
    process.exit(1)
  }

  await loadGlobalBlobs()

  if (version != null) {
    const chunk = await loadAtVersion(historyId, version, {
      persistedOnly: persistedOnly || false,
    })
    if (!chunk) {
      console.error(`Chunk not found at version ${version}`)
      process.exit(1)
    }
    await checkChunkChanges(historyId, chunk)
  } else {
    let checkedAny = false
    for await (const chunkRecord of getProjectChunksFromVersion(historyId, 0)) {
      const chunk = await loadAtVersion(historyId, chunkRecord.startVersion, {
        persistedOnly: persistedOnly || false,
      })
      if (chunk) {
        checkedAny = true
        await checkChunkChanges(historyId, chunk)
      } else {
        console.error(
          `Failed to load chunk starting at ${chunkRecord.startVersion}`
        )
      }
    }
    if (!checkedAny) {
      console.log(`No chunks found for project ${historyId}`)
    }
  }
}

main()
  .then(() => console.log('Done.'))
  .catch(err => {
    console.error('Error:', err)
    process.exit(1)
  })
  .finally(() => {
    knex.destroy().catch(err => console.error('Error closing Postgres:', err))
    client.close().catch(err => console.error('Error closing MongoDB:', err))
    redis
      .disconnect()
      .catch(err => console.error('Error disconnecting Redis:', err))
  })
