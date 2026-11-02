/**
 * Library data access (all reads/writes Mongo-backed — no per-process
 * state; the two web workers are safe by construction, LIBRARY_PLAN.md
 * R4). API surface per LIBRARY_PLAN.md §4 (SaaS shapes, D-C1 field name).
 */
import Settings from '@overleaf/settings'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'
import { LibraryReference } from './models/LibraryReference.mjs'
import {
  entrySearchBlob,
  escapeRegex,
  tokenizeSearchQuery,
} from './LibrarySearch.mjs'
import {
  normalizeLibraryEntry,
  validateLibraryEntry,
  validateEntryBatch,
} from './BibTypes.mjs'

// NOTE: the core Mongoose wrapper's top-level `ObjectId` is the *schema*
// type (no `isValid`); the real BSON class lives on `mongoose.Types`.
const { ObjectId } = mongoose.Types
const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 200
const SUGGESTION_LIMIT = 10

/**
 * Mongoose 8 no longer exposes `ObjectId.isValid` — validate with the 24-hex
 * shape instead (ids only ever come to us as strings over the API).
 */
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i
function toObjectId(value) {
  if (typeof value !== 'string' || !OBJECT_ID_HEX.test(value)) return null
  try {
    return new ObjectId(value)
  } catch {
    return null
  }
}

/** Retention window for trashed references (default 30 days, overridable). */
export function trashRetentionMs() {
  const days = Settings.bibLibrary?.trashRetentionDays
  const parsed = Number(days)
  const safeDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 30
  return safeDays * 24 * 60 * 60 * 1000
}

/** Serialize one document to the API entry shape (SaaS, D-C1). */
function toApiEntry(doc, occurrenceIndex) {
  return {
    key: doc.key,
    type: doc.type,
    fields: (doc.fields || []).map(f => ({
      name: f.name,
      value: f.value ?? '',
    })),
    _id: doc._id ? String(doc._id) : '',
    occurrenceIndex,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
  }
}

/** Mongo predicate for a search query against the normalized blob. */
function searchPredicate(query) {
  const tokens = tokenizeSearchQuery(query)
  if (tokens.length === 0) return null
  return {
    $and: tokens.map(token => ({
      searchBlob: { $regex: escapeRegex(token) },
    })),
  }
}

/** Active vs trashed predicate. */
function trashedPredicate(trashed) {
  return trashed ? { trashedAt: { $ne: null } } : { trashedAt: null }
}

/**
 * Idempotent retention sweep (D-C6): trashed documents older than the
 * retention window are deleted. Safe to run on every handler; per-worker
 * safe because it derives from Mongo state.
 */
export async function purgeTrashedReferences(userId, now = new Date()) {
  const cutoff = new Date(now.getTime() - trashRetentionMs())
  const res = await LibraryReference.deleteMany({
    user_id: userId,
    trashedAt: { $ne: null, $lt: cutoff },
  })
  return res.deletedCount
}

/**
 * List entries (cursor-paged; SaaS response shape).
 * `cursor` = the `_id` (hex string) AFTER which to continue.
 */
export async function listReferenceEntries(
  userId,
  { search = null, trashed = false, cursor = null, limit = LIST_DEFAULT_LIMIT } = {}
) {
  await purgeTrashedReferences(userId)
  const clampedLimit = Math.min(
    Math.max(1, Math.floor(Number(limit) || LIST_DEFAULT_LIMIT)),
    LIST_MAX_LIMIT
  )
  const query = { user_id: userId, ...trashedPredicate(trashed) }
  if (search) {
    const predicate = searchPredicate(search)
    if (predicate) Object.assign(query, predicate)
  }
  if (cursor) {
    const cursorId = toObjectId(cursor)
    if (cursorId) query._id = { $gt: cursorId }
  }
  const docs = await LibraryReference.find(query)
    .sort({ _id: 1 })
    .limit(clampedLimit + 1)
    .exec()
  const hasMore = docs.length > clampedLimit
  const page = docs.slice(0, clampedLimit)
  const items = page.map((doc, i) => toApiEntry(doc, i))
  return {
    items,
    nextCursor: hasMore && page.length > 0 ? String(page[page.length - 1]._id) : null,
  }
}

