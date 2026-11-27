/**
 * Shared Library vocabulary + validation (pure JS, no I/O).
 *
 * The 48-type vocabulary mirrors the frontend `OVERLEAF_TYPES` (C1,
 * `frontend/js/utils/overleaf-type-map.ts`) — it is data, not code; the two
 * lists must stay in sync (they both derive from the overleaf.com
 * reference). Validation here is the API's single gate for entry shapes
 * (LIBRARY_PLAN.md §3/§4, D-C1 field shape `{name, value}`).
 */

/** The 48 supported BibTeX entry types (overleaf.com reference vocabulary). */
export const BIB_TYPES = [
  'article',
  'artwork',
  'audio',
  'book',
  'bookinbook',
  'booklet',
  'commentary',
  'conference',
  'collection',
  'dataset',
  'electronic',
  'image',
  'inbook',
  'incollection',
  'inproceedings',
  'inreference',
  'jurisdiction',
  'legal',
  'legislation',
  'letter',
  'manual',
  'mastersthesis',
  'misc',
  'movie',
  'mvbook',
  'mvcollection',
  'mvproceedings',
  'mvreference',
  'music',
  'online',
  'patent',
  'performance',
  'periodical',
  'phdthesis',
  'proceedings',
  'reference',
  'report',
  'review',
  'software',
  'standard',
  'suppbook',
  'suppcollection',
  'suppperiodical',
  'techreport',
  'thesis',
  'unpublished',
  'video',
  'www',
]

export const BIB_TYPE_SET = new Set(BIB_TYPES)

/**
 * Citation-key charset: letters, digits, dot, underscore, dash
 * (reference helper: "Unique key for citations, no spaces or special
 * characters").
 */
export const CITATION_KEY_REGEX = /^[A-Za-z0-9._-]+$/

export const FIELD_NAME_REGEX = /^[a-z][a-z0-9-]*$/

const MAX_ENTRY_COUNT = 200 // one batch (paste/upload/manual)
const MAX_FIELDS_PER_ENTRY = 200
const MAX_FIELD_LENGTH = 32768 // values (abstract etc.)
const MAX_KEY_LENGTH = 128
const MAX_TYPE_LENGTH = 64
const MAX_FIELD_NAME_LENGTH = 64

/**
 * Validate one API entry `{key, type, fields: [{name, value}]}`.
 * Returns `{ ok: true }` or `{ ok: false, reason }` — reasons are stable
 * strings the controller maps to 400 messages.
 */
export function validateLibraryEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, reason: 'entry-not-object' }
  }
  const key = typeof entry.key === 'string' ? entry.key.trim() : ''
  if (key.length === 0) {
    return { ok: false, reason: 'key-missing' }
  }
  if (key.length > MAX_KEY_LENGTH) {
    return { ok: false, reason: 'key-too-long' }
  }
  if (!CITATION_KEY_REGEX.test(key)) {
    return { ok: false, reason: 'key-invalid' }
  }
  const type =
    typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : ''
  if (type.length === 0 || type.length > MAX_TYPE_LENGTH) {
    return { ok: false, reason: 'type-invalid' }
  }
  if (!BIB_TYPE_SET.has(type)) {
    return { ok: false, reason: 'type-unknown' }
  }
  if (entry.fields !== undefined && entry.fields !== null) {
    if (!Array.isArray(entry.fields)) {
      return { ok: false, reason: 'fields-not-array' }
    }
    if (entry.fields.length > MAX_FIELDS_PER_ENTRY) {
      return { ok: false, reason: 'fields-too-many' }
    }
    for (const field of entry.fields) {
      if (
        field === null ||
        typeof field !== 'object' ||
        Array.isArray(field)
      ) {
        return { ok: false, reason: 'field-not-object' }
      }
      const name =
        typeof field.name === 'string' ? field.name.trim().toLowerCase() : ''
      if (name.length === 0 || name.length > MAX_FIELD_NAME_LENGTH) {
        return { ok: false, reason: 'field-name-invalid' }
      }
      if (!FIELD_NAME_REGEX.test(name)) {
        return { ok: false, reason: 'field-name-invalid' }
      }
      if (field.value === null || field.value === undefined) {
        // null/absent value = empty (allowed)
      } else if (typeof field.value !== 'string') {
        return { ok: false, reason: 'field-value-not-string' }
      } else if (field.value.length > MAX_FIELD_LENGTH) {
        return { ok: false, reason: 'field-value-too-long' }
      }
    }
  }
  return { ok: true }
}

/** Validate a batch (list endpoints accept `{entries: [...]}`). */
export function validateEntryBatch(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, reason: 'entries-missing' }
  }
  if (entries.length > MAX_ENTRY_COUNT) {
    return { ok: false, reason: 'entries-too-many' }
  }
  for (const entry of entries) {
    const check = validateLibraryEntry(entry)
    if (!check.ok) return check
  }
  return { ok: true }
}

/**
 * Normalize an API entry into the storage shape (ordered, trimmed,
 * lower-cased names; LAST duplicate wins — BibTeX semantics, matches the
 * in-project editor's parser; an empty value removes the field — "empty
 * field is absent" convention).
 */
export function normalizeLibraryEntry(entry) {
  const map = new Map()
  const raw = Array.isArray(entry.fields) ? entry.fields : []
  for (const field of raw) {
    if (field === null || typeof field !== 'object' || Array.isArray(field)) {
      continue
    }
    const name = String(field.name ?? '').trim().toLowerCase()
    if (name === '' || !FIELD_NAME_REGEX.test(name)) continue
    const value =
      typeof field.value === 'string' ? field.value.trim() : ''
    if (value === '') {
      map.delete(name) // empty removes (last-wins, including emptying)
    } else {
      map.set(name, value)
    }
  }
  return {
    key: String(entry.key).trim(),
    type: String(entry.type).trim().toLowerCase(),
    fields: [...map.entries()].map(([name, value]) => ({ name, value })),
  }
}
