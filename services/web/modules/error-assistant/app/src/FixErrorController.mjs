import logger from '@overleaf/logger'
import { streamText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
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

/**
 * POST /project/:Project_id/ai/fix-error
 *
 * Asks the model for the smallest edit that fixes one compile log entry and
 * streams the answer as newline-delimited JSON:
 *   { type: 'text', text }   part of the explanation
 *   { type: 'fix', fix }     an edit { path, startLine, oldText, newText }
 *   { type: 'done' } or { type: 'failed' } at the end
 */

const INSTRUCTIONS = `A LaTeX project failed to compile, and you are shown one entry of the compile log together with the source of the file it points to. Find the cause of that one entry and propose the smallest edit that removes it.

- Answer with one short sentence saying what is wrong, then call propose_fix.
- propose_fix replaces whole lines: oldText is the current text of those lines copied exactly from the numbered source (without the numbers), newText is what they become. Use one call per block of consecutive lines; one line is the usual case.
- Change nothing that the fix does not need: keep spacing, line breaks, wording and indentation as they are.
- If the log entry does not tell you enough to fix it, say so in one sentence and do not call propose_fix.`

// The source goes in full up to this length; longer files are cut to the
// preamble and the lines around the error
const WHOLE_FILE_LINES = 500
const PREAMBLE_LINES = 40
const LINES_AROUND = 60

const proposeFix = tool({
  description: 'Propose replacing consecutive lines of a project file to fix the error.',
  inputSchema: z.object({
    path: z.string().describe('Path of the file in the project.'),
    startLine: z.number().int().min(1).describe('First line to replace.'),
    oldText: z.string().describe('The current text of those lines, exactly.'),
    newText: z.string().describe('The text to put in their place.'),
  }),
  // The browser shows the fix from the stream; the model only needs to know it arrived
  execute: async () => 'Shown to the user.',
})

/** Log paths look like "./main.tex" or "compile/main.tex"; project paths do not. */
function projectPath(logPath) {
  return logPath.replace(/^(\.\/|\/+)/, '').replace(/^compile\//, '')
}

function numberedSource(lines, errorLine) {
  const row = n => `${n}: ${lines[n - 1]}`
  const all = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i))
  if (lines.length <= WHOLE_FILE_LINES || !errorLine) {
    return all(1, lines.length).join('\n')
  }
  const head = Math.min(PREAMBLE_LINES, lines.length)
  const from = Math.max(head + 1, errorLine - LINES_AROUND)
  const to = Math.min(lines.length, errorLine + LINES_AROUND)
  return [...all(1, head), ...(from > head + 1 ? ['...'] : []), ...all(from, to)].join('\n')
}

function describeEntry(entry, path, lines) {
  const facts = [
    `File: ${path}`,
    entry.line != null && `Line: ${entry.line}`,
    entry.column != null && `Column: ${entry.column}`,
    entry.level && `Level: ${entry.level}`,
    entry.ruleId && `Rule: ${entry.ruleId}`,
  ].filter(Boolean)
  return [
    'Compile log entry:',
    ...facts,
    '',
    'Log text:',
    '"""',
    String(entry.raw ?? '').trim(),
    '"""',
    '',
    `Source of ${path}:`,
    '"""',
    numberedSource(lines, entry.line),
    '"""',
  ].join('\n')
}

async function fixError(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const projectId = req.params.Project_id
  const entry = req.body?.entry

  if (!isConfigured()) {
    return res.status(403).json({ error: 'ai_not_configured' })
  }
  if (!entry || typeof entry.file !== 'string' || !entry.file) {
    return res.status(400).json({ error: 'invalid_request' })
  }

  // Usage is charged after the call, so one request may go past the balance
  let remainingTokens = null
  if (isQuotaEnabled() && userId) {
    try {
      remainingTokens = await getRemainingTokens(userId)
    } catch (err) {
      logger.warn({ err, userId }, 'ai fix-error: quota check failed, allowing')
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

  const path = projectPath(entry.file)
  let lines
  try {
    const { element, type } = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path,
      exactCaseMatch: true,
    })
    if (type !== 'doc') {
      return res.status(404).json({ error: 'file_not_found' })
    }
    // The document updater has the edits not yet flushed to the docstore
    ;({ lines } = await DocumentUpdaterHandler.promises.getDocument(projectId, element._id, -1))
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return res.status(404).json({ error: 'file_not_found' })
    }
    logger.err({ err, projectId, userId }, 'ai fix-error: could not read the document')
    return res.status(500).json({ error: 'internal' })
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    // no-transform keeps compressing proxies from holding the stream
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    ...(remainingTokens !== null && {
      'Token-RateLimit-Remaining': `${remainingTokens}`,
      'Token-RateLimit-Reset': `${secondsUntilReset()}`,
    }),
  })
  const emit = event => {
    if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`)
  }

  try {
    const result = streamText({
      model: getProvider()(resolveModel()),
      system: INSTRUCTIONS,
      prompt: describeEntry(entry, path, lines),
      tools: { propose_fix: proposeFix },
      stopWhen: stepCountIs(1),
      onStepFinish: async ({ usage }) => {
        if (userId) await recordTokenUsage(userId, usage?.totalTokens)
      },
    })
    let failed = false
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta' && part.text) {
        emit({ type: 'text', text: part.text })
      } else if (part.type === 'tool-call' && !part.invalid && part.toolName === 'propose_fix') {
        emit({ type: 'fix', fix: { ...part.input, path: projectPath(part.input.path) } })
      } else if (part.type === 'error') {
        logger.err({ err: part.error, userId }, 'ai fix-error: stream error')
        failed = true
      }
    }
    emit({ type: failed ? 'failed' : 'done' })
  } catch (err) {
    logger.err({ err, userId, projectId }, 'ai fix-error failed')
    emit({ type: 'failed' })
  } finally {
    res.end()
  }
}

export default { fixError }
