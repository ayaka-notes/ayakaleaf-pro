// @ts-check
import logger from '@overleaf/logger'
import ChatApiHandler from '../Chat/ChatApiHandler.mjs'
import DocstoreManager from '../Docstore/DocstoreManager.mjs'
import UserGetter from '../User/UserGetter.mjs'

/**
 * Review state (comment threads + tracked changes) lives outside the project
 * files: comment anchors / tracked changes are docstore ranges, threads live
 * in the chat service. Project zips therefore bundle this state as a JSON
 * file (see Features/Downloads/ProjectZipStreamManager.mjs) so it can be
 * reconstituted on import.
 *
 * When a zip is imported via the UI ("New project → Import from .zip"), the
 * new project gets NEW doc ids, so the bundle cannot be applied by id.
 * Instead we match each bundle doc to the new project's docs by content:
 * every comment anchor and every tracked insertion must occur at the
 * recorded offset in the target doc's text.
 */

export const REVIEW_JSON_NAME = 'overleaf-comments-and-changes.json'

const ID_REGEX = /^[0-9a-f]{24}$/

/**
 * Validate a parsed review state bundle. Throws on any problem.
 */
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

/**
 * Whether all verifiable anchors of a bundle doc occur in `text` at their
 * recorded offsets (comment texts + tracked insertions). Deleted text is
 * gone by definition and can only be position-checked.
 */
export function matchBundleDocToText(bundleDoc, text) {
  const comments = bundleDoc?.ranges?.comments ?? []
  const changes = bundleDoc?.ranges?.changes ?? []
  if (comments.length === 0 && changes.length === 0) return false
  for (const comment of comments) {
    const { c, p } = comment?.op ?? {}
    if (
      typeof c !== 'string' ||
      typeof p !== 'number' ||
      p < 0 ||
      p + c.length > text.length ||
      text.slice(p, p + c.length) !== c
    ) {
      return false
    }
  }
  for (const change of changes) {
    const { i, d, p } = change?.op ?? {}
    if (typeof i === 'string') {
      // inserted text must still be present at the recorded offset
      if (
        typeof p !== 'number' ||
        p < 0 ||
        p + i.length > text.length ||
        text.slice(p, p + i.length) !== i
      ) {
        return false
      }
    } else if (typeof d === 'string') {
      // deleted text is gone; only the position is checkable
      if (typeof p !== 'number' || p < 0 || p > text.length) return false
    }
  }
  return true
}

async function _userExists(userId) {
  if (userId == null) return false
  try {
    await UserGetter.promises.getUser(userId)
    return true
  } catch {
    return false
  }
}

/**
 * Reconstitute a review state bundle in a freshly created project.
 *
 * @param {object} params
 * @param {object} params.project - the new project ({ _id })
 * @param {Array<{docId: string|object, text: string}>} params.docs - the new
 *   project's docs with their full text
 * @param {object} params.state - the validated review state bundle
 * @returns {Promise<{docs: Array, threads: Array}>} a report
 */
