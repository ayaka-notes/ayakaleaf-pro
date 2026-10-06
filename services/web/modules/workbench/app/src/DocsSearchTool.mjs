import { tool } from 'ai'
import { z } from 'zod'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { fetchString } from '@overleaf/fetch-utils'

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
    'Search across the Overleaf documentation to find relevant ' +
    'information, guides and how-tos. Use this tool when you need to answer ' +
    'questions about how Overleaf itself works — its features, settings, ' +
    'account/project management or administration. The search returns ' +
    'contextual content with titles and direct links to the documentation ' +
    'pages.',
  inputSchema: z.object({
    query: z.string().describe('The documentation search query.'),
  }),
  execute: async ({ query }) => {
    if (!isDocsSearchConfigured()) {
      return { content: [], error: 'docs_search_not_configured' }
    }
    try {
      return await _searchDocumentation(query)
    } catch (err) {
      logger.err({ err, query }, 'search_documentation (docs MCP) failed')
      return { content: [], error: 'docs_search_failed' }
    }
  },
})

export default { DOCS_SEARCH_TOOL, isDocsSearchConfigured }
