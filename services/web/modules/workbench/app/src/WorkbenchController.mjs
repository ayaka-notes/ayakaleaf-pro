import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import { getAiAccess } from './PermissionsMiddleware.mjs'
import { consumeStream, streamText, wrapLanguageModel } from 'ai'
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
 * POST /workbench/tex-gpt
 *
 * The workbench AI chat endpoint. Drives the Vercel AI SDK `useChat` client:
 * it converts the incoming UI-message history to model messages, runs
 * `streamText` against the operator-configured OpenAI-compatible model with the
 * client-executed tool set declared, and pipes the resulting UI-message stream
 * straight back to the browser (`x-vercel-ai-ui-message-stream: v1`).
 */
async function texGpt(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)

  if (!isConfigured()) {
    logger.warn(
      { userId },
      'workbench AI chat requested but no AI gateway is configured (set AI_BASE_URL / AI_API_KEY / AI_MODEL)'
    )
    // The client uses 403 responses to display the AI-unavailable notice.
    return res.status(403).json({ error: 'ai_not_configured' })
  }

  const { messages } = req.body || {}
  if (!Array.isArray(messages)) {
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
  const docsSearch =
    enabledTools.includes('search_documentation') && isDocsSearchConfigured()
  const tools = { ...CLIENT_TOOLS }
  if (webSearch) tools.web_search = WEB_SEARCH_TOOL
  if (docsSearch) tools.search_documentation = DOCS_SEARCH_TOOL

  // Include instructions for the search tools available in this request.
  let system = SYSTEM_PROMPT
  if (webSearch) {
    system += `\n\nYou have a web_search tool. When the user asks for current events, real-time data (weather, news, prices, latest versions) or anything beyond your training data, you MUST call web_search and answer from the results, citing the source URLs. Never say you cannot access the internet.`
  }
  if (docsSearch) {
    system += `\n\nYou have a search_documentation tool that searches the documentation of this Overleaf instance. When the user asks how Overleaf itself works — features, settings, account/project management, administration — call search_documentation and answer from the results, linking the source pages. Prefer it over web_search for questions about Overleaf itself.`
  }

  let modelMessages
  try {
    modelMessages = await convertWorkbenchMessages(messages)
  } catch (err) {
    logger.warn({ err, userId }, 'workbench tex-gpt: could not parse messages')
    return res.status(400).json({ error: 'invalid_messages' })
  }

  const resolvedModel = resolveModel(messages)

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

    result.pipeUIMessageStreamToResponse(res, {
      consumeSseStream: consumeStream,
      // Suggestion counts are unmetered. Token headers report the balance
      // before this request because headers are sent before streaming completes.
      headers: {
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
      onError(err) {
        logger.err({ err, userId }, 'workbench tex-gpt stream error')
        return 'The AI service returned an error. Please try again.'
      },
    })
  } catch (err) {
    logger.err({ err, userId }, 'workbench tex-gpt failed')
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
  texGpt,
}