/**
 * Bulk create (SaaS `POST /library/references` body `{entries}`).
 * Duplicate keys are allowed (SaaS); validation is per-entry (the first
 * failing reason wins — the controller maps it to a 400).
 */
export async function createReferenceEntries(userId, entries) {
  const check = validateEntryBatch(entries)
  if (!check.ok) {
    const err = new Error(check.reason)
    err.validationReason = check.reason
    throw err
  }
  const now = new Date()
  const docs = entries.map(entry => {
    const norm = normalizeLibraryEntry(entry)
    return {
      user_id: userId,
      key: norm.key,
      type: norm.type,
      fields: norm.fields,
      searchBlob: entrySearchBlob(norm),
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    }
  })
  const created = await LibraryReference.create(docs)
  return created.map((doc, i) => toApiEntry(doc, i))
}

/**
 * Which of the given keys already exist in the user's ACTIVE library
 * (SaaS `POST /library/references/match` → `{matches}`).
 */
export async function matchReferenceKeys(userId, entries) {
  const list = Array.isArray(entries) ? entries : []
  const keys = [
    ...new Set(
      list
        .map(e => (typeof e?.key === 'string' ? e.key.trim() : ''))
        .filter(k => k.length > 0)
    ),
  ]
  if (keys.length === 0) return []
  const found = await LibraryReference.find({
    user_id: userId,
    trashedAt: null,
    key: { $in: keys },
  })
    .select('key')
    .exec()
  const present = new Set(found.map(doc => doc.key))
  return keys.filter(k => present.has(k))
}

/**
 * Update one active entry by key (optionally rename).
 * `targetKey` = the (new) key; rename collision → `duplicate-key` error.
 */
export async function updateReferenceEntry(
  userId,
  originalKey,
  { key, type, fields }
) {
  const check = validateLibraryEntry({
    key: key ?? originalKey,
    type: type ?? '',
    fields,
  })
  if (!check.ok) {
    const err = new Error(check.reason)
    err.validationReason = check.reason
    throw err
  }
  const newKey = String(key ?? originalKey).trim()
  const doc = await LibraryReference.findOne({
    user_id: userId,
    key: originalKey,
    trashedAt: null,
  }).exec()
  if (!doc) {
    const err = new Error('not-found')
    err.notFound = true
    throw err
  }
  if (newKey !== originalKey) {
    const collision = await LibraryReference.findOne({
      user_id: userId,
      key: newKey,
      trashedAt: null,
      _id: { $ne: doc._id },
    }).exec()
    if (collision) {
      const err = new Error('duplicate-key')
      err.duplicateKey = newKey
      throw err
    }
  }
  const norm = normalizeLibraryEntry({
    key: newKey,
    type,
    fields,
  })
  doc.key = norm.key
  doc.type = norm.type
  doc.fields = norm.fields
  doc.searchBlob = entrySearchBlob(norm)
  doc.updatedAt = new Date()
  await doc.save()
  return toApiEntry(doc, 0)
}

/**
 * Delete (soft → trash by default, `permanent` → hard) by explicit ids or
 * by search (SaaS: `{ids?} | {search?}, permanent?`).
 */
export async function deleteReferenceEntries(
  userId,
  { ids = null, search = null, permanent = false } = {}
) {
  await purgeTrashedReferences(userId)
  const idList = Array.isArray(ids) ? ids.filter(s => typeof s === 'string' && s) : []
  if (idList.length > 0) {
    const validIds = idList.map(toObjectId).filter(Boolean)
    if (validIds.length === 0) return 0
    const query = {
      user_id: userId,
      trashedAt: null,
      _id: { $in: validIds },
    }
    if (permanent) {
      const res = await LibraryReference.deleteMany(query).exec()
      return res.deletedCount
    }
    const res = await LibraryReference.updateMany(
      query,
      { $set: { trashedAt: new Date() } }
    ).exec()
    return res.modifiedCount
  }
  if (search) {
    const predicate = searchPredicate(search)
    if (!predicate) return 0
    const query = { user_id: userId, trashedAt: null, ...predicate }
    if (permanent) {
      const res = await LibraryReference.deleteMany(query).exec()
      return res.deletedCount
    }
    const res = await LibraryReference.updateMany(
      query,
      { $set: { trashedAt: new Date() } }
    ).exec()
    return res.modifiedCount
  }
  const err = new Error('nothing-to-delete')
  err.validationReason = 'nothing-to-delete'
  throw err
}

