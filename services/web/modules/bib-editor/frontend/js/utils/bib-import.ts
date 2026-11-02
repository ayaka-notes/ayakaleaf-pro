/**
 * Paste-references import model (Phase C C5, PHASE_C_PLAN.md §1.6/§3-C5).
 *
 * Pure + unit-tested. The Paste flow:
 *   1. the user pastes a mix of BibTeX entry text and DOI lines;
 *   2. `splitImportText` (this file) parses the local parts in PASTE
 *      ORDER; each DOI line is resolved by the caller through the
 *      committed client-side `fetchEntryFromDoi` (OQ-8);
 *   3. a failed DOI resolution becomes an error ROW (the good entries
 *      still land);
 *   4. the preview modal lists the rows (capture
 *      `bibtex-import-preview-card`): citation-key checkbox, heading
 *      ("Ernst et al. (2007)" — humanizeCitationHeading), title line,
 *      type tag, and collision/error state (OQ-9: conflicts pre-unchecked);
 *   5. Import writes the checked rows through `planBibImport` (C5: one
 *      guarded, all-or-nothing append).
 */
import type { BibEntry } from './bib-types'
import { generateCitationKey, parseBibFile } from './bib-parser.ts'
import { humanizeCitationHeading } from './overleaf-type-map.ts'

/** One pasted "item", in paste order. */
export type BibImportItem =
  | { kind: 'bibtex'; entry: BibEntry; /** raw source text, when known */ raw?: string }
  | { kind: 'doi'; raw: string }
  | { kind: 'error'; raw: string }

/** A pasted `doi:` line, a bare `10.xxxx/...` DOI, or a DOI URL
 *  (https://doi.org/… — see normaliseDoi in doi-fetcher.ts). */
export function isDoiLine(line: string): boolean {
  const s = line.trim()
  if (/^doi:\s*\S/i.test(s)) return true
  if (/^(https?:\/\/)?(dx\.)?doi\.org\//i.test(s)) return true
  return /^10\.\d{4,9}\/\S+$/.test(s)
}

/**
 * Split the pasted text into items in paste order (no network here):
 *
 *  - a BibTeX entry block (a line starting with `@`, possibly spanning
 *    lines until its braces balance) → one item per parsed entry (a
 *    multi-entry paste yields multiple items, first-past first)
 *  - each `doi:` / bare DOI line → a 'doi' item the caller resolves via
 *    fetchEntryFromDoi; empty lines are dropped
 *  - anything else → an 'error' item (its text is shown in the preview)
 */
export function splitImportText(text: string): BibImportItem[] {
  const items: BibImportItem[] = []
  const lines = text.split(/\r?\n/)

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (trimmed === '') {
      i++
      continue
    }
    if (isDoiLine(trimmed)) {
      items.push({ kind: 'doi', raw: trimmed })
      i++
      continue
    }
    if (/^@/.test(trimmed)) {
      // Accumulate until the block balances (escaped braces count as pairs,
      // so they don't unbalance); a following new `@` or DOI line stops it
      // early (a broken block just parses to what it parses to).
      let block = lines[i]
      let j = i + 1
      while (j < lines.length && blockBraceDepth(block) > 0) {
        const next = lines[j].trim()
        if (/^@/.test(next) || isDoiLine(next)) break
        block += '\n' + lines[j]
        j++
      }
      const parsed = parseBibFile(block)
      if (parsed.length === 0) {
        items.push({ kind: 'error', raw: block.trim() })
      } else {
        for (const p of parsed) {
          items.push({
            kind: 'bibtex',
            entry: { type: p.type, id: p.id, fields: { ...p.fields } },
          })
        }
      }
      i = j
      continue
    }
    items.push({ kind: 'error', raw: lines[i] })
    i++
  }

  return items
}

function blockBraceDepth(s: string): number {
  // Escape-aware brace balance (a `\{` / `\}` pair does not unbalance).
  let depth = 0
  let escaped = false
  for (const c of s) {
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') escaped = true
    else if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
  }
  return depth
}

export type BibImportRow = {
  /** Stable row id for React keys */
  rowId: string
  /**
   * 'ok'       — BibTeX entry, importable
   * 'doi-ok'   — resolved from a DOI line (importable)
   * 'error'    — parse failure / failed DOI (NOT importable)
   * 'conflict' — key collides with the doc or another row (pre-unchecked;
   *               `kind: 'library'` marks keys already in the doc — the
   *               import card shows the "Already in your library" tag, and
   *               `kind: 'duplicate'` marks keys duplicated in the batch)
   * 'empty'    — transient: the DOI line is still resolving
   */
  status: 'ok' | 'doi-ok' | 'error' | 'conflict' | 'empty'
  /** Raw pasted line (error cards show it) */
  raw: string
  /** Parsed entry (ok/doi-ok rows) */
  entry: BibEntry | null
  /** Human error message ('error' rows) */
  error?: string
  /** Humanized heading ("Ernst et al. (2007)") */
  heading: string
  /** Title line (capture `-card-field`; empty → hidden) */
  title: string
  /** Type (capture `-card-tags` tag) */
  typeLabel: string
  /** Collision: the colliding key */
  conflictWith?: string
  /** Which conflict: 'library' = key in the document ("Already in your
      library" tag), 'duplicate' = key duplicated inside the batch */
  kind?: 'library' | 'duplicate'
}

