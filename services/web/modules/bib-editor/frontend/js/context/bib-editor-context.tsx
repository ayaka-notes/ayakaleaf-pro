/**
 * BibEditor context.
 *
 * Design (REDESIGN_PLAN.md §2):
 *  - The .bib DOCUMENT is the single source of truth. `entries` + `source`
 *    are re-derived from the CodeMirror view (300 ms debounce, extension),
 *    so Code-mode edits appear in the visual UI automatically.
 *  - WRITES go back through CodeMirror as BIB_WRITE_EVENT / BIB_DELETE_EVENT
 *    (guarded in the extension via bib-write.ts); nothing in this context
 *    caches offsets, so stale-offset writes are impossible.
 *  - There is NO draft persistence: the open form is the draft; the panel
 *    flushes it into the document on leaving visual mode.
 *  - Re-binding to a written entry is PARSE-CONFIRMED: the extension emits
 *    `written: { id, mode, originalId }` with the fresh parse ONLY after a
 *    successful guarded write; this provider passes it to `setEditorState`,
 *    which keeps the form bound only when the entry actually landed in the
 *    document. On rejection nothing changes here — the banner shows
 *    (writeFailure) and the form stays for a fix (§2.3 / §12 P1a).
 *
 * Selection:
 *  - `null`                       → list mode
 *  - `{ kind: 'existing', entryId }` → edit mode bound to a parsed entry
 *  - `{ kind: 'new', draft }`      → edit mode with a not-yet-materialized
 *                                     entry; "Check" appends it to the file
 */