async function restoreReviewState({ project, docs, state }) {
  validateReviewState(state)
  const report = { docs: [], threads: [] }
  // normalize ids to strings (they may be live ObjectId instances)
  const projectId = String(project._id)
  const normalizedDocs = docs.map(doc => ({
    docId: String(doc.docId),
    text: doc.text,
  }))

  // 1. match bundle docs to the new docs by content (doc ids differ)
  const assignments = []
  const usedDocIds = new Set()
  for (const bundleDoc of state.docs) {
    const comments = bundleDoc.ranges?.comments ?? []
    const changes = bundleDoc.ranges?.changes ?? []
    if (comments.length === 0 && changes.length === 0) continue
    let target = null
    for (const doc of normalizedDocs) {
      if (usedDocIds.has(doc.docId)) continue
      if (matchBundleDocToText(bundleDoc, doc.text)) {
        target = doc
        break
      }
    }
    if (target == null) {
      report.docs.push({
        docId: bundleDoc.id,
        status: 'skipped',
        reason: 'no doc in the new project matches this bundle doc',
      })
      continue
    }
    usedDocIds.add(target.docId)
    assignments.push({ ...target, comments, changes })
  }
  if (assignments.length === 0) return report

  // 2. re-create anchored comment threads in the chat service
  const threadIds = new Set()
  // threads that ended up present in the chat service (created now or
  // already there); only their anchors may be written below
  const okThreadIds = new Set()
  for (const assignment of assignments) {
    for (const comment of assignment.comments) {
      if (comment.op?.t != null) threadIds.add(String(comment.op.t))
    }
  }
  for (const threadId of [...threadIds]) {
    const thread = state.threads?.[threadId]
    if (thread == null) continue
    const messages = thread.messages ?? []
    if (messages.length === 0) {
      report.threads.push({ threadId, status: 'empty' })
      continue
    }
    // every message author must still exist; comments are created as the
    // original users (same model as the import script)
    for (const message of messages) {
      if (!(await _userExists(message.user_id))) {
        report.threads.push({
          threadId,
          status: 'skipped',
          reason: `message user ${message.user_id} does not exist`,
        })
        break
      }
    }
    if (report.threads.at(-1)?.threadId === threadId) continue

    let existing = null
    try {
      existing = await ChatApiHandler.promises.getThread(projectId, threadId)
    } catch {
      existing = null
    }
    if (existing == null || (existing.messages?.length ?? 0) === 0) {
      for (const message of messages) {
        await ChatApiHandler.promises.sendComment(
          projectId,
          threadId,
          message.user_id,
          message.content
        )
      }
      report.threads.push({ threadId, status: 'created', messages: messages.length })
    } else {
      report.threads.push({ threadId, status: 'existing' })
    }
    okThreadIds.add(threadId)
    if (thread.resolved) {
      const resolver =
        ((thread.resolved_by_user_id != null) &&
          (await _userExists(thread.resolved_by_user_id)) &&
          thread.resolved_by_user_id) ||
        messages[0].user_id
      if (resolver != null) {
        try {
          await ChatApiHandler.promises.resolveThread(projectId, threadId, resolver)
        } catch (err) {
          report.threads.push({ threadId, status: 'resolve-failed', reason: err.message })
        }
      }
    }
  }

  // 3. write comment anchors + tracked changes into the docstore.
  // Only anchors whose thread is present in the chat service are written:
  // on a system where the bundle's users do not exist, their threads were
  // skipped above and writing their anchors would leave dangling comment
  // markers in the editor. Tracked changes carry no chat dependency and are
  // always restored.
  for (const assignment of assignments) {
    const comments = assignment.comments.filter(
      comment => comment.op?.t == null || okThreadIds.has(String(comment.op.t))
    )
    const changes = assignment.changes
    if (comments.length === 0 && changes.length === 0) {
      report.docs.push({
        docId: assignment.docId,
        status: 'skipped',
        reason:
          'all comment threads were skipped (their users do not exist here) and there are no tracked changes',
      })
      continue
    }
    let target = null
    // the docstore doc is created by the document-updater pipeline; allow it
    // a few moments to land before giving up
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        target = await DocstoreManager.promises.getDoc(projectId, assignment.docId)
        break
      } catch {
        await new Promise(resolve => setTimeout(resolve, 400))
      }
    }
    if (target == null) {
      report.docs.push({
        docId: assignment.docId,
        status: 'skipped',
        reason: 'doc not (yet) present in docstore',
      })
      continue
    }
    await DocstoreManager.promises.updateDoc(
      projectId,
      assignment.docId,
      target.lines,
      target.version,
      { comments, changes }
    )
    report.docs.push({
      docId: assignment.docId,
      status: 'applied',
      comments: comments.length,
      changes: changes.length,
    })
  }

  logger.info(
    { projectId, report },
    'review state restored from import zip'
  )
  return report
}

export default {
  promises: {
    restoreReviewState,
  },
}
