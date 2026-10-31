import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import EditorSwitch from '@/features/source-editor/components/editor-switch'

import {
  parseDrawioFile,
  drawioHashPollMs,
} from '../util/drawio-protocol'

import './drawio-viewer.css'

/**
 * draw.io visual editor for `.drawio` documents (AK-11, owner 2026-10-08:
 * "a drawio-ish viewer/editor TUI for the drawio files").
 *
 * Registered through Overleaf's `visualEditorProviders` hook (exactly like
 * the tikz and diagram modules) — it replaces the code editor in the
 * editor pane; "Code | Visual" switches to the raw XML source.
 *
 * Implementation (house pattern — see modules/tikz, module diagram and the
 * svgedit plane): the vendored draw.io app (public/static/drawio/,
 * PROVENANCE.txt) runs in a SAME-ORIGIN IFRAME and syncs with the
 * OlliTeX-owned document through the draw.io hash protocol:
 *
 *   host -> iframe : location.hash = '#R' + app.Graph.compress(xml)
 *   iframe -> host : on edit the app rewrites the hash itself; the host
 *                    polls (same-origin read) and decodes it with
 *                    app.Graph.decompress, then writes the result into
 *                    the CodeMirror-backed document.
 *
 * The document stays OlliTeX-owned (normal sync / versioning apply) — the
 * iframe only isolates the third-party app.
 */

const POLL_MS = drawioHashPollMs

type AppWindow = Window & {
  Graph?: {
    compress: (xml: string) => string
    decompress: (b64: string) => string
  }
}

export default function DrawioViewer () {
  const { openDocName } = useEditorOpenDocContext()
  const cmView = useCodeMirrorViewContext()
  const { t } = useTranslation()

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const docRef = useRef<string>('')
  const loadedRef = useRef(false)

  const [status, setStatus] = useState<'booting' | 'ready' | 'error'>('booting')
  const [statusText, setStatusText] = useState('')

  const appWin = useCallback((): AppWindow | null => {
    return (iframeRef.current?.contentWindow as AppWindow) || null
  }, [])

  const pushHash = useCallback(
    (xml: string, fileName: string | null) => {
      const win = appWin()
      if (!win || !win.Graph || typeof win.Graph.compress !== 'function') return false
      const hash = '#R' + win.Graph.compress(xml)
      win.name = fileName == null ? '' : fileName
      try {
        win.location.hash = hash
        docRef.current = xml
        return true
      } catch (e) {
        return false
      }
    },
    [appWin]
  )

  const writeDoc = useCallback(
    (xml: string) => {
      if (!cmView) return false
      if (cmView.state.doc.toString() === xml) return true // no-op
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: xml },
      })
      return true
    },
    [cmView],
  )

  // BOOT — once the iframe's app has loaded, hand it the current document.
  useEffect(() => {
    let cancelled = false
    let timer = 0

    const tryBoot = () => {
      if (cancelled || loadedRef.current) return true
      const win = appWin()
      if (win && win.Graph && typeof win.Graph.compress === 'function') {
        loadedRef.current = true
        const source = cmView ? cmView.state.doc.toString() : docRef.current
        if (source && pushHash(source, openDocName ?? null)) {
          setStatus('ready')
          setStatusText(t('drawio_status_ready'))
          return true
        }
      }
      return false
    }

    const bootTimer = window.setInterval(() => {
      if (tryBoot()) window.clearInterval(bootTimer)
    }, 150)

    const timeout = window.setTimeout(() => {
      if (!loadedRef.current) {
        setStatus('error')
        setStatusText(t('drawio_error_boot'))
      }
    }, 30_000)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      window.clearInterval(bootTimer)
    }
  }, [appWin, cmView, openDocName, pushHash, t])

  // SYNC — poll the (same-origin) app's hash: when it points at a diagram
  // that differs from what we last pushed, decode it through the app's own
  // Graph.decompress and write it back into the OlliTeX document.
  useEffect(() => {
    if (!cmView) return

    const tick = () => {
      const win = appWin()
      if (!win || !win.Graph || typeof win.Graph.decompress !== 'function') return
      const hash = win.location.hash || ''
      if (!hash.startsWith('#R')) return
      let xml: string
      try {
        xml = win.Graph.decompress(hash.slice(2))
      } catch (e) {
        return
      }
      if (!xml || xml === docRef.current) return
      if (writeDoc(xml)) {
        docRef.current = xml
      }
    }

    const timer = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(timer)
  }, [appWin, cmView, writeDoc])

  // AK-10-class correctness (same race as tikz): if the OPEN DOCHANGED
  // while the canvas is up (e.g. one.tikz -> two.tikz in the tree), the
  // app must receive the NEW document — re-push it so the canvas always
  // shows the double-clicked file.
  useEffect(() => {
    if (!cmView || !loadedRef.current) return
    const src = cmView.state.doc.toString()
    if (src && src !== docRef.current) {
      if (pushHash(src, openDocName ?? null)) {
        docRef.current = src
      }
    }
  }, [openDocName, cmView, pushHash])

  // Read the INITIAL document into docRef (CodeMirror is the single
  // source of truth — the document stays editor-owned).
  useEffect(() => {
    if (cmView) {
      docRef.current = cmView.state.doc.toString()
    }
  }, [cmView])

  return (
    <div className="drawio-viewer">
      <div className="drawio-viewer-toolbar">
        <span className="drawio-viewer-title">{t('drawio_title')}</span>
        <span
          className={
            'drawio-viewer-status' +
            (status === 'error' ? ' drawio-viewer-status-error' : '')
          }>
          {statusText ||
            (status === 'booting' ? t('drawio_status_loading') : '')}
        </span>
        {/* AB (owner 2026-10-09): the Code|Visual switch lives in the CodeMirror
            toolbar, which CodeMirrorView[hidden] hides together with the code
            pane — so in VISUAL mode the switch is invisible (measured 0x0) and
            the user is stuck in the canvas with no way back to the source.
            Mounting it in THIS toolbar row: visible exactly when the code pane
            is hidden, driven by the same editor-properties state. */}
        <div className="drawio-viewer-switch">
          <EditorSwitch />
        </div>
      </div>
      <iframe
        ref={iframeRef}
        className="drawio-viewer-frame"
        src="/static/drawio/index.html?spin=1&amp;noHelpS=1&amp;od=0"
        title="draw.io canvas editor"
      />
    </div>
  )
}