import {
  createContext,
  FC,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { BibEntry } from '../utils/bib-types'
import { getNewEntryInitialType } from '../utils/bib-types'
import type { ParsedBibEntry } from '../utils/bib-parser'

export type BibSelection =
  | null
  | { kind: 'existing'; entryId: string }
  | { kind: 'new'; draft: BibEntry }

export type BibWriteRequest = {
  entry: BibEntry
  mode: 'existing' | 'new'
  /** The source snapshot the panel read when it created this request */
  expectedSource: string
  /** For mode 'existing': the id of the entry BEFORE any rename (guard) */
  originalId?: string
}

export type BibDeleteRequest = {
  /** Single entry (one delete). Use this XOR `entryIds`. */
  entryId?: string
  /** Bulk delete (W5): all-or-nothing guarded write. */
  entryIds?: string[]
  expectedSource: string
}

export type BibImportRequest = {
  /** The entries to append (all-or-nothing, C5) */
  entries: BibEntry[]
  /** The source snapshot the panel read when it created this request */
  expectedSource: string
}

type BibEditorActions = {
  /**
   * Update the parsed state from the editor (also clears writeFailure).
   * `written` (from a guarded write that just succeeded) carries the id the
   * write targeted; the selection is re-bound to it only when it resolves in
   * the fresh `entries` parse.
   *
   * NOTE: `isBibFile` is kept in the signature for bridge compatibility;
   * consumers must NOT rely on it (the panel only mounts for .bib filenames
   * per its visual provider — see §12 lint pass).
   */
  setEditorState: (
    isBibFile: boolean,
    entries: ParsedBibEntry[],
    source: string,
    written?: { id: string; mode: 'existing' | 'new'; originalId?: string }
  ) => void
  /** Select an existing entry for editing */
  selectEntry: (entry: BibEntry) => void
  /** Bind the form to an existing entry by id (e.g. after materialization) */
  selectExisting: (entryId: string) => void
  /** Start a new (not yet materialized) entry */
  selectNew: (draft?: BibEntry) => void
  /** Last type used on a new-entry form (W1 type preset); `null` = unset */
  newEntryTypePreset: string | null
  /** Record the type the user chose on a new-entry form (W1) */
  updateNewEntryTypePreset: (type: string) => void
  /** Back to the list (the panel flushes before calling this) */
  deselect: () => void
  /** Ask the editor to write a flushed entry into the document */
  writeEntry: (request: BibWriteRequest) => void
  /** Ask the editor to import N entries (C5 Paste flow, all-or-nothing) */
  importMany: (request: BibImportRequest) => void
  /** Ask the editor to delete an entry from the document */
  deleteEntry: (request: BibDeleteRequest) => void
  /** Set the focus position (entry sourceStart) when returning to Code */
  scrollTo: (position: number) => void
  /** Record a rejected write (shown as a banner); cleared by a fresh parse */
  setWriteFailure: (reason: string | null) => void
  /** Dismiss the write-failure banner (e.g. user acknowledged) */
  clearWriteFailure: () => void
  /** Set the toolbar enabled-state (the extension's undo/redo stack) */
  setHistoryState: (canUndo: boolean, canRedo: boolean) => void
}

export type BibEditorState = {
  /** Whether the current document is a .bib file */
  isBibFile: boolean;
  /** Parsed entries from the current document */
  entries: ParsedBibEntry[]
  /** The full source text of the current document */
  source: string
  /** The current selection (list mode when null) */
  selection: BibSelection
  /** Set when the last write request was rejected by the editor guard */
  writeFailure: string | null
  /** Whether document-level undo/redo is currently possible (toolbar state) */
  canUndo: boolean
  canRedo: boolean
}

type BibEditorContextValue = BibEditorState & BibEditorActions

const BibEditorContext = createContext<BibEditorContextValue | undefined>(
  undefined
)

export const BibEditorProvider: FC<React.PropsWithChildren> = ({ children }) => {
  const [isBibFile, setIsBibFile] = useState(false) // tracked; unused by consumers (§12 lint pass)
  const [entries, setEntries] = useState<ParsedBibEntry[]>([])
  const [newEntryTypePreset, setNewEntryTypePreset] = useState<string | null>(
    null
  )
  const [source, setSource] = useState('')
  const [selection, setSelection] = useState<BibSelection>(null)
  const [writeFailure, setWriteFailureState] = useState<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const setEditorState = useCallback(
    (
      newIsBibFile: boolean,
      newEntries: ParsedBibEntry[],
      newSource: string,
      written?: { id: string; mode: 'existing' | 'new'; originalId?: string }
    ) => {
      setIsBibFile(newIsBibFile)
      setEntries(newEntries)
      setSource(newSource)
      // A fresh parse means the UI is back in sync with the document.
      setWriteFailureState(null)
      // Selection handling, order matters:
      // 1. a confirmed write just landed → bind to the written entry, but
      //    only when the fresh parse actually contains it (parse-confirmed);
      // 2. otherwise an existing entry that vanished from the document
      //    (edited away in Code mode / file switched) → back to list.
      setSelection(prev => {
        if (prev && written) {
          if (prev.kind === 'new' && written.mode === 'new') {
            return newEntries.some(e => e.id === written.id)
              ? { kind: 'existing', entryId: written.id }
              : prev
          }
          if (
            prev.kind === 'existing' &&
            written.mode === 'existing' &&
            written.originalId === prev.entryId &&
            written.id !== prev.entryId
          ) {
            return newEntries.some(e => e.id === written.id)
              ? { kind: 'existing', entryId: written.id }
              : prev
          }
        }
        if (prev && prev.kind === 'existing') {
          return newEntries.some(e => e.id === prev.entryId) ? prev : null
        }
        return prev
      })
    },
    []
  )

  const setWriteFailure = useCallback((reason: string | null) => {
    setWriteFailureState(reason)
  }, [])

  const clearWriteFailure = useCallback(() => {
    setWriteFailureState(null)
  }, [])

  const setHistoryState = useCallback((nextUndo: boolean, nextRedo: boolean) => {
    setCanUndo(prev => (prev === nextUndo ? prev : nextUndo))
    setCanRedo(prev => (prev === nextRedo ? prev : nextRedo))
  }, [])

  const selectEntry = useCallback((entry: BibEntry) => {
    setSelection({ kind: 'existing', entryId: entry.id })
  }, [])

  const selectExisting = useCallback((entryId: string) => {
    setSelection({ kind: 'existing', entryId })
  }, [])

  const selectNew = useCallback((draft?: BibEntry) => {
    setSelection({
      kind: 'new',
      draft: draft ?? {
        type: getNewEntryInitialType(newEntryTypePreset),
        id: '',
        fields: {},
      },
    })
  }, [newEntryTypePreset])

  const updateNewEntryTypePreset = useCallback((type: string) => {
    setNewEntryTypePreset(type)
  }, [])

  const deselect = useCallback(() => {
    setSelection(null)
  }, [])

  const writeEntry = useCallback((request: BibWriteRequest) => {
    document.dispatchEvent(new CustomEvent('bib-editor:write', { detail: request }))
  }, [])

  const importMany = useCallback((request: BibImportRequest) => {
    document.dispatchEvent(new CustomEvent('bib-editor:import', { detail: request }))
  }, [])

  const deleteEntry = useCallback((request: BibDeleteRequest) => {
    document.dispatchEvent(new CustomEvent('bib-editor:delete', { detail: request }))
  }, [])

  const scrollTo = useCallback((position: number) => {
    document.dispatchEvent(
      new CustomEvent('bib-editor:scroll-to', { detail: { position } })
    )
  }, [])

  const value = useMemo<BibEditorContextValue>(
    () => ({
      isBibFile,
      entries,
      source,
      selection,
      writeFailure,
      canUndo,
      canRedo,
      setEditorState,
      selectEntry,
      selectExisting,
      selectNew,
      newEntryTypePreset,
      updateNewEntryTypePreset,
      deselect,
      writeEntry,
      importMany,
      deleteEntry,
      scrollTo,
      setWriteFailure,
      clearWriteFailure,
      setHistoryState,
    }),
    [
      isBibFile,
      entries,
      source,
      selection,
      writeFailure,
      canUndo,
      canRedo,
      setEditorState,
      selectEntry,
      selectExisting,
      selectNew,
      newEntryTypePreset,
      updateNewEntryTypePreset,
      deselect,
      writeEntry,
      importMany,
      deleteEntry,
      scrollTo,
      setWriteFailure,
      clearWriteFailure,
      setHistoryState,
    ]
  )

  return (
    <BibEditorContext.Provider value={value}>
      {children}
    </BibEditorContext.Provider>
  )
}

export function useBibEditorContext() {
  const context = useContext(BibEditorContext)
  if (!context) {
    throw new Error(
      'useBibEditorContext is only available inside BibEditorProvider'
    )
  }
  return context
}
