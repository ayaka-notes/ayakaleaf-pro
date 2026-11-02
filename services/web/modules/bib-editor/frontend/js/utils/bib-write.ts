/**
 * Pure write planning for the "file is truth" write path (plan §2.2 / R2).
 *
 * All functions here take the *current* document source and an entry to
 * write, and return a concrete write plan (a range to replace, or an append
 * position) or a guard error. Nothing here touches the DOM, React state, or
 * the editor — the CodeMirror extension and the context apply the plan.
 *
 * This kills the stale-offset bug: ranges are always recomputed against the
 * source we are about to write to, and clamped when they are no longer valid.
 */
import { parseBibFile } from './bib-parser'
import type { BibEntry } from './bib-types'

export type BibWritePlan = {
  kind: 'replace' | 'append'
  /** inclusive start offset */
  from: number
  /** exclusive end offset (=== from for append) */
  to: number
  /** text to splice in between from and to */
  insert: string
  /** true when the plan had to be clamped to stay valid */
  clamped: boolean
}

export type BibWriteGuard =
  | { ok: true; plan: BibWritePlan }
  | { ok: false; reason: string }

/**
 * Serialize a BibEntry to a BibTeX string.
 *
 * Kept here (and re-exported from bib-parser for the write path) so that the
 * write planner and the parser share one formatter. `escapeBibValue` is
 * idempotent so double-escaping never happens.
 */
export { serializeBibEntry } from './bib-parser'

export const KEY_TAKEN_REASON = 'key-taken'
const NOT_A_BIB_REASON = 'not-a-bib-file'
const ENTRY_GONE_REASON = 'entry-gone'

/**
 * True when the document is the bibliography the panel is bound to (a .bib
 * file with at least one entry, or an empty .bib that may gain its first
 * entry). Used by the extension to gate writes and avoid corrupting a
 * different / closed document.
 */
export function isBibDocument(source: string): boolean {
  // matches the extension's detectBibFile heuristic (first 2k chars)
  const sample = source.slice(0, Math.min(source.length, 2000))
  return /@\s*[\w-]+\s*\{/i.test(sample)
}

/**
 * Plan a write of a single entry against the *current* source.
 *
 * mode 'existing': the entry id must resolve to exactly one parsed entry; the
 * plan replaces that entry's range. When the form renames the citation key
 * (originalId differs from entry.id) the new id must not collide with a
 * different entry ('key-taken').
 *
 * mode 'new': the entry is appended at the end of the source.
 *
 * In both modes the range is clamped into [0, source.length] and `clamped`
 * is set true. A clamped plan is safe to apply; it can only never be larger
 * than the document.
 */
export function planBibWrite(
  source: string,
  entry: BibEntry,
  mode: 'existing' | 'new',
  serialize: (entry: BibEntry) => string,
  originalId?: string
): BibWriteGuard {
  if (!isBibDocument(source) && mode === 'existing') {
    return { ok: false, reason: NOT_A_BIB_REASON }
  }

  if (mode === 'existing') {
    const entries = parseBibFile(source)
    // Anchor on the ORIGINAL key when given (a renamed entry is not resolved
    // by its new key — the parsed doc does not contain it yet).
    const anchorId = originalId ?? entry.id
    const own = entries.filter(
      e => e.id === anchorId && e.type.toLowerCase() === (entry.type || '').toLowerCase()
    )
    if (own.length !== 1) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    // Renamed key: reject when the new key is already taken by a
    // DIFFERENT entry (form collision guard, plan §2.2).
    if (originalId && entry.id !== originalId) {
      const clash = entries.find(e => e.id === entry.id && e !== own[0])
      if (clash) {
        return { ok: false, reason: KEY_TAKEN_REASON }
      }
    }
    const { sourceStart, sourceEnd } = own[0]
    const from = Math.max(0, Math.min(sourceStart, source.length))
    const to = Math.max(0, Math.min(sourceEnd, source.length))
    return {
      ok: true,
      plan: {
        kind: 'replace',
        from,
        to,
        insert: serialize(entry),
        clamped: from !== sourceStart || to !== sourceEnd,
      },
    }
  }

  // 'new': append at the end, surrounded by newlines so entries stay on
  // their own lines.
  const insert =
    source.endsWith('\n') || source.length === 0 ? serialize(entry) : `\n${serialize(entry)}`
  return {
    ok: true,
    plan: { kind: 'append', from: source.length, to: source.length, insert, clamped: false },
  }
}

/**
 * Delete an entry from a source by id. Returns guard + plan (removal) or a
 * guard reason when it is not present.
 */
export function planBibDelete(
  source: string,
  entryId: string
): BibWriteGuard {
  if (!isBibDocument(source)) {
    return { ok: false, reason: NOT_A_BIB_REASON }
  }
  const entries = parseBibFile(source)
  const match = entries.filter(e => e.id === entryId)
  if (match.length !== 1) {
    return { ok: false, reason: ENTRY_GONE_REASON }
  }
  const { sourceStart, sourceEnd } = match[0]
  // consume trailing newlines so we don't leave blank lines
  let end = sourceEnd
  while (
    end < source.length &&
    (source[end] === '\n' || source[end] === '\r')
  ) {
    end++
  }
  return {
    ok: true,
    plan: {
      kind: 'replace',
      from: sourceStart,
      to: end,
      insert: '',
      clamped: false,
    },
  }
}

export type BibBulkDeleteGuard =
  | { ok: true; changes: { from: number; to: number; insert: string }[] }
  | { ok: false; reason: string }

/**
 * Plan a bulk delete of several entries against the *current* source (Phase
 * B W5). The guard is ALL-OR-NOTHING: when ANY id is missing from the
 * fresh parse, the WHOLE op is rejected (no partial deletes). On success the
 * changes are sorted ascending and applied as a single CodeMirror dispatch.
 * Duplicate ids in `entryIds` are deduplicated (a card can't be picked
 * twice, but the planner must stay pure+safe).
 */
export function planBibBulkDelete(
  source: string,
  entryIds: string[]
): BibBulkDeleteGuard {
  if (!isBibDocument(source)) {
    return { ok: false, reason: NOT_A_BIB_REASON }
  }
  const unique = [...new Set(entryIds)]
  if (unique.length === 0) {
    // An empty selection is a no-op (zero changes); the caller simply
    // doesn't dispatch.
    return { ok: true, changes: [] }
  }
  const entries = parseBibFile(source)
  const ranges: { from: number; to: number }[] = []
  for (const id of unique) {
    const match = entries.filter(e => e.id === id)
    if (match.length !== 1) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    const { sourceStart, sourceEnd } = match[0]
    // consume trailing newlines so we don't leave blank lines (same as the
    // single planner)
    let end = sourceEnd
    while (
      end < source.length &&
      (source[end] === '\n' || source[end] === '\r')
    ) {
      end++
    }
    ranges.push({ from: sourceStart, to: end })
  }
  ranges.sort((a, b) => a.from - b.from)
  // Defensive: distinct ids have distinct, non-overlapping parser ranges.
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].from < ranges[i - 1].to) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
  }
  return {
    ok: true,
    changes: ranges.map(r => ({ from: r.from, to: r.to, insert: '' })),
  }
}

