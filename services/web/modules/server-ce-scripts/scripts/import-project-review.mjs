import minimist from 'minimist'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL } from 'node:url'
import yauzl from 'yauzl'
import logger from '@overleaf/logger'
import { gracefulShutdown } from '../../../app/src/infrastructure/GracefulShutdown.mjs'
import ChatApiHandler from '../../../app/src/Features/Chat/ChatApiHandler.mjs'
import DocstoreManager from '../../../app/src/Features/Docstore/DocstoreManager.mjs'
import UserGetter from '../../../app/src/Features/User/UserGetter.mjs'

// Must match REVIEW_JSON_NAME in export-user-projects.mjs (the two scripts are
// standalone, so the name is duplicated rather than imported: importing the
// export script would run its main()).
export const REVIEW_JSON_NAME = 'overleaf-comments-and-changes.json'

// Reconstitute a project's review state (comment threads and tracked
// changes) from an overleaf-comments-and-changes.json bundle, as produced by
// scripts/export-user-projects.mjs.
//
// Comments are re-created in the chat service under their original thread ids
// (sendComment creates the thread if it does not exist yet), and the comment
// anchors plus tracked changes are written to the docstore the same way a
// project duplication clones ranges.
//
// Run the import when the target project is not being actively edited, and
// keep a backup: applying a bundle replaces the target project's current
// comment/tracked-change state.

const ID_REGEX = /^[0-9a-f]{24}$/

function showUsage() {
  console.log(`
Usage: node scripts/import-project-review.mjs [options]
  --help, -h                 Show help
  --project-id               The target project ID (must already exist)
  --json                     Path to an ${REVIEW_JSON_NAME} file
  --zip                      Path to an export zip; the JSON is extracted from it
                             (top level or inside a nested project zip)
  --force                    Apply even when an anchor no longer matches the doc
                             text, or the target already has comments/changes
  --map-missing-user         User ID to attribute messages of users that do not
                             exist on this instance (default: fail)
  --dry-run                  Only report what would be applied
  --log-level                Log level (trace|debug|info|warn|error|fatal) [default: info]
`)
}

function parseArgs() {
  return minimist(process.argv.slice(2), {
    boolean: ['help', 'force', 'dry-run'],
    string: ['project-id', 'json', 'zip', 'map-missing-user', 'log-level'],
    alias: { help: 'h' },
    default: {
      'log-level': 'info',
    },
  })
}

export async function readZipEntry(zipPath, entryName) {
  // yauzl v3: async entry iteration + read streams.
  const zipFile = await yauzl.openPromise(zipPath)
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (entry.fileName === entryName) {
        const readStream = await zipFile.openReadStreamPromise(entry)
        const chunks = []
        for await (const chunk of readStream) chunks.push(chunk)
        return Buffer.concat(chunks)
      }
    }
  } finally {
    zipFile.close()
  }
  return null
}

export async function listZipEntries(zipPath, suffix) {
  const zipFile = await yauzl.openPromise(zipPath)
  const entries = []
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (entry.fileName.endsWith(suffix)) entries.push(entry.fileName)
    }
  } finally {
    zipFile.close()
  }
  return entries
}

