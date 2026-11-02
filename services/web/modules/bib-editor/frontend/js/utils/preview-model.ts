/**
 * C4 preview-panel model (PHASE_C_PLAN.md §1.4/§3-C4) — pure, unit-tested.
 *
 * The preview panel is a view over the current parsed `entries` list: no
 * document state, just indices into it. These helpers keep the panel
 * component thin and the edge cases (wrap, empty list, bulk selection,
 * required-missing labels, humanized summary, download filename) unit
 * testable without a DOM.
 *
 * Field labels are DATA (captured overleaf.com strings), not i18n — same
 * decision as the C1 type labels and the form's FIELD_DISPLAY_LABELS.
 */
import type { ParsedBibEntry } from './bib-parser'
import type { BibEntry } from './bib-types'
import {
  getEntryType,
  getMissingRequiredFields,
  type RequiredFieldConstraint,
} from './bib-types'

/** Flat, order-preserving required members (OR-groups expanded). */
export function requiredFlatList(
  requiredFields: RequiredFieldConstraint[]
): string[] {
  const out: string[] = []
  for (const f of requiredFields) {
    for (const m of (Array.isArray(f) ? f : [f])) {
      if (!out.includes(m)) out.push(m)
    }
  }
  return out
}

/**
 * Display label for a known biblatex field name (DATA — same captured
 * labels as the C2 form's FIELD_DISPLAY_LABELS; fallback: capitalized
 * snake-to-words). e.g. `journaltitle` → "Journal title".
 */
