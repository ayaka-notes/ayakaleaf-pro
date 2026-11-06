/**
 * Bridge between the CodeMirror extension (DOM events) and the BibEditor
 * React context.
 *
 * Listens to:
 *  - BIB_ENTRIES_EVENT     entries + source + isBibFile from the extension
 *  - BIB_WRITE_FAILED_EVENT a rejected guarded write (surfaces a banner)
 *
 * The panel dispatches BIB_WRITE_EVENT / BIB_DELETE_EVENT /
 * BIB_SCROLL_TO_EVENT (see the extension for the guard contract).
 */
import React, { useEffect } from 'react'
import {
  BibEditorProvider,
  useBibEditorContext,
} from './bib-editor-context'
import type { ParsedBibEntry } from '../utils/bib-parser'
import {
  BIB_ENTRIES_EVENT,
  BIB_WRITE_FAILED_EVENT,
  BIB_HISTORY_STATE_EVENT,
} from '../extensions/bib-editor-extension'

function BibEditorBridge({ children }: { children: React.ReactNode }) {
  const { setEditorState, setWriteFailure, setHistoryState } = useBibEditorContext()

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail
      if (!detail) return
      const { entries, source, isBibFile, written } = detail as {
        entries: ParsedBibEntry[]
        source: string
        isBibFile: boolean
        written?: { id: string; mode: 'existing' | 'new'; originalId?: string }
      }
      setEditorState(isBibFile, entries, source, written)
    }
    const historyHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { canUndo?: boolean; canRedo?: boolean }
        | undefined
      if (detail && (typeof detail.canUndo === 'boolean' || typeof detail.canRedo === 'boolean')) {
        setHistoryState(!!detail.canUndo, !!detail.canRedo)
      }
    }

    const failedHandler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { reason?: string }
        | undefined
      // A rejected guarded write: surface the banner (dismissed by the
      // user, or automatically on the next fresh parse via setEditorState).
      setWriteFailure(detail?.reason ?? 'unknown')
    }

    document.addEventListener(BIB_HISTORY_STATE_EVENT, historyHandler)
    document.addEventListener(BIB_ENTRIES_EVENT, handler)
    document.addEventListener(BIB_WRITE_FAILED_EVENT, failedHandler)
    return () => {
      document.removeEventListener(BIB_HISTORY_STATE_EVENT, historyHandler)
      document.removeEventListener(BIB_ENTRIES_EVENT, handler)
      document.removeEventListener(
        BIB_WRITE_FAILED_EVENT,
        failedHandler
      )
    }
  }, [setEditorState, setWriteFailure, setHistoryState])

  return <>{children}</>
}

/**
 * Composite provider: BibEditorProvider + BibEditorBridge.
 * Registered in rootContextProviders (settings).
 */
export default function BibEditorContextProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <BibEditorProvider>
      <BibEditorBridge>{children}</BibEditorBridge>
    </BibEditorProvider>
  )
}
