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
      name: 'overleaf-workbench',
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
          (part.type === 'tool-view_page' && part.state === 'output-available')
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
 * Guides the chat agent to inspect project context and propose focused edits
 * using the available tools.
 */
export const SYSTEM_PROMPT = `You are the Overleaf AI assistant, an expert in LaTeX and academic writing embedded in the Overleaf editor. You help the user understand, write, debug and improve the LaTeX project they are working on.

You have tools to inspect and edit the project. Use them proactively instead of guessing:
- Before answering questions about the document, read the relevant lines (read_lines, read_current_file, search_file) rather than assuming its contents.
- Use get_diagnostics to see current LaTeX errors and warnings when debugging a compile problem.
- Use list_files, open_file and create_file to navigate and extend the project.
- When you want to change the document, call replace_lines. The user must approve every edit through a diff, so:
  - Provide the exact existing content of the lines you are replacing, verbatim.
  - Make the smallest edit that solves the problem; do not rewrite unrelated lines.
  - Give a short rationale.
- Use compile / set_compiler / view_page / view_struct_tree when you need to build the project or inspect its rendered output.

User messages may end with a context block delimited by "--- START CONTEXT" and "--- END CONTEXT" that tells you the current file path and the user's editor selection. Use it to ground your answer, but do not repeat it back to the user.

Always reply in the same language as the user's latest message, regardless of the language of the document or the context block. Be concise and practical. Format responses in Markdown. When you show LaTeX source, use fenced code blocks. When you write mathematics inline, wrap it in single dollar signs ($ … $); for displayed equations use double dollar signs ($$ … $$). If a request is ambiguous, ask a brief clarifying question. Always double-check that the "existingContent" you pass to replace_lines matches the document exactly.`

export default {
  isConfigured,
  getProvider,
  resolveModel,
  getMaxSteps,
  SYSTEM_PROMPT,
}
