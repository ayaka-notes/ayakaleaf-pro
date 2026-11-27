/**
 * Lightweight BibTeX parser and serializer.
 * Parses a .bib file string into BibEntry objects and serializes them back.
 *
 * Parsing is offset-based: every parsed entry carries its start/end offset in
 * the source so the editor can replace or remove it surgically.
 */
import type { BibEntry } from './bib-types'

/**
 * A BibEntry plus its positional info in the source string.
 *
 * `libId` / `updatedAt` (optional) are set by the Library page (API rows)
 * for stable row identity across duplicate citation keys (SaaS allows
 * duplicates) and the `Updated __date__` line (LIBRARY_PLAN.md §5).
 */
export type ParsedBibEntry = BibEntry & {
  /** Start offset in the source string (inclusive) */
  sourceStart: number
  /** End offset in the source string (exclusive) */
  sourceEnd: number
  /** Raw source text for this entry */
  raw: string
  /** Stable mongo _id for Library rows (set by library-api rows) */
  libId?: string
  /** ISO timestamp of the Library row's last update (set by library-api rows) */
  updatedAt?: string | null
}

/** Entry types that are parsed but not editable bibliographies entries. */
const SKIP_TYPES = new Set(['comment', 'preamble', 'string'])

/**
 * Parse all BibTeX entries from a source string.
 *
 * Entries without a citation key (`@misc{}`) and entries with a key but no
 * comma or fields (`@misc{key}`) are still returned, with an empty `id` /
 * empty `fields`, so the UI can show them (red frame) and repair them.
 */
export function parseBibFile(source: string): ParsedBibEntry[] {
  const entries: ParsedBibEntry[] = []
  // Match "@type{" openings (type may be absent for stray `@{` which we skip)
  const entryStartRe = /@\s*([\w-]*)\s*\{/g
  let match: RegExpExecArray | null

  while ((match = entryStartRe.exec(source)) !== null) {
    const type = match[1]?.toLowerCase() || ''
    const braceStart = match.index + match[0].length - 1
    const braceEnd = findMatchingBrace(source, braceStart)
    if (braceEnd === -1) {
      entryStartRe.lastIndex = braceStart + 1
      continue
    }

    if (type && SKIP_TYPES.has(type)) {
      // Skip @comment / @preamble / @string but advance past their braces
      entryStartRe.lastIndex = braceEnd + 1
      continue
    }

    const entrySourceStart = match.index
    const entrySourceEnd = braceEnd + 1
    const innerContent = source.slice(braceStart + 1, braceEnd)
    const raw = source.slice(entrySourceStart, entrySourceEnd)

    // The id (citation key) is everything up to the first comma; a keyless
    // entry (`@misc{}`) has all of the inner content as fields (or none).
    const commaIdx = innerContent.indexOf(',')
    const id =
      commaIdx === -1
        ? innerContent.trim()
        : innerContent.slice(0, commaIdx).trim()
    const fieldsStr = commaIdx === -1 ? '' : innerContent.slice(commaIdx + 1)

    entries.push({
      type: type || 'misc',
      id,
      fields: parseFields(fieldsStr),
      sourceStart: entrySourceStart,
      sourceEnd: entrySourceEnd,
      raw,
    })

    entryStartRe.lastIndex = entrySourceEnd
  }

  return entries
}

/**
 * Parse a single BibTeX entry string (e.g., "@article{key, title={...}, ...}")
 */
export function parseBibEntry(source: string): BibEntry | null {
  const entries = parseBibFile(source)
  return entries.length > 0
    ? {
        type: entries[0].type,
        id: entries[0].id,
        fields: entries[0].fields,
      }
    : null
}

/**
 * Find the index of the matching closing brace for the opening brace at `start`.
 * Backslash-escaped braces (`\{` / `\}`) are treated as literal characters
 * and do not change the depth, matching BibTeX semantics. This is what keeps
 * serialized values such as `a\}b` parseable.
 */
function findMatchingBrace(source: string, start: number): number {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\' && (source[i + 1] === '{' || source[i + 1] === '}')) {
      i++ // escape: skip the brace
      continue
    }
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Parse "field = {value}" / "field = "value"" / "field = number" pairs.
 *
 * Brace values are extracted with a character scan (nested braces of any
 * depth are preserved); quoted and bare values end at the next separator.
 */
function parseFields(fieldsStr: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let i = 0
  const n = fieldsStr.length

  while (i < n) {
    // skip whitespace and separators
    while (i < n && (/\s/.test(fieldsStr[i]) || fieldsStr[i] === ',')) i++
    if (i >= n) break

    // field name (letters, digits, minus)
    const nameStart = i
    while (i < n && /[\w-]/.test(fieldsStr[i])) i++
    const name = fieldsStr.slice(nameStart, i)
    if (name === '') {
      // unexpected character — skip one and rescan
      i++
      continue
    }

    // field name is lowercase
    while (i < n && /\s/.test(fieldsStr[i])) i++
    if (fieldsStr[i] !== '=') {
      // malformed (no "=") — skip this token, keep scanning
      i++
      continue
    }
    i++ // consume '='
    while (i < n && /\s/.test(fieldsStr[i])) i++
    if (i >= n) break

    let value: string
    if (fieldsStr[i] === '{') {
      const open = i
      const braceEnd = findMatchingBrace(fieldsStr, i)
      if (braceEnd === -1) {
        // unbalanced — take the rest
        value = fieldsStr.slice(i + 1)
        i = n
      } else {
        value = fieldsStr.slice(open + 1, braceEnd)
        i = braceEnd + 1
      }
    } else if (fieldsStr[i] === '"') {
      // A backslash escapes the following character (\" in a quoted value
      // is a literal quote, not the closing delimiter).
      let close = i + 1
      while (close < n) {
        if (fieldsStr[close] === '\\') {
          close += 2
          continue
        }
        if (fieldsStr[close] === '"') break
        close++
      }
      if (close >= n) {
        value = fieldsStr.slice(i + 1)
        i = n
      } else {
        value = fieldsStr.slice(i + 1, close)
        i = close + 1
      }
    } else {
      // bare value (e.g. a number): up to the next comma
      let j = i
      while (j < n && fieldsStr[j] !== ',') j++
      value = fieldsStr.slice(i, j)
      i = j
    }

    fields[name.toLowerCase()] = value.trim()
  }

  return fields
}

/**
 * Escape a raw BibTeX field value for writing inside braces: a `}` that is
 * not part of a balanced {…} pair inside the value gets a backslash (e.g. a
 * stray `a}b` → `a\}b`). Balanced nested braces such as `{Last, First}` are
 * preserved, so values round-trip through serialize → parse unchanged.
 * Idempotent: an already-escaped `\}` is left alone.
 */
export function escapeBibValue(value: string): string {
  // A value is safe inside {…} only if its unescaped braces are balanced.
  // Keep balanced braces as-is (preserving the author's formatting); escape
  // stray `}` immediately and any `{` that never finds its closing `}`.
  const outChars: string[] = []
  const openPositions: number[] = [] // outChars indices of unmatched '{'
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '\\') {
      outChars.push(c)
      if (i + 1 < value.length) {
        i++
        outChars.push(value[i])
      }
      continue
    }
    if (c === '{') {
      openPositions.push(outChars.length)
      outChars.push(c)
      continue
    }
    if (c === '}') {
      if (openPositions.length) {
        openPositions.pop()
        outChars.push(c)
      } else {
        outChars.push('\\}')
      }
      continue
    }
    outChars.push(c)
  }
  for (const pos of openPositions) {
    outChars.splice(pos, 0, '\\')
  }
  return outChars.join('')
}

