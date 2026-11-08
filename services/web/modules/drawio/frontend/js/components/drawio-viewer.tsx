import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorView } from '@codemirror/view'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useProjectContext } from '@/shared/context/project-context'
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
 * draw.io visual editor for `.drawio` documents (AK-11, owner 2026-10-08).
 *
 * Registered through Overleaf's `visualEditorProviders` hook (exactly
 * like the tikz and diagram modules) — it replaces the code editor in the
 * editor pane.
 *
 * Implementation: the vendored draw.io app (public/static/drawio) runs in
 * a SAME-ORIGIN IFRAME and syncs with the OlliTeX-owned document:
 *   host -> app : EditorUi.replaceDiagramData(xml) (the app's own load
 *                 API; hash '#R'+compress() as fallback)
 *   app -> host : Editor.getGraphXml() — the app's own model serializer.
 *
 * Save policy (owner 2026-10-13): every canvas edit is pulled into the
 * document within POLL_MS (Overleaf autosave persists it); File>Save /
 * Ctrl+S flushes the pull immediately (intercepted by drawio-app.ts);
 * the app's own file management is removed.
 *
 * CROSS-FILE INTEGRITY — owner reports 2026-10-27 (round 5) and
 * 2026-11-01 (round 7): "switching between test1.drawio and
 * e2e.drawio destroys the content of the files".
 *
 * (a) The viewer is ONE component for the whole pane (Overleaf renders a
 *     single <VisualEditor/> without a per-file key): ONE app instance
 *     with one GLOBAL diagram model serves EVERY .drawio file in turn.
 *     After a file switch the app keeps showing the PREVIOUS file's
 *     model until the hand-off lands — a pull during that window copies
 *     one file's diagram into the other.
 *
 * (b) Round 7 (closed by this revision): Overleaf updates `openDocName`
 *     BEFORE the CodeMirror document swap lands. The old code read the
 *     CodeMirror buffer during that window to seed the new document —
 *     i.e. it seeded with the PREVIOUS file's content and, when that
 *     content equalled the last write (always, by construction), the
 *     settle shortcut declared the hand-off settled and the very next
 *     tick pulled the foreign model into the newly opened file.
 *     Owner-visible: open e2e → canvas still shows test1's diagram →
 *     whatever is drawn on it is lost or lands in the wrong file.
 *
 * THE FIX:
 *   - a PULL never seeds anything: strictly read-only, allowed only
 *     when the app's model has been VERIFIED to be the active document
 *     (appDocRef is set only AFTER a settle check, never optimistically);
 *   - a HAND-OFF SUPERVISOR owns every file switch: it pushes the cached
 *     seed of the TARGET document first (canvas shows that file's OWN
 *     diagram within ms, even if CodeMirror has not swapped yet), then
 *     — once CodeMirror's state version has advanced (proof the new
 *     document loaded) — pushes the fresh content and settles. Until
 *     settle, pulls for the new document are refused and the status
 *     still reads "Loading…";
 *   - settle failure never locks sync out and never mis-attributes: the
 *     supervisor re-pushes for a bounded window (never stomping a model
 *     the user has edited in the meantime) while attribution simply
 *     stays with the previous document — so a foreign model can never
 *     be written into the newly opened file.
 */

function isSettledAgainstSeed (
  model: string | null,
  seedSig: string | null,
): boolean {
  // STRICT (round 7): the app's model must be signature-identical to the
  // diagram we pushed. The round 5-6 clause ("the model changed since the
  // push => settled") is UNSAFE: EditorUi.replaceDiagramData WIPES the
  // model to a blank page when given an mxfile-wrapped payload (verified
  // in-page 2026-10-31) — a wipe is a "change" and was mis-read as a
  // successful load, attributing a blank/foreign canvas. A signature
  // match is the only proof the app is actually showing this diagram.
  if (model == null || seedSig == null || !seedSig) return false
  return modelSignature(model) === seedSig
}

const POLL_MS = drawioHashPollMs
const BOOT_POLL_MS = 150
const BOOT_TIMEOUT_MS = 30_000
const HANDOFF_STEP_MS = 250
const HANDOFF_MAX_MS = 20_000
const IFRAME_SRC =
  '/static/drawio/index.html?spin=1&noHelpS=1' +
  '&noSaveBtn=1&noExitBtn=1&saveAndExit=0&od=0' +
  // Native offline/stealth gates of the vendored app: stealth=1 skips the
  // Pusher realtime-script load, cloud sync and the cloud login surface;
  // gapi=0 disables the Google Drive/API client. (Deliberately NOT
  // offline=1: that parameter ENABLES the app's service-worker
  // registration, which would 404 on our same-origin scope.)
  '&gapi=0&stealth=1&plugins=0'

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
      /* uncacheable window: re-scan next poll */
    }
  }
  return pick
}

