/**
 * BibEditor visual component — rendered in the main editor window when
 * the user switches to "Visual" mode on a .bib file.
 *
 * Layout (Phase C capture, PHASE_C_PLAN.md §1.3/§1.4/§3-C4):
 *   .bibtex-entry-list-panel
 *     └─ .bibtex-list-and-preview
 *          ├─ .bibtex-entry-list        (C3 compact windowed rows; its
 *          │                            toolbar = search + Add (C5), and
 *          │                            the bulk bar = select-all + count
 *          │                            + bulk-Delete (W5 core))
 *          └─ .bibtex-entry-preview-
 *             panel (C4: Details form / Abstract tab)  — hidden until a
 *                card is previewed (selection kind 'existing')
 *
 * Selection === preview (C4): the context `selection` (kind 'existing')
 * IS the previewed entry; prev/next chevrons walk the current parse list
 * (file order). Bulk row-checkbox selection is panel-local state — never
 * document state.
 *
 * Draft model (REDESIGN_PLAN.md R2, capture OQ-7): there is no draft
 * persistence machinery. The open form (preview Details tab, or the C5
 * "Enter manually" modal) is the draft; whenever the panel is about to stop
 * being relevant for this document (Code toggle, Close/back, file switch,
 * unmount) the current form is flushed into the CodeMirror buffer via a
 * GUARDED write request (the extension re-resolves ranges against the live
 * document and rejects stale writes — see bib-editor-extension.ts).
 *
 * Flush compares the form against the *freshly parsed* entry, so leaving
 * with no effective change writes nothing; a type-only "new" form
 * materializes nothing (§2.3).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import withErrorBoundary from '@/infrastructure/error-boundary'
import EditorSwitch from '@/features/source-editor/components/editor-switch'
import GenericConfirmModal from '@/features/ide-react/components/modals/generic-confirm-modal'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useBibEditorContext } from '../context/bib-editor-context'
import {
  BIB_UNDO_EVENT,
  BIB_REDO_EVENT,
  BIB_RESET_HISTORY_EVENT,
} from '../extensions/bib-editor-extension'
import BibEntryList from './bib-entry-list'
import BibManualModal from './bib-manual-modal'
import BibEntryPreview from './bib-entry-preview'
import BibImportModal from './bib-import-modal'
import BibImportFromLibrary from './bib-import-from-library'
import OrcidPickerModal from '../../../deps/orcid-picker/frontend/js/components/orcid-picker-modal'
import ZoteroPickerModal from '../../../deps/zotero/frontend/js/components/zotero-picker-modal'
import MendeleyPickerModal from '../../../deps/mendeley/frontend/js/components/mendeley-picker-modal'
import { useBibServices } from '../utils/provider-status'
import type { BibEntry } from '../utils/bib-types'
import type { ParsedBibEntry } from '../utils/bib-parser'
import { generateAvailableCitationKey } from '../utils/bib-key-generation'
import { normaliseOrcidEntryKeys, splitImportText } from '../utils/bib-import'
import { diffBibEntry } from '../utils/bib-write'
import { downloadBibFilename, downloadBibBulkFilename, selectedEntriesInOrder, bulkDeleteIds, nextEntry, prevEntry } from '../utils/preview-model.ts'
import { validateBibSource, attachDiagnostics, allDiagnostics, diagnosticLabel } from '../utils/bib-source-diagnostics'
import { plural } from '../utils/plural'
import {
  bibPreviewSessionKey,
  readBibPreviewSession,
  resolveBibPreviewSession,
  writeBibPreviewSession,
} from '../utils/bib-preview-session.ts'
import { captureBibListPosition, restoreBibListPosition } from '../utils/bib-list-position.ts'
import '../../stylesheets/bib-editor-panel.css'
import '../../stylesheets/bib-saas.css'

function shallowEntriesEqual(
  a: { type: string; id: string; fields: Record<string, string> },
  b: { type: string; id: string; fields: Record<string, string> } | undefined
): boolean {
  if (!b) return false
  if (a.type !== b.type) return false
  if (a.id !== b.id) return false
  const ak = Object.keys(a.fields)
  const bk = Object.keys(b.fields)
  if (ak.length !== bk.length) return false
  return ak.every(k => a.fields[k] === b.fields[k])
}

function BibEditorPanel() {
  const { t } = useTranslation()
  const {
    entries,
    source,
    selection,
    writeFailure,
    selectEntry,
    updateNewEntryTypePreset,
    deselect,
    writeEntry,
    importMany,
    deleteEntry,
    scrollTo,
    clearWriteFailure,
    canUndo,
    canRedo,
  } = useBibEditorContext()
  const { showVisual } = useEditorPropertiesContext()
  const { openDocName, currentDocumentId } = useEditorOpenDocContext()

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
 /** C5: the Paste-references import modal is open */
  const [importOpen, setImportOpen] = useState(false)
  // C9: "Import from Library" (LIBRARY_PLAN.md — the one deliberate deviation)
  const [libraryImportOpen, setLibraryImportOpen] = useState(false)
  // P2: "Import from ORCID.org" (Add dropdown) — the orcid-picker modal.
  const [orcidOpen, setOrcidOpen] = useState(false)
  // P4: "Import from Zotero" (Add dropdown) — the zotero-picker modal.
  const [zoteroOpen, setZoteroOpen] = useState(false)
  const [mendeleyOpen, setMendeleyOpen] = useState(false)
  // Reference managers configured on this instance (client id + secret):
  // menu entries are HIDDEN when a provider is not configured.
  const bibServices = useBibServices()
  // Owner #11 (2026-09-13 editor wave): "Upload .bib file" in the Add
  // menu (parity with the /hub library Add menu). Same pipeline as the
  // library page: hidden file input → read text → BibImportModal
  // pre-filled (initialText).
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadText, setUploadText] = useState('')
  const openUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      try {
        setUploadText(await file.text())
        setImportOpen(true)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('bib file upload read failed:', err)
      }
    },
    []
  )
  // Item 3: "Enter manually" opens the Add-reference modal (SaaS parity).
  const [manualShow, setManualShow] = useState(false)
  const [bulkDeleteGuard, setBulkDeleteGuard] = useState<
    { entryIds: string[]; expectedSource: string } | null
  >(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedIdsRef = useRef(selectedIds)

  /** Latest form values (written there by BibEntryForm on every change). */
  const formRef = useRef<{
    entry: BibEntry
    kind: 'existing' | 'new'
    originalId: string | null
  } | null>(null)

  // Mirrors of the reactive values so effect cleanups use the LATEST values
  // without re-running the effects.
  const selectionMirror = useRef(selection)
  const sourceMirror = useRef(source)
  const entriesMirror = useRef<ParsedBibEntry[]>(entries)
  const openDocNameMirror = useRef(openDocName)
  const flushMirror = useRef<() => void>(() => {})
  const scrollToMirror = useRef<(p: number) => void>(() => {})
  // Preview session (UI state per document): panel root for list capture,
  // latest scoped key, once-only restore flag.
  const panelRootRef = useRef<HTMLDivElement | null>(null)
  const sessionKeyRef = useRef<string | null>(null)
  const restoredSession = useRef(false)
  useEffect(() => { selectionMirror.current = selection }, [selection])
  useEffect(() => { sourceMirror.current = source }, [source])
  useEffect(() => { entriesMirror.current = entries }, [entries])
  useEffect(() => { openDocNameMirror.current = openDocName }, [openDocName])
  useEffect(() => {
    sessionKeyRef.current = currentDocumentId
      ? bibPreviewSessionKey(currentDocumentId)
      : null
  }, [currentDocumentId])

  // ── Preview session: restore + persist UI state per open document ────

  // Restore on (re)mount, once the parse exists: select the previously
  // previewed entry and re-anchor the list scroll (first visible row plus
  // in-row offset works even if preceding rows changed height).
  useEffect(() => {
    const key = sessionKeyRef.current
    if (restoredSession.current || !key || selection !== null || entries.length === 0) {
      return
    }
    const { entry, listPosition } = resolveBibPreviewSession(
      readBibPreviewSession(key),
      entries
    )
    if (!entry) return
    restoredSession.current = true
    selectEntry(entry)
    if (listPosition) {
      // Rows render in the same commit as the selection effect; defer so
      // the list body has layout before we measure.
      requestAnimationFrame(() => {
        const listEl = panelRootRef.current?.querySelector('.bibtex-entry-list')
        restoreBibListPosition(listEl as HTMLElement | null, listPosition)
      })
    }
  }, [selection, entries, selectEntry])

  // Persist when the selection moves to an existing entry (the row is
  // visible, so the capture is meaningful); the unmount effect below
  // captures the final state.
  useEffect(() => {
    const key = sessionKeyRef.current
    if (!key || selection?.kind !== 'existing') return
    const listEl = panelRootRef.current?.querySelector('.bibtex-entry-list')
    writeBibPreviewSession(key, {
      entryId: selection.entryId,
      listPosition: captureBibListPosition(listEl as HTMLElement | null),
    })
  }, [selection])

  // Final capture on unmount (tab close / visual exit): use the LATEST
  // document + selection mirrors; storage failures are swallowed.
  useEffect(() => {
    return () => {
      const key = sessionKeyRef.current
      const sel = selectionMirror.current
      if (!key || sel?.kind !== 'existing') return
      const listEl = panelRootRef.current?.querySelector('.bibtex-entry-list')
      writeBibPreviewSession(key, {
        entryId: sel.entryId,
        listPosition: captureBibListPosition(listEl as HTMLElement | null),
      })
    }
  }, [])

  /**
   * Flush the open form into the current document (REDESIGN_PLAN.md R2,
   * OQ-7: flush-on-leave — the preview has no Save button). The request
   * carries `expectedSource`; the extension rejects it (and surfaces a
   * banner) when the document is no longer this bibliography. Skips
   * everything that is already the document (no-op writes).
   */
  const flushCurrentForm = useCallback(() => {
    const form = formRef.current
    const sel = selectionMirror.current
    if (!form || !sel) return

    if (sel.kind === 'new') {
      const entry: BibEntry = {
        type: form.entry.type,
        id: form.entry.id.trim(),
        fields: { ...form.entry.fields },
      }
      // Type-only form: materialize nothing (§2.3).
      if (entry.id === '' && Object.keys(entry.fields).length === 0) {
        return
      }
      const finalEntry: BibEntry =
        entry.id === ''
          ? {
              ...entry,
              id: generateAvailableCitationKey(
                entry.fields,
                entriesMirror.current.map(e => e.id)
              ),
            }
          : entry
      writeEntry({
        entry: finalEntry,
        mode: 'new',
        expectedSource: sourceMirror.current,
      })
      // The extension re-emits the fresh parse with `written` and the
      // context re-binds the selection to the written entry — but only
      // when it actually landed (parse-confirmed, §2.3 / §12 P1a). On
      // rejection nothing changes: the banner shows and the form stays
      // for a fix.
      return
    }

    // existing (preview Details): write only when the form actually
    // diverged from the freshly parsed entry (no no-op rewrites on every
    // Close). The anchor is the ORIGINAL key (a renamed entry is not
    // parsed by its new key).
    const original = entriesMirror.current.find(
      e => e.id === (form.originalId ?? sel.entryId)
    )
    const entry: BibEntry = {
      type: form.entry.type,
      id: form.entry.id.trim(),
      fields: { ...form.entry.fields },
    }
    // Unchanged = same id AND same values (a pure key rename is NOT
    // unchanged — §12 P1b). Renames are re-resolved by the write planner
    // against the original key, and the context re-binds the selection
    // afterwards (parse-confirmed; not done here — §12 P1a).
    const unchanged =
      original != null &&
      original.id === entry.id &&
      shallowEntriesEqual(entry, original)
    if (unchanged) {
      return
    }
    // Board #6: ship the semantic diff alongside the entry so the
    // extension can rewrite ONLY the changed regions (the full-entry
    // re-serialization remains the fallback for entries the scanner
    // can't safely locate).
    const edits = original ? diffBibEntry(original, entry) : undefined
    writeEntry({
      entry,
      mode: 'existing',
      originalId: form.originalId ?? undefined,
      expectedSource: sourceMirror.current,
      edits,
    })
  }, [writeEntry])

  /**
   * R7 (2026-08-29, item 4): the panel is UNMOUNTED when the user
   * switches to Code (the parent renders it conditionally on
   * `showVisual`), so the `showVisual` watcher below often never sees the
   * false value — React unmounts the panel in the same commit and effects
   * with the new context value never run. Perform the flush + reveal on
   * UNMOUNT (cleanup runs exactly then); it is idempotent with the
   * watchers (no-op writes skip, scrolling twice is harmless).
   */
  const unmountedLeave = useRef(false)
  const leaveVisual = useCallback(() => {
    if (unmountedLeave.current) return
    unmountedLeave.current = true
    const sel = selectionMirror.current
    const wasNew = sel?.kind === 'new'
    flushMirror.current()
    if (wasNew) {
      // Appended 'new' entry: the end of the flushed document is it.
      scrollToMirror.current(Number.MAX_SAFE_INTEGER)
      return
    }
    if (sel?.kind === 'existing') {
      const entry = entriesMirror.current.find(e => e.id === sel.entryId)
      if (entry) scrollToMirror.current(entry.sourceStart)
    }
  }, [])
  useEffect(() => {
    flushMirror.current = flushCurrentForm
    scrollToMirror.current = scrollTo
  })
  useEffect(() => {
    return () => { leaveVisual() }
  }, [leaveVisual])

  // ── R2 leave watchers: flush whenever we stop being shown ─────────────

  // 1. showVisual: true → false (Code toggle): flush + reveal the entry in
  //    Code (same behavior as the old code-switch capture, now side-
  //    effect-free). R7 (2026-08-29): the entry lands at the TOP of the
  //    editor with the cursor on it — including freshly created ('new')
  //    entries (they append at the end, so scroll to the end of doc).
  const prevShowVisual = useRef(showVisual)
  useEffect(() => {
    if (prevShowVisual.current && !showVisual) {
      const sel = selectionMirror.current
      const wasNew = sel?.kind === 'new'
      flushCurrentForm()
      if (wasNew) {
        // Appended entry: the end of the (flushed) document is it.
        scrollTo(Number.MAX_SAFE_INTEGER)
        return
      }
      if (sel?.kind === 'existing') {
        const entry = entriesMirror.current.find(e => e.id === sel.entryId)
        if (entry) {
          scrollTo(entry.sourceStart)
        }
      }
    }
    prevShowVisual.current = showVisual
  }, [showVisual, flushCurrentForm, scrollTo])

  // 2. openDocName changes while visual is mounted (file switch).
  const prevDocName = useRef(openDocName)
  useEffect(() => {
    if (prevDocName.current !== null && openDocName !== prevDocName.current) {
      // Best-effort: the CM document most likely still holds the old file
      // (loading is async) — if it has already switched the guard rejects
      // the write and the panel surfaces the banner. No corruption possible.
      flushCurrentForm()
      deselect()
      setBulkDeleteGuard(null)
      setSelectedIds([])
      // The undo/redo stack belongs to the file that produced it: start a
      // fresh stack for every new file so undo can never restore the
      // previous file's text into this file's buffer.
      document.dispatchEvent(
        new CustomEvent(BIB_RESET_HISTORY_EVENT, {
          detail: { file: openDocName },
        })
      )
    }
    prevDocName.current = openDocName
  }, [openDocName, flushCurrentForm, deselect])

  // 2b. Mount: same reset (the panel remounts for new files; a remount for
  //     the SAME file after a Code->Visual round-trip is a no-op in the
  //     extension because the file is unchanged).
  useEffect(() => {
    document.dispatchEvent(
      new CustomEvent(BIB_RESET_HISTORY_EVENT, {
        detail: { file: openDocName },
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 3. unmount (tab close, etc.)
  useEffect(() => {
    return () => {
      flushCurrentForm()
    }
  }, [flushCurrentForm])

  // Bulk selection: drop ids that no longer resolve in the current parse
  // (e.g. after a Code-mode edit or a delete).
  useEffect(() => {
    setSelectedIds(prev => {
      const present = new Set(entries.map(e => e.id))
      const next = prev.filter(id => present.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [entries])

  // ── Preview (C4): the context selection (existing) drives it ─────────

  const previewEntry = useMemo<ParsedBibEntry | null>(() => {
    if (selection?.kind === 'existing') {
      return entries.find(e => e.id === selection.entryId) || null
    }
    return null
  }, [selection, entries])
  const previewIndex = useMemo(() => {
    if (selection?.kind !== 'existing') return -1
    return entries.findIndex(e => e.id === selection.entryId)
  }, [selection, entries])

  // ── Source diagnostics (board #5): WHERE a .bib is broken ──────────
  // validateBibSource is pure: it flags unterminated entries (the parser
  // silently drops those), invalid keys and duplicate fields, with 1-based
  // line numbers for the banner's "Go to line" action.
  const diagnosticsInfo = useMemo(() => {
    const diagnostics = validateBibSource(source)
    const { byEntry, unattached } = attachDiagnostics(entries, diagnostics)
    // allDiagnostics handles Map values safely (`.values().flat()` would
    // crash: Map iterators have no .flat — regression 2026-11-05).
    return { byEntry, all: allDiagnostics(byEntry, unattached) }
  }, [source, entries])

  const handlePreviewClose = useCallback(() => {
    setShowDeleteConfirm(false)
    flushCurrentForm()
    formRef.current = null
    deselect()
  }, [flushCurrentForm, deselect])

  // Prev/next = prev/next entry in the current parse list (file order,
  // wrap-to-ends per the preview-model tests). Crossing the boundary
  // flushes (R2) and then re-selects — leave-then-select ordering keeps
  // the R2 guarantee.
  const handlePrev = useCallback(() => {
    const prev = prevEntry(entries, previewIndex)
    if (!prev || (selection?.kind === 'existing' && prev.id === selection.entryId)) {
      return
    }
    flushCurrentForm()
    formRef.current = null
    selectEntry(prev)
  }, [previewIndex, entries, selection, flushCurrentForm, selectEntry])

  const handleNext = useCallback(() => {
    const next = nextEntry(entries, previewIndex)
    if (!next || (selection?.kind === 'existing' && next.id === selection.entryId)) {
      return
    }
    flushCurrentForm()
    formRef.current = null
    selectEntry(next)
  }, [previewIndex, entries, selection, flushCurrentForm, selectEntry])

  const handleFormChange = useCallback(
    (entry: BibEntry, originalId: string | null) => {
      // W1: remember the type chosen on a new-entry form (the preset).
      // Existing entries: the type is bound to the parsed entry — don't
      // pollute the preset from an edit.
      if (originalId === null) {
        updateNewEntryTypePreset(entry.type)
      }
      formRef.current = {
        entry: {
          type: entry.type,
          id: entry.id,
          fields: { ...entry.fields },
        },
        kind: originalId === null ? 'new' : 'existing',
        originalId,
      }
    },
    [updateNewEntryTypePreset]
  )

  const handleChecked = useCallback(
    (entry: BibEntry, kind: 'existing' | 'new') => {
      if (kind === 'new') {
        const finalEntry: BibEntry =
          entry.id.trim() !== ''
            ? { ...entry, id: entry.id.trim() }
            : {
                ...entry,
                id: generateAvailableCitationKey(
                  entry.fields,
                  entriesMirror.current.map(e => e.id)
                ),
              }
        // Materialize (append). The extension re-emits the fresh parse
        // with the written id and the context re-binds to it only when the
        // entry actually landed (parse-confirmed, §2.3 / §12 P1a). On
        // rejection the banner shows and this form stays in "new" mode
        // for a fix.
        writeEntry({
          entry: finalEntry,
          mode: 'new',
          expectedSource: sourceMirror.current,
        })
      }
      // kind 'existing': Check is validate-only — nothing to do.
    },
    [writeEntry]
  )

  // ── Delete: single (preview Actions) + bulk (bulk bar, W5 core) ───────

  const handleConfirmDelete = useCallback(() => {
    const sel = selectionMirror.current
    setShowDeleteConfirm(false)
    formRef.current = null
    if (sel?.kind === 'existing') {
      deleteEntry({
        entryId: sel.entryId,
        expectedSource: sourceMirror.current,
      })
    }
    deselect()
  }, [deleteEntry, deselect])

  // Guard before the bulk write: snapshot { source, ids } so the confirm
  // action re-checks both against the live context at dispatch time
  // (W5 all-or-nothing, no partial deletes on a stale source).
  const handleAskBulkDelete = useCallback(() => {
    setBulkDeleteGuard({
      entryIds: bulkDeleteIds(
        entriesMirror.current,
        selectedIdsRef.current
      ),
      expectedSource: sourceMirror.current,
    })
  }, [])

  const handleConfirmBulkDelete = useCallback(() => {
    const guard = bulkDeleteGuard
    setBulkDeleteGuard(null)
    if (!guard) return
    const liveSource = sourceMirror.current
    // Stale source since the ask → abort (the extension guard is the
    // second line of defense; here we avoid the confirm dance on a doc
    // that already changed).
    if (liveSource !== guard.expectedSource) {
      return
    }
    deleteEntry({
      entryIds: guard.entryIds,
      expectedSource: liveSource,
    })
    setSelectedIds([])
    formRef.current = null
    // The preview for a deleted row closes (the context also clears a
    // vanished selection — same result).
    const sel = selectionMirror.current
    if (sel?.kind === 'existing' && guard.entryIds.includes(sel.entryId)) {
      deselect()
    }
  }, [deleteEntry, deselect, bulkDeleteGuard])

  // C5 Paste import: one guarded, all-or-nothing append (the extension
  // re-resolves against the live doc and rejects stale-source/conflict,
  // surfacing the banner — the modal closes optimistically, like the
  // W5 bulk delete).
  const handleImportEntries = useCallback((importEntries: BibEntry[]) => {
    importMany({ entries: importEntries, expectedSource: sourceMirror.current })
    setImportOpen(false)
  }, [importMany])

  // C9: Import-from-Library uses the SAME guarded, all-or-nothing write.
  const handleLibraryImport = useCallback((importEntries: BibEntry[]) => {
    importMany({ entries: importEntries, expectedSource: sourceMirror.current })
    setLibraryImportOpen(false)
  }, [importMany])

  // P2: Import from ORCID (BIB_ORCID_TEMPLATES_PLAN.md §2.3) — the modal
  // already fetched the BibTeX of the selected works; write it through
  // the same guarded append path as the paste import (new keys only —
  // conflicts surface with the usual banner; the modal closes itself on
  // full success and stays open with per-work errors otherwise).
  const handleOrcidInserted = useCallback(
    (bibtexText: string) => {
      const entries = normaliseOrcidEntryKeys(
        splitImportText(bibtexText)
          .filter(i => i.kind === 'bibtex')
          .map(i => (i as { entry: BibEntry }).entry)
      )
      if (entries.length > 0) {
        importMany({ entries, expectedSource: sourceMirror.current })
      }
      setOrcidOpen(false)
    },
    [importMany]
  )

  // Shared blob-download for the whole file (OQ-6) and the selection.
  const downloadText = useCallback((text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  // Download (OQ-6: whole file). The browser saves the current document
  // text; no range export.
  const handleDownload = useCallback(() => {
    downloadText(sourceMirror.current, downloadBibFilename(openDocNameMirror.current ?? ''))
  }, [downloadText])

  // Bulk download of the selection: preserves document order and writes one
  // partial BibTeX file. Each entry's raw source slice is kept verbatim so
  // formatting and in-entry comments survive.
  const handleBulkDownload = useCallback(() => {
    const selectedEntries = selectedEntriesInOrder(
      entriesMirror.current,
      selectedIdsRef.current
    )
    if (selectedEntries.length === 0) return
    const source = sourceMirror.current
    const text = selectedEntries
      .map(e => source.slice(e.sourceStart, e.sourceEnd))
      .join('\n')
    downloadText(text, downloadBibBulkFilename(openDocNameMirror.current ?? ''))
  }, [downloadText])

  // Bulk selection handlers (lifted into the panel — C4: the preview must
  // close for a deleted previewed row, and the confirm modal lives here).
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }, [])

  const handleToggleSelectAll = useCallback((kind: 'all' | 'none') => {
    setSelectedIds(
      kind === 'all' ? entries.map(e => e.id) : []
    )
  }, [entries])

  return (
    <div className="bib-editor-panel" ref={panelRootRef}>
      {writeFailure !== null && (
        <div className="bib-write-failure-banner" role="alert">
          <span className="bib-write-failure-banner-text">
            {writeFailure === 'duplicate-key'
              ? t('That citation key is used by more than one entry, so it can’t be targeted on its own. Select the entry in the list and use the Delete bulk action to remove every entry that shares the key.')
              : t('Could not save: the file changed or is no longer a bibliography.')}
          </span>
          <button
            type="button"
            className="bib-write-failure-dismiss"
            aria-label={t('Dismiss')}
            onClick={(e) => {
              e.stopPropagation()
              clearWriteFailure()
            }}
          >
            {t('Dismiss')}
          </button>
        </div>
      )}

      {/* SaaS bibtex toolbar (reference 2a): Undo/Redo on the left, the
          Code/Visual toggle (right) with the reserved search slot.
          The visual "new entry" back action stays on the left. */}
      <div
        className="bibtex-toolbar"
        role="toolbar"
        aria-label={t('BibTeX editor toolbar')}
      >
        <div className="ol-toolbar-layout-left">
          <div
            className="ol-editor-toolbar-button-group"
            aria-label={t('toolbar_undo_redo_actions')}
          >
            <button
              type="button"
              className="ol-cm-toolbar-button"
              aria-label={t('undo')}
              disabled={!canUndo}
              onClick={() =>
                document.dispatchEvent(new CustomEvent(BIB_UNDO_EVENT))
              }
            >
              <span className="material-symbols" aria-hidden="true">
                undo
              </span>
              <span className="visually-hidden">{t('undo')}</span>
            </button>
            <button
              type="button"
              className="ol-cm-toolbar-button"
              aria-label={t('redo')}
              disabled={!canRedo}
              onClick={() =>
                document.dispatchEvent(new CustomEvent(BIB_REDO_EVENT))
              }
            >
              <span className="material-symbols" aria-hidden="true">
                redo
              </span>
              <span className="visually-hidden">{t('redo')}</span>
            </button>
          </div>
        </div>
        <div className="ol-toolbar-layout-right">
          {/* Code/Visual toggle — the leave watchers above handle
              "leaving visual" (no click interception, R2). */}
          <EditorSwitch />
          {/* SaaS reserves the search slot (hidden on narrow widths). */}
          <div style={{ display: 'flex', visibility: 'hidden' }} aria-hidden="true">
            <button
              type="button"
              className="ol-cm-toolbar-button"
              aria-label={t('toolbar_search_file')}
            >
              <span className="material-symbols" aria-hidden="true">
                search
              </span>
              <span className="visually-hidden">
                {t('toolbar_search_file')}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="bib-editor-panel-content">
        <div className="bibtex-list-and-preview">
          {diagnosticsInfo.all.length > 0 && (
            <div className="bib-source-issues" role="alert" aria-live="polite">
              <span className="bib-source-issues-title">
                <span className="material-symbols" aria-hidden="true">warning</span>
                {plural(t, diagnosticsInfo.all.length, '1 source problem found', '__count__ source problems found')}
              </span>
              <ul className="bib-source-issues-list">
                {diagnosticsInfo.all.map(d => (
                  <li key={d.from}>
                    <span className="bib-source-issues-text">
                      {diagnosticLabel(d, t)}
                      {' '}
                      {t('line __line__', { line: d.line })}
                    </span>
                    <button
                      type="button"
                      className="bib-source-issues-goto"
                      onClick={() => scrollTo(d.entryFrom ?? d.from)}
                    >
                      {t('Go')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
            <BibEntryList
              entries={entries}
              onSelect={selectEntry}
              previewId={
                selection?.kind === 'existing' ? selection.entryId : null
              }
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onBulkDelete={
                selectedIds.length > 0
                  ? handleAskBulkDelete
                  : undefined
              }
              onBulkDownload={
                selectedIds.length > 0 ? handleBulkDownload : undefined
              }
              openDocName={openDocName ?? undefined}
              diagnostics={diagnosticsInfo.byEntry}
              onAddPaste={() => {
                // clear any stale upload text so "Paste references" is blank
                setUploadText('')
                setImportOpen(true)
              }}
              onAddManual={() => setManualShow(true)}
              onAddFromLibrary={() => setLibraryImportOpen(true)}
              onAddFromOrcid={() => setOrcidOpen(true)}
              onAddFromZotero={
                bibServices.zotero !== false ? () => setZoteroOpen(true) : undefined
              }
              onAddFromMendeley={
                bibServices.mendeley !== false
                  ? () => setMendeleyOpen(true)
                  : undefined
              }
              onAddUpload={openUpload}
            />
            {selection?.kind === 'existing' && previewEntry ? (
              <BibEntryPreview
                entries={entries}
                entry={{
                  type: previewEntry.type,
                  id: previewEntry.id,
                  fields: { ...previewEntry.fields },
                }}
                previewIndex={previewIndex}
                onPrev={handlePrev}
                onNext={handleNext}
                onClose={handlePreviewClose}
                onDownload={handleDownload}
                onDelete={() => setShowDeleteConfirm(true)}
                onFormChange={handleFormChange}
                existingIds={entries.map(e => e.id)}
                canDelete
                resizerStorageKey="bibPanelResizer"
              />
            ) : null}
          </div>
      </div>

      {/* Single-entry delete confirm (preview Actions) */}
      <GenericConfirmModal
        show={showDeleteConfirm}
        onHide={() => setShowDeleteConfirm(false)}
        title={t('Delete entry')}
        message={t(
          'Are you sure you want to delete this entry? This action cannot be undone.'
        )}
        confirmLabel={t('delete')}
        primaryVariant="danger"
        onConfirm={handleConfirmDelete}
      />

      {/* Bulk delete confirm (W5 core, bulk bar) */}
      <GenericConfirmModal
        show={bulkDeleteGuard !== null}
        onHide={() => setBulkDeleteGuard(null)}
        title={t('Delete entry')}
        message={t('Delete __count__ references? This action cannot be undone.', {
          count: bulkDeleteGuard?.entryIds.length ?? 0,
        })}
        confirmLabel={t('delete')}
        primaryVariant="danger"
        onConfirm={handleConfirmBulkDelete}
      />

      {/* C5 paste import (the Add dropdown "Paste references") — and the
          owner-#11 "Upload .bib file" flow (pre-filled via initialText). */}
      <BibImportModal
        show={importOpen}
        existingIds={entries.map(e => e.id)}
        source={source}
        expectedSource={sourceMirror.current}
        initialText={uploadText}
        onImport={handleImportEntries}
        onHidden={() => setImportOpen(false)}
      />
      {/* Hidden .bib file picker (owner #11): mirrors the library page's
          "Upload .bib file" input. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".bib,application/x-bibtex,text/plain"
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        onChange={e => void handleFileUpload(e)}
      />
      <BibManualModal
        show={manualShow}
        existingIds={entries.map(e => e.id)}
        onSave={(entry, kind) => handleChecked(entry, kind)}
        onHide={() => setManualShow(false)}
      />

      {/* C9 (LIBRARY_PLAN.md): Import from Library — the Add dropdown item
          (enabled; the pre-L disabled stub is the no-wire fallback). */}
      <BibImportFromLibrary
        show={libraryImportOpen}
        existingIds={entries.map(e => e.id)}
        onImport={handleLibraryImport}
        onHidden={() => setLibraryImportOpen(false)}
      />

      {/* P2: Import from ORCID (Add dropdown "Import from ORCID.org") */}
      <OrcidPickerModal
        show={orcidOpen}
        handleHide={() => setOrcidOpen(false)}
        onInsert={handleOrcidInserted}
      />
      {/* P4: Import from Zotero (Add dropdown "Import from Zotero") */}
      <ZoteroPickerModal
        show={zoteroOpen}
        handleHide={() => setZoteroOpen(false)}
        onInsert={handleOrcidInserted}
      />
      {/* Mendeley picker (Add dropdown "Import from Mendeley") */}
      <MendeleyPickerModal
        show={mendeleyOpen}
        handleHide={() => setMendeleyOpen(false)}
        onInsert={handleOrcidInserted}
      />
    </div>
  )
}

function BibEditorFallback() {
  const { t } = useTranslation()
  return (
    <div className="bib-editor-panel">
      <div className="bib-editor-placeholder">
        <div className="bib-editor-placeholder-text">
          {t('Something went wrong loading the bibliography editor.')}
        </div>
      </div>
    </div>
  )
}

export default withErrorBoundary(BibEditorPanel, () => <BibEditorFallback />)
