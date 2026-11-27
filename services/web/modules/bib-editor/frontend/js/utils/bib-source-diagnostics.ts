/**
 * Source diagnostics for the visual bib editor.
 *
 * Pure scanner (no Lezer dependency): reports WHERE a .bib is broken so the
 * panel can surface it instead of the editor silently dropping the entry
 * (our parse loop skips entries whose opening brace never closes).
 *
 * Codes:
 *  - `bib_entry_unterminated`                    opening whose brace never closes
 *  - `citation_key_contains_invalid_characters`  non-empty key outside the
 *                                               btparse identifier class
 *  - `bib_syntax_duplicate_field`                a field name repeated in one entry
 *
 * Line numbers are 1-based and CRLF-aware. (Lezer-exact syntax issues,
 * unbalanced field values and the keyless projection are the build-environment
 * follow-up — see docs/undo-redo-review.md's porting notes.)
 */
import { BIBTEX_CITATION_KEY_REGEX } from '@shared/bibtex/bibtex-identifier.mts'
import { parseBibFile } from './bib-parser.ts'
import type { ParsedBibEntry } from './bib-parser.ts'

export type BibSourceDiagnostic = {
  /** First offset of the problem in the source. */
  from: number
  /** Entry start the problem belongs to, when known. */
  entryFrom?: number
  /** 1-based line of `from`. */
  line: number
  code: string
  /** Field name, when the problem is field-local. */
  field?: string
}

const SKIP_TYPES = new Set(['comment', 'preamble', 'string'])
const ENTRY_START_RE = /@\s*([\w-]*)\s*\{/g

function lineStarts(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\r') {
      if (source[i + 1] === '\n') i++
      starts.push(i + 1)
    } else if (source[i] === '\n') {
      starts.push(i + 1)
    }
  }
  return starts
}

function lineAt(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (starts[middle] <= offset) low = middle + 1
    else high = middle
  }
  return low // 1-based
}

/** Field names at brace depth 0 of an entry's inner content, in order, with
 * the position of the name within the scanned string. */
function topLevelFields(inner: string): Array<{ name: string; at: number }> {
  const fields: Array<{ name: string; at: number }> = []
  const ID = /[\w-]+/y
  let depth = 0
  let inQuotes = false
  let i = 0
  while (i < inner.length) {
    const ch = inner[i]
    if (inQuotes) {
      if (ch === '\\') i++ // escaped char stays in the value
      else if (ch === '"') inQuotes = false
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      i++
      continue
    }
    if (depth === 0) {
      ID.lastIndex = i
      const m = ID.exec(inner)
      if (m && /^\w+$/.test(m[0])) {
        // A field name is an identifier followed (skipping trivia) by '='
        let j = i + m[0].length
        while (j < inner.length && /\s/.test(inner[j])) j++
        if (inner[j] === '=') {
          fields.push({ name: m[0].toLowerCase(), at: i })
          i = j
        }
      }
    }
    i++
  }
  return fields
}

/**
 * All diagnostics for a source, in source-offset order. Offsets are UTF-16.
 */
