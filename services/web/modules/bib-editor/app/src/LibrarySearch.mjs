/**
 * Library search helpers (pure JS, no I/O).
 *
 * Machine-extracted from the reference bundle (`1_files/library-*.js`,
 * SaaS Library) — the exact normalization the SaaS library uses for
 * search:
 *
 *   fold map  = {æ→ae, œ→oe, ø→o, ß→ss, ł→l, đ→d, ð→d, þ→th, ŋ→ng}
 *   normalize = toLowerCase → NFD → strip \p{Mn} → fold map
 *   tokenize  = split normalized text on runs of punctuation/whitespace
 *               (\p{P}\s), de-duplicate, drop empties
 *
 * The stored `searchBlob` is the normalization of key + type + field
 * names + field values joined by spaces, so a query matches when EVERY
 * query token is a substring of the blob (case- and diacritic-insensitive,
 * e.g. "ernst" finds "Efficient … Ernst 2007"; "café"/"cafe" both match
 * "café").
 */

const FOLD_MAP = {
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

const FOLD_REGEX = new RegExp(
  `[${Object.keys(FOLD_MAP).join('')}]`,
  'g'
)
const PUNCT = String.raw`\p{P}\s`
const TOKEN_SPLIT_REGEX = new RegExp(`[${PUNCT}]+`, 'u')

/**
 * Normalize text for search: lowercase, strip diacritics (NFD + \p{Mn}),
 * then apply the SaaS fold map (covers the ligatures NFD does not split).
 */
export function normalizeSearchText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(FOLD_REGEX, ch => FOLD_MAP[ch] ?? ch)
}

/** Tokenize a query (normalized): unique tokens, order preserved. */
export function tokenizeSearchQuery(text) {
  return [
    ...new Set(
      normalizeSearchText(text)
        .split(TOKEN_SPLIT_REGEX)
        .filter(tok => tok.length > 0)
    ),
  ]
}

/**
 * Build the normalized search blob for an entry
 * `{key, type, fields: [{name, value}]}` (shape-agnostic: an array of
 * name/value pairs).
 */
export function entrySearchBlob(entry) {
  const parts = []
  const key = typeof entry.key === 'string' ? entry.key : ''
  const type = typeof entry.type === 'string' ? entry.type : ''
  if (key) parts.push(key)
  if (type) parts.push(type)
  const fields = Array.isArray(entry.fields) ? entry.fields : []
  for (const field of fields) {
    const name = typeof field?.name === 'string' ? field.name : ''
    const value = typeof field?.value === 'string' ? field.value : ''
    if (name) parts.push(name)
    if (value) parts.push(value)
  }
  return normalizeSearchText(parts.join(' '))
}

/**
 * True when EVERY query token occurs in the stored blob (substring
 * semantics on the normalized text). Empty query → true (match all).
 */
export function blobMatchesQuery(storedBlob, query) {
  const tokens = tokenizeSearchQuery(query)
  if (tokens.length === 0) return true
  const blob = typeof storedBlob === 'string' ? storedBlob : ''
  return tokens.every(token => blob.includes(token))
}

/** Escape a string for use inside a JavaScript RegExp literal (mongo $regex). */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