export function previewFieldLabel(name: string): string {
  const known: Record<string, string> = {
    author: 'Author',
    editor: 'Editor',
    title: 'Title',
    subtitle: 'Subtitle',
    titleaddon: 'Title addon',
    journal: 'Journal',
    journaltitle: 'Journal title',
    year: 'Year',
    date: 'Date',
    publisher: 'Publisher',
    booktitle: 'Book title',
    chapter: 'Chapter',
    pages: 'Pages',
    institution: 'Institution',
    school: 'School',
    number: 'Number',
    type: 'Type',
    note: 'Note',
    doi: 'DOI',
    eprint: 'Eprint',
    url: 'URL',
    language: 'Language',
    volume: 'Volume',
    volumes: 'Volumes',
    edition: 'Edition',
    abstract: 'Abstract',
    series: 'Series',
    address: 'Address',
    location: 'Location',
    organization: 'Organization',
  }
  if (known[name]) return known[name]
  return name
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * The required field names shown in the preview warning
 * (capture: "Required fields missing" + "Author, Title, Journal, Year").
 * OR-groups list every empty member (an empty [author, editor] group shows
 * "Author, Editor"); valued members are omitted.
 */
export function missingRequiredLabels(
  entryType: string,
  fields: Record<string, string>
): string[] {
  const typeDef = getEntryType(entryType)
  if (!typeDef) return []
  const missing = getMissingRequiredFields(typeDef.requiredFields, fields)
  // Expand OR-groups into their empty members (in order).
  const flat: string[] = []
  for (const req of missing) {
    const members = Array.isArray(req) ? req : [req]
    for (const m of members) flat.push(m)
  }
  return [...new Set(flat)].map(previewFieldLabel)
}

type NamedEntry = { id: string; type: string; fields: Record<string, string> }

/**
 * Previous entry in the current parse list, wrapping to the last entry from
 * index 0 (cycle: prev → next around the same entry must be back).
 * Returns null for an empty list.
 */
export function prevEntry<T extends NamedEntry>(
  entries: readonly T[],
  index: number
): T | null {
  if (entries.length === 0) return null
  return entries[(index - 1 + entries.length) % entries.length]
}

/**
 * Next entry in the current parse list, wrapping to the first entry from
 * the last one (cycle invariant: next then prev around the same entry is
 * back). Returns null for an empty list.
 */
export function nextEntry<T extends NamedEntry>(
  entries: readonly T[],
  index: number
): T | null {
  if (entries.length === 0) return null
  return entries[(index + 1) % entries.length]
}

/** Whether the prev/next nav buttons are enabled (≥2 entries). */
export function navEnabled(entries: NamedEntry[]): boolean {
  return entries.length >= 2
}

/**
 * The select-all "all rows" state (C3 bulk bar): checked when every visible
 * row is selected and at least one exists.
 */
export function allRowsSelected(
  rows: NamedEntry[],
  selectedIds: string[]
): boolean {
  return (
    rows.length > 0 &&
    rows.every(row => selectedIds.includes(row.id)) &&
    selectedIds.length > 0
  )
}

/** A "new" (type-only, no key/fields) entry materializes nothing (§2.3). */
export function isTypeOnlyDraft(entry: NamedEntry): boolean {
  return entry.id.trim() === '' && Object.keys(entry.fields).length === 0
}

/**
 * Bulk-delete selection for the current source (guarded on the extension
 * side like every other W5 write): only ids that still resolve in the
 * current parse list (stale selections after external edits are dropped).
 * An empty result is a deliberate no-op (the extension skips zero-change
 * plans).
 */
export function bulkDeleteIds(
  entries: ParsedBibEntry[],
  selectedIds: string[]
): string[] {
  const present = new Set(entries.map(e => e.id))
  return selectedIds.filter(id => present.has(id))
}

/**
 * The preview summary rows (capture `bibtex-entry-preview-summary-title` /
 * `-meta`):
 *   title = fields.title (row hidden when empty; the capture's empty entry
 *           shows neither row)
 *   who   = "Last et al." (author/editor ONLY — no year; no citation-key
 *           fallback — the capture's empty entry has no meta row)
 *   year  = year=, or the leading 4 digits of date= (biblatex "2007-05")
 * Returns null when all three are empty.
 */
export function previewSummary(
  fields: Record<string, string>
): { title: string; who: string; year: string } | null {
  const who = citationAttribution(fields)
  const year = yearOf(fields)
  const title = fields.title?.trim() || ''
  if (!title && !who && !year) return null
  return { title, who, year }
}

/** The "Last et al." (no year) attribution from the first author/editor. */
export function citationAttribution(
  fields: Record<string, string>
): string {
  const people = (fields.author?.trim() || fields.editor?.trim() || '')
  const authors = people
    .split(/\s+and\s+/i)
    .map(a => a.trim())
    .filter(Boolean)
  if (authors.length === 0) return ''
  const first = authors[0]
  const hasComma = first.includes(',')
  const surname = hasComma
    ? (first.split(',')[0] || '').trim() || first
    : first.lastIndexOf(' ') >= 0
      ? first.slice(first.lastIndexOf(' ') + 1).trim()
      : first
  return authors.length > 1 ? `${surname} et al.` : surname
}

export function yearOf(fields: Record<string, string>): string {
  const y = fields.year?.trim() || ''
  if (y) return y
  const date = fields.date?.trim() || ''
  const m = date.match(/^(\d{4})(?:[-.].*)?$/)
  return m ? m[1] : ''
}

/** Whole-file download filename (OQ-6: Download = the whole .bib file). */
export function downloadBibFilename(openDocName: string): string {
  const name = (openDocName || '').trim()
  return name.endsWith('.bib') ? name : `${name || 'bibliography'}.bib`
}

/**
 * D15 (search scope) — the row's searchable text, per the reference:
 * the citation key, title, author, editor, year, and venue
 * (journal/journaltitle/booktitle). Empty query matches everything.
 */
export function matchesSearch(entry: BibEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  const f = entry.fields
  const venue = f.journal || f.journaltitle || f.booktitle || ''
  return [
    entry.id,
    f.title || '',
    f.author || '',
    f.editor || '',
    f.year || '',
    venue,
  ].some(s => s.toLowerCase().includes(q))
}

/**
 * D15 (search scope) — split `text` into alternating plain/match segments
 * for the (case-insensitive) `query`, so the row can wrap matches in
 * `<mark>` (capture `.bibtex-entry-card-key mark{padding:0}`).
 * Non-query input → a single plain segment; empty text → no segments.
 */
export function splitHighlighted(
  text: string,
  query: string
): { text: string; match: boolean }[] {
  const needle = query.trim().toLowerCase()
  if (text === '') return []
  if (needle === '') return [{ text, match: false }]
  const segments: { text: string; match: boolean }[] = []
  const lower = text.toLowerCase()
  let pos = 0
  while (pos <= lower.length) {
    const idx = lower.indexOf(needle, pos)
    if (idx === -1) break
    if (idx > pos) segments.push({ text: text.slice(pos, idx), match: false })
    segments.push({ text: text.slice(idx, idx + needle.length), match: true })
    pos = idx + needle.length
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), match: false })
  return segments
}
