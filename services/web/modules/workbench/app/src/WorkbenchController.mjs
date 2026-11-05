import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import { getAiAccess } from './PermissionsMiddleware.mjs'
import {
  APICallError,
  consumeStream,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  streamText,
  wrapLanguageModel,
} from 'ai'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import {
  isConfigured,
  getProvider,
  resolveModel,
  hasPdf,
  hasImage,
  getMaxSteps,
  SYSTEM_PROMPT,
} from './WorkbenchAiClient.mjs'
import { resolveWorkbenchLane } from './LlmBridge.mjs'
import { probeLane } from './LaneCapability.mjs'
import { toTextMessages } from './PdfExtract.mjs'
import { CLIENT_TOOLS, convertWorkbenchMessages } from './WorkbenchTools.mjs'
import { WEB_SEARCH_TOOL, isWebSearchConfigured } from './WebSearchTool.mjs'
import { DOCS_SEARCH_TOOL, isDocsSearchConfigured } from './DocsSearchTool.mjs'
import { WEB_FETCH_TOOL, isWebFetchConfigured } from './WebFetchTool.mjs'
import { createToolCallLimit } from './ToolCallLimit.mjs'
import { condenseOldToolOutputs, compactHistory } from './ContextCompaction.mjs'
import {
  isQuotaEnabled,
  getRemainingTokens,
  secondsUntilReset,
  recordTokenUsage,
} from './TokenQuota.mjs'
// overleaf-lab (2026-11, merge phases 3+4): ONE governance plane and ONE usage
// ledger shared with every llm-module surface — the admin feature flags (the
// chat toggle now governs this endpoint), the per-user budget guard, and the
// LLMUsage ledger that feeds the admin/user usage meters. The workbench prompt
// comes from the same admin-editable prompt store.
import {
  getLLMFeatureFlags,
  getLLMPrompts,
} from '../../../llm/app/src/LLMAdminController.mjs'
import { guardLLMCall } from '../../../llm/app/src/LLMBudget.mjs'
import { recordUsage } from '../../../llm/app/src/LLMUsage.mjs'

