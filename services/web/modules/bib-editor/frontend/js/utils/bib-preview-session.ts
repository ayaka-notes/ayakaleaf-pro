/**
 * UI-only preview session for the visual bib editor.
 *
 * Persists WHICH entry was selected and where the list was scrolled,
 * per open document, so reopening a .bib file (or project) restores the
 * previous context. Keyless occurrence ids are a later phase — ids here
 * are entry keys.
 *
 * Reads validate shape and never throw (storage may be unavailable or
 * disabled; the editor must work normally regardless).
 */
import type { BibListPosition } from './bib-list-position'

export type BibPreviewSession = {
  entryId: string | null
  listPosition: BibListPosition | null
}

export function bibPreviewSessionKey(documentId: string): string {
  return `bib-editor:preview:v1:${documentId}`
}

function isListPosition(value: unknown): value is BibListPosition {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.entryId === 'string' &&
    typeof p.offset === 'number' &&
    Number.isFinite(p.offset) &&
    typeof p.scrollTop === 'number' &&
    Number.isFinite(p.scrollTop) &&
    p.scrollTop >= 0
  )
}

export function readBibPreviewSession(
  key: string
): BibPreviewSession | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.entryId !== null && typeof v.entryId !== 'string') return null
  if (
    'listPosition' in v &&
    v.listPosition !== null &&
    !isListPosition(v.listPosition)
  ) {
    return null
  }
  return {
    entryId: v.entryId as string | null,
    listPosition: (v.listPosition as BibPreviewSession['listPosition']) ?? null,
  }
}

export function writeBibPreviewSession(
  key: string,
  state: BibPreviewSession
): void {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Storage may be unavailable or disabled. Nothing to do.
  }
}

/**
 * Resolve a stored session against the currently parsed entries. A stored
 * key must never resolve to a missing entry: when it is gone, the whole
 * session (including the list position) is dropped.
 */
export function resolveBibPreviewSession<T extends { id: string }>(
  state: BibPreviewSession | null,
  entries: ReadonlyArray<T>
): { entry: T | null; listPosition: BibListPosition | null } {
  const entry = state?.entryId
    ? (entries.find(item => item.id === state.entryId) ?? null)
    : null
  return {
    entry,
    listPosition: entry ? (state?.listPosition ?? null) : null,
  }
}
