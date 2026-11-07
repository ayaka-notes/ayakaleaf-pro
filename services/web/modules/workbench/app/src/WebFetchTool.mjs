import { tool } from 'ai'
import { z } from 'zod'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import sanitizeHtml from 'sanitize-html'
import {
  fetchStreamWithResponse,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import UrlHelper from '../../../../app/src/Features/Helpers/UrlHelper.mjs'

/**
 * Reads a web page through the linked-url-proxy, like URL files and Open in
 * Overleaf do: the proxy refuses internal addresses and checks every redirect
 * again. HTML pages are turned into plain text for the model.
 */

const REQUEST_TIMEOUT_MS = 60 * 1000
// The part of a page that is read, and the part of its text the model gets
const MAX_BYTES = 2 * 1024 * 1024
const MAX_CHARS = 40_000

const TEXT_TYPE = /^(text\/|application\/([\w.-]+\+)?(json|xml)$)/
const HTML_TYPE = /^(text\/html|application\/xhtml\+xml)$/

// Tags that end a line, so that the text of blocks does not run together
const BLOCK_TAG =
  /<\/?(address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)\b[^>]*>/gi

/** Whether the linked-url-proxy is set up. */
export function isWebFetchConfigured() {
  return Boolean(Settings.apis.linkedUrlProxy?.url)
}

function htmlToText(html) {
  const text = sanitizeHtml(html.replace(BLOCK_TAG, '\n$&'), {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['script', 'style', 'noscript', 'template', 'textarea', 'option'],
  })
  // sanitize-html escapes the text it keeps
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>' }
  return text
    .replace(/&(amp|lt|gt);/g, entity => entities[entity])
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

async function readStart(stream) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    size += chunk.length
    if (size >= MAX_BYTES) break
  }
  return Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8')
}

async function fetchPage(url) {
  const { stream, response } = await fetchStreamWithResponse(
    UrlHelper.wrapUrlWithProxy(url),
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  )
  const type = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!TEXT_TYPE.test(type)) {
    stream.destroy()
    return { url, error: 'unsupported_content_type', contentType: type }
  }
  const body = await readStart(stream)
  const title = HTML_TYPE.test(type)
    ? htmlToText(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    : ''
  const text = HTML_TYPE.test(type) ? htmlToText(body) : body
  return {
    url,
    title,
    content: text.slice(0, MAX_CHARS),
    length: text.length,
  }
}

function formatPage({ url, title, content, length, error, status, contentType }) {
  if (error === 'unsupported_content_type') {
    return `${url} is ${contentType || 'not text'}, which cannot be read as text.`
  }
  if (error) {
    return `Could not read ${url}${status ? ` (HTTP ${status})` : ''}.`
  }
  const cut =
    length > content.length
      ? `\n\n[Only the first ${content.length} of ${length} characters]`
      : ''
  return `# ${title || url}\nURL: ${url}\n\n${content}${cut}`
}

export const WEB_FETCH_TOOL = tool({
  description:
    'Read a web page by its URL and return its text. Use it for a link the ' +
    'user gives, or when a web_search result needs more than its snippet. ' +
    'Only public http(s) pages can be read.',
  inputSchema: z.object({
    url: z.string().describe('The http(s) URL of the page.'),
  }),
  execute: async ({ url }) => {
    try {
      return await fetchPage(url)
    } catch (err) {
      // The proxy answers 4xx for blocked, unreachable or oversized pages
      if (err instanceof RequestFailedError) {
        return { url, error: 'web_fetch_failed', status: err.response.status }
      }
      logger.warn({ err, url }, 'web_fetch failed')
      return { url, error: 'web_fetch_failed' }
    }
  },
  // Output of earlier turns arrives condensed to a string (ContextCompaction)
  toModelOutput: ({ output }) => ({
    type: 'text',
    value: typeof output === 'string' ? output : formatPage(output),
  }),
})

export default { WEB_FETCH_TOOL, isWebFetchConfigured }
