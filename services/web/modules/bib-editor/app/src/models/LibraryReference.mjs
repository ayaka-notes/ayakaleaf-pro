/**
 * Per-user Library reference document (LIBRARY_PLAN.md §3).
 *
 * Pattern: module-local mongoose model created at import time
 * (`modules/template-gallery` precedent); the `mongoose.models[...] ||`
 * guard makes double-import safe (R3). All documents are scoped to
 * `user_id`; duplicate citation keys are ALLOWED (SaaS: flagged with a
 * warning, not rejected — non-unique index below).
 *
 * Trash = soft delete (`trashedAt` set); retention (default 30 days) is
 * enforced by an idempotent lazy purge in LibraryManager (D-C6 — safe
 * across the two web workers because the decision is derived from Mongo
 * state, never process memory).
 */
import mongoose from '../../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose

export const LibraryReferenceSchema = new Schema(
  {
    // Core-model convention: plain string user id (like Tag/Oauth*).
    user_id: { type: String, required: true },
    /** Citation key (unique per user only among ACTIVE refs in practice;
     *  the index is non-unique on purpose — SaaS allows duplicates and
     *  warns about them). */
    key: { type: String, required: true },
    /** One of the 48 BibTypes (BibTypes.mjs). */
    type: { type: String, required: true },
    /** Ordered field list (D-C1: plain `value` strings). */
    fields: {
      type: [
        {
          _id: false,
          name: { type: String, required: true },
          value: { type: String, default: '' },
        },
      ],
      default: [],
    },
    /** Normalized (diacritic-folded, lowercased) search text over
     *  key + type + field names + field values — LibrarySearch. */
    searchBlob: { type: String, default: '' },
    /** Soft delete; null while active. */
    trashedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false }
)

// Non-unique (duplicate keys allowed, SaaS-parity); fast lookups by key.
LibraryReferenceSchema.index({ user_id: 1, key: 1 })
// List ordering (insertion order — ObjectId is time-ordered) scoped by
// user + trashed state.
LibraryReferenceSchema.index({ user_id: 1, trashedAt: 1 })

export const LibraryReference =
  mongoose.models['LibraryReference'] ||
  mongoose.model('LibraryReference', LibraryReferenceSchema)