export type BibImportInsert = {
  from: number
  to: number
  insert: string
}

export type BibImportGuard =
  | { ok: true; changes: BibImportInsert[] }
  | { ok: false; reason: string }

const KEY_CONFLICT_REASON = 'key-conflict'

/**
 * Plan a multi-entry import (C5 "Paste references"): append N entries as
 * ONE guarded, all-or-nothing write at the end of the current source.
 *
 * The guard is the same family as planBibWrite (guarded on
 * `expectedSource` by the extension) plus the import-specific rejection:
 * ANY entry whose citation key is not non-empty and unique within the
 * import AND the current document is a `key-conflict` (all-or-nothing — the
 * preview step pre-unchecks conflicts, so a conflict here means the user
 * re-checked one after the source changed).
 *
 * Insert layout is byte-compatible with successive single-appends
 * (planBibWrite 'new'): a leading separator newline is inserted only when
 * the source is non-empty and does not already end with one.
 */
export function planBibImport(
  source: string,
  entries: BibEntry[],
  serialize: (entry: BibEntry) => string
): BibImportGuard {
  if (!isBibDocument(source)) {
    return { ok: false, reason: NOT_A_BIB_REASON }
  }
  if (entries.length === 0) {
    return { ok: true, changes: [] }
  }
  const existingKeys = parseBibFile(source).map(e => e.id)
  const seen = new Set<string>()
  const body: string[] = []
  for (const entry of entries) {
    const id = (entry.id || '').trim()
    if (id === '') {
      // A keyless paste/imported entry must materialize with a key —
      // nothing else is importable.
      return { ok: false, reason: KEY_CONFLICT_REASON }
    }
    if (seen.has(id)) {
      return { ok: false, reason: KEY_CONFLICT_REASON }
    }
    seen.add(id)
    if (existingKeys.includes(id)) {
      return { ok: false, reason: KEY_CONFLICT_REASON }
    }
    body.push(serialize(entry))
  }
  // SerializeBibOutput ends every entry in exactly one '\n'; entries stay
  // adjacent inside the append, and the leading '\n' separates the batch
  // from the document's last line (mirror of planBibWrite 'new').
  const insert =
    source.length === 0 || source.endsWith('\n')
      ? body.join('')
      : `\n${body.join('')}`
  return {
    ok: true,
    changes: [{ from: source.length, to: source.length, insert }],
  }
}
