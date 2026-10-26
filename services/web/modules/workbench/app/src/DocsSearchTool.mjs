import { tool } from 'ai'
import { z } from 'zod'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import {
  CustomHttpAgent,
  CustomHttpsAgent,
  fetchString,
} from '@overleaf/fetch-utils'

// fetch-utils' default agent gives up connecting after 1s, too short for
// external APIs, so these requests get a 3s connect timeout instead
const MAX_CONNECT_TIME = 3000
const httpAgent = new CustomHttpAgent({ connectTimeout: MAX_CONNECT_TIME })
const httpsAgent = new CustomHttpsAgent({ connectTimeout: MAX_CONNECT_TIME })
const agent = url => (url.protocol === 'https:' ? httpsAgent : httpAgent)
const REQUEST_TIMEOUT_MS = 30 * 1000

/**
 * Searches the configured documentation site through its GitBook MCP endpoint.
 * Calls searchDocumentation and returns its content blocks for the model and
 * the chat source renderer. Accepts JSON or SSE responses.
 */

/** Whether a docs-search MCP endpoint is configured. */
export function isDocsSearchConfigured() {
  return Boolean(Settings.workbenchDocsSearch?.mcpUrl)
}

/** Parse a streamable-HTTP MCP response: SSE (`data: {...}` lines) or plain JSON. */
function _parseMcpResponse(raw) {
  const trimmed = raw.trim()
  let message
  if (trimmed.startsWith('{')) {
    message = JSON.parse(trimmed)
  } else {
    const dataLine = trimmed
      .split('\n')
      .find(line => line.startsWith('data: '))
    if (!dataLine) throw new Error('no data line in MCP response')
    message = JSON.parse(dataLine.slice('data: '.length))
  }
  if (message.error) {
    throw new Error(`MCP error: ${message.error.message || 'unknown'}`)
  }
  return message.result
}

async function _searchDocumentation(query) {
  const raw = await fetchString(Settings.workbenchDocsSearch.mcpUrl, {
    agent,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'searchDocumentation', arguments: { query } },
    }),
  })
  return _parseMcpResponse(raw)
}

export const DOCS_SEARCH_TOOL = tool({
  description:
    'Search the help pages of this editor and return matching passages ' +
    'with their titles and links. For questions about the editor itself: ' +
    'features, settings, projects, accounts and administration.',
  inputSchema: z.object({
    query: z.string().describe('What to look for in the help pages.'),
  }),
  execute: async ({ query }) => {
    if (!isDocsSearchConfigured()) {
      return { content: [], error: 'docs_search_not_configured' }
    }
    try {
      return await _searchDocumentation(query)
    } catch (err) {
      logger.err({ err, query }, 'search_docs (docs MCP) failed')
      return { content: [], error: 'docs_search_failed' }
    }
  },
})

export default { DOCS_SEARCH_TOOL, isDocsSearchConfigured }
