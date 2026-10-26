import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import { getAiAccess } from './PermissionsMiddleware.mjs'
import {
  consumeStream,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  streamText,
  wrapLanguageModel,
} from 'ai'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import {
  isConfigured,
  getProvider,
  resolveModel,
  getMaxSteps,
  SYSTEM_PROMPT,
} from './WorkbenchAiClient.mjs'
import { CLIENT_TOOLS, convertWorkbenchMessages } from './WorkbenchTools.mjs'
import { WEB_SEARCH_TOOL, isWebSearchConfigured } from './WebSearchTool.mjs'
import { DOCS_SEARCH_TOOL, isDocsSearchConfigured } from './DocsSearchTool.mjs'
import { createToolCallLimit } from './ToolCallLimit.mjs'
import { condenseOldToolOutputs, compactHistory } from './ContextCompaction.mjs'
import {
  isQuotaEnabled,
  getRemainingTokens,
  secondsUntilReset,
  recordTokenUsage,
} from './TokenQuota.mjs'

function hasValidAttachments(messages) {
  return messages.every(message =>
    Array.isArray(message?.parts) && message.parts.every(part => {
      if (!part || typeof part !== 'object') return false
      if (part.type !== 'file') return true
      if (
        typeof part.url !== 'string' ||
        typeof part.mediaType !== 'string' ||
        !/^image\/[a-z0-9.+-]+$/.test(part.mediaType)
      ) {
        return false
      }
      // The uploader sends inline files; remote URLs make the SDK fetch from our network.
      const prefix = `data:${part.mediaType};base64,`
      if (!part.url.startsWith(prefix)) return false
      const encoded = part.url.slice(prefix.length)
      return Buffer.from(encoded, 'base64').toString('base64') === encoded
    })
  )
}

/**
 * POST /workbench/chat
 *
 * The workbench AI chat endpoint. Drives the Vercel AI SDK `useChat` client:
 * it condenses old tool output and summarizes the older turns of a long
 * history (ContextCompaction),
 * converts the incoming UI-message history to model messages, runs
 * `streamText` against the operator-configured OpenAI-compatible model with the
 * client-executed tool set declared, and pipes the resulting UI-message stream
 * straight back to the browser (`x-vercel-ai-ui-message-stream: v1`).
 */