export function validateBibSource(source: string): BibSourceDiagnostic[] {
  const starts = lineStarts(source)
  const line = (offset: number) => lineAt(starts, offset)
  const diagnostics: BibSourceDiagnostic[] = []

  // Closed entries (our parser's boundary model).
  const entries = parseBibFile(source)
  const closedRanges = entries.map(e => [e.sourceStart, e.sourceEnd]) as Array<
    [number, number]
  >

  // 1) unterminated entries: openings our parser had to skip.
  ENTRY_START_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ENTRY_START_RE.exec(source)) !== null) {
    const type = (m[1] || '').toLowerCase()
    if (SKIP_TYPES.has(type)) continue
    const opening = m.index
    const closing = findClosingBrace(source, m.index + m[0].length - 1)
    if (closing !== -1) continue
    const inClosed = closedRanges.some(
      ([s, e]) => opening >= s && opening < e
    )
    if (inClosed) continue // inside another entry's value: not a top-level entry
    diagnostics.push({
      from: opening,
      line: line(opening),
      code: 'bib_entry_unterminated',
    })
  }

  // 2) invalid non-empty keys + duplicate fields within each closed entry.
  for (const entry of entries) {
    const inner = source.slice(entry.sourceStart)
    // open is relative to `inner`; convert to an absolute source offset.
    const open = entry.sourceStart + inner.indexOf('{')
    const entryInner = source.slice(open + 1, entry.sourceEnd - 1)

    const commaIdx = entryInner.indexOf(',')
    const rawKey = (
      commaIdx === -1 ? entryInner : entryInner.slice(0, commaIdx)
    ).trim()
    if (rawKey !== '' && !BIBTEX_CITATION_KEY_REGEX.test(rawKey)) {
      diagnostics.push({
        from: open + 1 + entryInner.indexOf(rawKey),
        entryFrom: entry.sourceStart,
        line: line(open + 1 + entryInner.indexOf(rawKey)),
        code: 'citation_key_contains_invalid_characters',
      })
    }

    const fieldsStr = commaIdx === -1 ? '' : entryInner.slice(commaIdx + 1)
    const fields = topLevelFields(fieldsStr)
    const seen = new Set<string>()
    for (const { name, at } of fields) {
      if (seen.has(name)) {
        // Report the DUPLICATE (current) occurrence, not the first one.
        const offset = open + 1 + (commaIdx + 1) + at
        diagnostics.push({
          from: offset,
          entryFrom: entry.sourceStart,
          line: line(offset),
          code: 'bib_syntax_duplicate_field',
          field: name,
        })
      }
      seen.add(name)
    }
  }

  return diagnostics.sort((a, b) => a.from - b.from)
}

function findClosingBrace(source: string, openIdx: number): number {
  let depth = 0
  let inQuotes = false
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i]
    if (inQuotes) {
      if (ch === '\\') i++
      else if (ch === '"') inQuotes = false
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Human-readable label for one diagnostic (board #5).
 * `t` is the i18n translator; codes map to localized messages.
 */
export function diagnosticLabel(
  d: BibSourceDiagnostic,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  switch (d.code) {
    case 'bib_entry_unterminated':
      return t('An entry is not closed')
    case 'citation_key_contains_invalid_characters':
      return t('Citation key contains invalid characters')
    case 'bib_syntax_duplicate_field':
      return t('Field __field__ is set more than once', { field: d.field ?? '' })
    default:
      return d.code
  }
}

/** Attach diagnostics to closed entries by containment (offset in
 * [sourceStart, sourceEnd)). Unterminated entries (and anything else not
 * matched) return in `unattached`.
 */
export type BibEntryDiagnosticsMap = Map<
  object,
  ReadonlyArray<BibSourceDiagnostic>
>

export function attachDiagnostics(
  entries: ReadonlyArray<ParsedBibEntry>,
  diagnostics: ReadonlyArray<BibSourceDiagnostic>
): {
  byEntry: BibEntryDiagnosticsMap
  unattached: BibSourceDiagnostic[]
} {
  const byEntry: BibEntryDiagnosticsMap = new Map()
  const unattached: BibSourceDiagnostic[] = []
  for (const d of diagnostics) {
    const owner = entries.find(
      e => d.from >= e.sourceStart && d.from < e.sourceEnd
    )
    if (owner) {
      const list = byEntry.get(owner) ?? []
      list.push(d)
      byEntry.set(owner, list)
    } else {
      unattached.push(d)
    }
  }
  return { byEntry, unattached }
}

/**
 * Flatten { byEntry, unattached } to ONE flat diagnostic array (unattached
 * first). `byEntry` is a Map — `byEntry.values()` is an iterator without
 * `.flat()` (calling it crashes render; regression 2026-11-05).
 */
export function allDiagnostics(
  byEntry: BibEntryDiagnosticsMap,
  unattached: BibSourceDiagnostic[]
): BibSourceDiagnostic[] {
  return [...unattached, ...[...byEntry.values()].flat()]
}
