import { tool } from 'ai'
import { z } from 'zod'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import {
  CustomHttpAgent,
  CustomHttpsAgent,
  fetchJson,
} from '@overleaf/fetch-utils'

// fetch-utils' default agent gives up connecting after 1s, too short for
// external APIs, so these requests get a 3s connect timeout instead
const MAX_CONNECT_TIME = 3000
const httpAgent = new CustomHttpAgent({ connectTimeout: MAX_CONNECT_TIME })
const httpsAgent = new CustomHttpsAgent({ connectTimeout: MAX_CONNECT_TIME })
const agent = url => (url.protocol === 'https:' ? httpsAgent : httpAgent)
const REQUEST_TIMEOUT_MS = 30 * 1000

/**
 * Searches the web through a Tavily-compatible API.
 * Returns action and source metadata for the chat renderer, plus result text
 * for the model to use when composing an answer.
 */

const DEFAULT_TAVILY_URL = 'https://api.tavily.com/search'

/** Whether the operator has configured a web-search backend. */
export function isWebSearchConfigured() {
  return Boolean(Settings.workbenchWebSearch?.apiKey)
}

async function _tavilySearch(query) {
  const cfg = Settings.workbenchWebSearch || {}
  const data = await fetchJson(cfg.url || DEFAULT_TAVILY_URL, {
    agent,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      // Send both key locations for compatibility with Tavily-compatible services.
      api_key: cfg.apiKey,
      query,
      search_depth: cfg.searchDepth || 'basic',
      max_results: cfg.maxResults || 5,
      include_answer: false,
    }),
  })
  return (data?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }))
}

// The model gets the results as Markdown; sources are for the chat renderer
function formatResults({ results, error }) {
  if (error) return `The search failed (${error}).`
  if (!results.length) return 'No results.'
  return results
    .map(r => `## [${r.title || r.url}](${r.url})\n\n${r.content}`)
    .join('\n\n')
}

export const WEB_SEARCH_TOOL = tool({
  description:
    'Search the web for up-to-date information (current events, recent facts, ' +
    'anything outside your training data). Returns relevant results with their ' +
    'URLs and content. Cite the sources you use.',
  inputSchema: z.object({
    query: z.string().describe('The search query.'),
  }),
  execute: async ({ query }) => {
    const action = { type: 'search', query }
    if (!isWebSearchConfigured()) {
      return { action, sources: [], results: [], error: 'web_search_not_configured' }
    }
    try {
      const results = await _tavilySearch(query)
      return {
        action,
        sources: results.map(r => ({ type: 'url', url: r.url, title: r.title })),
        results,
      }
    } catch (err) {
      logger.err({ err, query }, 'web_search (tavily) failed')
      return { action, sources: [], results: [], error: 'web_search_failed' }
    }
  },
  // Output of earlier turns arrives condensed to a string (ContextCompaction)
  toModelOutput: ({ output }) => ({
    type: 'text',
    value: typeof output === 'string' ? output : formatResults(output),
  }),
})

export default { WEB_SEARCH_TOOL, isWebSearchConfigured }
