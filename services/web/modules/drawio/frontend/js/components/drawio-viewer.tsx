import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'

import {
  parseDrawioFile,
  buildDrawioFile,
  DEFAULT_DRAWIO_XML,
  drawioHashPollMs,
} from '../util/drawio-protocol'
import { applyOverleafHostConstraints } from '../util/drawio-app'

import './drawio-viewer.css'

/**
 * draw.io visual editor for `.drawio` documents (AK-11, owner 2026-10-08:
 * "a drawio-ish viewer/editor TUI for the drawio files").
 *
 * Registered through Overleaf's `visualEditorProviders` hook (exactly like
 * the tikz and diagram modules) — it replaces the code editor in the
 * editor pane; "Code | Visual" switches to the raw source.
 *
 * Implementation (house pattern — see modules/tikz and the svgedit
 * plane): the vendored draw.io app (public/static/drawio, PROVENANCE.txt)
 * runs in a SAME-ORIGIN IFRAME and syncs with the OlliTeX-owned document
 * through the draw.io hash protocol:
 *
 *   host -> iframe : location.hash = '#R' + app.Graph.compress(<model xml>)
 *   host -> iframe : location.hash = '#R' + app.Graph.compress(<model xml>)
 *   iframe -> host : the host reads the app's LIVE graph model
 *                    (Graph.app.editor.graph, encoded with the app's own
 *                    mxCodec + mxUtils.getXml) — the hash decode is the
 *                    fallback. The app does NOT rewrite the hash on canvas
 *                    edits (only through its own save flow, which we
 *                    disable), so hash-polling alone lost every edit
 *                    (owner 2026-10-13 round 2: "The drawio file changes
 *                    are NOT saved in the overleaf project").
 *
 * Mode (owner 2026-10-13 round 2, c): `.drawio` is FIXED TO VISUAL — no
 * Code|Visual toggle is rendered for this editor (the provider defaults to
 * visual); the document stays plain text underneath (Code view remains
 * possible for power users through the editor state, but is no longer
 * offered in the UI).
 *
 * SAVE POLICY (owner 2026-10-13): "Save is only allowed to save into the
 * overleaf file tree with the pre-created file."
 *   - every canvas edit is pulled into the document within POLL_MS — the
 *     Overleaf document autosave persists it (no separate save step);
 *   - File>Save / Ctrl+S flush that pull immediately (intercepted in the
 *     capture phase by drawio-app.ts); the app's own save dialog, share
 *     button, new/open libraries and other file management are removed.
 *
 * SCALING (owner 2026-10-13): the app sizes itself to its window on
 * resize; the host forwards iframe resizes to the app window so the canvas
 * follows the Overleaf editor pane.
 */

const POLL_MS = drawioHashPollMs
const BOOT_POLL_MS = 150
const BOOT_TIMEOUT_MS = 30_000
const IFRAME_SRC =
  '/static/drawio/index.html?spin=1&noHelpS=1' +
  '&noSaveBtn=1&noExitBtn=1&saveAndExit=0&od=0'

type AppWindow = Window & {
  Graph?: {
    compress: (xml: string) => string
    decompress: (b64: string) => string
    app?: {
      editor?: {
        graph?: {
          model?: { root?: unknown }
        }
      }
    }
  }
  mxCodec?: new (doc: Document) => {
    encode: (cell: unknown, cellMap?: unknown) => { nodeName: string }
  }
  mxUtils?: {
    getXml: (node: { nodeName: string }) => string
  }
}