export async function extractJsonFromZip(zipPath) {
  // Top level first, then one level of nested project zips (the user-level
  // bundles contain a zip per project).
  const topLevel = await readZipEntry(zipPath, REVIEW_JSON_NAME)
  if (topLevel) return topLevel

  const innerZips = await listZipEntries(zipPath, '.zip')
  for (const name of innerZips) {
    const buffer = await readZipEntry(zipPath, name)
    if (!buffer) continue
    const tmp = `${tmpdir()}/ol-review-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.zip`
    try {
      writeFileSync(tmp, buffer)
      const found = await readZipEntry(tmp, REVIEW_JSON_NAME)
      if (found) return found
    } finally {
      try {
        unlinkSync(tmp)
      } catch {
        // ignore
      }
    }
  }
  throw new Error(
    `${REVIEW_JSON_NAME} not found in ${zipPath} (also searched nested project zips)`
  )
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

export function validateReviewState(state) {
  if (state?.format !== 'overleaf-comments-and-changes') {
    throw new Error('not an overleaf-comments-and-changes bundle (bad "format")')
  }
  if (state.version !== 1) {
    throw new Error(`unsupported bundle version: ${state.version}`)
  }
  if (!Array.isArray(state.docs)) throw new Error('bundle has no "docs" array')
  for (const doc of state.docs) {
    if (typeof doc.id !== 'string' || !ID_REGEX.test(doc.id)) {
      throw new Error(`bad doc id in bundle: ${JSON.stringify(doc.id)}`)
    }
    const ranges = doc.ranges ?? {}
    if (!Array.isArray(ranges.comments)) throw new Error('bad ranges.comments')
    if (!Array.isArray(ranges.changes)) throw new Error('bad ranges.changes')
    for (const comment of ranges.comments) {
      const { c, p, t } = comment?.op ?? {}
      if (typeof c !== 'string' || !Number.isInteger(p) || p < 0) {
        throw new Error(`bad comment op in bundle: ${JSON.stringify(comment?.op)}`)
      }
      if (typeof t !== 'string' && typeof t !== 'object') {
        throw new Error(`bad comment thread id in bundle: ${JSON.stringify(t)}`)
      }
    }
    for (const change of ranges.changes) {
      const { i, d, p } = change?.op ?? {}
      const isInsert = typeof i === 'string'
      const isDelete = typeof d === 'string'
      if (!isInsert && !isDelete) {
        throw new Error(`bad change op in bundle: ${JSON.stringify(change?.op)}`)
      }
      if (!Number.isInteger(p) || p < 0) {
        throw new Error(`bad change offset in bundle: ${JSON.stringify(change?.op)}`)
      }
    }
  }
  if (typeof state.threads !== 'object' || state.threads == null) {
    throw new Error('bundle has no "threads" object')
  }
  for (const [threadId, thread] of Object.entries(state.threads)) {
    if (!ID_REGEX.test(threadId)) {
      throw new Error(`bad thread id in bundle: ${threadId}`)
    }
    if (!Array.isArray(thread?.messages)) {
      throw new Error(`bad thread messages for ${threadId}`)
    }
    for (const message of thread.messages) {
      if (typeof message?.content !== 'string') {
        throw new Error(`bad message in thread ${threadId}`)
      }
    }
  }
}

async function main() {
  const argv = parseArgs()

  if (argv.help) {
    showUsage()
    process.exit(0)
  }
  if (argv['log-level']) {
    logger.logger.level(argv['log-level'])
  }

  if (!argv['project-id'] || !ID_REGEX.test(argv['project-id'])) {
    fail('a valid --project-id is required')
  }
  if (Boolean(argv.json) === Boolean(argv.zip)) {
    fail('exactly one of --json or --zip is required')
  }

  let raw
  try {
    raw = argv.json
      ? readFileSync(argv.json)
      : await extractJsonFromZip(argv.zip)
  } catch (err) {
    fail(`could not read the review state bundle: ${err.message}`)
  }

  let state
  try {
    state = JSON.parse(raw.toString('utf8'))
    validateReviewState(state)
  } catch (err) {
    fail(`invalid review state bundle: ${err.message}`)
  }

  const projectId = argv['project-id']
  const report = { threads: [], docs: [] }

  // ---- comment threads in the chat service ------------------------------
  const userCache = new Map()
  async function resolveUser(userId) {
    if (userCache.has(String(userId))) return userCache.get(String(userId))
    let user = null
    try {
      user = await UserGetter.promises.getUser(userId)
    } catch {
      user = null
    }
    let resolved = null
    if (user) {
      resolved = userId
    } else if (argv['map-missing-user']) {
      if (!ID_REGEX.test(argv['map-missing-user'])) {
        fail('bad --map-missing-user id')
      }
      await UserGetter.promises.getUser(argv['map-missing-user']) // must exist
      resolved = argv['map-missing-user']
    }
    userCache.set(String(userId), resolved)
    return resolved
  }

  const threadIds = Object.keys(state.threads).filter(threadId => {
    // Only threads anchored by some comment range are part of the review state.
    return state.docs.some(doc =>
      (doc.ranges?.comments ?? []).some(comment =>
        String(comment.op?.t) === threadId
      )
    )
  })

  for (const threadId of threadIds) {
    const thread = state.threads[threadId]
    let existing = null
    try {
      existing = await ChatApiHandler.promises.getThread(projectId, threadId)
    } catch {
      existing = null
    }

    const missingMessages =
      existing?.messages?.length > 0 ? [] : (thread.messages ?? [])

    if (missingMessages.length > 0) {
      for (const message of missingMessages) {
        const userId = await resolveUser(message.user_id)
        if (userId == null) {
          report.threads.push({
            threadId,
            status: 'skipped',
            reason: `message user ${message.user_id} does not exist; re-run with --map-missing-user`,
          })
          break
        }
        if (!argv['dry-run']) {
          await ChatApiHandler.promises.sendComment(
            projectId,
            threadId,
            userId,
            message.content
          )
        }
      }
      if (report.threads.at(-1)?.status !== 'skipped') {
        report.threads.push({ threadId, status: argv['dry-run'] ? 'dry-run' : 'created', messages: missingMessages.length })
      }
    } else {
      report.threads.push({ threadId, status: 'existing', messages: existing.messages.length })
    }

    if (thread.resolved && existing?.resolved != null) {
      // already resolved
    } else if (thread.resolved && existing?.resolved == null) {
      const resolver =
        (thread.resolved_by_user_id &&
          (await resolveUser(thread.resolved_by_user_id))) ||
        (existing?.messages?.[0]?.user_id) ||
        argv['map-missing-user']
      if (resolver && !argv['dry-run']) {
        await ChatApiHandler.promises.resolveThread(projectId, threadId, resolver)
      }
      if (resolver) {
        report.threads.push({ threadId, status: 'resolved' })
      }
    }
  }

  // ---- comment anchors and tracked changes in the docstore --------------
  for (const doc of state.docs) {
    const { comments = [], changes = [] } = doc.ranges ?? {}
    if (comments.length === 0 && changes.length === 0) {
      report.docs.push({ docId: doc.id, status: 'empty' })
      continue
    }

    let target = null
    try {
      target = await DocstoreManager.promises.getDoc(projectId, doc.id)
    } catch (err) {
      report.docs.push({
        docId: doc.id,
        status: 'skipped',
        reason: `doc not found in target project (${err.message})`,
      })
      continue
    }

    const text = (target.lines ?? []).join('\n')
    const problems = []
    for (const comment of comments) {
      const { c, p } = comment.op
      if (p + c.length > text.length || text.slice(p, p + c.length) !== c) {
        problems.push(
          `comment at offset ${p} does not match the target doc text (the doc differs from the export source)`
        )
      }
    }
    for (const change of changes) {
      const { i, d, p } = change.op
      if (p > text.length) {
        problems.push(`change at offset ${p} is outside the target doc`)
      } else if (typeof i === 'string') {
        // inserted text must still be present at the recorded offset
        if (text.slice(p, p + i.length) !== i) {
          problems.push(
            `tracked insertion at offset ${p} does not match the target doc text`
          )
        }
      } else if (d != null && d.length > 0) {
        // deleted text is gone from the doc; only the position is checkable
      }
    }

    if (problems.length > 0 && !argv['force']) {
      report.docs.push({
        docId: doc.id,
        status: 'skipped',
        reason: problems[0] + (problems.length > 1 ? ` (+${problems.length - 1} more)` : '') + '; re-run with --force to apply anyway',
      })
      continue
    }

    const existingComments = target.ranges?.comments?.length ?? 0
    const existingChanges = target.ranges?.changes?.length ?? 0
    if (
      (existingComments > 0 || existingChanges > 0) &&
      !argv['force']
    ) {
      report.docs.push({
        docId: doc.id,
        status: 'skipped',
        reason: `target already has ${existingComments} comments / ${existingChanges} tracked changes; re-run with --force to replace them`,
      })
      continue
    }

    if (!argv['dry-run']) {
      await DocstoreManager.promises.updateDoc(
        projectId,
        doc.id,
        target.lines,
        target.version,
        { comments, changes }
      )
    }
    report.docs.push({
      docId: doc.id,
      status: argv['dry-run'] ? 'dry-run' : 'applied',
      comments: comments.length,
      changes: changes.length,
      note: problems.length > 0 ? `applied with ${problems.length} mismatch(es) due to --force` : undefined,
    })
  }

  console.log('\nImport report:')
  for (const entry of report.threads) {
    console.log(`  thread ${entry.threadId}: ${entry.status}${entry.reason ? ` — ${entry.reason}` : ''}`)
  }
  for (const entry of report.docs) {
    console.log(
      `  doc ${entry.docId}: ${entry.status}` +
        (entry.comments != null ? ` (${entry.comments} comments, ${entry.changes} tracked changes)` : '') +
        (entry.reason ? ` — ${entry.reason}` : '') +
        (entry.note ? ` — ${entry.note}` : '')
    )
  }

  const skipped =
    report.threads.filter(t => t.status === 'skipped').length +
    report.docs.filter(d => d.status === 'skipped').length
  if (skipped > 0 && !argv['dry-run']) {
    console.log(`\n${skipped} item(s) were skipped; see the reasons above.`)
    process.exitCode = 1
  }
}

// Running directly: yarn node scripts/import-project-review.mjs
// (imported as a module — e.g. by tests — main does not run)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch(async err => {
      logger.error({ err }, 'Error in import-project-review script')
      process.exitCode = 1
    })
    .finally(async () => {
      await gracefulShutdown({ close: done => done() })
    })
}
