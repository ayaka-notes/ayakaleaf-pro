import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import customLocalStorage from '@/infrastructure/local-storage'

import {
  TIKZ_STORAGE_KEY,
  encodeTikzHostMessage,
  handleTikzEmbedMessage,
  tikzEmbedUrl,
} from '../util/tikz-protocol'
import './tikz-viewer.css'

const BOOT_TIMEOUT_MS = 30_000

/**
 * TikZ visual editor for `.tikz` / `.pgf` documents (candidate B, 2026-09-29).
 *
 * Registered through Overleaf's `visualEditorProviders` hook — it replaces
 * the code editor in the editor pane; "Code | Visual" switches to the raw
 * TikZ source.
 *
 * Implementation (house pattern — see modules/diagram): the vendored
 * tikz-editor app (MIT, public/static/tikz-editor/ + PROVENANCE.txt) runs
 * in a SAME-ORIGIN IFRAME and talks to us through a JSON-string postMessage
 * bridge (init -> load(source); change/autosave/save -> source back;
 * export -> data; persistence-save -> localStorage). We push the
 * document in on boot and write every non-trivial source update back into
 * the CodeMirror-backed document — the document itself stays OlliTeX-owned,
 * so the normal sync / versioning pipeline applies (same as the diagram
 * module; the iframe only isolates the third-party app).
 */