/**
 * Serialize a BibEntry to a BibTeX string.
 */
export function serializeBibEntry(entry: BibEntry): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(entry.fields)) {
    if (value.trim()) {
      lines.push(`  ${key} = {${escapeBibValue(value.trim())}}`)
    }
  }
  const linesText = lines.length > 0 ? lines.join(',\n') : ''
  // Keyless entries serialize without the trailing comma (valid BibTeX).
  if (entry.id.trim()) {
    return linesText
      ? `@${entry.type}{${entry.id},\n${linesText}\n}`
      : `@${entry.type}{${entry.id}}\n`
  }
  return linesText
    ? `@${entry.type}{\n${linesText}\n}`
    : `@${entry.type}{}\n`
}

/**
 * Replace a single entry's text in the full source.
 * Returns the updated source string.
 */
export function replaceEntryInSource(
  source: string,
  parsed: ParsedBibEntry,
  newEntry: BibEntry
): string {
  const newText = serializeBibEntry(newEntry)
  return (
    source.slice(0, parsed.sourceStart) + newText + source.slice(parsed.sourceEnd)
  )
}

/**
 * Remove an entry from the source, including trailing whitespace/newlines.
 */
export function removeEntryFromSource(
  source: string,
  parsed: ParsedBibEntry
): string {
  let end = parsed.sourceEnd
  // Consume trailing newlines
  while (end < source.length && (source[end] === '\n' || source[end] === '\r')) {
    end++
  }
  return source.slice(0, parsed.sourceStart) + source.slice(end)
}

/**
 * Generate a citation key from author/title/year fields.
 *
 * Re-export for backward compatibility: the implementation moved to
 * `./bib-key-generation.ts` (deterministic Unknown/0000 fallbacks, shared
 * suffix-collision handling). Prefer importing from there in new code.
 */
export { generateCitationKey } from './bib-key-generation.ts'