function hasValidAttachments(messages) {
  return messages.every(message =>
    Array.isArray(message?.parts) && message.parts.every(part => {
      if (!part || typeof part !== 'object') return false
      if (part.type !== 'file') return true
      if (
        typeof part.url !== 'string' ||
        typeof part.mediaType !== 'string' ||
        !/^(image\/[a-z0-9.+-]+|application\/pdf)$/.test(part.mediaType)
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

  // overleaf-lab (2026-11, BYO phase 1): the request may run on the operator
  // gateway (legacy) or on this user's resolved LLM lane (BYO row / site
  // provider) when the operator gateway is not set. Both paths below use the
  // same provider/model plumbing.
  const lane = await resolveWorkbenchLane(userId).catch(() => null)

  if (!isConfigured() && !lane) {
    logger.warn(
      { userId },
      'workbench AI chat requested but no AI gateway is configured (set AI_BASE_URL / AI_API_KEY / AI_MODEL) and no user LLM lane resolved'
    )
    // The client uses 403 responses to display the AI-unavailable notice.
    return res.status(403).json({ error: 'ai_not_configured' })
  }

  // overleaf-lab (merge phase 3): the admin "chat" feature flag governs this
  // endpoint like it governed the old chat pane — one switch, every surface.
  // (A failed flag read fails open, matching the llm module's own behavior.)
  try {
    const flags = await getLLMFeatureFlags()
    if (flags && flags.chatEnabled === false) {
      return res.status(403).json({ error: 'feature_disabled', message: 'The chat feature is disabled' })
    }
  } catch {
    // fail open; the flags are enforced by the llm endpoint the same way
  }

  // overleaf-lab (merge phase 3): the SAME per-user budget guard as every llm
  // lane, applied to site-paid paths (operator gateway or site provider row).
  // User-paid BYO rows are exempt: that budget is the user's own API spend,
  // capped elsewhere by the tool-call limit and the workbench token quota.
  let sitePaidBudget = null
  const sitePaid = !lane || lane.lane === 'site'
  if (sitePaid) {
    try {
      sitePaidBudget = await guardLLMCall(userId)
    } catch (err) {
      logger.warn({ err, userId, code: err?.code }, 'workbench chat budget guard rejected')
      res.status(err?.code === 'llm-rate-limited' || err?.code === 'llm-budget' ? 429 : 503)
      return res.json({ error: err?.code || 'llm-error', message: err?.message || 'LLM budget guard' })
    }
  }

  // summary: the earlier turns, summarized by a previous request
  const { messages: rawMessages, summary } = req.body || {}
  if (
    !Array.isArray(rawMessages) ||
    (summary !== undefined && typeof summary !== 'string')
  ) {
    return res.status(400).json({ error: 'invalid_request' })
  }
  let messages = rawMessages
  if (!hasValidAttachments(messages)) {
    return res.status(400).json({ error: 'invalid_attachments' })
  }
  // overleaf-lab (2026-11, owner request): per-user text-extraction mode.
  // Image/PDF attachments are converted to text on this server (pdftotext,
  // Tesseract/Ocrmypdf for scans) BEFORE the model sees them, so text-only
  // lanes can read them. Opt-in in the user's LLM settings; failed parts
  // keep the raw attachment and the normal refusal path explains it.
  // overleaf-lab (2026-11, bug hunt): the FAILED count matters to the refusal
  // message — "enable OCR text mode" is wrong advice when the mode was ON
  // and the extraction could not read the attachment.
  let extraction = null
  try {
    const prof = await UserGetter.promises.getUser(userId, { llmTextExtract: 1 })
    if (prof && prof.llmTextExtract === true) {
      const { messages: extracted, report } = await toTextMessages(messages)
      if (report.length) {
        messages = extracted
        const failed = report.filter(x => x.mode === 'failed')
        if (failed.length) {
          extraction = {
            anyFailed: true,
            kinds: [...new Set(failed.map(x => x.kind))],
            reasons: [...new Set(failed.map(x => x.reason))],
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err, userId }, 'workbench chat: text-extraction mode failed, raw attachments kept')
    extraction = { anyFailed: true, kinds: ['pdf', 'image'], reasons: ['service'] }
  }
  // overleaf-lab (2026-11-05, owner report: "image works with qwen3.8:latest
  // but not the pdf"): a BYO lane is its own capability boundary. OpenAI-
  // compatible relays (Ollama/vLLM) accept image parts but reject OpenAI
  // `file` PDF parts; text-only models reject images. Instead of refusing
  // AFTER the provider rejects, probe the lane once (1h in-process cache)
  // and auto-convert the shape(s) it does not accept — the same
  // pdftotext/Tesseract pipeline as the user's text-extraction mode, no
  // user action. Unknown capability (null) keeps the native part and the
  // existing refusal path still explains it.
  if (lane?.baseURL && lane?.model && (hasPdf(messages) || hasImage(messages))) {
    let caps = null
    try {
      caps = await probeLane(lane.baseURL, lane.apiKey, lane.model)
    } catch (err) {
      logger.warn({ err, userId }, 'workbench chat: capability probe failed, native attachments kept')
    }
    const kinds = []
    if (hasPdf(messages) && caps?.pdf === false) kinds.push('pdf')
    if (hasImage(messages) && caps?.images === false) kinds.push('image')
    if (kinds.length) {
      try {
        const { messages: converted, report } = await toTextMessages(messages, kinds)
        if (report.length) {
          messages = converted
          const failed = report.filter(x => x.mode === 'failed')
          extraction = failed.length
            ? {
                anyFailed: true,
                kinds: [...new Set(failed.map(x => x.kind))],
                reasons: [...new Set(failed.map(x => x.reason))],
              }
            : { anyFailed: false, automatic: true, kinds }
          logger.info(
            { userId, model: lane.model, kinds, report },
            'workbench chat: auto text-conversion for lane capabilities'
          )
        }
      } catch (err) {
        logger.warn({ err, userId }, 'workbench chat: auto text-conversion failed, raw attachments kept')
      }
    }
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
  // Server-side web and docs tools can run alongside browser document tools.
  const webSearch = enabledTools.includes('web_search') && isWebSearchConfigured()
  const docsSearch = enabledTools.includes('search_docs') && isDocsSearchConfigured()
  const webFetch = enabledTools.includes('web_fetch') && isWebFetchConfigured()
  const tools = { ...CLIENT_TOOLS }
  if (webSearch) tools.web_search = WEB_SEARCH_TOOL
  if (docsSearch) tools.search_docs = DOCS_SEARCH_TOOL
  if (webFetch) tools.web_fetch = WEB_FETCH_TOOL

  // Include instructions for the server tools available in this request.
  // overleaf-lab (merge phase 4): the system prompt is the admin-effective
  // value from the shared prompt store (override when set, else the shipped
  // default); the tool instructions below are appended exactly as before.
  let system
  try {
    system = (await getLLMPrompts()).workbenchSystemPrompt
  } catch {
    system = SYSTEM_PROMPT
  }
  if (webSearch || webFetch) {
    // The model would otherwise take its training cutoff for today
    system += `\n\nToday is ${new Date().toISOString().slice(0, 10)}.`
  }
  if (webSearch) {
    system += `\n\nweb_search looks things up on the internet. Use it for anything recent or outside what you know, such as news, prices or the latest version of a package, answer from what it returns and link the pages you used. You do have internet access through it.`
  }
  if (webFetch) {
    system += `\n\nweb_fetch reads a web page by its URL. Use it for a link the user gives, or to read a page web_search found when its snippet is not enough, and link the pages you used.`
  }
  if (docsSearch) {
    system += `\n\nsearch_docs searches the help pages of this editor. Use it, rather than web_search, when the user asks how the editor itself works (its features, settings, projects, accounts or administration), and link the pages you used.`
  }

  let condensed
  let modelMessages
  try {
    condensed = condenseOldToolOutputs(messages)
    modelMessages = await convertWorkbenchMessages(condensed, tools)
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
    modelMessages = await convertWorkbenchMessages(history, tools)
  }
  if (historySummary) {
    system += `\n\nThe earlier part of this conversation was summarized:\n\n${historySummary}`
  }

  const resolvedModel = resolveModel(history, lane)

  try {
    const result = streamText({
      model: wrapLanguageModel({
        model: getProvider(
          lane ? { baseURL: lane.baseURL, apiKey: lane.apiKey } : undefined
        )(resolvedModel),
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
        // overleaf-lab (merge phase 3): feed the ONE shared usage ledger — the
        // admin and user meters (LLMUsage) cover the workbench now, by action
        // 'workbench-chat' with the resolved lane and model for transparency.
        recordUsage(
          {
            userId,
            // The client sends the project id so the ledger can group per project.
            projectId: req.body?.projectId,
            action: 'workbench-chat',
            lane: lane?.lane === 'user' ? 'user:byo' : lane?.lane === 'site' ? 'site' : 'operator',
            model: resolvedModel || '',
          },
          {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            totalTokens: usage?.totalTokens,
          }
        )
        if (sitePaidBudget) sitePaidBudget.record(usage?.outputTokens)
      },
    })

    const onError = err => {
      logger.err({ err, userId }, 'workbench chat stream error')
      // A rejected PDF request may be a gateway, a model or a request
      // validation error — the status alone cannot identify the cause
      // (ayakaleaf #122 follow-up, 2026-10-28). Route the notice by lane:
      // BYO/site rows are the user's own choice, operator gateways are admin's.
      if (
        hasPdf(history) &&
        APICallError.isInstance(err) &&
        [400, 415, 422].includes(err.statusCode)
      ) {
        // overleaf-lab (bug hunt): extraction was attempted and could not
        // read the PDF → the lane-remedy below (pick a PDF-capable model)
        // is the only actionable part; don't imply the user must toggle
        // anything when text mode was already on.
        if (extraction?.anyFailed) return 'ai_pdf_unreadable'
        return lane ? 'ai_pdf_not_supported_byo' : 'ai_pdf_not_supported_site'
      }
      // overleaf-lab (2026-11, owner report): an image attachment was routed
      // to a TEXT-ONLY model (no image task slot selected) and the provider
      // rejects it — e.g. AcademicCloud: "not a multimodal model". Same
      // lane-aware remedy as the PDF refusal: the user can pick an
      // image-capable model (File → Select LLM Task → Image task... the
      // modal offers the per-task slots) or the admin enables one.
      if (
        hasImage(history) &&
        APICallError.isInstance(err) &&
        /multimodal|modality|image|vision/i.test(String(err?.message || ''))
      ) {
        // overleaf-lab (bug hunt): OCR text mode was ON but tesseract could
        // not read this image (blurry scan, unsupported format) — a different
        // message than "mode is off", so the user is not told to enable a
        // setting they already enabled.
        if (extraction?.anyFailed) return 'ai_image_unreadable'
        return lane ? 'ai_image_not_supported_byo' : 'ai_image_not_supported_site'
      }
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
    res.json({
      allowed: access.chat,
      errorAssistant: access.errorAssistant,
      // overleaf-lab (2026-11): tells the client whether render_pdf_page should
      // hand the model page TEXT (text-extraction mode) instead of a page image.
      textExtract: access.textExtract === true,
    })
  }),
  chat,
}
