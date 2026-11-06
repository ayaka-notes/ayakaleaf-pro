/**
 * Library frontend pure model (LIBRARY_PLAN.md §5) — unit-tested, no React.
 *
 * Maps between the SaaS API entry shape
 *   `{key, type, fields: [{name, value}], _id, occurrenceIndex, updatedAt}`
 * (LIBRARY_PLAN.md §1.1, D-C1) and the module's `BibEntry`
 * `{type, id, fields: {name: value}}`, plus the client-side part of the
 * citation-key suggestion merge (the SaaS bundle does `base` +
 * server-returned keys + `extraTakenKeys` client-side — D-C1/R5).
 */
import type { BibEntry } from '../utils/bib-types'

/** One API field (D-C1: plain `value` string). */
export type LibraryFieldApi = {
  name: string
  value: string
}

/** One API entry (SaaS response shape; `editableValue` alias not used, D-C1). */
export type LibraryEntryApi = {
  key: string
  type: string
  fields: LibraryFieldApi[]
  /** Mongo _id (hex) — stable row identity (duplicate keys allowed) */
  _id: string
  occurrenceIndex: number
  updatedAt: string | null
  createdAt: string | null
}

/** API entry → module BibEntry (id = citation key, libId = Mongo _id so
 *  bulk selection/identity is the stable row id even for duplicate keys). */
export function apiToBibEntry(api: LibraryEntryApi): BibEntry {
  const fields: Record<string, string> = {}
  for (const field of api.fields ?? []) {
    if (field?.name) fields[field.name] = field.value ?? ''
  }
  return {
    type: api.type,
    id: api.key,
    fields,
    libId: api._id || undefined,
    updatedAt: api.updatedAt,
  }
}

/** Module BibEntry → API entry (ordered fields; keys in given field order). */
export function bibEntryToApi(
  entry: BibEntry,
  id: string | null = null
): LibraryEntryApi {
  return {
    key: entry.id,
    type: entry.type,
    fields: Object.entries(entry.fields ?? {}).map(([name, value]) => ({
      name,
      value: String(value ?? ''),
    })),
    _id: id ?? '',
    occurrenceIndex: 0,
    updatedAt: null,
    createdAt: null,
  }
}

/**
 * Deterministic client-side suggestion merge (SaaS semantics):
 * server keys in priority order, minus locally-taken keys (the FILE's keys
 * in an import flow, or other in-flight selections). Falls back to the
 * local pattern (base, baseb..basez, base2..) when the server list is
 * empty (offline/failed endpoint).
 */
export function pickSuggestedKey(
  base: string,
  serverKeys: string[],
  takenKeys: Set<string>
): string {
  const root = String(base ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!root) return ''
  const candidates: string[] = []
  for (const k of serverKeys) {
    const kk = String(k).trim()
    if (kk && !candidates.includes(kk)) candidates.push(kk)
  }
  if (candidates.length === 0) {
    candidates.push(root)
    for (const ch of 'bcdefghijklmnopqrstuvwxyz') candidates.push(`${root}${ch}`)
    for (let n = 2; n < 1000; n++) candidates.push(`${root}${n}`)
  }
  for (const key of candidates) {
    if (!takenKeys.has(key)) return key
  }
  return candidates[candidates.length - 1] || root
}

/**
 * Normalize a list of API entries into stable list rows for React
 * (rowId = _id when present, else citation key — duplicate-key rows keep
 * distinct row ids via occurrence).
 */
export type LibraryRow = {
  rowId: string
  entry: BibEntry
  api: LibraryEntryApi
}

export function toRows(apiEntries: LibraryEntryApi[]): LibraryRow[] {
  return (apiEntries ?? []).map(api => ({
    rowId: api._id || `${api.key}#${api.occurrenceIndex}`,
    entry: apiToBibEntry(api),
    api,
  }))
}

/**
 * Search filtering (client-side, for the loaded page): the SAME
 * normalization the server uses (NFD strip + fold map) so the visible
 * rows match the server's own results (no flicker on page loads).
 */
const FOLD_MAP: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ŋ: 'ng',
}
const FOLD_RE = /[æœøßłðþŋ]/g
const TOKEN_SPLIT_RE = /[\p{P}\s]+/u

export function normalizeSearchText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(FOLD_RE, ch => FOLD_MAP[ch] ?? ch)
}

export function tokenizeSearchQuery(text: string): string[] {
  return [
    ...new Set(
      normalizeSearchText(text)
        .split(TOKEN_SPLIT_RE)
        .filter(tok => tok.length > 0)
    ),
  ]
}

/** True when every query token is a substring of the entry's normalized text. */
export function entryMatchesQuery(entry: BibEntry, query: string): boolean {
  const tokens = tokenizeSearchQuery(query)
  if (tokens.length === 0) return true
  const hay = normalizeSearchText(
    [
      entry.id,
      entry.type,
      ...Object.keys(entry.fields ?? {}),
      ...Object.values(entry.fields ?? {}),
    ].join(' ')
  )
  return tokens.every(token => hay.includes(token))
}

/**
 * Duplicate-key detection within the loaded page (SaaS flags duplicates
 * with `bibtex_duplicates_keys`); returns the set of rowIds whose
 * citation key is used by more than one row on the page.
 */
export function duplicateKeyRowIds(rows: LibraryRow[]): Set<string> {
  const byKey = new Map<string, string[]>()
  for (const row of rows) {
    const key = row.entry.id
    if (!key) continue
    const list = byKey.get(key) ?? []
    list.push(row.rowId)
    byKey.set(key, list)
  }
  const dupes = new Set<string>()
  for (const list of byKey.values()) {
    if (list.length > 1) for (const id of list) dupes.add(id)
  }
  return dupes
}