/**
 * Assemble preview rows from split items + resolved DOIs. `doiResults` is
 * parallel to the paste-order DOI items: a string is a failure message, an
 * entry a success, `undefined` "still resolving" (a transient row).
 * Conflict flags (OQ-9) are applied to importable rows in order.
 */
export function buildImportRows(
  items: BibImportItem[],
  doiResults: (string | BibEntry | undefined)[],
  existingIds: string[]
): BibImportRow[] {
  const seen = new Set(existingIds)
  const rows: BibImportRow[] = []
  let doiIndex = 0
  let seq = 0
  for (const item of items) {
    const base: BibImportRow = {
      rowId: `import-${seq++}`,
      status: 'ok',
      raw: item.raw ?? '',
      entry: null,
      heading: '',
      title: '',
      typeLabel: '',
    }
    let row: BibImportRow
    switch (item.kind) {
      case 'bibtex': {
        const e = item.entry
        row = {
          ...base,
          raw: `@${e.type}{${e.id}`,
          entry: e,
          heading: humanizeCitationHeading(e.id, e.fields),
          title: e.fields.title?.trim() || '',
          typeLabel: e.type,
        }
        break
      }
      case 'doi': {
        const r = doiResults[doiIndex++]
        if (r === undefined) {
          row = { ...base, status: 'empty', raw: item.raw }
        } else if (typeof r === 'string') {
          row = { ...base, status: 'error', raw: item.raw, error: r }
        } else {
          const e = r
          row = {
            ...base,
            status: 'doi-ok',
            raw: item.raw,
            entry: e,
            heading: humanizeCitationHeading(e.id, e.fields),
            title: e.fields.title?.trim() || '',
            typeLabel: e.type,
          }
        }
        break
      }
      case 'error':
        row = {
          ...base,
          status: 'error',
          raw: item.raw,
          error: 'Could not parse this reference.',
        }
        break
    }
    // Conflict: importable row whose key is taken by the doc or an earlier
    // row (OQ-9 — the UI pre-unchecks these; the planner re-guards).
    if (row.entry !== null) {
      const id = row.entry.id.trim()
      if (id === '' || seen.has(id)) {
        row = {
          ...row,
          status: 'conflict',
          conflictWith: id === '' ? '(no citation key)' : id,
          kind: id !== '' && existingIds.includes(id) ? 'library' : 'duplicate',
        }
      } else {
        seen.add(id)
      }
    }
    rows.push(row)
  }
  return rows
}

/** The rows Import may write (the UI checks these; the planner re-guards). */
export function importableRows(rows: BibImportRow[]): BibEntry[] {
  return rows
    .filter((r): r is BibImportRow => {
      if (r.status === 'ok' || r.status === 'doi-ok') return true
      return false
    })
    .map(r => r.entry as BibEntry)
}

/** True when the preview has at least one resolvable row. */
export function hasImportableRows(rows: BibImportRow[]): boolean {
  return rows.some(r => r.status === 'ok' || r.status === 'doi-ok')
}

// ---------------------------------------------------------------------------
// ORCID import key normalisation (P2, BIB_ORCID_TEMPLATES_PLAN.md §2.3)
// ---------------------------------------------------------------------------

/** Library REST key charset (mirrors app/src/BibTypes.mjs). */
export const VALID_CITATION_KEY = /^[A-Za-z0-9._-]+$/
export const MAX_KEY_LENGTH = 128

function isValidKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY_LENGTH && VALID_CITATION_KEY.test(key)
}

/**
 * ORCID-embedded BibTeX sometimes carries machine-style keys that are not
 * legal citation keys (e.g. `https://doi.org/10.17613/...` — the library
 * REST layer rejects those with a 400). Normalise a batch of imported
 * entries: keep legal keys as-is, regenerate illegal ones from the
 * entry's own author/year/title (generateCitationKey always yields a key
 * in the legal charset), and de-duplicate within the batch. Pure and
 * side-effect free; returns new objects for changed entries only.
 */
export function normaliseOrcidEntryKeys(
  entries: BibEntry[]
): BibEntry[] {
  const seen = new Set<string>()
  return entries.map(entry => {
    let key = (entry.id || '').trim()
    if (!isValidKey(key)) {
      key = generateCitationKey(entry.fields || {})
    }
    if (!isValidKey(key)) {
      key = 'orcid'
    }
    let final = key
    let n = 2
    while (seen.has(final)) {
      final = `${key}${n}`
      n += 1
    }
    seen.add(final)
    return final === entry.id ? entry : { ...entry, id: final }
  })
}