export default function DrawioViewer () {
  const { openDocName } = useEditorOpenDocContext()
  const cmView = useCodeMirrorViewContext()
  const { t } = useTranslation()

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const docRef = useRef<string>('')
  const loadedRef = useRef(false)

  const [status, setStatus] = useState<'booting' | 'ready' | 'saved' | 'error'>('booting')
  const [statusText, setStatusText] = useState('')

  const appWin = useCallback((): AppWindow | null => {
    return (iframeRef.current?.contentWindow as AppWindow) || null
  }, [])

  const writeDoc = useCallback(
    (xml: string): boolean => {
      if (!cmView) return false
      if (cmView.state.doc.toString() === xml) return true // no-op
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: xml },
      })
      return true
    },
    [cmView],
  )

  // host → app: hand the document's MODEL over through the hash.
  const pushDoc = useCallback(
    (text: string, fileName: string | null): boolean => {
      const win = appWin()
      if (!win || !win.Graph || typeof win.Graph.compress !== 'function') {
        return false
      }
      const parsed = text && text.trim() ? parseDrawioFile(text) : null
      if (!parsed) return false
      let hash: string
      try {
        hash =
          parsed.form === 'inline'
            ? '#R' + win.Graph.compress(parsed.xml)
            : '#R' + parsed.payload
        win.name = fileName == null ? '' : fileName
        win.location.hash = hash
      } catch (e) {
        return false
      }
      return true
    },
    [appWin],
  )

  // app → host: read the app's LIVE graph model (Graph.app.editor.graph,
  // encoded with the app's own mxCodec + mxUtils.getXml). Falls back to
  // decoding the hash when the live API is unavailable.
  const readAppModel = useCallback((): string | null => {
    const win = appWin()
    if (!win || !win.Graph) return null
    try {
      const root = win.Graph.app?.editor?.graph?.model?.root
      const Codec = win.mxCodec
      const getXml = win.mxUtils?.getXml
      if (root && typeof Codec === 'function' && typeof getXml === 'function') {
        const node = new Codec(win.document).encode(root, null)
        const xml = getXml(node)
        if (xml && xml.trim()) return xml
      }
    } catch (e) {
      /* fall through to the hash */
    }
    const hash = win.location?.hash || ''
    if (!hash.startsWith('#R') || typeof win.Graph.decompress !== 'function') {
      return null
    }
    try {
      return win.Graph.decompress(hash.slice(2))
    } catch (e) {
      return null
    }
  }, [appWin])

  // a model with only the canonical 0/1 root cells = the blank default
  const cellCount = (xml: string): number => (xml.match(/mxCell/g) || []).length

  // app → host: pull the app's current state into the Overleaf document.
  // A blank app model never replaces a document that has real content
  // (guards the push-not-yet-reflected window); `allowClobber` (Ctrl+S
  // flush) additionally allows replacing non-diagram document content.
  // Returns false when there is nothing (yet) to pull or the write was
  // refused.
  const pullToDoc = useCallback(
    (allowClobber: boolean): boolean => {
      const model = readAppModel()
      if (!model || !model.trim()) return false
      const next = buildDrawioFile(model)
      if (next === docRef.current) return true // already in sync
      const cur = cmView
        ? cmView.state.doc.toString()
        : docRef.current
      if (!allowClobber && cur && cur.trim() && !parseDrawioFile(cur)) {
        return false // document holds non-diagram content: do not replace it
      }
      // blank app model vs. real diagram in the document: do not clobber
      if (cellCount(model) <= 2) {
        const parsed = cur && cur.trim() ? parseDrawioFile(cur) : null
        if (
          parsed &&
          cellCount(parsed.form === 'inline' ? parsed.xml : cur) > 2
        ) {
          return false
        }
      }
      if (writeDoc(next)) {
        docRef.current = next
        return true
      }
      return false
    },
    [readAppModel, writeDoc, cmView],
  )

  // File>Save / Ctrl+S (intercepted in the app window): flush the pull
  // immediately and surface "saved" — the Overleaf document autosave does
  // the persistence into the file tree.
  const flushSave = useCallback(() => {
    const ok = pullToDoc(true)
    if (ok) {
      setStatus('saved')
      setStatusText(t('drawio_saved'))
    }
  }, [pullToDoc, t])

  // BOOT — poll for the app, hand it the document (or seed a blank diagram
  // for empty files), then apply the host constraints. Retries until the
  // hand-off succeeds; only marks loaded AFTER a successful push (the old
  // early flag left the status stuck on "Loading draw.io…" for empty
  // files — see owner report 2026-10-13).
  useEffect(() => {
    let cancelled = false

    const tryBoot = (): boolean => {
      if (cancelled || loadedRef.current) return true
      const win = appWin()
      if (!(win && win.Graph && typeof win.Graph.compress === 'function')) {
        return false
      }
      let source = cmView ? cmView.state.doc.toString() : docRef.current
      if (!source || !source.trim()) {
        // empty (pre-)created file: seed the canonical blank diagram into
        // the document (Overleaf autosave persists it) and push it
        source = buildDrawioFile(DEFAULT_DRAWIO_XML)
        writeDoc(source)
      }
      if (!parseDrawioFile(source)) {
        // not diagram content at all: hand the app a blank diagram instead
        // of failing forever (the document stays as-is for the code view)
        source = buildDrawioFile(DEFAULT_DRAWIO_XML)
      }
      if (pushDoc(source, openDocName ?? null)) {
        docRef.current = source
        try {
          applyOverleafHostConstraints(win, {
            savedText: t('drawio_saved'),
            onFlushSave: flushSave,
          })
        } catch (e) {
          /* constraints are an enhancement; never block the editor */
        }
        loadedRef.current = true
        setStatus('ready')
        setStatusText(t('drawio_status_ready'))
        return true
      }
      return false
    }

    const bootTimer = window.setInterval(() => {
      if (tryBoot()) window.clearInterval(bootTimer)
    }, BOOT_POLL_MS)
    if (tryBoot()) window.clearInterval(bootTimer)

    // The share button + status surfaces are (re)created per app load —
    // re-apply the constraints briefly after boot in case they land late.
    const settle1 = window.setTimeout(() => {
      if (!loadedRef.current) return
      try {
        const win = appWin()
        if (win) {
          applyOverleafHostConstraints(win, {
            savedText: t('drawio_saved'),
            onFlushSave: flushSave,
          })
        }
      } catch (e) {
        /* ignore */
      }
    }, 1000)
    const settle2 = window.setTimeout(() => {
      if (!loadedRef.current) return
      try {
        const win = appWin()
        if (win) {
          applyOverleafHostConstraints(win, {
            savedText: t('drawio_saved'),
            onFlushSave: flushSave,
          })
        }
      } catch (e) {
        /* ignore */
      }
    }, 3000)

    const timeout = window.setTimeout(() => {
      if (!loadedRef.current) {
        setStatus('error')
        setStatusText(t('drawio_error_boot'))
      }
    }, BOOT_TIMEOUT_MS)

    return () => {
      cancelled = true
      window.clearTimeout(settle1)
      window.clearTimeout(settle2)
      window.clearTimeout(timeout)
      window.clearInterval(bootTimer)
    }
  }, [appWin, cmView, openDocName, pushDoc, flushSave, t, writeDoc])

  // SYNC — poll the (same-origin) app's hash; when it points at a diagram
  // that differs from what we last pushed, decode it through the app's own
  // Graph.decompress and write it back into the OlliTeX document.
  useEffect(() => {
    if (!cmView) return
    const tick = () => {
      if (!loadedRef.current) return
      pullToDoc(false)
    }
    const timer = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(timer)
  }, [appWin, cmView, pullToDoc])

  // AK-10-class correctness (same race as tikz): if the open doc CHANGED
  // while the canvas is up (e.g. one.drawio -> two.drawio in the tree),
  // the app must receive the NEW document.
  useEffect(() => {
    if (!cmView || !loadedRef.current) return
    const src = cmView.state.doc.toString()
    if (src && src !== docRef.current) {
      if (pushDoc(src, openDocName ?? null)) {
        docRef.current = src
      }
    }
  }, [openDocName, cmView, pushDoc])

  // Read the INITIAL document into docRef (CodeMirror is the single
  // source of truth — the document stays editor-owned).
  useEffect(() => {
    if (cmView) {
      docRef.current = cmView.state.doc.toString()
    }
  }, [cmView])

  // SCALING (owner 2026-10-13: "drawio windows does not scale with the
  // overleaf editor windows") — the app sizes itself on its own resize
  // event; forward every iframe resize to the app window so the canvas
  // follows the editor pane (split divider, window resizes, responsive
  // relayouts).
  useEffect(() => {
    const el = iframeRef.current
    if (!el) return
    const RO =
      (window as unknown as { ResizeObserver?: new (cb: () => void) => {
        observe: (t: Element) => void
        disconnect: () => void
      } })?.ResizeObserver
    if (!RO) return
    const ro = new RO(() => {
      const win = el.contentWindow
      if (!win) return
      try {
        win.dispatchEvent(new win.Event('resize'))
      } catch (e) {
        /* the app is still booting; the next resize will hit */
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
        {/* (owner 2026-10-13 round 2, c): no Code|Visual toggle for .drawio —
            this editor is FIXED TO VISUAL; the document underneath stays
            plain text for tooling, but the toggle is not offered here. */}
      </div>
      <iframe
        ref={iframeRef}
        className="drawio-viewer-frame"
        src={IFRAME_SRC}
        title="draw.io canvas editor"
      />
    </div>
  )
}