export default function TikzViewer () {
  const { openDocName } = useEditorOpenDocContext()
  const cmView = useCodeMirrorViewContext()
  const { t } = useTranslation()

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const docRef = useRef<string>('')
  const openDocNameRef = useRef<string | null>(openDocName)
  openDocNameRef.current = openDocName
  const pendingExportRef = useRef<{
    resolve: (v: string | null) => void
    reject: (e: Error) => void
  } | null>(null)
  const bootedRef = useRef(false)

  const [status, setStatus] = useState<'booting' | 'ready' | 'error'>(
    'booting'
  )
  const [statusText, setStatusText] = useState('')

  const isOwnIframe = useCallback((event: MessageEvent): boolean => {
    // Same-origin iframe: compare the sender to the mounted element.
    return iframeRef.current != null && event.source === iframeRef.current.contentWindow
  }, [])

  const writeDoc = useCallback((source: string) => {
    if (!cmView) return
    if (cmView.state.doc.toString() === source) return // no-op, never dirties
    cmView.dispatch({
      changes: { from: 0, to: cmView.state.doc.length, insert: source }
    })
    docRef.current = source
  }, [cmView])

  const post = useCallback((message: object) => {
    iframeRef.current?.contentWindow?.postMessage(
      encodeTikzHostMessage(message),
      window.location.origin
    )
  }, [])

  const onMessage = useCallback((event: MessageEvent) => {
    if (!isOwnIframe(event)) return

    let payload: unknown = event.data
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload)
      } catch {
        return
      }
    }
    if (payload == null || typeof payload !== 'object') return

    const action = handleTikzEmbedMessage(payload, { doc: docRef.current })

    switch (action.kind) {
      case 'boot-load':
        if (bootedRef.current) return // replay guard
        bootedRef.current = true
        // The embed requested a document: hand it the current source.
        post({ action: 'load', source: action.source, autosave: 1, fileName: openDocName ?? '' })
        setStatus('ready')
        setStatusText(t('tikz_status_ready'))
        return

      case 'ready':
        if (!bootedRef.current) {
          bootedRef.current = true
          post({ action: 'load', source: docRef.current, autosave: 1, fileName: openDocName ?? '' })
        }
        setStatus('ready')
        setStatusText(t('tikz_status_ready'))
        return

      case 'doc-update':
        writeDoc(action.source)
        // Tell the embed the host accepted the change (clears its
        // "unresolved changes" state after a host-side save).
        post({ action: 'status', modified: false })
        return

      case 'export-result':
        if (pendingExportRef.current) {
          pendingExportRef.current.resolve(action.data)
          pendingExportRef.current = null
        }
        return

      case 'persistence-save':
        // The safe wrapper JSON-encodes the value — readStorage() below
        // reads it back through the same wrapper, so the pair round-trips.
        {
          const storage =
            customLocalStorage.getItem(TIKZ_STORAGE_KEY) || {}
          storage[action.key] = action.value
          customLocalStorage.setItem(TIKZ_STORAGE_KEY, storage)
        }
        return

      case 'error':
        if (pendingExportRef.current) {
          pendingExportRef.current.reject(new Error(action.message))
          pendingExportRef.current = null
        }
        setStatus('error')
        setStatusText(action.message)
        return

      case 'noop':
        return
    }
  }, [isOwnIframe, openDocName, post, t, writeDoc])

  // AK-10 (owner 2026-10-08): race guard — the embed can request its
  // document (boot-load/ready) before the open-doc switch has landed in the
  // CodeMirror state, so the first push can carry the PREVIOUS file's
  // source. Listen to the CM state directly: whenever the doc CONTENT
  // diverges from what the canvas last received (docRef) AND the change is
  // NOT the canvas's own write-back, re-push. The content-equality guard
  // makes the loop impossible (a push only happens when the two differ).
  useEffect(() => {
    if (!cmView) return
    const onDocChange = () => {
      if (!bootedRef.current) return
      const doc = cmView.state.doc
      const shown = docRef.current
      // NOTE: a length+head/tail "cheap identical" shortcut is NOT safe —
      // two sources can be equal in length, first-64 and last-64 and still
      // differ in the middle (AKK-ONE-MARKER vs AKK-TWO-MARKER defeated it;
      // the re-push never happened and the canvas kept the previous file).
      // So: full string compare only, gated by CM state-identity below.
      const src = doc.toString()
      if (src !== shown) {
        docRef.current = src
        post({ action: 'load', source: src, autosave: 1, fileName: openDocNameRef.current ?? '' })
      }
    }
    // CM6 has no public subscription on an existing view, so poll on
    // requestAnimationFrame — but only the STATE IDENTITY (O(1)); the full
    // document comparison runs exactly once per real CM update (file switch,
    // edit, or the canvas's own write-back), never per frame. The equality
    // guard in onDocChange makes re-pushes impossible (no loop): the
    // write-back dispatch changes state once, compares equal, and stops.
    let lastState: unknown = null
    let raf = 0
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      const st = cmView.state
      if (lastState !== st) {
        lastState = st
        onDocChange()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [cmView, post])

  useEffect(() => {
    // Read the initial document (CodeMirror state is the single source of
    // truth — the document stays editor-owned, as in modules/diagram).
    if (cmView) {
      docRef.current = cmView.state.doc.toString()
    }
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(() => {
      if (!bootedRef.current) {
        setStatus('error')
        setStatusText(t('tikz_error_boot'))
      }
    }, BOOT_TIMEOUT_MS)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
    }
  }, [onMessage, cmView, t])

  return (
    <div className="tikz-viewer">
      <div className="tikz-viewer-toolbar">
        <span className="tikz-viewer-title">{t('tikz_title')}</span>
        <span
          className={
            'tikz-viewer-status' +
            (status === 'error' ? ' tikz-viewer-status-error' : '')
          }
        >
          {statusText || (status === 'booting' ? t('tikz_status_loading') : '')}
        </span>
      </div>
      <iframe
        ref={iframeRef}
        className="tikz-viewer-frame"
        title={t('tikz_title')}
        src={tikzEmbedUrl(readStorage())}
      />
    </div>
  )
}

function readStorage (): Record<string, string> | null {
  // Same wrapper as the writer (persistence-save handler): the value is a
  // JSON-encoded object of key/value pairs the embed wants re-applied.
  const storage = customLocalStorage.getItem(TIKZ_STORAGE_KEY)
  return storage != null && typeof storage === 'object'
    ? (storage as Record<string, string>)
    : null
}
