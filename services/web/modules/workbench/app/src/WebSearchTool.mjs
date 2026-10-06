import { tool } from 'ai'
import { z } from 'zod'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { fetchJson } from '@overleaf/fetch-utils'

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
})

export default { WEB_SEARCH_TOOL, isWebSearchConfigured }
