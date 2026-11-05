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
import { parseBibFile, escapeBibValue } from './bib-parser'
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
  if (match.length === 0) {
    return { ok: false, reason: ENTRY_GONE_REASON }
  }
  if (match.length > 1) {
    // The selection model addresses entries by key, so a single-row delete
    // cannot say WHICH occurrence is meant. Reject with an honest reason
    // (the UI explains bulk delete removes all occurrences).
    return { ok: false, reason: 'duplicate-key' }
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
 * Plan a bulk delete of several entries against the *current* source
 * (Phase B W5). The guard is ALL-OR-NOTHING over PRESENCE: when ANY id is
 * missing from the fresh parse, the WHOLE op is rejected (no partial
 * deletes). An id shared by several rows deletes ALL of its occurrences —
 * consistent with the checkbox model, where every row with that key is
 * checked at once and no row can be picked in isolation. On success the
 * changes are sorted ascending and applied as a single CodeMirror
 * dispatch. Duplicate ids in `entryIds` are deduplicated.
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
    if (match.length === 0) {
      return { ok: false, reason: ENTRY_GONE_REASON }
    }
    // Every occurrence of the id is part of the selection.
    for (const m of match) {
      const { sourceStart, sourceEnd } = m
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

// ─────────────────────────────────────────────────────────────────────
// Surgical edits (board #6): rewrite ONLY the regions that actually
// changed (citation key, entry type, changed/added/removed fields) and
// preserve every other byte of the entry — sibling field ordering,
// spacing, inline comments, unusual-but-valid value quoting. Full
// re-serialization (planBibWrite) is retained as a fallback for entries
// the scanner cannot safely locate.
// ─────────────────────────────────────────────────────────────────────

/** One field edit. `value: null` deletes the field. */
export type BibFieldEdit = {
  name: string
  value: string | null
}

/** A diff of one entry. `null` = unchanged; `key: ''` = clear the key. */
export type BibEntryEdits = {
  /** New citation key; `''` clears it; `null` = unchanged. */
  key: string | null
  /** New entry type; `null` = unchanged. */
  type: string | null
  /** Changed / added / removed fields (value `null` = remove). */
  fields: BibFieldEdit[]
}

export type BibEditChange = {
  /** inclusive start */
  from: number
  /** exclusive end (=== from for a pure insertion) */
  to: number
  insert: string
}

export type BibEditGuard =
  | { ok: true; changes: BibEditChange[] }
  | { ok: false; reason: string }

/** Trim + collapse empty → null (the form's and parser's value model). */
function normValue(v: string | undefined): string | null {
  if (v === undefined) return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * Pure diff of an original (parsed) entry against an edited form entry.
 * Only semantic changes are reported: whitespace-only differences and
 * no-ops produce no edits (value `null` = the field is removed).
 */
export function diffBibEntry(
  original: BibEntry,
  edited: BibEntry
): BibEntryEdits {
  const origKey = normValue(original.id)
  const newKey = normValue(edited.id)
  const key =
    origKey === newKey ? null : newKey === null ? '' : newKey

  const type =
    (original.type || 'misc').toLowerCase() ===
    (edited.type || 'misc').toLowerCase()
      ? null
      : edited.type || 'misc'

  const names = new Set<string>([
    ...Object.keys(original.fields || {}),
    ...Object.keys(edited.fields || {}),
  ])
  const fields: BibFieldEdit[] = []
  for (const n of names) {
    const o = normValue(original.fields?.[n])
    const e = normValue(edited.fields?.[n])
    if (o !== e) fields.push({ name: n, value: e })
  }
  return { key, type, fields }
}

type LocatedField = {
  name: string
  /** absolute offset of the field name */
  nameFrom: number
  /** absolute offset one PAST the value (inclusive value end) */
  valueEnd: number
}

const FIELD_NAME = /^[\w-]+/

/**
 * Locate the top-level (brace-depth-0) fields inside [innerStart, innerEnd)
 * of `source`. Returns the located fields, or `null` when the region is
 * structurally malformed (unbalanced value, unterminated quote) — callers
 * fall back to full re-serialization in that case.
 */
function locateFields(
  source: string,
  innerStart: number,
  innerEnd: number
): LocatedField[] | null {
  const out: LocatedField[] = []
  let depth = 0
  let inQuotes = false
  let i = innerStart
  while (i < innerEnd) {
    const ch = source[i]
    if (inQuotes) {
      if (ch === '\\') i++
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
      const m = FIELD_NAME.exec(source.slice(i, Math.min(i + 64, innerEnd)))
      if (m && /^[A-Za-z]/.test(m[0])) {
        let j = i + m[0].length
        while (j < innerEnd && /\s/.test(source[j])) j++
        if (source[j] === '=') {
          j++
          while (j < innerEnd && /\s/.test(source[j])) j++
          if (j >= innerEnd) return null
          if (source[j] === '{') {
            let d = 0
            let k = j
            let inQ = false
            for (; k < innerEnd; k++) {
              const c = source[k]
              if (inQ) {
                if (c === '\\') k++
                else if (c === '"') inQ = false
                continue
              }
              if (c === '"') inQ = true
              else if (c === '{') d++
              else if (c === '}') {
                d--
                if (d === 0) break
              }
            }
            if (d !== 0 || k >= innerEnd) return null
            out.push({ name: m[0].toLowerCase(), nameFrom: i, valueEnd: k + 1 })
            i = k + 1
            continue
          }
          if (source[j] === '"') {
            let k = j + 1
            let esc = false
            for (; k < innerEnd; k++) {
              if (esc) {
                esc = false
                continue
              }
              if (source[k] === '\\') esc = true
              else if (source[k] === '"') break
            }
            if (k >= innerEnd || source[k] !== '"') return null
            out.push({ name: m[0].toLowerCase(), nameFrom: i, valueEnd: k + 1 })
            i = k + 1
            continue
          }
          // bare value: to the next ',' or end
          let k = j
          while (k < innerEnd && source[k] !== ',') k++
          out.push({ name: m[0].toLowerCase(), nameFrom: i, valueEnd: k })
          i = k
          continue
        }
      }
    }
    i++
  }
  return out
}

/**
 * Plan the smallest edit set for one entry given a diff. Offsets are in
 * ONE source snapshot; changes are non-overlapping so the extension can
 * dispatch them as a single CodeMirror transaction (one undo step).
 *
 * Reasons:
 *  - 'not-a-bib-file'  : the document gate fails (same as planBibWrite)
 *  - 'entry-gone'      : the anchor entry no longer resolves uniquely
 *  - 'key-taken'       : the new key is already used by a different entry
 *  - 'field-not-found' : a changed field can't be located / malformed — the
 *                        caller falls back to planBibWrite
 */
export function planBibEditEntry(
  source: string,
  entry: BibEntry,
  edits: BibEntryEdits,
  originalId?: string
): BibEditGuard {
  if (!isBibDocument(source)) {
    return { ok: false, reason: NOT_A_BIB_REASON }
  }
  const entries = parseBibFile(source)
  const anchorId = originalId ?? entry.id
  // Anchor on the citation key (the rename target is not in the parsed doc
  // yet). A type mismatch only fails the anchor when the type is NOT part
  // of this edit — otherwise it is the very change being written.
  const byId = entries.filter(e => e.id === anchorId)
  if (byId.length !== 1) {
    return { ok: false, reason: ENTRY_GONE_REASON }
  }
  const target = byId[0]
  const entryType = (entry.type || 'misc').toLowerCase()
  if (target.type.toLowerCase() !== entryType && edits.type === null) {
    return { ok: false, reason: ENTRY_GONE_REASON }
  }

  // Renamed key: reject when another entry already owns it.
  if (edits.key !== null && edits.key !== anchorId) {
    const clash = entries.find(e => e.id === edits.key && e !== target)
    if (clash) return { ok: false, reason: KEY_TAKEN_REASON }
  }

  const open = target.sourceStart + source
    .slice(target.sourceStart)
    .indexOf('{')
  if (open === -1 || open + 1 >= target.sourceEnd) {
    return { ok: false, reason: 'field-not-found' }
  }
  const innerStart = open + 1
  const innerEnd = target.sourceEnd - 1

  const located = locateFields(source, innerStart, innerEnd)
  if (located === null) {
    return { ok: false, reason: 'field-not-found' }
  }

  const byName = new Map(located.map(f => [f.name, f]))
  const changes: BibEditChange[] = []
  const fieldText = (name: string, v: string) =>
    `${name} = {${escapeBibValue(v.trim())}}`

  // 1) citation key
  if (edits.key !== null) {
    const comma = depthZeroComma(source, innerStart, innerEnd)
    if (comma === -1) {
      if (edits.key !== '') {
        // keyless entry: the whole inner is fields (or empty). Adding a key
        // means splicing `key,` in front of the fields.
        changes.push({ from: innerStart, to: innerStart, insert: `${edits.key},` })
      }
    } else if (edits.key === '') {
      // Clear the key but KEEP the separating comma: `@misc{, title={T}}`
      // is the keyless-with-fields spelling (dropping the comma would make
      // the first field read as the key).
      changes.push({ from: innerStart, to: comma, insert: '' })
    } else {
      // Replace the key tokens only; keep the separating comma.
      changes.push({ from: innerStart, to: comma, insert: edits.key })
    }
  }

  // 2) entry type: the identifier between '@' and the entry's '{'
  if (edits.type !== null) {
    changes.push({
      from: target.sourceStart + 1,
      to: open,
      insert: edits.type,
    })
  }

  // 3) fields
  for (const fe of edits.fields) {
    const loc = byName.get(fe.name)
    if (fe.value === null) {
      if (!loc) continue // nothing to remove
      // Absorb ONE adjacent separator comma (and keep the spacing tidy):
      // prefer the comma AFTER the value (also drop the whitespace run that
      // preceded the field name), else the comma BEFORE it.
      let from = loc.nameFrom
      let to = loc.valueEnd
      let k = to
      let absAfter = false
      while (k < innerEnd && /\s/.test(source[k])) k++
      if (k < innerEnd && source[k] === ',') {
        to = k + 1
        absAfter = true
      } else {
        k = from
        while (k > innerStart && /\s/.test(source[k - 1])) k--
        if (k > innerStart && source[k - 1] === ',') from = k - 1
      }
      if (absAfter) {
        k = from
        while (k > innerStart && /\s/.test(source[k - 1])) k--
        if (k > innerStart && source[k - 1] === ',') from = k
      }
      changes.push({ from, to, insert: '' })
      continue
    }
    if (loc) {
      changes.push({
        from: loc.nameFrom,
        to: loc.valueEnd,
        insert: fieldText(loc.name, fe.value),
      })
      continue
    }
    // field absent → append at the end of the inner region.
    //  - fields already present        → comma-separate before them
    //  - key added in the same edit    → the key insert already ends in ','
    //  - `@misc{}` / keyless text inner → a LEADING comma keeps the new field
    //    a real field (`@misc{, title={T}}`), not a pseudo-key
    const commaSep = !(located.length === 0 && edits.key !== null && edits.key !== '')
    changes.push({
      from: innerEnd,
      to: innerEnd,
      insert: `${commaSep ? ',' : ''} ${fieldText(fe.name, fe.value)}`,
    })
  }

  if (changes.length === 0) {
    // A no-op edit set is a deliberate, safe no-write (mirror planBibImport).
    return { ok: true, changes: [] }
  }

  // Non-overlap guard, plus a merge of pure insertions that land on the
  // SAME offset (key-add + field-add into an empty entry) so that the
  // single change carries the intended text order unambiguously.
  const sorted = [...changes].sort((a, b) => a.from - b.from)
  const merged: BibEditChange[] = []
  for (const ch of sorted) {
    const last = merged[merged.length - 1]
    if (
      last &&
      ch.from === ch.to &&
      last.from === last.to &&
      ch.from === last.from
    ) {
      last.insert += ch.insert
      continue
    }
    merged.push({ ...ch })
  }
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].from < merged[i - 1].to) {
      return { ok: false, reason: 'field-not-found' }
    }
  }
  return { ok: true, changes: merged }
}

/** First `,` at brace-depth 0 / outside quotes inside [start, end), or -1. */
function depthZeroComma(source: string, start: number, end: number): number {
  let depth = 0
  let inQuotes = false
  for (let i = start; i < end; i++) {
    const c = source[i]
    if (inQuotes) {
      if (c === '\\') i++
      else if (c === '"') inQuotes = false
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === ',' && depth === 0) return i
  }
  return -1
}
