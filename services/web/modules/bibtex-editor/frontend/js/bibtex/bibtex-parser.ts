/**
 * A small, self-contained BibTeX parser + serializer.
 *
 * - Parses @type{key, field = value, ...} entries, tracking each entry's
 *   [from, to) character range in the source (needed to write edits back to
 *   the exact region of the shared document).
 * - Resolves @string macros and `#` concatenation for display.
 * - Collects duplicate citation keys.
 * - Ignores @comment / @preamble bodies (kept as junk offsets only).
 *
 * No external dependencies, so it works standalone. If you prefer, the display
 * layer can instead be fed by the repo's existing `lezer-bibtex` parser; this
 * module keeps the editor usable without that wiring.
 */
import { BibEntry, FieldValue } from './bibtex-entry'

export interface ParseResult {
  entries: BibEntry[]
  /** citation keys that appear more than once */
  duplicateKeys: Set<string>
  /** @string macros: lower-cased name -> resolved value */
  macros: Map<string, string>
}

const WS = /\s/

function skipWs(s: string, i: number): number {
  while (i < s.length && WS.test(s[i])) i++
  return i
}

/** Read a delimited value starting at `i` (which points at `{` or `"`). */
function readDelimited(s: string, i: number): { raw: string; next: number } {
  const open = s[i]
  if (open === '{') {
    let depth = 0
    const start = i
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++
      else if (s[i] === '}') {
        depth--
        if (depth === 0) return { raw: s.slice(start, i + 1), next: i + 1 }
      }
    }
    return { raw: s.slice(start), next: s.length }
  }
  if (open === '(') {
    // paren-delimited body: @comment(...) / @preamble(...) / @string(...).
    // Paren-delimited body: braces still nest inside; the body ends at the
    // first `)` at brace-depth 0.
    const start = i
    i++ // consume opening paren
    let depth = 0
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++
      else if (s[i] === '}') depth = Math.max(0, depth - 1)
      else if (s[i] === ')' && depth === 0) {
        return { raw: s.slice(start, i + 1), next: i + 1 }
      }
    }
    return { raw: s.slice(start), next: s.length }
  }
  // quoted "..."  (braces still nest, quotes inside braces are literal)
  const start = i
  i++ // consume opening quote
  let depth = 0
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') depth = Math.max(0, depth - 1)
    else if (s[i] === '"' && depth === 0) return { raw: s.slice(start, i + 1), next: i + 1 }
  }
  return { raw: s.slice(start), next: s.length }
}

/** Read one concatenated value (handles `#` joins) up to `,` or the body close. */
function readValue(
  s: string,
  i: number,
  close: string
): { raw: string; next: number } {
  const start = i
  for (;;) {
    i = skipWs(s, i)
    if (i >= s.length) break
    const c = s[i]
    if (c === '{' || c === '"') {
      i = readDelimited(s, i).next
    } else {
      // bare token: macro name or number
      while (i < s.length && !WS.test(s[i]) && s[i] !== ',' && s[i] !== '#' && s[i] !== close) i++
    }
    i = skipWs(s, i)
    if (s[i] === '#') {
      i++ // continue concatenation
      continue
    }
    break
  }
  return { raw: s.slice(start, i).trim(), next: i }
}

/** Resolve a raw value (with #, macros, braces/quotes) into display text. */
export function renderValue(raw: string, macros: Map<string, string>): string {
  // split on top-level `#`
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
    else if (c === '#' && depth === 0) {
      parts.push(raw.slice(start, i))
      start = i + 1
    }
  }
  parts.push(raw.slice(start))

  const rendered = parts.map(p => {
    const t = p.trim()
    if (t.startsWith('{') || t.startsWith('"')) {
      // strip one outer delimiter layer
      return t.slice(1, -1)
    }
    if (/^\d+$/.test(t)) return t
    const macro = macros.get(t.toLowerCase())
    return macro ?? t
  })

  // strip remaining braces used for case protection, collapse whitespace
  return rendered.join('').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

