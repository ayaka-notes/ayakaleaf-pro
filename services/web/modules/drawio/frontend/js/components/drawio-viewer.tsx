import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'

import {
  parseDrawioFile,
  buildDrawioFile,
  modelSignature,
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
 *   host -> iframe : EditorUi.replaceDiagramData(xml) — the app's own
 *                    load API (paste/import path); hash '#R'+compress()
 *                    is the pre-instance fallback
 *   iframe -> host : Editor.getGraphXml() — the app's own model
 *                    serializer (encode(graph.getModel()); hand-encoding
 *                    model.root drops the child cells — that was the
 *                    root cause of canvas edits not landing in the
 *                    document, owner 2026-10-13 round 2)
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
 *
 * CROSS-FILE INTEGRITY (owner 2026-10-27: "opening the e2e.drawio file
 * destroys the content of test1.drawio") — the viewer is ONE component
 * for the whole editor pane (Overleaf renders a single `<VisualEditor />`
 * without a per-file key), i.e. ONE app instance with a single GLOBAL
 * diagram model serving EVERY `.drawio` file in turn. After the user
 * switches files the app keeps displaying the PREVIOUS file's model
 * until the new hand-off lands. The old tick pulled the app's live model
 * into whichever document was active, so during the switch window it
 * silently COPIED one file's diagram into the other — destroying it.
 * The fix: attribute the app's state before any pull is allowed —
 * `appDocRef` records which document the app is believed to be showing,
 * and after every push the pull waits until the app's model actually
 * leaves its previous value (or matches the pushed diagram's signature).
 * Until then the app's content is never written into the active file.
 */

/**
 * Settle check: is the app's current `model` the result of pushing
 * `seed` (given it used to show `before`)? True when the model changed,
 * or when it is (signature-)the same diagram as the pushed seed
 * (covers re-pushing identical content, e.g. a blank default onto a
 * blank app page).
 */
function isSettledAgainstSeed (
  model: string | null,
  before: string | null,
  seed: string,
): boolean {
  if (model != null && before != null && model !== before) return true
  if (model == null || !seed || !seed.trim()) return false
  const parsed = parseDrawioFile(seed)
  if (parsed && parsed.form === 'inline' && parsed.xml) {
    return modelSignature(model) === modelSignature(parsed.xml)
  }
  return false
}

const POLL_MS = drawioHashPollMs
const BOOT_POLL_MS = 150
const BOOT_TIMEOUT_MS = 30_000
const IFRAME_SRC =
  '/static/drawio/index.html?spin=1&noHelpS=1' +
  '&noSaveBtn=1&noExitBtn=1&saveAndExit=0&od=0' +
  // block custom-plugin loading (remote code) — the session stays offline
  '&plugins=0'

/**
 * The vendored app is minified and does not expose a stable `app` global in
 * every version (v32.3.0 ships the app instance reachable through the
 * sidebar global's `editorUi` property; older builds use `window.app` or
 * `Graph.app`). We therefore DISCOVER the instance by fingerprint instead
 * of by name: an object with `.editor.getGraphXml()` (the app's own model
 * serializer) and `.editor.graph`.
 */
interface DrawioUi {
  editor?: {
    graph?: { model?: unknown; container?: unknown }
    getGraphXml?: (a?: unknown) => unknown
    setGraphXml?: (node: unknown) => void
  }
  replaceDiagramData?: (xml: string) => void
}

type AppWindow = Window & Record<string, any> & {
  __overleafDrawioUi?: DrawioUi | null
  Graph?: {
    compress: (xml: string) => string
    decompress: (b64: string) => string
    app?: { editor?: { graph?: { model?: { root?: unknown } } } }
  }
  mxCodec?: new (doc: Document) => {
    encode: (cell: unknown, cellMap?: unknown) => { nodeName: string }
    decode?: (node: unknown, target: unknown) => void
  }
  mxUtils?: {
    getXml: (node: { nodeName: string }) => string
    parseXml?: (xml: string) => { documentElement: unknown }
  }
}

/**
 * Find the app instance (EditorUi/App) inside the app window.
 * Fingerprint: `.editor.getGraphXml()` + `.editor.graph.model` (the
 * app's own model serializer — `Editor.prototype.getGraphXml`). Checks
 * the top level plus the properties a host object carries it on
 * (`editorUi`, `app`, `ui`, `main`). Prefers the instance bound to a
 * VISIBLE canvas container (the main editor, not a sidebar thumbnail).
 * Result is cached on the window.
 */
function findDrawioUi (win: AppWindow): DrawioUi | null {
  const cached = win.__overleafDrawioUi
  if (cached) return cached
  let names: string[]
  try {
    names = Object.getOwnPropertyNames(win)
  } catch (e) {
    return null
  }
  let first: DrawioUi | null = null
  let best: DrawioUi | null = null
  for (const k of names) {
    let v: unknown
    try {
      v = win[k]
    } catch (e) {
      continue
    }
    if (!v || typeof v !== 'object') continue
    const vv = v as Record<string, unknown>
    const cands: unknown[] = [vv.editorUi, vv.app, vv.ui, vv.main, v]
    for (const c of cands) {
      if (!c || typeof c !== 'object') continue
      const ui = c as DrawioUi
      const ed = ui.editor
      if (
        ed &&
        ed.graph &&
        ed.graph.model &&
        typeof ed.getGraphXml === 'function'
      ) {
        if (!first) first = ui
        try {
          const g = ed.graph as { container?: { offsetParent?: unknown } }
          const ctr = g.container
          const visible =
            !!ctr && 'offsetParent' in ctr
              ? ctr.offsetParent !== null
              : false
          if (visible) best = ui
        } catch (e) {
          /* keep looking */
        }
      }
    }
    if (best) break
  }
  const pick = best || first
  if (pick) {
    try {
      win.__overleafDrawioUi = pick
    } catch (e) {
      /* uncacheable window (shouldn't happen): re-scan next poll */
    }
  }
  return pick
}

export default function DrawioViewer () {
  const { openDocName } = useEditorOpenDocContext()
  const cmView = useCodeMirrorViewContext()
  const { t } = useTranslation()

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const docRef = useRef<string>('')
  const loadedRef = useRef(false)
  // Cross-file integrity (see module header): attribute the app's state
  // to a document before any pull is allowed.
  const appDocRef = useRef<string | null>(null)
  const pendingRef = useRef<{
    before: string | null
    attempts: number
    seed: string
  } | null>(null)

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

  // host → app: hand the document over. Preferred path is the app's OWN
  // load API (EditorUi.replaceDiagramData → Editor.setGraphXml — the same
  // code the app uses for paste/import, update-safe). Fallback: the draw.io
  // hash protocol (location.hash '#R' + compressed model), which the app
  // watches via hashchange.
  const pushDoc = useCallback(
    (text: string, fileName: string | null): boolean => {
      const win = appWin()
      if (!win || !text || !text.trim()) return false
      const parsed = parseDrawioFile(text)
      // 1) in-place API (immediate, no hash round-trip)
      const ui = findDrawioUi(win)
      const ed = ui && ui.editor
      if (
        win &&
        win.mxUtils &&
        typeof win.mxUtils.parseXml === 'function'
      ) {
        try {
          if (typeof ui?.replaceDiagramData === 'function') {
            ui.replaceDiagramData(text)
            return true
          }
          if (ed && typeof ed.setGraphXml === 'function') {
            const node = win.mxUtils.parseXml(text).documentElement
            const g = ed.graph as {
              model?: { beginUpdate?: () => void; endUpdate?: () => void }
            }
            if (g && g.model && typeof g.model.beginUpdate === 'function') {
              g.model.beginUpdate()
              try {
                ed.setGraphXml(node)
              } finally {
                g.model.endUpdate()
              }
            } else {
              ed.setGraphXml(node)
            }
            return true
          }
        } catch (e) {
          /* fall back to the hash path below */
        }
      }
      // 2) hash path (also the only option before the app instance exists)
      if (!win.Graph || typeof win.Graph.compress !== 'function') return false
      if (!parsed) {
        // not diagram content at all: nothing the hash path can carry
        return false
      }
      try {
        const hash =
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

  // app → host: read the app's LIVE graph model through the app's OWN
  // serializer (Editor.getGraphXml → encode(graph.getModel()) +
  // mxUtils.getXml — verified against the vendored v32.3.0 bundle).
  // The earlier revision hand-encoded graph.model.root, which drops the
  // child cells; that is why canvas edits never reached the document
  // (owner 2026-10-13 round 2). Falls back to the hash decode when the
  // instance is not reachable yet.
  const readAppModel = useCallback((): string | null => {
    const win = appWin()
    if (!win) return null
    try {
      const ui = findDrawioUi(win)
      const ed = ui && ui.editor
      if (ed && typeof ed.getGraphXml === 'function') {
        const node = ed.getGraphXml(true) as { nodeName: string } | null
        const getXml = win.mxUtils && win.mxUtils.getXml
        if (node && typeof getXml === 'function') {
          const xml = getXml(node)
          if (xml && xml.trim()) return xml
        }
      }
    } catch (e) {
      /* fall through to the hash */
    }
    if (!win.Graph) return null
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

  // app → host: track a push — remember what the app was showing so the
  // settle check can prove the app actually switched before allowing a
  // pull (the cross-file clobber guard).
  const pushAndTrack = useCallback(
    (xml: string, name: string | null): boolean => {
      if (!xml || !xml.trim()) return false
      if (!pushDoc(xml, name)) return false
      docRef.current = xml
      appDocRef.current = name
      pendingRef.current = {
        before: readAppModel(),
        attempts: 1,
        seed: xml,
      }
      return true
    },
    [pushDoc, readAppModel],
  )

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
      const active = openDocName ?? null

      // Clobber guard (owner 2026-10-27): the app's model is GLOBAL and
      // lags the active document after a file switch — pulling during
      // that window copies the OTHER file's diagram into the newly
      // opened one and destroys it. Settle first.
      if (appDocRef.current !== active) {
        const src = cmView ? cmView.state.doc.toString() : ''
        const seed =
          src && src.trim()
            ? src
            : buildDrawioFile(DEFAULT_DRAWIO_XML)
        if (seed !== docRef.current) {
          pushAndTrack(seed, active) // retried on the next tick until ok
        } else {
          appDocRef.current = active // same content both sides: settled
          pendingRef.current = null
        }
        return false
      }
      const pending = pendingRef.current
      if (pending) {
        const model = readAppModel()
        if (isSettledAgainstSeed(model, pending.before, pending.seed)) {
          pendingRef.current = null // the app shows this document now
        } else if (pending.attempts < 3) {
          pending.attempts += 1
          const src = cmView ? cmView.state.doc.toString() : ''
          const seed =
            src && src.trim()
              ? src
              : buildDrawioFile(DEFAULT_DRAWIO_XML)
          // silent re-push (the hash path is asynchronous); keep the
          // original baseline + seed for the settle check
          if (pushDoc(seed, active)) docRef.current = seed
          return false
        } else {
          // still showing content that is not this document's: never
          // write it into the active file (safe: sync resumes as soon
          // as the app switches)
          return false
        }
      }

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
    [readAppModel, writeDoc, cmView, openDocName, pushDoc, pushAndTrack],
  )

  // File>Save / Ctrl+S (intercepted in the app window): flush the pull
  // immediately and surface "saved" — the Overleaf document autosave does
  // the persistence into the file tree.
  const flushSave = useCallback(() => {
    const attempt = (left: number): void => {
      const settled =
        appDocRef.current === (openDocName ?? null) &&
        pendingRef.current === null
      if (!settled) {
        if (left > 0) {
          window.setTimeout(() => attempt(left - 1), 150)
        } else {
          // the app is still switching documents — do NOT flush a
          // foreign model into the active file; the next tick lands it
          setStatus('ready')
          setStatusText(t('drawio_status_ready'))
        }
        return
      }
      if (pullToDoc(true)) {
        setStatus('saved')
        setStatusText(t('drawio_saved'))
      }
    }
    attempt(20)
  }, [pullToDoc, t, openDocName])

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
        appDocRef.current = openDocName ?? null
        pendingRef.current = {
          before: readAppModel(),
          attempts: 1,
          seed: source,
        }
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
  // the app must receive the NEW document. (owner 2026-10-27: this is
  // also the clobber entry point — the push is tracked so the pull
  // refuses until the app actually shows the new document, including
  // the case where the new document is EMPTY and must be seeded with a
  // blank diagram instead of inheriting the previous file's content.)
  useEffect(() => {
    if (!cmView || !loadedRef.current) return
    const src = cmView.state.doc.toString()
    const seed =
      src && src.trim() ? src : buildDrawioFile(DEFAULT_DRAWIO_XML)
    if (seed !== docRef.current) {
      pushAndTrack(seed, openDocName ?? null)
    }
  }, [openDocName, cmView, pushAndTrack])

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
