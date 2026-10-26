import Settings from '@overleaf/settings'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { HttpsProxyAgent } from 'https-proxy-agent'
import nodeFetch from 'node-fetch'
import { Readable } from 'node:stream'

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

/** Lazily build (and cache) the OpenAI-compatible provider. */
export function getProvider() {
  if (!_provider) {
    const config = {
      name: 'workbench',
      baseURL: Settings.workbenchAi.baseURL,
      apiKey: Settings.workbenchAi.apiKey,
      includeUsage: true,
    }
    const proxyFetch = _getProxyFetch()
    if (proxyFetch) {
      config.fetch = proxyFetch
    }
    _provider = createOpenAICompatible(config)
  }
  return _provider
}

/**
 * Selects the instance's configured text or image model for a request.
 */
export function resolveModel(messages = []) {
  // Follow-up requests retain earlier images, so route the entire conversation.
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
 */
export const SYSTEM_PROMPT = `You work inside a collaborative LaTeX editor as the writing and TeX assistant for the project the user has open. Help them write, fix, explain and restructure their document.

Ground every answer in the project, not in guesses:
- Look before you answer: get_file, get_lines and find_in_file show the source of a document by its path; list_project_files shows what exists; new_file adds a document.
- For build problems, call get_problems, or run_compile to get a fresh log; render_pdf_page and get_pdf_outline show the output; choose_compiler switches the engine.
- To change text, call propose_edit. Nothing changes until the user applies it, so pass the current text of the lines as oldText exactly as it is, touch only what the request needs, and say why in a short reason.
- Results of tools from earlier turns may be shortened or dropped; call the tool again when you need them in full or up to date.

The user's message can end with an <editor-context> block naming the open file and what is selected in it; it comes again when the user opens another file. Use it, but do not quote it back.

Answer in the language of the user's latest message, whatever language the document is in. Keep answers short and practical, in Markdown: LaTeX source in fenced code blocks, inline math in $...$ and displayed math in $$...$$, and a dollar sign that is not math as \\$. When a request is unclear, ask one short question first.`

export default {
  isConfigured,
  getProvider,
  resolveModel,
  getMaxSteps,
  SYSTEM_PROMPT,
}
