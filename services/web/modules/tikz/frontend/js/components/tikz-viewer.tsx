import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import customLocalStorage from '@/infrastructure/local-storage'

import {
  TIKZ_STORAGE_KEY,
  encodeTikzHostMessage,
  handleTikzEmbedMessage,
  isTikzFile,
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
  // True once the first handshake reached "ready". Any iframe `load`
  // event AFTER that means the app reloaded underneath us (browser
  // eviction of a backgrounded iframe, crash-reload, in-place
  // navigation) — the replay guard below would then eat the app's fresh
  // boot-load and leave the canvas EMPTY while the status still claims
  // "ready" (reported 2026-11-08: editor empty after the Overleaf tab
  // sat in the background while an exported SVG was viewed elsewhere,
  // fixed by a tex→tikz re-open cycle that remounts the viewer).
  const readyRef = useRef(false)

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
        // AK-12 (2026-11-07): file-kind gate — during a file switch the
        // open doc (and the CM state it was read from) can still belong to
        // the PREVIOUS file for a few ticks. Only ever feed the embed a
        // document while a TikZ file is the open one; the CM-state guard
        // below completes the load once the right document has landed.
        if (!isTikzFile(openDocNameRef.current)) {
          docRef.current = action.source
          return
        }
        // The embed requested a document: hand it the current source.
        post({ action: 'load', source: action.source, autosave: 1, fileName: openDocName ?? '' })
        setStatus('ready')
        setStatusText(t('tikz_status_ready'))
        readyRef.current = true
        return

      case 'ready':
        if (bootedRef.current) return // boot-load already handled it
        bootedRef.current = true
        if (!isTikzFile(openDocNameRef.current)) return // AK-12 gate
        post({ action: 'load', source: docRef.current, autosave: 1, fileName: openDocName ?? '' })
        setStatus('ready')
        setStatusText(t('tikz_status_ready'))
        readyRef.current = true
        return

      case 'doc-update': {
        // AK-12: never write the canvas source into a non-TikZ document —
        // if a file switch is in flight the open doc is the PREVIOUS file
        // and the write-back would corrupt it. Drop the update and re-sync
        // the canvas to the real open document instead.
        if (!isTikzFile(openDocNameRef.current)) {
          docRef.current = cmView ? cmView.state.doc.toString() : action.source
          if (cmView) {
            post({ action: 'load', source: docRef.current, autosave: 1, fileName: openDocNameRef.current ?? '' })
          }
          return
        }
        writeDoc(action.source)
        // Tell the embed the host accepted the change (clears its
        // "unresolved changes" state after a host-side save).
        post({ action: 'status', modified: false })
        return
      }

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
      // AK-12: only re-sync while a TikZ file is the open document. While a
      // non-TikZ file is open, just track its content so that the switch
      // back to the TikZ file is detected as a content change and pushed.
      if (!isTikzFile(openDocNameRef.current)) {
        docRef.current = cmView.state.doc.toString()
        return
      }
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

  // AK-13 (2026-11-08): app-reload recovery. After the first handshake is
  // ready, a further iframe `load` event means the app restarted
  // (background-tab iframe eviction / crash / in-place navigation).
  // Re-arm the handshake so the app's fresh boot-load is processed and
  // the document is pushed again — otherwise the replay guard leaves the
  // canvas empty (see readyRef above).
  const onIframeLoad = useCallback(() => {
    if (!readyRef.current) return // initial boot: nothing to recover
    readyRef.current = false
    bootedRef.current = false
    setStatus('booting')
    setStatusText('')
  }, [])

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
        key={openDocName}
        src={tikzEmbedUrl(readStorage())}
        onLoad={onIframeLoad}
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
