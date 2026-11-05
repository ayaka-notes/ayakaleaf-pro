/**
 * CodeMirror extension for the bib-editor module.
 *
 * Registered via overleafModuleImports.sourceEditorExtensions (settings).
 *
 * Responsibilities:
 *  1. Detect when the current document is a .bib file
 *  2. Parse BibTeX entries (300 ms debounce) and emit them to the React
 *     context via DOM CustomEvents — the document always stays the truth
 *  3. Apply guarded write/delete requests from the React panel:
 *       - ranges are resolved against the CURRENTLY SHOWN document (no
 *         cached offsets → the "Invalid change range" crash class is gone)
 *       - the event carries `expectedSource` (the source snapshot the panel
 *         flushed from); a mismatch means the view already switched to
 *         another file, so the write is REJECTED (surfaced via a
 *         "write-failed" event) instead of corrupting the new document
 *       - after a SUCCESSFUL guarded write the fresh parse is re-emitted with
 *         `written: { id, mode, originalId }`, so the context re-binds the
 *         form to the written entry only when it actually landed; on
 *         rejection nothing changes (the banner shows and the form stays)
 *
 * This extension holds no React state; all bridging is event-based, which is
 * the sanctioned module pattern (see REDESIGN_PLAN.md §2.9).
 */
import { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { parseBibFile, serializeBibEntry } from '../utils/bib-parser'
import type { ParsedBibEntry } from '../utils/bib-parser'
import {
  planBibWrite,
  planBibDelete,
  planBibBulkDelete,
  planBibImport,
  isBibDocument,
} from '../utils/bib-write'
import type { BibEntry } from '../utils/bib-types'

/**
 * Module-internal event names. The React side (bib-editor-context.tsx /
 * bib-editor-provider.tsx) listens and dispatches using these names.
 */
export const BIB_ENTRIES_EVENT = 'bib-editor:entries-updated'
export const BIB_WRITE_EVENT = 'bib-editor:write'
export const BIB_DELETE_EVENT = 'bib-editor:delete'
export const BIB_IMPORT_EVENT = 'bib-editor:import'
export const BIB_SCROLL_TO_EVENT = 'bib-editor:scroll-to'
export const BIB_WRITE_FAILED_EVENT = 'bib-editor:write-failed'
// Document-level undo/redo (SaaS bibtex toolbar parity):
export const BIB_UNDO_EVENT = 'bib-editor:undo'
export const BIB_REDO_EVENT = 'bib-editor:redo'
// File-scoped history reset (panel mount / file switch):
export const BIB_RESET_HISTORY_EVENT = 'bib-editor:reset-history'
// Toolbar enabled-state (SaaS: Undo/Redo grey out when the stack is empty).
export const BIB_HISTORY_STATE_EVENT = 'bib-editor:history-state'

/** Coalesce rapid successive updates into one undo step (ms). */
const HISTORY_COALESCE_MS = 700
/** Bounded snapshot history (a .bib document is small; still bound it). */
const HISTORY_MAX = 100
/**
 * Minimum shared prefix/suffix length (chars) for treating a document
 * change as an EDIT of the same file rather than a FILE SWAP. A user edit
 * (typing, find-replace, bulk append) always leaves a long shared boundary;
 * a load of a different file usually does not.
 */
const SAME_DOC_SHARED_CHARS = 64

/**
 * Pure heuristic: does `next` look like an edited version of `prev` (same
 * file)? Used only to DECIDE whether to fold a change into the undo stack
 * or RESET it — a false positive costs one lost undo step, never data.
 */
export function looksLikeSameDocument(prev: string, next: string): boolean {
  if (next === prev) return true
  const k = Math.min(SAME_DOC_SHARED_CHARS, prev.length, next.length)
  if (k === 0) return true
  return (
    prev.slice(0, k) === next.slice(0, k) ||
    prev.slice(-k) === next.slice(-k)
  )
}

/**
 * Pure document-level undo/redo state machine (SaaS bibtex toolbar parity).
 *
 * Invariant: `history[0]` is the document when the session started. A live
 * edit appends the NEW source; `pos === null` means "at the live head".
 * Undoing then editing discards the redo tail (standard editor behaviour).
 * Kept free of any EditorView dependency so it can be unit-tested directly.
 */
export class BibHistory {
  private history: string[]
  private historyPos: number | null = null

  constructor(initial: string, maxSize: number = HISTORY_MAX) {
    this.history = [initial]
    this.maxSize = maxSize
  }

  private maxSize: number

  get length(): number {
    return this.history.length
  }

  /** The document currently in force (live head or the undone position). */
  get current(): string {
    const idx =
      this.historyPos === null
        ? this.history.length - 1
        : this.historyPos
    return this.history[idx] ?? ''
  }

  get canUndo(): boolean {
    return this.history.length > 1 && (this.historyPos === null
      ? this.history.length - 1 > 0
      : this.historyPos > 0)
  }

  get canRedo(): boolean {
    return (
      this.historyPos !== null &&
      this.historyPos < this.history.length - 1
    )
  }

  /**
   * Record a live document change. `replaceTop` coalesces a rapid
   * successive update (typing burst) into the previous step.
   */
  append(doc: string, replaceTop = false): void {
    if (this.historyPos === null) {
      if (replaceTop && this.history.length > 1) {
        this.history[this.history.length - 1] = doc
      } else {
        this.history.push(doc)
      }
    } else {
      // An edit after undoing discards the discarded tail (standard).
      this.history = this.history.slice(0, this.historyPos + 1)
      this.history.push(doc)
      this.historyPos = null
    }
    if (this.history.length > this.maxSize) {
      this.history.splice(0, this.history.length - this.maxSize)
    }
  }

  /**
   * Undo one step. Returns the document to apply, or null when nothing
   * can be undone (pos advances so the next call continues).
   */
  undo(): string | null {
    const n = this.history.length
    const pos = this.historyPos === null ? n - 1 : this.historyPos
    const target = pos - 1
    if (target < 0 || target >= n) return null
    this.historyPos = target
    return this.history[target]
  }

  /** Redo one step. Returns the document to apply, or null. */
  redo(): string | null {
    if (this.historyPos === null) return null
    const target = this.historyPos + 1
    if (target >= this.history.length) return null
    this.historyPos = target
    return this.history[target]
  }

  /** Replace the whole stack (file switch / session reset). */
  reset(doc: string): void {
    this.history = [doc]
    this.historyPos = null
  }
}

class BibEditorPlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private dispatchHandler: ((ev: Event) => void) | null = null
  private scrollHandler: ((ev: Event) => void) | null = null
  private historyHandler: ((ev: Event) => void) | null = null

  // Document history (SaaS toolbar undo/redo) — pure state machine + the
  // editor-facing bindings below.
  private history: BibHistory
  private lastPushTime = 0
  private lastPushSource = ''
  /** The document moveHistory() dispatched; cleared by update() on apply. */
  private pendingHistoryDoc: string | null = null
  /** File (openDocName) the undo stack currently belongs to (event path). */
  private historyFile: string | null = null
  private resetHandler: ((ev: Event) => void) | null = null

  constructor(private view: EditorView) {
    this.history = new BibHistory(this.view.state.doc.toString())
    this.setupDispatchListener()
    this.setupScrollListener()
    this.setupHistoryListener()
    this.emitState()
    this.emitHistoryState()
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      const prev = update.startState.doc.toString()
      const next = update.state.doc.toString()
      // The moveHistory() dispatch produces exactly the document we applied
      // (tracked locally — CM6 major differences make transaction metadata
      // unreliable across versions). Any other doc change is a real edit.
      const isHistoryMove =
        this.pendingHistoryDoc !== null && next === this.pendingHistoryDoc
      if (isHistoryMove) {
        this.pendingHistoryDoc = null
        // History application: don't pollute the stack; just resync.
        this.lastPushSource = next
      } else if (!looksLikeSameDocument(prev, next)) {
        // No long shared boundary: this is a FILE SWAP (or a full-document
        // replacement), not an edit. Folding it in would let the next undo
        // restore the PREVIOUS file's text, so reset the stack instead.
        this.history.reset(next)
        this.lastPushSource = next
        this.lastPushTime = 0
        this.emitHistoryState()
      } else {
        this.recordHistory(prev, next)
      }
      this.debouncedParse()
    }
  }

  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.dispatchHandler) {
      document.removeEventListener(BIB_WRITE_EVENT, this.dispatchHandler)
      document.removeEventListener(BIB_DELETE_EVENT, this.dispatchHandler)
      document.removeEventListener(BIB_IMPORT_EVENT, this.dispatchHandler)
      this.dispatchHandler = null
    }
    if (this.scrollHandler) {
      document.removeEventListener(BIB_SCROLL_TO_EVENT, this.scrollHandler)
      this.scrollHandler = null
    }
    if (this.historyHandler) {
      document.removeEventListener(BIB_UNDO_EVENT, this.historyHandler)
      document.removeEventListener(BIB_REDO_EVENT, this.historyHandler)
      this.historyHandler = null
    }
    if (this.resetHandler) {
      document.removeEventListener(BIB_RESET_HISTORY_EVENT, this.resetHandler)
      this.resetHandler = null
    }
  }

  // ---------------------------------------------------------------- history

  get canUndo(): boolean {
    return this.history.canUndo
  }

  get canRedo(): boolean {
    return this.history.canRedo
  }

  /**
   * Record a live document change into the history stack. Coalesces rapid
   * consecutive updates (typing bursts) into a single step.
   */
  private recordHistory(prevSource: string, newSource: string) {
    if (newSource === prevSource) return
    const now = Date.now()
    const replaceTop =
      now - this.lastPushTime < HISTORY_COALESCE_MS &&
      this.lastPushSource === prevSource
    this.history.append(newSource, replaceTop)
    this.lastPushTime = now
    this.lastPushSource = newSource
    this.emitHistoryState()
  }

  private moveHistory(direction: -1 | 1) {
    const doc = direction === -1 ? this.history.undo() : this.history.redo()
    if (doc === null) return
    // Track the exact document this move applies so update() can tell a
    // history application apart from a real edit (no CM6 metadata needed).
    this.pendingHistoryDoc = doc
    // NOTE: `state.update(spec)` returns the Transaction itself (CM6 API);
    // destructuring a `{ transaction }` key yields undefined and the dispatch
    // then crashes inside resolveTransaction.
    const transaction = this.view.state.update({
      changes: { from: 0, to: this.view.state.doc.length, insert: doc },
      selection: { anchor: 0 },
      // Undo is a first-class OT origin (source-editor/realtime.ts maps
      // userEvent 'undo' onto the document op metadata) — tag the move so
      // the sync pipeline and any listeners see an undo, not a plain edit.
      userEvent: direction === -1 ? 'undo' : 'redo',
    })
    this.view.dispatch(transaction)
    this.emitHistoryState()
  }

  /**
   * Undo/redo requests from the toolbar (bib-editor-panel.tsx).
   */
  private setupHistoryListener() {
    this.historyHandler = (ev: Event) => {
      if (ev.type === BIB_UNDO_EVENT) this.moveHistory(-1)
      else if (ev.type === BIB_REDO_EVENT) this.moveHistory(1)
    }
    document.addEventListener(BIB_UNDO_EVENT, this.historyHandler)
    document.addEventListener(BIB_REDO_EVENT, this.historyHandler)
    // File-scoped history reset (see BIB_RESET_HISTORY_EVENT). The panel
    // dispatches it on mount and on every openDocName change; skipping when
    // the file is unchanged keeps the stack across a Code->Visual round-
    // trip (undo must survive the toggle). Resetting on a genuinely new
    // file prevents undo from restoring the PREVIOUS file's text into this
    // file's buffer.
    this.resetHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { file?: string } | null
      if (!detail || typeof detail.file !== 'string') return
      if (this.historyFile === detail.file) return
      this.historyFile = detail.file
      const current = this.view.state.doc.toString()
      this.history.reset(current)
      this.pendingHistoryDoc = null
      this.lastPushSource = current
      this.lastPushTime = 0
      this.emitHistoryState()
    }
    document.addEventListener(BIB_RESET_HISTORY_EVENT, this.resetHandler)
  }

  /**
   * Whether the current document is a bibliography file (heuristic: an
   * `@type{` marker within the first 2k characters).
   */
  private detectBibFile(): boolean {
    // The `@type{` heuristic is module-internal (documented in the plan,
    // pinned by a unit test). isBibDocument samples the first 2k chars.
    return isBibDocument(this.view.state.doc.toString())
  }

  private emitHistoryState() {
    document.dispatchEvent(
      new CustomEvent(BIB_HISTORY_STATE_EVENT, {
        detail: {
          canUndo: this.history.canUndo,
          canRedo: this.history.canRedo,
        },
      })
    )
  }

  private emitState(
    written?: { id: string; mode: 'existing' | 'new'; originalId?: string }
  ) {
    const isBibFile = this.detectBibFile()
    const source = this.view.state.doc.toString()
    document.dispatchEvent(
      new CustomEvent(BIB_ENTRIES_EVENT, {
        detail: {
          entries: isBibFile ? this.parseEntries() : [],
          source,
          isBibFile,
          written,
        },
      })
    )
  }

  private parseEntries(): ParsedBibEntry[] {
    try {
      return parseBibFile(this.view.state.doc.toString())
    } catch {
      return []
    }
  }

  private debouncedParse() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => this.emitState(), 300)
  }

  /**
   * Guarded dispatch of write/delete requests from the panel.
   *
   * `expectedSource` is the source snapshot the panel read when it created
   * the request. If the view no longer holds that exact source, the user has
   * switched files (or the document changed externally) in the meantime →
   * reject instead of write. This makes the "flush from file A while file B
   * is becoming current" race unconditionally safe (REDESIGN_PLAN.md §2.2/R2)
   * and — because the panel only exists in visual mode for `.bib` files —
   * doubles as the "is this still my bib file" gate (plan §12 P1c).
   */
  private setupDispatchListener() {
    this.dispatchHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (!detail) {
        return
      }
      const source = this.view.state.doc.toString()
      const {
        entry,
        entries,
        mode,
        originalId,
        expectedSource,
      } = detail as {
        entry?: BibEntry
        entries?: BibEntry[]
        mode: 'existing' | 'new'
        originalId?: string
        expectedSource?: string
      } & { entryId?: string; entryIds?: string[] }

      if (ev.type === BIB_DELETE_EVENT && !isBibDocument(source)) {
        this.emitWriteFailed('not-a-bib-file')
        return
      }
      if (typeof expectedSource === 'string' && source !== expectedSource) {
        this.emitWriteFailed('doc-changed')
        return
      }

      if (ev.type === BIB_WRITE_EVENT) {
        if (!entry) {
          return
        }
        const guard = planBibWrite(
          source,
          entry,
          mode,
          serializeBibEntry,
          originalId
        )
        if (!guard.ok) {
          this.emitWriteFailed(guard.reason)
          return
        }
        this.view.dispatch({
          changes: {
            from: guard.plan.from,
            to: guard.plan.to,
            insert: guard.plan.insert,
          },
        })
        // Fresh parse WITH the written id: the context re-binds the form to
        // the written entry only when it resolves in that parse. On
        // rejection (above) no re-emit happens → selection untouched, the
        // banner shows and the form stays for a fix (§2.3 / §12 P1a).
        this.emitState({ id: entry.id as string, mode, originalId })
      } else if (ev.type === BIB_IMPORT_EVENT) {
        // C5 Paste import: one guarded, all-or-nothing append of N entries.
        // A zero-entry plan is a deliberate no-op (nothing to import).
        const entriesArg = entries ?? []
        if (entriesArg.length === 0) {
          return
        }
        const guard = planBibImport(source, entriesArg, serializeBibEntry)
        if (!guard.ok) {
          this.emitWriteFailed(guard.reason)
          return
        }
        this.view.dispatch({ changes: guard.changes })
        this.emitState()
      } else if (ev.type === BIB_DELETE_EVENT) {
        const { entryId, entryIds } = detail as {
          entryId?: string
          entryIds?: string[]
        }
        // Bulk delete (W5): one guarded write, all-or-nothing; a zero-
        // change plan (empty selection) is a deliberate no-op.
        if (entryIds !== undefined) {
          const guard = planBibBulkDelete(source, entryIds)
          if (!guard.ok) {
            this.emitWriteFailed(guard.reason)
            return
          }
          if (guard.changes.length === 0) {
            return
          }
          this.view.dispatch({ changes: guard.changes })
          this.emitState()
          return
        }
        const guard = planBibDelete(source, entryId ?? '')
        if (!guard.ok) {
          this.emitWriteFailed(guard.reason)
          return
        }
        this.view.dispatch({
          changes: {
            from: guard.plan.from,
            to: guard.plan.to,
            insert: guard.plan.insert,
          },
        })
        this.emitState()
      }
    }
    document.addEventListener(BIB_WRITE_EVENT, this.dispatchHandler)
    document.addEventListener(BIB_DELETE_EVENT, this.dispatchHandler)
    document.addEventListener(BIB_IMPORT_EVENT, this.dispatchHandler)
  }

  private emitWriteFailed(reason: string) {
    document.dispatchEvent(
      new CustomEvent(BIB_WRITE_FAILED_EVENT, { detail: { reason } })
    )
  }

  /**
   * Scroll-to requests from the React panel (focus an entry in Code mode).
   * R7 (2026-08-29): the entry goes to the TOP of the editor (user
   * request — the old centered scroll felt like 'not there' for long
   * files), with the cursor on it.
   */
  private setupScrollListener() {
    this.scrollHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (!detail) {
        return
      }
      const { position } = detail as { position: number }
      if (typeof position !== 'number') {
        return
      }
      const pos = Math.min(
        Math.max(0, position),
        this.view.state.doc.length
      )
      this.view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'start' }),
      })
      this.view.focus()
    }
    document.addEventListener(BIB_SCROLL_TO_EVENT, this.scrollHandler)
  }
}

/**
 * The extension registered in sourceEditorExtensions.
 *
 * The import-overleaf-module macro compiles the registration into
 * `createExtensions()`, which CALLS `moduleExtensions.map(e => e(options))`
 * — so this must be a factory function, not an Extension value.
 */
export const extension = (
  _options?: Record<string, unknown>
): Extension => {
  return [ViewPlugin.fromClass(BibEditorPlugin)]
}