async function chat(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  if (!isConfigured()) {
    logger.warn(
      { userId },
      'workbench AI chat requested but no AI gateway is configured (set AI_BASE_URL / AI_API_KEY / AI_MODEL)'
    )
    // The client uses 403 responses to display the AI-unavailable notice.
    return res.status(403).json({ error: 'ai_not_configured' })
  }

  // summary: the earlier turns, summarized by a previous request
  const { messages, summary } = req.body || {}
  if (
    !Array.isArray(messages) ||
    (summary !== undefined && typeof summary !== 'string')
  ) {
    return res.status(400).json({ error: 'invalid_request' })
  }
  if (!hasValidAttachments(messages)) {
    return res.status(400).json({ error: 'invalid_attachments' })
  }
  const toolCallLimit = createToolCallLimit(messages, getMaxSteps())
  if (toolCallLimit.exhausted()) {
    return res.status(409).json({ error: 'ai_tool_call_limit_exceeded' })
  }

  // Check the current period's quota before streaming. Usage is recorded on
  // completion, so a request may exceed the remaining balance.
  let remainingTokens = null
  if (isQuotaEnabled() && userId) {
    try {
      remainingTokens = await getRemainingTokens(userId)
    } catch (err) {
      logger.warn({ err, userId }, 'ai token quota check failed, allowing')
    }
    if (remainingTokens !== null && remainingTokens <= 0) {
      const reset = `${secondsUntilReset()}`
      // RateLimit-Reset doubles as the retry hint the client reads on 429
      res.set({
        'RateLimit-Reset': reset,
        'Token-RateLimit-Remaining': '0',
        'Token-RateLimit-Reset': reset,
      })
      return res.status(429).json({ error: 'ai_token_quota_exceeded' })
    }
  }

  const enabledTools = Array.isArray(req.body?.enabledTools)
    ? req.body.enabledTools
    : []
  // Server-side search tools can run alongside browser document tools.
  const webSearch = enabledTools.includes('web_search') && isWebSearchConfigured()
  const docsSearch = enabledTools.includes('search_docs') && isDocsSearchConfigured()
  const tools = { ...CLIENT_TOOLS }
  if (webSearch) tools.web_search = WEB_SEARCH_TOOL
  if (docsSearch) tools.search_docs = DOCS_SEARCH_TOOL

  // Include instructions for the search tools available in this request.
  let system = SYSTEM_PROMPT
  if (webSearch) {
    system += `\n\nweb_search looks things up on the internet. Use it for anything recent or outside what you know, such as news, prices or the latest version of a package, answer from what it returns and link the pages you used. You do have internet access through it.`
  }
  if (docsSearch) {
    system += `\n\nsearch_docs searches the help pages of this editor. Use it, rather than web_search, when the user asks how the editor itself works (its features, settings, projects, accounts or administration), and link the pages you used.`
  }

  let condensed
  let modelMessages
  try {
    condensed = condenseOldToolOutputs(messages)
    modelMessages = await convertWorkbenchMessages(condensed)
  } catch (err) {
    logger.warn({ err, userId }, 'workbench chat: could not parse messages')
    return res.status(400).json({ error: 'invalid_messages' })
  }

  let history = condensed
  let historySummary = summary
  let compaction = null
  try {
    compaction = await compactHistory({ messages: condensed, summary, userId })
  } catch (err) {
    // Send the whole history rather than fail the chat
    logger.warn({ err, userId }, 'workbench chat: could not summarize history')
  }
  if (compaction) {
    history = compaction.messages
    historySummary = compaction.summary
    modelMessages = await convertWorkbenchMessages(history)
  }
  if (historySummary) {
    system += `\n\nThe earlier part of this conversation was summarized:\n\n${historySummary}`
  }

  const resolvedModel = resolveModel(history)

  try {
    const result = streamText({
      model: wrapLanguageModel({
        model: getProvider()(resolvedModel),
        middleware: toolCallLimit.middleware,
      }),
      system,
      messages: modelMessages,
      tools,
      // Finish the current step for its usage report, but stop after a disconnect.
      stopWhen: [toolCallLimit.exhausted, () => res.destroyed],
      onStepFinish: async ({ usage }) => {
        if (userId) {
          await recordTokenUsage(userId, usage?.totalTokens)
        }
      },
    })

    const onError = err => {
      logger.err({ err, userId }, 'workbench chat stream error')
      return 'The AI service returned an error. Please try again.'
    }
    const stream = createUIMessageStream({
      // Continues the last assistant message after browser tool calls;
      // without it every response would start a new message
      originalMessages: messages,
      execute({ writer }) {
        // The browser sends the summary and the later messages from now on
        if (compaction) {
          writer.write({
            type: 'data-compaction',
            data: {
              summary: compaction.summary,
              upToMessageId: compaction.upToMessageId,
            },
            transient: true,
          })
        }
        writer.merge(result.toUIMessageStream({ onError }))
      },
      onError,
    })

    pipeUIMessageStreamToResponse({
      response: res,
      stream,
      consumeSseStream: consumeStream,
      // Suggestion counts are unmetered. Token headers report the balance
      // before this request because headers are sent before streaming completes.
      headers: {
        // no-transform keeps compressing proxies from holding the stream
        'Cache-Control': 'no-cache, no-transform',
        'RateLimit-Remaining': '1000000',
        'RateLimit-Reset': '0',
        ...(remainingTokens !== null
          ? {
              'Token-RateLimit-Remaining': `${remainingTokens}`,
              'Token-RateLimit-Reset': `${secondsUntilReset()}`,
            }
          : {
              'Token-RateLimit-Remaining': '100000000',
              'Token-RateLimit-Reset': '0',
            }),
      },
    })
  } catch (err) {
    logger.err({ err, userId }, 'workbench chat failed')
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal' })
    }
  }
}

export default {
  getAccess: expressify(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const access = await getAiAccess(SessionManager.getLoggedInUserId(req.session))
    res.json({ allowed: access.chat, errorAssistant: access.errorAssistant })
  }),
  chat,
}