/** Restore trashed entries by ids (SaaS `{ids}` → `{restoredCount}`). */
export async function restoreReferenceEntries(userId, ids = null) {
  const idList = Array.isArray(ids) ? ids.filter(s => typeof s === 'string' && s) : []
  if (idList.length === 0) return 0
  const validIds = idList.map(toObjectId).filter(Boolean)
  if (validIds.length === 0) return 0
  const res = await LibraryReference.updateMany(
    {
      user_id: userId,
      trashedAt: { $ne: null },
      _id: { $in: validIds },
    },
    { $set: { trashedAt: null, updatedAt: new Date() } }
  ).exec()
  return res.modifiedCount
}

/** Count (SaaS `{count}`). */
export async function countReferenceEntries(
  userId,
  { search = null, trashed = false } = {}
) {
  const query = { user_id: userId, ...trashedPredicate(trashed) }
  if (search) {
    const predicate = searchPredicate(search)
    if (predicate) Object.assign(query, predicate)
  }
  return LibraryReference.countDocuments(query).exec()
}

/**
 * Download set (SaaS `?mode=&search=&ids=`).
 *  - inclusion (default): ids, else search-matching actives
 *  - exclusion: actives NOT matching the search
 * Returns the API entries in list order (the controller serializes).
 */
export async function downloadReferenceEntries(
  userId,
  { mode = 'inclusion', search = null, ids = null } = {}
) {
  const idList = Array.isArray(ids) ? ids.filter(s => typeof s === 'string' && s) : []
  const validIds = idList.map(toObjectId).filter(Boolean)

  let query = { user_id: userId, trashedAt: null }
  if (mode === 'exclusion' && search) {
    const tokens = tokenizeSearchQuery(search)
    if (tokens.length > 0) {
      query = {
        user_id: userId,
        trashedAt: null,
        $nor: tokens.map(token => ({
          searchBlob: { $regex: escapeRegex(token) },
        })),
      }
    }
  } else if (validIds.length > 0) {
    query._id = { $in: validIds }
  } else if (search) {
    const predicate = searchPredicate(search)
    if (predicate) Object.assign(query, predicate)
  }
  const docs = await LibraryReference.find(query)
    .sort({ _id: 1 })
    .limit(LIST_MAX_LIMIT)
    .exec()
  return docs.map((doc, i) => toApiEntry(doc, i))
}

/**
 * Citation-key suggestions (SaaS
 * `GET /library/references/citation-key-suggestions?base=`): candidates in
 * priority order (base, baseb..basez, base2..base999) minus the user's
 * ACTIVE keys. Client filters against its own (file) keys — SaaS does the
 * same (`extraTakenKeys` merge, machine-extracted).
 */
export async function citationKeySuggestions(userId, base, { extra = [] } = {}) {
  const root = sanitizeKeyBase(base)
  if (!root) return []
  const taken = new Set(
    (Array.isArray(extra) ? extra : []).map(k => String(k).trim()).filter(Boolean)
  )
  const candidates = [root]
  for (const ch of 'bcdefghijklmnopqrstuvwxyz') candidates.push(`${root}${ch}`)
  for (let n = 2; n < 1000; n++) candidates.push(`${root}${n}`)

  const found = await LibraryReference.find({
    user_id: userId,
    trashedAt: null,
    key: { $in: candidates },
  })
    .select('key')
    .exec()
  for (const doc of found) taken.add(doc.key)
  const available = candidates.filter(k => !taken.has(k))
  return available.slice(0, SUGGESTION_LIMIT)
}

/** Alphanumeric-only key base (SaaS-generated keys are [a-z0-9]). */
function sanitizeKeyBase(base) {
  return String(base ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 64)
}