export function parseBibtex(input: string): ParseResult {
  const entries: BibEntry[] = []
  const macros = new Map<string, string>()
  const seen = new Set<string>()
  const duplicateKeys = new Set<string>()

  let i = 0
  const n = input.length
  while (i < n) {
    const at = input.indexOf('@', i)
    if (at < 0) break
    const from = at
    i = at + 1
    const tm = /^[A-Za-z]+/.exec(input.slice(i))
    if (!tm) {
      i = at + 1
      continue
    }
    const type = tm[0].toLowerCase()
    i += tm[0].length
    i = skipWs(input, i)
    const open = input[i]
    if (open !== '{' && open !== '(') {
      continue
    }
    const close = open === '{' ? '}' : ')'
    i++ // consume open

    if (type === 'comment' || type === 'preamble') {
      // skip balanced body
      i = readDelimited(input, i - 1).next
      continue
    }

    if (type === 'string') {
      i = skipWs(input, i)
      const nameM = /^[^\s=]+/.exec(input.slice(i))
      if (nameM) {
        const name = nameM[0].toLowerCase()
        i += nameM[0].length
        i = skipWs(input, i)
        if (input[i] === '=') {
          i++
          const v = readValue(input, i, close)
          macros.set(name, renderValue(v.raw, macros))
          i = v.next
        }
      }
      const end = input.indexOf(close, i)
      i = end < 0 ? n : end + 1
      continue
    }

    // normal entry: key , field = value , ...
    i = skipWs(input, i)
    let key = ''
    while (i < n && input[i] !== ',' && input[i] !== close && !WS.test(input[i])) {
      key += input[i++]
    }
    const fields = new Map<string, FieldValue>()
    for (;;) {
      i = skipWs(input, i)
      if (i >= n || input[i] === close) break
      if (input[i] === ',') {
        i++
        i = skipWs(input, i)
      }
      if (input[i] === close) break
      const nameM = /^[^\s=,}()]+/.exec(input.slice(i))
      if (!nameM) {
        // malformed; bail to next close
        break
      }
      const fname = nameM[0].toLowerCase()
      i += nameM[0].length
      i = skipWs(input, i)
      if (input[i] !== '=') {
        continue
      }
      i++ // consume '='
      const v = readValue(input, i, close)
      i = v.next
      fields.set(fname, { raw: v.raw, display: renderValue(v.raw, macros) })
    }
    // consume closing delimiter
    const closeIdx = input.indexOf(close, i)
    const to = closeIdx < 0 ? n : closeIdx + 1
    i = to

    const entry = new BibEntry({ type, key, fields, range: { from, to } })
    entries.push(entry)
    if (key) {
      if (seen.has(key)) duplicateKeys.add(key)
      else seen.add(key)
    }
  }

  return { entries, duplicateKeys, macros }
}

// ---------------- serialization ----------------

/** Serialize one entry to canonical BibTeX. Unedited fields keep their raw source. */
export function serializeEntry(entry: BibEntry, indent = '  '): string {
  const lines: string[] = []
  lines.push(`@${entry.type}{${entry.key},`)
  const names = entry.getFieldNames()
  names.forEach((name, idx) => {
    const fv = entry.fields.get(name)!
    const value = fv.raw?.trim() ? fv.raw.trim() : `{${fv.display}}`
    const comma = idx === names.length - 1 ? '' : ','
    lines.push(`${indent}${name} = ${value}${comma}`)
  })
  lines.push('}')
  return lines.join('\n')
}

/** Replace one entry's source range inside the full document text. */
export function replaceEntryInSource(
  source: string,
  entry: BibEntry,
  serialized: string
): string {
  if (!entry.range) return source
  return source.slice(0, entry.range.from) + serialized + source.slice(entry.range.to)
}
