import { tool } from 'ai'
import { z } from 'zod'

/**
 * Server-side tools for reading project documents and suggesting LaTeX fixes.
 * Suggested changes are returned to the browser for review and application.
 */

function _normalisePath(p) {
  return String(p || '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/^compile\//, '')
}

/** Resolve a model-supplied path against the project docs (exact, then basename). */
function resolveDoc(docs, path) {
  const wanted = _normalisePath(path)
  if (docs[wanted]) return docs[wanted]
  // exact match ignoring a normalised leading path
  for (const key of Object.keys(docs)) {
    if (_normalisePath(key) === wanted) return docs[key]
  }
  // basename fallback (the log entry file is often just "main.tex")
  const base = wanted.split('/').pop()
  for (const key of Object.keys(docs)) {
    if (key.split('/').pop() === base) return docs[key]
  }
  return null
}

export function buildTools(docs) {
  return {
    getDocLines: tool({
      description:
        'Read a range of lines from a file in the project. Line numbers are ' +
        '1-indexed and inclusive. Omit fromLine/toLine to read the whole file. ' +
        'Returns lines prefixed with their line number.',
      inputSchema: z.object({
        path: z.string().describe('Project-relative path of the file, e.g. "main.tex".'),
        fromLine: z.number().int().optional().describe('First line (1-indexed).'),
        toLine: z.number().int().optional().describe('Last line (1-indexed).'),
      }),
      execute: async ({ path, fromLine, toLine }) => {
        const doc = resolveDoc(docs, path)
        if (!doc) return `File not found: ${path}`
        const lines = doc.lines || []
        const from = Math.max(1, fromLine || 1)
        const to = Math.min(lines.length, toLine || lines.length)
        const out = []
        for (let i = from; i <= to; i++) {
          out.push(`${i}: ${lines[i - 1]}`)
        }
        return out.join('\n') || '(file is empty)'
      },
    }),

    searchDocLines: tool({
      description:
        'Search a file in the project for a substring. Returns matching lines ' +
        'prefixed with their 1-indexed line number (first 50 matches).',
      inputSchema: z.object({
        path: z.string().describe('Project-relative path of the file to search.'),
        query: z.string().describe('The substring to search for.'),
      }),
      execute: async ({ path, query }) => {
        const doc = resolveDoc(docs, path)
        if (!doc) return `File not found: ${path}`
        const matches = []
        ;(doc.lines || []).forEach((content, i) => {
          if (content.includes(query)) {
            matches.push(`${i + 1}: ${content}`)
          }
        })
        return matches.slice(0, 50).join('\n') || `No lines matching "${query}"`
      },
    }),

    suggestLineChange: tool({
      description:
        'Propose the fix for the error as a replacement of one or more lines. ' +
        'The user is shown a diff and applies it themselves, so `from.content` ' +
        'MUST be the exact current content of the line(s) at `from.line` ' +
        '(verbatim, so the edit can be located), and `to.content` is the full ' +
        'replacement. Make the smallest change that fixes the error. Call this ' +
        'once per contiguous line range that must change (usually once).',
      inputSchema: z.object({
        path: z
          .string()
          .describe('Project-relative path of the file to change, e.g. "main.tex".'),
        from: z.object({
          line: z
            .number()
            .int()
            .describe('1-indexed line number where the replaced content starts.'),
          content: z
            .string()
            .describe('The exact current content of the line(s) being replaced.'),
        }),
        to: z.object({
          content: z.string().describe('The replacement content.'),
        }),
      }),
      // The client renders the fix from the streamed {tool,args} event; the
      // server just acknowledges so the agent can finish.
      execute: async () => 'The suggested fix has been shown to the user.',
    }),
  }
}

export default { buildTools }
