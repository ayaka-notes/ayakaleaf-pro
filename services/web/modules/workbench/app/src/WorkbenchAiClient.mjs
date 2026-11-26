import Settings from '@overleaf/settings'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { HttpsProxyAgent } from 'https-proxy-agent'
import nodeFetch from 'node-fetch'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'

/**
 * Configures the AI SDK provider, optional HTTP proxy, and model selection
 * for the workbench gateway.
 */

let _provider = null
let _proxyFetch = null

/**
 * Whether AI is enabled and its gateway, API key, and text model are configured.
 */
export function isConfigured() {
  return Boolean(
    Settings.workbenchAi?.enabled &&
      Settings.workbenchAi?.baseURL &&
      Settings.workbenchAi?.apiKey &&
      Settings.workbenchAi?.model
  )
}

/**
 * When AI_PROXY_URL is set, route the gateway calls through an HTTP proxy.
 * Node's global fetch (undici) ignores http.Agent proxies, so we fetch through
 * node-fetch (which honours the proxy agent) and re-wrap its Node stream body
 * as a WHATWG Response, keeping the AI SDK's streaming (getReader/pipeThrough)
 * working. No proxy configured -> undefined -> the SDK uses global fetch.
 */
function _getProxyFetch() {
  const proxyUrl = Settings.workbenchAi?.proxyUrl
  if (!proxyUrl) {
    return undefined
  }
  if (!_proxyFetch) {
    const agent = new HttpsProxyAgent(proxyUrl)
    _proxyFetch = async (url, init = {}) => {
      const res = await nodeFetch(url, { ...init, agent })
      const body = res.body ? Readable.toWeb(res.body) : null
      return new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers],
      })
    }
  }
  return _proxyFetch
}

/** Lazily build (and cache) the provider per gateway.
 * overleaf-lab (2026-11, BYO phase 1): a per-gateway cache — the workbench
 * chat may run against the operator gateway OR a user BYO/site lane resolved
 * per request (LlmBridge.mjs); each (baseURL, apiKey) pair gets its own
 * provider instance, the operator defaults remain for calls without a cfg.
 * The gateway's API follows AI_API_MODE: Chat Completions, or the OpenAI
 * Responses API with aiMode: 'responses'.
 */
const _providers = new Map()

export function getProvider(cfg = null) {
  const baseURL = cfg?.baseURL ?? Settings.workbenchAi?.baseURL
  const apiKey = cfg?.apiKey ?? Settings.workbenchAi?.apiKey
  const key = createHash('sha256').update(String(baseURL) + '|' + String(apiKey)).digest('hex')
  if (!_providers.has(key)) {
    const config = { baseURL, apiKey }
    const proxyFetch = _getProxyFetch()
    if (proxyFetch) {
      config.fetch = proxyFetch
    }
    // Responses keep OpenAI's default store: true, so the later steps of a
    // tool call refer to the stored reasoning and call items (item_reference).
    // With store: false, @ai-sdk/openai sends the reasoning back encrypted only
    // for the models it knows (o-series, gpt-5), and the tool calls of newer
    // reasoning models such as gpt-6.x would lose their reasoning items.
    // The operator gateway's API mode is AI_API_MODE (Settings.workbenchAi
    // .apiMode); a BYO/site lane opts in per-lane via cfg.aiMode.
    const useResponses =
      cfg?.aiMode === 'responses' ||
      (cfg == null && Settings.workbenchAi?.apiMode === 'responses')
    _providers.set(
      key,
      useResponses
        ? createOpenAI(config).responses
        : createOpenAICompatible({
            ...config,
            name: 'workbench',
            includeUsage: true,
          })
    )
  }
  return _providers.get(key)
}

/** Whether a user attached a PDF anywhere in the conversation. */
export function hasPdf(messages = []) {
  return messages.some(message =>
    message.parts?.some(
      part => part.type === 'file' && part.mediaType === 'application/pdf'
    )
  )
}

/** Whether a user attached an IMAGE anywhere in the conversation. */
export function hasImage(messages = []) {
  return messages.some(message =>
    message.parts?.some(
      part =>
        (part.type === 'file' && typeof part.mediaType === 'string' && part.mediaType.startsWith('image/')) ||
        (part.type === 'tool-render_pdf_page' && part.state === 'output-available')
    )
  )
}

/**
 * Selects the instance's configured text, image or PDF model for a request.
 * overleaf-lab (2026-11, BYO phase 1): when a resolved user lane (BYO row or
 * site provider) is passed, its model is used for the whole conversation —
 * the user's gateway defines its own capabilities; the operator pdfModel/
 * imageModel overrides apply to the operator gateway only.
 */
export function resolveModel(messages = [], lane = null) {
  // overleaf-lab (2026-11, BYO phase 1): a resolved user lane (BYO row or
  // site provider) defines its own model and capabilities for the whole
  // conversation; the operator pdfModel/imageModel overrides apply to the
  // operator gateway only.
  if (lane?.model) {
    return lane.model
  }
  // Follow-up requests retain earlier attachments, so route the entire conversation.
  // A PDF goes to the PDF model, or to the chat model without one, even with
  // images: the image model may not read PDF file parts (a vision model may
  // read images but refuse 'file' parts), and a PDF+image history with
  // AI_PDF_MODEL unset must not land on the image model.

  if (hasPdf(messages)) {
    return Settings.workbenchAi?.pdfModel || Settings.workbenchAi?.model
  }
  if (
    Settings.workbenchAi?.imageModel &&
    messages.some(message =>
      message.parts?.some(
        part =>
          (part.type === 'file' && part.mediaType?.startsWith('image/')) ||
          (part.type === 'tool-render_pdf_page' && part.state === 'output-available')
      )
    )
  ) {
    return Settings.workbenchAi.imageModel
  }
  return Settings.workbenchAi?.model
}

/** Maximum tool calls per user message, including automatic continuations. */
export function getMaxSteps() {
  const limit = Settings.workbenchAi?.maxSteps
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 20
}

/**
 * The agent's instructions: look at the project through the tools, keep
 * edits small, answer in the user's language.
 *
 * overleaf-lab (2026-11, merge phase 4): the canonical default lives in the
 * llm module's prompt store (LLMPrompts) so super-admins can override it on
 * /admin/llm/settings like every other prompt; WorkbenchController resolves
 * the effective value. This export is the shipped default (fallback).
 */
import { DEFAULT_WORKBENCH_SYSTEM_PROMPT } from '../../../llm/app/src/LLMPrompts.mjs'

export const SYSTEM_PROMPT = DEFAULT_WORKBENCH_SYSTEM_PROMPT

export default {
  isConfigured,
  getProvider,
  resolveModel,
  getMaxSteps,
  SYSTEM_PROMPT,
}
