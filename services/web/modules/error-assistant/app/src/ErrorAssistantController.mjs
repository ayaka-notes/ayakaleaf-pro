import logger from '@overleaf/logger'
import { streamText, stepCountIs } from 'ai'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ProjectLocator from '../../../../app/src/Features/Project/ProjectLocator.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import {
  isConfigured,
  getProvider,
  resolveModel,
} from '../../../workbench/app/src/WorkbenchAiClient.mjs'
import {
  isQuotaEnabled,
  getRemainingTokens,
  secondsUntilReset,
  recordTokenUsage,
} from '../../../workbench/app/src/TokenQuota.mjs'
import { buildTools } from './SuggestFixTools.mjs'

// Limit each request to the reported compile error and return reviewable edits.
const SYSTEM_PROMPT = `You are a LaTeX expert embedded in the Overleaf editor. Fix exactly ONE LaTeX compile error — nothing else.

You are given the error and the source of the file it is in. Rules:
- Make the SMALLEST possible change that fixes THIS error. Fix only the reported problem.
- Preserve everything else EXACTLY. Do NOT reformat, re-wrap, re-indent, rename, or "improve" anything. Never touch a line that isn't strictly part of the fix. Keep all other content and whitespace byte-for-byte.
- The file source is provided below — use it and go STRAIGHT to suggestLineChange in a single step. Do not ask to read more.
- Call suggestLineChange with from.content = the exact current line(s) (verbatim, copied from the source) and to.content = the corrected line(s). Use one call per contiguous range that changes; usually one call, one line.
- Explanation: ONE short sentence. No step-by-step reasoning, no restating the error, no headings or lists.

If you genuinely cannot determine a fix, say so in one sentence and do not call suggestLineChange.`

/**
 * Streams a suggested fix for one LaTeX compile error.
 * SSE events carry explanation text ({ delta }), tool calls ({ tool, args }),
 * and completion or failure ({ finish } / { error }) for the error panel.
 */
async function suggestFix(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const projectId = req.params.Project_id
  const { logEntry } = req.body || {}

  if (!isConfigured()) {
    logger.warn({ userId }, 'suggest-fix requested but no AI gateway configured')
    return res.status(403).json({ error: 'ai_not_configured' })
  }
  if (!logEntry) {
    return res.status(400).json({ error: 'missing_log_entry' })
  }
  if (typeof logEntry.file !== 'string' || !logEntry.file) {
    return res.status(400).json({ error: 'missing_file' })
  }

  let remainingTokens = null
  if (isQuotaEnabled() && userId) {
    try {
      remainingTokens = await getRemainingTokens(userId)
    } catch (err) {
      logger.warn({ err, userId }, 'ai token quota check failed, allowing')
    }
    if (remainingTokens !== null && remainingTokens <= 0) {
      const reset = `${secondsUntilReset()}`
      res.set({
        'RateLimit-Reset': reset,
        'Token-RateLimit-Remaining': '0',
        'Token-RateLimit-Reset': reset,
      })
      return res.status(429).json({ error: 'ai_token_quota_exceeded' })
    }
  }

  let docs
  try {
    const path = logEntry.file
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
      .replace(/^compile\//, '')
    const { element, type } = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path,
      exactCaseMatch: true,
    })
    if (type !== 'doc') {
      return res.status(404).json({ error: 'file_not_found' })
    }
    // Read synchronized edits without waiting for Docstore persistence.
    const { lines } = await DocumentUpdaterHandler.promises.getDocument(
      projectId,
      element._id,
      -1
    )
    docs = { [path]: { lines } }
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return res.status(404).json({ error: 'file_not_found' })
    }
    logger.err({ err, projectId, userId }, 'suggest-fix: failed to load document')
    return res.status(500).json({ error: 'internal' })
  }

  // Custom SSE stream.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(remainingTokens !== null && {
      'Token-RateLimit-Remaining': `${remainingTokens}`,
      'Token-RateLimit-Reset': `${secondsUntilReset()}`,
    }),
  })
  const send = evt => {
    if (!res.destroyed) res.write(`data: ${JSON.stringify(evt)}\n\n`)
  }

  try {
    // The prompt already contains the source, so only the edit-suggestion tool is needed.
    const { suggestLineChange } = buildTools(docs)

    const result = streamText({
      model: getProvider()(resolveModel()),
      system: SYSTEM_PROMPT,
      prompt: _buildUserPrompt(logEntry, docs),
      tools: { suggestLineChange },
      stopWhen: stepCountIs(1),
      // Keep reading after a disconnect so this step's usage is still recorded.
      onStepFinish: async ({ usage }) => {
        if (userId) {
          await recordTokenUsage(userId, usage?.totalTokens)
        }
      },
    })

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          if (part.text) send({ delta: part.text })
          break
        case 'tool-call':
          // The client expects structured tool arguments to render an edit.
          if (!part.invalid && part.input && typeof part.input === 'object') {
            send({ tool: part.toolName, args: part.input })
          }
          break
        case 'error':
          logger.err({ err: part.error, userId }, 'suggest-fix stream error')
          send({ error: 'unhandled' })
          break
        default:
          break
      }
    }
    send({ finish: true })
  } catch (err) {
    logger.err({ err, userId, projectId }, 'suggest-fix failed')
    send({ error: 'unhandled' })
  } finally {
    res.end()
  }
}

function _buildUserPrompt(logEntry, docs) {
  const { file, line, column, raw, ruleId, level } = logEntry
  const out = ['Fix this LaTeX compile error.', '']
  if (file) out.push(`File: ${file}`)
  if (line != null) out.push(`Line: ${line}`)
  if (column != null) out.push(`Column: ${column}`)
  if (ruleId) out.push(`Rule: ${ruleId}`)
  if (level) out.push(`Level: ${level}`)
  out.push('', 'Error message:', '```', String(raw || '').trim(), '```')

  // Include source context without requiring a separate document-read tool call.
  const context = _fileContext(docs, file, line)
  if (context) {
    out.push('', `Source of ${file} (numbered lines):`, '```', context, '```')
  }
  return out.join('\n')
}

// The error file's source as numbered lines. Whole file when reasonably small;
// for large files, the preamble plus a window around the error line.
function _fileContext(docs, file, line, { maxWholeFile = 500, window = 60, preamble = 40 } = {}) {
  if (!docs || !file) return ''
  const wanted = String(file).replace(/^\.\//, '').replace(/^\/+/, '').replace(/^compile\//, '')
  let doc = docs[wanted]
  if (!doc) {
    const base = wanted.split('/').pop()
    const key = Object.keys(docs).find(k => k.split('/').pop() === base)
    doc = key && docs[key]
  }
  const lines = doc?.lines
  if (!lines?.length) return ''

  const fmt = (i) => `${i}: ${lines[i - 1]}`

  if (lines.length <= maxWholeFile || line == null) {
    return lines.map((_, i) => fmt(i + 1)).join('\n')
  }

  // Large file: preamble + window around the error, with a marker if there's a gap.
  const rows = []
  const preTo = Math.min(preamble, lines.length)
  for (let i = 1; i <= preTo; i++) rows.push(fmt(i))
  const from = Math.max(preTo + 1, line - window)
  const to = Math.min(lines.length, line + window)
  if (from > preTo + 1) rows.push('…')
  for (let i = from; i <= to; i++) rows.push(fmt(i))
  return rows.join('\n')
}

export default { suggestFix }