export default function DrawioViewer () {
  const { openDocName, currentDocumentId } = useEditorOpenDocContext()
  const { projectId } = useProjectContext()
  const cmView = useCodeMirrorViewContext()
  const { t } = useTranslation()

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const docRef = useRef<string>('')
  const loadedRef = useRef(false)
  // The document the app's GLOBAL model has been VERIFIED to be showing
  // (set only after a settle check — a pull is allowed only when this
  // equals the active document).
  const appDocRef = useRef<string | null>(null)
  // A push is in flight: {before, attempts, seed, seedSig}. Cleared when
  // the settle check passes (which is the moment appDocRef is updated).
  const pendingRef = useRef<{
    before: string | null
    attempts: number
    seed: string
    seedSig: string
  } | null>(null)
  // LAST VERIFIED content per .drawio document (insertion-ordered,
  // capped). Lets a hand-off push the TARGET file's own content at once
  // — never by reading a CodeMirror buffer that may still hold the
  // PREVIOUS document (round 7 root cause b).
  const seedCacheRef = useRef<Map<string, string>>(new Map())
  // Every new hand-off supersedes any running one.
  const handoffSeqRef = useRef(0)
  // Keep a ref mirror of openDocName for use inside timers.
  const openDocNameRef = useRef<string | null>(null)
  // Ref mirror of the ACTIVE document id (round-8 server-fetch seed).
  const openDocIdRef = useRef<string | null>(null)
  // The document that was active before the CURRENT one (round 9): its
  // verified cache signature is used to RECOGNISE a shared buffer that
  // still holds the previous document (OT swap lag) so a pull never
  // overwrites that other file.
  const prevDocNameRef = useRef<string | null>(null)
  // CodeMirror version captured when THIS instance first saw the view
  // (round 9): a later version proves content was delivered to / edited
  // in this instance's buffer, which is what makes a buffer seed legal.
  const mountVersionRef = useRef<number | null>(null)
  const cmViewRef = useRef<EditorView | null>(null)

  const [status, setStatus] = useState<'booting' | 'ready' | 'saved' | 'error'>('booting')
  const [statusText, setStatusText] = useState('')
  // Ref mirror of the latest runHandoff (for the debug force() hook);
  // assigned by the effect after its definition below.
  const handoffFnRef = useRef<((name: string) => void) | null>(null)

  // Flipped once the app window is alive; lets the hand-off (re)start
  // after a slow boot if its bounded window expired first.
  const [appAlive, setAppAlive] = useState(false)
  // AK-13 (2026-11-08): app-reload recovery — same class of bug as the
  // tikz viewer. The viewer stays mounted while other files are open
  // (Overleaf keeps the document tabs alive); if the browser EVICTS or
  // reloads the iframe in the background (crash, memory pressure), the
  // app comes back EMPTY while the host-side hand-off guard
  // (appDocRef === name) still says "already handed off" — the replay
  // guard eats the fresh boot and the canvas stays empty (fixing it
  // requires the tex→drawio re-open cycle that remounts the viewer).
  // Every post-boot iframe `load` event bumps this epoch, which re-runs
  // the one-shot boot effect below and clears the hand-off guard.
  const [bootEpoch, setBootEpoch] = useState(0)
  // Last CodeMirror state version we acted on (freshness watchdog).
  const lastCmVersionRef = useRef(0)
  // Live mirrors for the read-only debug probe (window.__drawioDebug).
  const statusTextRef = useRef('')
  statusTextRef.current = statusText
  const appAliveRef = useRef(false)
  appAliveRef.current = appAlive

  const dbgLog = useCallback((m: string): void => {
    try {
      const w = window as any
      if (w.__drawioDebug) {
        w.__drawioDebug.log(m)
      }
    } catch {
      // probing must never break the editor
    }
  }, [])

  // Read-only support probe: exposes the viewer's internal state (active
  // doc, attribution, settle state, cm/app signatures, handoff log) on
  // window.__drawioDebug for live diagnosis without rebuilds.
  // ROUND 9: this is (re)registered by EVERY mount (per-file instances) —
  // the latest instance is the active one, so its refs win.
  useEffect(() => {
    const w = window as any
    const sig = (x: string): string => modelSignature(String(x || ''))
    const readModel = (): string | null => {
      const ifr = iframeRef.current
      if (!ifr) {
        return null
      }
      try {
        const win = ifr.contentWindow as any
        if (!win) {
          return null
        }
        const ui = findDrawioUi(win) as any
        const ed = ui && ui.editor
        if (ed && typeof ed.getGraphXml === 'function' && win.mxUtils && typeof win.mxUtils.getXml === 'function') {
          const node = ed.getGraphXml(true)
          const xml = node ? win.mxUtils.getXml(node) : ''
          return xml && xml.trim() ? xml : null
        }
        return null
      } catch {
        return null
      }
    }
    w.__drawioDebug = {
      version: 'r7.1',
      get attribution () { return appDocRef.current },
      get pending () {
        const p = pendingRef.current
        return p ? { beforeSig: sig(String(p.before || '')), attempts: p.attempts, seedSig: sig(String(p.seed || '')) } : null
      },
      get cacheKeys () { return Object.keys(seedCacheRef.current) },
      get statusText () { return statusTextRef.current },
      get appAlive () { return appAliveRef.current },
      get handoffSeq () { return handoffSeqRef.current },
      get activeName () { return openDocNameRef.current },
      force: (name: string): void => {
        try { if (handoffFnRef.current) { handoffFnRef.current(name) } } catch { /* noop */ }
      },
      cm () {
        const v = cmViewRef.current
        const doc = v ? String((v.state as any).doc) : ''
        return v
          ? { version: (v.state as any).version, head: doc.slice(40, 140), hasCloud: doc.includes('yd6rvUTQzXNY8A2MaNvI'), hasStep: doc.includes('zmBKXzrDDcqhVt7bbxXc') }
          : null
      },
      app () {
        const m = readModel()
        return m ? { sig: sig(m), cells: (m.match(/<mxCell\b/g) || []).length, hasCloud: m.includes('yd6rvUTQzXNY8A2MaNvI'), hasStep: m.includes('zmBKXzrDDcqhVt7bbxXc') } : null
      },
      appXml () {
        const m = readModel()
        return m ? String(m).slice(0, 20000) : null
      },
      doc () {
        const v = cmViewRef.current
        return v ? String((v.state as any).doc).slice(40, 140) : null
      },
      log: (m: string): void => {
        try {
          w.__drawioDebug._log.push('[' + new Date().toISOString().slice(11, 23) + '] ' + m)
          if (w.__drawioDebug._log.length > 250) {
            w.__drawioDebug._log.shift()
          }
        } catch {
          // noop
        }
      },
    }
    w.__drawioDebug._log = []
    return undefined
  }, [])

  useEffect(() => {
    const next = openDocName ?? null
    if (
      openDocNameRef.current !== null &&
      next !== null &&
      openDocNameRef.current !== next
    ) {
      prevDocNameRef.current = openDocNameRef.current
    }
    openDocNameRef.current = next
    openDocIdRef.current = currentDocumentId ?? null
  }, [openDocName, currentDocumentId])
  useEffect(() => {
    cmViewRef.current = cmView
    if (mountVersionRef.current === null && cmView) {
      mountVersionRef.current = cmView.state.version
    }
  }, [cmView])

  const appWin = useCallback((): AppWindow | null => {
    return (iframeRef.current?.contentWindow as AppWindow) || null
  }, [])

  const writeDoc = useCallback(
    (xml: string): boolean => {
      const cm = cmViewRef.current
      if (!cm) return false
      if (cm.state.doc.toString() === xml) return true // no-op
      cm.dispatch({
        changes: { from: 0, to: cm.state.doc.length, insert: xml },
      })
      return true
    },
    []
  )

  // host -> app: hand a diagram over. The app's OWN load API
  // (EditorUi.replaceDiagramData -> Editor.setGraphXml — the same code
  // the app uses for paste/import). ROUND 7 (verified in-page 2026-10-31):
  // replaceDiagramData requires the RAW graph XML — fed an <mxfile>-
  // wrapped payload it silently loads a BLANK model. So we always
  // unwrap first (parseDrawioFile / Graph.decompress) and only then
  // call it. Fallback: the draw.io hash protocol (location.hash '#R'
  // + compressed model), which the app's native loader handles for both
  // inline and compressed payloads.
  const pushDoc = useCallback(
    (text: string, fileName: string | null): boolean => {
      const win = appWin()
      if (!win || !text || !text.trim()) return false
      const parsed = parseDrawioFile(text)
      if (!parsed) return false
      // Raw graph XML for the app's own load API.
      let inlineXml: string | null = null
      if (parsed.form === 'inline' && parsed.xml && parsed.xml.trim()) {
        inlineXml = parsed.xml
      } else if (
        (win as any).Graph &&
        typeof (win as any).Graph.decompress === 'function'
      ) {
        try {
          inlineXml = (win as any).Graph.decompress(parsed.payload)
        } catch (e) {
          inlineXml = null
        }
      }
      const ui = findDrawioUi(win)
      const ed = ui && ui.editor
      if (
        win &&
        (win as any).mxUtils &&
        typeof (win as any).mxUtils.parseXml === 'function' &&
        inlineXml
      ) {
        try {
          if (typeof ui?.replaceDiagramData === 'function') {
            ui.replaceDiagramData(inlineXml)
            dbgLog('pushDoc: replaceDiagramData(inline)')
            return true
          }
          if (ed && typeof ed.setGraphXml === 'function') {
            const node = (win as any).mxUtils.parseXml(inlineXml).documentElement
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
            dbgLog('pushDoc: setGraphXml(inline)')
            return true
          }
        } catch (e) {
          dbgLog('pushDoc: api path threw (' + String(e).slice(0, 80) + ') -> hash')
          /* fall back to the hash path below */
        }
      }
      if (!('Graph' in win) || typeof (win as any).Graph.compress !== 'function') {
        dbgLog('pushDoc: no hash path (no Graph.compress)')
        return false
      }
      try {
        const hash =
          parsed.form === 'inline'
            ? '#R' + (win as any).Graph.compress(inlineXml || parsed.xml)
            : '#R' + parsed.payload
        win.name = fileName == null ? '' : fileName
        win.location.hash = hash
        dbgLog('pushDoc: hash ' + hash.slice(0, 24) + '...')
      } catch (e) {
        return false
      }
      return true
    },
    [appWin, dbgLog]
  )

  // app -> host: read the app's LIVE graph model through the app's OWN
  // serializer (Editor.getGraphXml -> encode(graph.getModel()) +
  // mxUtils.getXml — round 3 fix: hand-encoding model.root drops the
  // child cells). Falls back to the hash decode when the instance is
  // not reachable yet.
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

  // record a push for the settle check — WITHOUT attributing the app:
  // attribution (appDocRef) happens only when the settle check passes.
  const rememberSeed = useCallback((name: string | null, xml: string): void => {
    if (!name || !xml || !xml.trim()) return
    const m = seedCacheRef.current
    m.delete(name)
    m.set(name, xml)
    while (m.size > 16) {
      const oldest = m.keys().next().value
      if (oldest === undefined) break
      m.delete(oldest)
    }
  }, [])

  const pushAndTrack = useCallback(
    (xml: string, name: string | null): boolean => {
      if (!xml || !xml.trim()) return false
      const before = readAppModel()
      if (!pushDoc(xml, name)) return false
      // Seed signature for the STRICT settle check (round 7): the app's
      // read-back model must match THIS diagram, not merely differ from
      // what it showed before.
      const parsed = parseDrawioFile(xml)
      let seedSig = ''
      if (parsed && parsed.form === 'inline' && parsed.xml) {
        seedSig = modelSignature(parsed.xml)
      } else if (parsed && parsed.form === 'compressed') {
        const win = appWin()
        if (win && (win as any).Graph && typeof (win as any).Graph.decompress === 'function') {
          try {
            seedSig = modelSignature((win as any).Graph.decompress(parsed.payload))
          } catch (e) {
            seedSig = ''
          }
        }
      }
      docRef.current = xml
      pendingRef.current = {
        before,
        attempts: 1,
        seed: xml,
        seedSig,
      }
      rememberSeed(name, xml)
      dbgLog('pushAndTrack ' + String(name) + ' seedSig=' + (seedSig || '(none)'))
      return true
    },
    [pushDoc, readAppModel, rememberSeed, appWin, dbgLog]
  )

  // a model with only the canonical 0/1 root cells = the blank default
  const cellCount = (xml: string): number => (xml.match(/mxCell/g) || []).length

  // app -> host: pull the app's current state into the Overleaf document.
  // STRICTLY READ-ONLY (round 7): it never reads a document buffer to
  // seed the app, never re-pushes, never declares settle. It is allowed
  // only when the app's model has been verified to be the active
  // document's (attribution set by the hand-off supervisor) — which is
  // exactly what keeps a switch window from copying one file's diagram
  // into the other.
  // AK-13 (2026-11-08): blank-watch cooldown for the self-heal below
  // (a pathological app must not be able to create a push loop).
  const blankPushAtRef = useRef(0)

  const pullToDoc = useCallback(
    (allowClobber: boolean): boolean => {
      const active = openDocNameRef.current
      if (!active) { return false }
      if (appDocRef.current !== active) {
        dbgLog('pull refused: attribution=' + appDocRef.current + ' active=' + active)
        return false
      }
      if (pendingRef.current) { dbgLog('pull refused: pending'); return false }
      const model = readAppModel()
      if (!model || !model.trim()) { dbgLog('pull refused: empty app model'); return false }
      const next = buildDrawioFile(model)
      if (next === docRef.current) return true // already in sync
      const cur = cmViewRef.current
        ? cmViewRef.current.state.doc.toString()
        : docRef.current
      if (!allowClobber && cur && cur.trim() && !parseDrawioFile(cur)) {
        dbgLog('pull refused: buffer not diagram')
        return false
      }
      // blank app model vs. real diagram in the document: do not clobber
      if (cellCount(model) <= 2) {
        const parsed = cur && cur.trim() ? parseDrawioFile(cur) : null
        if (
          parsed &&
          cellCount(parsed.form === 'inline' ? parsed.xml : cur) > 2
        ) {
          dbgLog('pull refused: blank app vs. real diagram in buffer')
          return false
        }
      }
      // ROUND 9 buffer provenance: the shared CodeMirror buffer may still
      // hold the PREVIOUS document (the OT swap lags behind the switch)
      // even though THIS instance is authoritative for the active one.
      // Writing our model over a buffer we cannot prove belongs to THIS
      // document would clobber the other file. Only write when the buffer
      // is empty (a new file), already equal to what we would write, or
      // proven to be this document's own earlier verified state. An
      // explicit flush (File→Save) may additionally proceed — that is the
      // user's explicit save of THIS file and attribution is verified.
      if (cur && cur.trim()) {
        const bufSig = ((): string => {
          const p = parseDrawioFile(cur)
          if (p && p.form === 'inline' && p.xml) return modelSignature(p.xml)
          return p ? 'compressed' : ''
        })()
        if (bufSig) {
          const cX = seedCacheRef.current.get(active)
          // NOTE: cache entries are stored as DOCUMENT text (the diagram XML
          // is HTML-escaped inside <diagram>), so the signature must be
          // computed from the UNWRAPPED content — signature of the raw text
          // is always '' and would wrongly reject every pull (round 9 bug).
          const mine = ((): string => {
            if (!cX) return ''
            const pc = parseDrawioFile(cX)
            if (pc && pc.form === 'inline' && pc.xml) return modelSignature(pc.xml)
            return pc ? 'compressed' : ''
          })()
          if (bufSig !== modelSignature(model) && bufSig !== mine) {
            const prev = prevDocNameRef.current
            const cP = prev ? seedCacheRef.current.get(prev) : null
            const prevSig = ((): string => {
              if (!cP) return ''
              const pp = parseDrawioFile(cP)
              if (pp && pp.form === 'inline' && pp.xml) return modelSignature(pp.xml)
              return pp ? 'compressed' : ''
            })()
            if (prevSig && prevSig === bufSig) {
              dbgLog('pull refused: buffer still holds PREVIOUS doc ' + prev)
              return false
            }
            if (!allowClobber) {
              dbgLog('pull refused: unproven buffer content (wait for provenance)')
              return false
            }
          }
        }
      }
      if (writeDoc(next)) {
        docRef.current = next
        rememberSeed(active, next)
        dbgLog('pull OK -> ' + active + ' cells=' + cellCount(model))
        return true
      }
      dbgLog('pull FAIL: writeDoc false')
      return false
    },
    [readAppModel, writeDoc, rememberSeed, dbgLog]
  )

  // File>Save / Ctrl+S (intercepted in the app window): flush the pull
  // immediately and surface "saved" — the Overleaf document autosave does
  // the persistence into the file tree. While a hand-off is settling the
  // flush waits (bounded) instead of writing a foreign model; if it
  // still has not settled it surfaces "ready" (NOT "saved") — an honest
  // no-op rather than a clobber.
  const flushSave = useCallback(() => {
    const attempt = (left: number): void => {
      const active = openDocNameRef.current
      const settled =
        active != null &&
        appDocRef.current === active &&
        pendingRef.current === null
      if (!settled) {
        if (left > 0) {
          window.setTimeout(() => attempt(left - 1), 150)
        } else {
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
  }, [pullToDoc, t])

  const statusReady = useCallback((): void => {
    setStatus('ready')
    setStatusText(t('drawio_status_ready'))
  }, [t])

  const statusLoading = useCallback((): void => {
    setStatus('booting')
    setStatusText(t('drawio_status_loading'))
  }, [t])

  // AUTHORITATIVE SEED (round 8): the server's own copy of the ACTIVE
  // document (currentDocumentId — set by Overleaf the moment the switch
  // starts). By definition this document's content: no shared-buffer
  // ambiguity, immune to a lagging/missing OT swap into the shared
  // CodeMirror view.
  const fetchActiveDocContent = useCallback(async (): Promise<string | null> => {
    try {
      const id = openDocIdRef.current
      if (!id || !projectId) {
        return null
      }
      const resp = await fetch(`/project/${projectId}/doc/${id}/download`, {
        credentials: 'same-origin',
      })
      if (!resp.ok) {
        return null
      }
      const txt = await resp.text()
      if (!txt || !txt.trim() || !parseDrawioFile(txt)) {
        return null
      }
      return txt
    } catch (e) {
      return null
    }
  }, [projectId])

  /**
   * HAND-OFF SUPERVISOR (round 9): own every open of a document in THIS
   * isolated app instance (one instance per file — see codemirror-editor).
   *
   * 1. Push this document's own content as a seed — verified local
   *    cache, then the server's own copy, then (only after the buffer
   *    provably synced) the shared buffer — and settle on a STRICT
   *    signature match of the app's read-back model.
   * 2. ONLY after settle does this app instance get attributed to the
   *    document (appDocRef) and become "Ready"; pulls require that
   *    attribution plus buffer provenance (round 9) — which is what
   *    keeps any switch window from copying one file's diagram into the
   *    other.
   *
   * Failure handling: if the push does not take, re-push for a bounded
   * window — but never re-push on top of a model the user has edited in
   * the meantime (that would stomp their drawing); if it still does not
   * settle, attribution stays unset and pulls are refused (safe).
   */
  const runHandoff = useCallback(
    (name: string, preferBuffer = false): void => {
      const seq = ++handoffSeqRef.current
      const t0 = Date.now()
      let pushedSeed: string | null = null
      // server fetch attempts: at most 2, spaced (rate safety)
      let serverTries = 0
      let lastServerAt = 0

      const step = async (): Promise<void> => {
        if (seq !== handoffSeqRef.current) return // superseded by a newer switch
        const cm = cmViewRef.current
        try {

        // (b) pick the seed for THIS document and push it (once).
        //     ROUND 9 priority (per-file app instances make these safe):
        //       (0) when asked after a detected EXTERNAL edit (the
        //           buffer's diagram differs from what we last pushed),
        //           the buffer itself — it is this file's content and is
        //           newer than the cache by definition;
        //       (A) this document's own last VERIFIED content (seed
        //           cache — includes canvas edits we pulled while it was
        //           the active file); the freshest local truth;
        //       (B) the server's own copy of the ACTIVE document —
        //           authoritative, immune to shared-buffer / OT-swap lag;
        //       (C) the shared CodeMirror buffer IF it advanced since
        //           THIS instance mounted (OT delivered it or the code
        //           view was edited); never a not-yet-synced buffer —
        //           that may still hold the PREVIOUS document;
        //       (D) the blank default — only for a genuinely new/empty
        //           document (buffer empty), never on top of real content.
        //     Otherwise wait; at the deadline stay unattributed (pulls
        //     refused — pulls can only happen after a verified push)
        //     and let a re-open recover.
        if (pushedSeed == null) {
          const cmText = cm ? cm.state.doc.toString() : ''
          let seed: string | null = null
          let why = ''
          const cached = seedCacheRef.current.get(name)
          if (
            preferBuffer &&
            cmText &&
            cmText.trim() &&
            parseDrawioFile(cmText) &&
            modelSignature(cmText) !== modelSignature(docRef.current)
          ) {
            seed = cmText
            why = 'buffer-external-edit'
          }
          if (
            seed == null &&
            cached &&
            cached.trim() &&
            parseDrawioFile(cached)
          ) {
            seed = cached
            why = 'verified-cache'
          }
          if (
            seed == null &&
            serverTries < 2 &&
            (serverTries === 0 || Date.now() - lastServerAt > 1500)
          ) {
            serverTries += 1
            lastServerAt = Date.now()
            const txt = await fetchActiveDocContent()
            if (seq !== handoffSeqRef.current) return
            if (txt) {
              seed = txt
              why = 'server-fetch'
            }
          }
          if (seed == null && cmText && cmText.trim() && parseDrawioFile(cmText)) {
            if (
              mountVersionRef.current != null &&
              cm &&
              cm.state.version > mountVersionRef.current
            ) {
              seed = cmText
              why = 'buffer-synced'
            }
          }
          if (seed == null && (!cmText || !cmText.trim())) {
            seed = buildDrawioFile(DEFAULT_DRAWIO_XML)
            why = 'blank-new'
          }
          if (seed != null) {
            if (pushAndTrack(seed, name)) {
              pushedSeed = seed
              lastCmVersionRef.current = cm ? cm.state.version : 0
              dbgLog('handoff ' + name + ': seed=' + why)
              window.setTimeout(step, HANDOFF_STEP_MS)
              return
            }
            // app not ready yet (booting) — retry below
            if (Date.now() - t0 > HANDOFF_MAX_MS) {
              statusLoading()
              return
            }
            window.setTimeout(step, HANDOFF_STEP_MS)
            return
          }
          if (Date.now() - t0 > HANDOFF_MAX_MS) {
            pendingRef.current = null
            dbgLog('handoff ' + name + ': no trusted seed by deadline; refusing to settle (pulls stay refused)')
            statusLoading()
            return
          }
          dbgLog('handoff ' + name + ': waiting for seed (buf=' + (cmText ? 'yes' : 'none') + ', serverTries=' + serverTries + ', cache=' + (cached ? 'yes' : 'no') + ')')
          window.setTimeout(step, HANDOFF_STEP_MS)
          return
        }

        // (c) settle check for the push we own — STRICT signature match
        //     (round 7: see isSettledAgainstSeed).
        const p = pendingRef.current
        if (p != null) {
          const model = readAppModel()
          if (isSettledAgainstSeed(model, p.seedSig)) {
            pendingRef.current = null
            appDocRef.current = name // app provably shows this document now
            dbgLog('handoff ' + name + ': SETTLED (sig match)')
            statusReady()
            return
          }
          p.attempts += 1
          if (p.attempts > 3) {
            // Re-push only when the app's model is still the diagram we
            // replaced, a blank (the app wiped it — round 7's
            // replaceDiagramData(mxfile) wipe), or signature-equal to
            // our seed — never on top of user edits.
            const cur = readAppModel()
            const untouched =
              cur == null ||
              cellCount(cur) <= 2 ||
              (p.before != null && cur === p.before) ||
              (p.seedSig && modelSignature(cur || '') === p.seedSig)
            if (untouched && Date.now() - t0 < HANDOFF_MAX_MS) {
              if (pushAndTrack(p.seed, name)) {
                p.attempts = 1
                dbgLog('handoff ' + name + ': re-push (app model=' + (cur == null ? 'null' : 'not-seed') + ')')
              }
            }
          }
        } else if (appDocRef.current === name) {
          statusReady()
          return
        }

        if (Date.now() - t0 > HANDOFF_MAX_MS) {
          pendingRef.current = null
          dbgLog('handoff ' + name + ': gave up at deadline; attribution unchanged (pulls stay refused)')
          statusLoading()
          return
        }
        window.setTimeout(step, HANDOFF_STEP_MS)
        } catch (e) {
          // a transient error must never kill the hand-off loop (round 9:
          // a ReferenceError here used to silence all retries)
          dbgLog('handoff ' + name + ': step error ' + String(e))
          if (seq === handoffSeqRef.current && Date.now() - t0 < HANDOFF_MAX_MS) {
            window.setTimeout(step, HANDOFF_STEP_MS)
          }
        }
      }

      statusLoading()
      step()
    },
    [pushAndTrack, readAppModel, statusReady, statusLoading]
  )
  // Latest runHandoff for the debug force() hook (plain assignment —
  // NOT a deps-array reference before declaration).
  handoffFnRef.current = runHandoff

  // BOOT — mark the app window alive once its loader (Graph) is usable,
  // and (re)apply the host constraints (share button removal, Save
  // rerouting, ...). The hand-off effect below performs the first
  // document push. The old revision marked "ready" the moment the push
  // SUCCEEDED — before knowing the app actually displayed it — which is
  // the window round 7 exposes.
  useEffect(() => {
    let stopped = false
    let tries = 0
    const apply = (): void => {
      if (stopped) return
      const win = appWin()
      if (win) {
        try {
          applyOverleafHostConstraints(win, {
            savedText: t('drawio_saved'),
            onFlushSave: flushSave,
          })
        } catch (e) {
          /* constraints are an enhancement; never block the editor */
        }
      }
    }
    const iv = window.setInterval(() => {
      const win = appWin()
      if (win && win.Graph && typeof win.Graph.compress === 'function') {
        window.clearInterval(iv)
        if (!stopped) {
          loadedRef.current = true
          setAppAlive(true)
          apply()
        }
        return
      }
      if (++tries > BOOT_TIMEOUT_MS / BOOT_POLL_MS) {
        window.clearInterval(iv)
        if (!stopped) {
          setStatus('error')
          setStatusText(t('drawio_error_boot'))
        }
      }
    }, BOOT_POLL_MS)
    const settle1 = window.setTimeout(apply, 1000)
    const settle2 = window.setTimeout(apply, 3000)
    return () => {
      stopped = true
      window.clearInterval(iv)
      window.clearTimeout(settle1)
      window.clearTimeout(settle2)
    }
  }, [appWin, flushSave, t, bootEpoch])

  // AK-13 (2026-11-08): iframe reload recovery. The FIRST load event is
  // the normal boot (handled by the one-shot effect above). Any load
  // event after the boot completed means the app reloaded underneath us
  // (background-tab iframe eviction / crash / in-place navigation): reset
  // the boot + hand-off state and re-arm the one-shot boot effect via
  // bootEpoch, so the fresh app gets the document pushed again.
  const onIframeLoad = useCallback((): void => {
    if (!loadedRef.current) return // initial boot: nothing to recover
    loadedRef.current = false
    appDocRef.current = null
    pendingRef.current = null
    setAppAlive(false)
    setStatus('booting')
    setStatusText('')
    setBootEpoch(epoch => epoch + 1)
  }, [])

  // HAND-OFF — one supervisor per file switch (and the initial open).
  // Re-runs when the app window becomes alive (slow boot safety net);
  // a no-op skip when this document is already handed off and settled.
  useEffect(() => {
    const name = openDocName ?? ''
    if (!name || !cmView) return
    if (appDocRef.current === name && pendingRef.current == null) return
    runHandoff(name)
  }, [openDocName, cmView, runHandoff, appAlive, bootEpoch])

  // SYNC — the pull tick, plus a freshness watchdog: if the document
  // changes underneath us (code view, collaboration, server-side edit)
  // hand the FRESH content to the app before any further pull.
  useEffect(() => {
    if (!cmView) return
    const tick = (): void => {
      if (!loadedRef.current) return
      const active = openDocNameRef.current
      const cm = cmViewRef.current
      if (active && cm) {
        const v = cm.state.version
        if (v !== lastCmVersionRef.current) {
          lastCmVersionRef.current = v
          const txt = cm.state.doc.toString()
          // Truly different DIAGRAM (signature compare — the OT echo can
          // re-serialise the same diagram and must not stomp live canvas
          // edits): hand the fresh content to the app before further
          // pulls.
          const external =
            txt.length > 0 &&
            parseDrawioFile(txt) != null &&
            parseDrawioFile(docRef.current) != null &&
            modelSignature(txt) !== modelSignature(docRef.current) &&
            appDocRef.current === active &&
            pendingRef.current == null
          if (external) {
            runHandoff(active, true)
            return
          }
        }
      }
      // AK-13 (2026-11-08): blank-watch self-heal. The vendored app can
      // WIPE its own model late in boot (its default-diagram step lands
      // after a hash push; verified live 2026-11-08 after an
      // eviction-reload, where the settle check matched then the canvas
      // went empty). If we already hold this document's TRUSTED content
      // (real cells — never for a genuinely new blank file) and the app
      // shows a BLANK canvas with no in-flight hand-off, re-run the
      // hand-off so the canvas recovers within one poll.
      const activeDoc = openDocNameRef.current
      if (
        loadedRef.current &&
        activeDoc &&
        appDocRef.current === activeDoc &&
        pendingRef.current == null
      ) {
        const trusted = docRef.current || seedCacheRef.current.get(activeDoc) || ''
        if (
          trusted &&
          parseDrawioFile(trusted) != null &&
          cellCount(trusted) > 2 &&
          Date.now() - blankPushAtRef.current > 3000
        ) {
          const model = readAppModel()
          if (model == null || cellCount(String(model)) <= 2) {
            blankPushAtRef.current = Date.now()
            dbgLog('blank-watch: app canvas is blank; re-running handoff for ' + activeDoc)
            runHandoff(activeDoc, false)
            return
          }
        }
      }
      pullToDoc(false)
    }
    const timer = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(timer)
  }, [cmView, pullToDoc, runHandoff])

  // Read the INITIAL document into docRef (CodeMirror is the single
  // source of truth — the document stays editor-owned).
  useEffect(() => {
    if (cmView) {
      docRef.current = cmView.state.doc.toString()
    }
  }, [cmView])

  // SCALING (owner 2026-10-13): forward iframe resizes to the app window
  // so the canvas follows the editor pane (split divider, window
  // resizes, responsive relayouts).
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
          {statusText || (status === 'booting' ? t('drawio_status_loading') : '')}
        </span>
      </div>
      <iframe
        ref={iframeRef}
        className="drawio-viewer-frame"
        src={IFRAME_SRC}
        title="draw.io canvas editor"
        onLoad={onIframeLoad}
      />
    </div>
  )
}
