/**
 * draw.io → PDF / PNG conversion + upload into the project.
 *
 * Why: `.drawio` files cannot be `\includegraphics`-ed by pdfLaTeX (they are
 * not previewable either), so the file tree offers conversions next to the
 * original:
 *  - PDF (vector, via svg2pdf.js + jsPDF) — shapes stay vector, ideal for LaTeX
 *  - PNG (raster, via <canvas>, 2× device pixels) — for non-vector contexts
 *
 * Pipeline (all client-side, no new server surface):
 *   1. fetch the `.drawio` text (authenticated blob URL of the file view)
 *   2. render the diagram to SVG with the vendored draw.io app — served
 *      same-origin at /static/drawio (no dynamic downloads) — which decodes
 *      the mxGraphModel through its own Graph/mxGraph/mxCodec APIs
 *   3. convert the SVG to PDF (vector) or PNG
 *   4. upload the result into the same folder as the source file via the
 *      standard /project/:id/upload endpoint, under a derived name
 *      (diagram.pdf / diagram.png, with -1, -2, … on collisions)
 *
 * The conversion implementations at the bottom are browser-only and are
 * never loaded in the Node unit tests (fetch/renderer/converter are all
 * injectable in `convertAndUpload`).
 */

export type ConvertTarget = 'pdf' | 'png'

export const CONVERT_MIME: Record<ConvertTarget, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
}

/**
 * Render a `.drawio` payload (mxGraphModel XML, or a `#R…` compressed
 * diagram) into an SVG document.
 */
export type DiagramRenderer = (
  diagramText: string
) => Promise<string> | string

export type ConvertBlob = (
  svgText: string,
  target: ConvertTarget
) => Promise<Blob>

export function isDrawioFile(name: string): boolean {
  return /\.drawio$/i.test(name || '')
}

/** "diagram.drawio" -> { base: "diagram", ext: "drawio" } */
export function splitFileName(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) {
    return { base: name, ext: '' }
  }
  return { base: name.slice(0, idx), ext: name.slice(idx + 1) }
}

/**
 * Pick the target file name for the conversion result.
 * diagram.drawio -> diagram.pdf / diagram.png; if the name is already used
 * in the folder (exists(name) === true), try diagram-1.pdf, diagram-2.pdf,
 * … (bounded).
 */
export function resolveConversionName(
  sourceName: string,
  target: ConvertTarget,
  exists: (name: string) => boolean
): string {
  const { base } = splitFileName(sourceName)
  let candidate = `${base}.${target}`
  let i = 1
  while (exists(candidate) && i < 100) {
    candidate = `${base}-${i}.${target}`
    i += 1
  }
  return candidate
}

/**
 * Compute a pixel size to render the SVG at.
 * Prefers explicit width/height on the <svg> tag, falls back to the viewBox
 * (scaled so its longest side is 1200px), then a 1200×1200 default (avoids
 * rendering 0×0 for viewBox-only documents).
 */
export function computeRasterPixelSize(svgText: string): {
  width: number
  height: number
} {
  const DEFAULT = 1200

  const attr = (re: RegExp) => {
    const m = re.exec(svgText)
    if (!m) return NaN
    const n = parseFloat(m[1])
    return Number.isFinite(n) && n > 0 ? n : NaN
  }
  const width = attr(/^\s*<svg[^>]*?\bwidth\s*=\s*["']([^"']+)["']/i)
  const height = attr(/^\s*<svg[^>]*?\bheight\s*=\s*["']([^"']+)["']/i)

  let viewBox: number[] | null = null
  const vb = /^\s*<svg[^>]*?\bviewBox\s*=\s*["']([^"']+)["']/i.exec(svgText)
  if (vb) {
    const parts = vb[1].split(/[\s,]+/).map(parseFloat)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      viewBox = parts
    }
  }

  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { width, height }
  }
  if (viewBox) {
    const w = viewBox[2]
    const h = viewBox[3]
    const scale = DEFAULT / Math.max(w, h)
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    }
  }
  return { width: DEFAULT, height: DEFAULT }
}

/**
 * draw.io v32 (adaptive-color theme) ships each shape with CSS that
 * svg2pdf.js 2.9 cannot resolve — inline
 * `style="fill: var(--ge-adaptive-bg, #fff); stroke: light-dark(…)"`
 * plus a `<style>` block with the `@supports (color: light-dark(…))`
 * variable. Unresolvable declarations leave the shapes without fill or
 * stroke and the exported PDF page comes out BLANK (owner 2026-10-27:
 * "Convert to PDF produces an empty canvas"). The canvas raster path
 * tolerates it in current browsers, but not in older ones — sanitize
 * both targets.
 *
 * We reduce to the LIGHT-MODE equivalents (the same values the app
 * renders in light mode; the fallback presentation attributes on the
 * elements already carry them):
 *   light-dark(light, dark)  → light
 *   var(--name, fallback)    → fallback (resolved recursively)
 *   var(--name)              → declaration dropped (unresolvable)
 *   <style>…</style> blocks  → removed (in draw.io output they only
 *                               carry the adaptive-color @supports rules)
 *
 * Pure string processing — unit-testable in Node, no DOM required.
 */

/** Index of the `)` closing the `(` at openIdx (balanced scan), or -1. */
function matchParen (s: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Split a CSS argument list at top level (commas inside parens kept). */
function splitTopLevel (s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

/**
 * Resolve `light-dark(…)` and `var(…)` references to concrete
 * light-mode values; returns null when the value cannot be resolved
 * (e.g. a `var()` without a fallback).
 */
export function resolveCssValue (value: string): string | null {
  let out = String(value == null ? '' : value).trim()
  if (!out) return null
  for (let pass = 0; pass < 32; pass++) {
    // light-dark(light, dark[, fallback]) → the light value
    const ldIdx = out.indexOf('light-dark(')
    if (ldIdx >= 0) {
      const open = ldIdx + 'light-dark(' .length // index after the '('
      const close = matchParen(out, open - 1)
      if (close < open) return null // malformed
      const args = splitTopLevel(out.slice(open, close))
      const light = (args[0] || '').trim()
      if (!light) return null
      out = `${out.slice(0, ldIdx)}${light}${out.slice(close + 1)}`.trim()
      continue
    }
    // var(--name, fallback) → the fallback (may itself carry refs)
    const vIdx = out.indexOf('var(')
    if (vIdx >= 0) {
      const open = vIdx + 4 // index after the '('
      const close = matchParen(out, open - 1)
      if (close < open) return null // malformed
      const args = splitTopLevel(out.slice(open, close))
      if (args.length < 2) return null // no fallback: unresolvable
      const fallback = (args[1] || '').trim()
      if (!fallback) return null
      out = `${out.slice(0, vIdx)}${fallback}${out.slice(close + 1)}`.trim()
      continue
    }
    break
  }
  out = out.trim()
  return out || null
}

/**
 * Make a draw.io-exported SVG consumable by svg2pdf.js (and by older
 * browser canvas rasterisers): see the note above this block.
 */
export function sanitizeSvgForExport (svgText: string): string {
  let out = String(svgText == null ? '' : svgText)
  // 1) drop <style> blocks: in draw.io output they only carry the
  //    adaptive-color @supports rule we resolve away below.
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  // 2) inline style attributes: keep only the resolvable declarations.
  out = out.replace(
    /(\s*\bstyle\s*=\s*)(["'])((?:\\.|(?!\2).)*)\2/gi,
    (match: string, before: string, q: string, style: string): string => {
      const kept: string[] = []
      for (const raw of style.split(';')) {
        const decl = raw.trim()
        if (!decl) continue
        const idx = decl.indexOf(':')
        if (idx < 0) continue
        const prop = decl.slice(0, idx).trim()
        const value = decl.slice(idx + 1).trim()
        const resolved = resolveCssValue(value)
        if (prop && resolved) kept.push(`${prop}: ${resolved}`)
      }
      return kept.length ? before + q + kept.join('; ') + q : ''
    },
  )
  return out
}

/**
 * Convert the content of a `.drawio` file to an SVG document.
 * `renderDiagram` is injectable for unit tests; the default runs the
 * vendored draw.io app in a hidden same-origin iframe.
 */
export async function diagramToSvg(
  diagramText: string,
  renderDiagram: DiagramRenderer = browserRenderDiagram
): Promise<string> {
  if (!diagramText || !diagramText.trim()) {
    throw new Error('the diagram file is empty (nothing to convert yet)')
  }
  const out = await Promise.resolve(renderDiagram(diagramText))
  const text = typeof out === 'string' ? out : ''
  if (!text.trim()) {
    throw new Error('draw.io did not produce SVG output')
  }
  if (!/<svg[\s>]/i.test(text)) {
    throw new Error('draw.io did not return an <svg> document')
  }
  return sanitizeSvgForExport(text)
}

export interface ConvertAndUploadInput {
  projectId: string
  /** Authenticated same-origin blob URL: /project/:id/blob/:hash. */
  downloadPath: string
  /** Parent folder id to upload into (same folder as the source). */
  folderId: string
  sourceName: string
  target: ConvertTarget
  /** Name-collision predicate for the target folder. */
  exists?: (name: string) => boolean
  /** Injected fetch (browser default). */
  fetchImpl?: typeof fetch
  /** Injected diagram renderer (browser default: vendored draw.io app). */
  renderDiagram?: DiagramRenderer
  /** Injected converter (browser default: canvas / svg2pdf.js + jsPDF). */
  convert?: ConvertBlob
  /** CSRF token (from ol-csrfToken meta). */
  csrfToken?: string
}

export type ConvertAndUploadResult =
  | { ok: true; name: string; uploadedId: string | null }
  | { ok: false; error: string }

/**
 * Fetch the original `.drawio` file, render + convert it to the target
 * format and upload the result into the project (same folder as the
 * source).
 */
export async function convertAndUpload(
  input: ConvertAndUploadInput
): Promise<ConvertAndUploadResult> {
  const fetchImpl = input.fetchImpl || fetch
  try {
    const res = await fetchImpl(input.downloadPath, {
      credentials: 'same-origin',
    })
    if (!res.ok) {
      throw new Error(`diagram fetch failed (HTTP ${res.status})`)
    }
    const text = await res.text()
    if (!text.trim()) {
      throw new Error('the diagram file is empty (nothing to convert yet)')
    }

    const renderDiagram = input.renderDiagram || browserRenderDiagram
    const svgText = await diagramToSvg(text, renderDiagram)

    const convert = input.convert || (browserConvert as ConvertBlob)
    const blob = await convert(svgText, input.target)
    if (!blob) {
      throw new Error('conversion produced no output')
    }

    const name = resolveConversionName(
      input.sourceName,
      input.target,
      input.exists || (() => false)
    )

    const formData = new FormData()
    formData.append('qqfile', blob, name)
    formData.append('name', name)

    const uploadRes = await fetchImpl(
      `/project/${input.projectId}/upload?folder_id=${encodeURIComponent(
        input.folderId || ''
      )}`,
      {
        method: 'POST',
        headers: { 'X-CSRF-TOKEN': input.csrfToken || '' },
        body: formData,
      }
    )
    if (!uploadRes.ok) {
      throw new Error(`upload failed (HTTP ${uploadRes.status})`)
    }

    let uploadedId: string | null = null
    try {
      const data = await uploadRes.clone().json()
      uploadedId = data?.entity_id ?? null
    } catch (e) {
      // Non-JSON response: the upload itself succeeded; continue.
    }

    return { ok: true, name, uploadedId }
  } catch (err: unknown) {
    const message =
      (err as { message?: string })?.message ?? 'draw.io conversion failed'
    return { ok: false, error: message }
  }
}

/* ------------------------------------------------------------------ */
/* Browser-only conversion implementations                             */
/* ------------------------------------------------------------------ */

async function svgToPngBlob(svgText: string): Promise<Blob> {
  const { width, height } = computeRasterPixelSize(svgText)
  const DPR = 2 // render at 2× for crisp raster output
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  const img = new Image()
  img.src = url
  try {
    if (typeof img.decode === 'function') {
      await img.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('failed to rasterise the SVG'))
      })
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * DPR))
    canvas.height = Math.max(1, Math.round(height * DPR))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('canvas 2d context unavailable')
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))),
        'image/png'
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function svgToPdfBlob(svgText: string): Promise<Blob> {
  const { width, height } = computeRasterPixelSize(svgText)

  // Lazy: keep jsPDF + svg2pdf.js out of the main IDE bundle.
  const [{ jsPDF }, svg2pdfMod] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ])
  // svg2pdf.js 2.8.x ships a *named* ESM export (svg2pdf.element, pdf, options?)
  const svg2pdf = ((svg2pdfMod as any).svg2pdf ?? (svg2pdfMod as any).default) as (
    svg: SVGSVGElement,
    doc: any,
    config?: any
  ) => Promise<any>
  if (typeof svg2pdf !== 'function') {
    throw new Error('unsupported svg2pdf.js export shape')
  }

  const doc = new jsPDF({
    unit: 'pt',
    format: [Math.max(1, width), Math.max(1, height)],
    orientation: width >= height ? 'l' : 'p',
  })

  const svgEl = new DOMParser().parseFromString(
    svgText,
    'image/svg+xml'
  ).documentElement as unknown as SVGSVGElement
  if (!svgEl || svgEl.nodeName !== 'svg') {
    throw new Error('the file does not contain a valid <svg> root')
  }

  // svg2pdf.js needs a live DOM (e.g. text measurement); render off-screen.
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = '1px'
  host.style.height = '1px'
  host.style.overflow = 'hidden'
  host.appendChild(svgEl)
  document.body.appendChild(host)
  try {
    await svg2pdf(svgEl, doc, { x: 0, y: 0, loadExternalStyleSheets: false })
  } finally {
    host.remove()
  }

  const blob: Blob | null = doc.output('blob')
  if (!blob) {
    throw new Error('pdf generation produced no output')
  }
  return blob
}

/** Default browser converter (not used in Node unit tests). */
export function browserConvert(
  svgText: string,
  target: ConvertTarget
): Promise<Blob> {
  return target === 'png' ? svgToPngBlob(svgText) : svgToPdfBlob(svgText)
}

/* ------------------------------------------------------------------ */
/* Browser-only: render the diagram with the vendored draw.io app      */
/* ------------------------------------------------------------------ */

/**
 * draw.io app, vendored same-origin (see /static/drawio). No dynamic
 * downloads: the image build ships the bundle, nginx serves it.
 */
const DRAWIO_APP_URL = '/static/drawio/index.html'

/** Boot (and cache) one hidden app instance for all conversions. */
let sharedAppPromise: Promise<Window> | null = null

function appWindow(): Promise<Window> {
  if (!sharedAppPromise) {
    sharedAppPromise = new Promise<Window>((resolve, reject) => {
      const fail = (message: string) => {
        window.clearTimeout(deadline)
        window.clearInterval(poll)
        if (frame.parentNode) {
          frame.parentNode.removeChild(frame)
        }
        sharedAppPromise = null
        reject(new Error(message))
      }

      const frame = document.createElement('iframe')
      frame.setAttribute('aria-hidden', 'true')
      frame.style.cssText =
        'position:fixed;left:-100000px;top:0;width:800px;height:600px;' +
        'border:0;visibility:hidden;'

      let poll = 0
      const deadline = window.setTimeout(
        () => fail('draw.io took too long to start'),
        60000
      )

      frame.addEventListener('load', () => {
        const win = frame.contentWindow
        if (!win || typeof (win as any).Graph === 'undefined') {
          fail('draw.io failed to expose its Graph API')
          return
        }
        const started = Date.now()
        poll = window.setInterval(() => {
          const G = (win as any).Graph
          if (
            G &&
            typeof G.compress === 'function' &&
            typeof G.decompress === 'function'
          ) {
            window.clearTimeout(deadline)
            window.clearInterval(poll)
            resolve(win)
            return
          }
          if (Date.now() - started > 45000) {
            fail('draw.io failed to initialise')
          }
        }, 100)
      })
      frame.addEventListener('error', () =>
        fail('draw.io failed to load')
      )
      frame.src = DRAWIO_APP_URL
      document.body.appendChild(frame)
    })
  }
  return sharedAppPromise
}

/**
 * Runs inside the app iframe (constructed with the iframe realm's
 * `Function`, so it sees the app's globals: Graph, mxGraph, mxCodec).
 * Decodes the diagram model and renders the graph to an SVG document via
 * the app's own `getSvg` path (the same one its export dialog uses).
 * Accepts plain mxGraphModel XML or a compressed `#R…` payload.
 */
const DRAWIO_RENDER_CODE = [
  'return (function (xmlText) {',
  '  var G = window.Graph;',
  '  if (!G) { throw new Error("draw.io Graph API missing"); }',
  '  var xml = String(xmlText == null ? "" : xmlText).trim();',
  '  if (!xml) { throw new Error("the diagram file is empty"); }',
  '  if (!/<(?:mxGraphModel|model)[\\s>]/i.test(xml) && !/<mxfile[\\s>]/i.test(xml)) {',
  '    if (typeof G.decompress !== "function") {',
  '      throw new Error("draw.io cannot decode this diagram");',
  '    }',
  '    xml = G.decompress(xml.replace(/^#R/, ""));',
  '  }',
  '  var node = null;',
  '  try {',
  '    node = new DOMParser().parseFromString(xml, "text/xml").documentElement;',
  '  } catch (parseErr) {',
  '    throw new Error("failed to parse the diagram XML: " + parseErr.message);',
  '  }',
  '  if (!node || node.nodeName === "parsererror") {',
  '    throw new Error("the diagram is not valid XML");',
  '  }',
  '  if (node.nodeName.toLowerCase() === "mxfile") {',
  '    var diag = node.getElementsByTagName("diagram")[0] || null;',
  '    var body = diag ? String(diag.textContent || "") : "";',
  '    if (/^\\s*<mxGraphModel[\\s>]/i.test(body)) {',
  '      var inner = new DOMParser().parseFromString(body, "text/xml").documentElement;',
  '      if (inner && inner.nodeName !== "parsererror") { node = inner; }',
  '    } else {',
  '      var pay = body.replace(/\\s+/g, "").replace(/^#R/, "");',
  '      if (/^[A-Za-z0-9+/=]+$/.test(pay) && pay.length >= 8) {',
  '        xml = G.decompress(pay);',
  '        node = new DOMParser().parseFromString(xml, "text/xml").documentElement;',
  '        if (!node || node.nodeName === "parsererror") {',
  '          throw new Error("the diagram is not valid XML");',
  '        }',
  '      }',
  '    }',
  '  }',
  '  var host = document.createElement("div");',
  '  host.style.cssText = "position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;";',
  '  document.body.appendChild(host);',
  '  var cleaned = false;',
  '  function cleanup() {',
  '    if (cleaned) { return; }',
  '    cleaned = true;',
  '    try { host.parentNode.removeChild(host); } catch (e) {}',
  '  }',
  '  var out = null;',
  '  try {',
  '    var GK = window.Graph;',
  '    if (typeof GK !== "function") {',
  '      throw new Error("draw.io Graph API missing");',
  '    }',
  '    var graph = new GK(host);',
  '    var codec = null;',
  '    try { codec = new window.mxCodec(document); } catch (e) { codec = new window.mxCodec(); }',
  '    if (!codec || typeof codec.decode !== "function") {',
  '      throw new Error("draw.io codec missing");',
  '    }',
  '    try { codec.decode(node, graph.model); }',
  '    catch (firstErr) {',
  '      try { codec.decode(xml, graph.model); }',
  '      catch (secondErr) {',
  '        cleanup();',
  '        throw new Error("failed to load the diagram into draw.io: " + secondErr.message);',
  '      }',
  '    }',
  '    try { graph.refresh(); } catch (e) {}',
  '    function renderCall(fn) {',
  '      var r = fn();',
  '      return (r && typeof r.then === "function") ? r : r;',
  '    }',
  '    try { out = renderCall(function () { return graph.getSvg(); }); }',
  '    catch (firstErr) {',
  '      try {',
  '        out = renderCall(function () {',
  '          return graph.getSvg(null, null, 0, null, null, null, null, null, null, null, null, null, null, null);',
  '        });',
  '      } catch (secondErr) {',
  '        cleanup();',
  '        throw new Error("failed to render the diagram: " + secondErr.message);',
  '      }',
  '    }',
  '  } finally {',
  '    if (!out) { cleanup(); }',
  '  }',
  '  function done(value) {',
  '    cleanup();',
  '    var text = value;',
  '    if (text && typeof text !== "string") {',
  '      try { text = new XMLSerializer().serializeToString(text); } catch (e) { text = null; }',
  '    }',
  '    if (typeof text === "string" && text.trim()) { return text; }',
  '    throw new Error("draw.io did not produce SVG output");',
  '  }',
  '  if (out && typeof out.then === "function") {',
  '    return out.then(done, function (err) {',
  '      cleanup();',
  '      throw new Error("failed to render the diagram: " + (err && err.message));',
  '    });',
  '  }',
  '  return done(out);',
  '})(xmlText)'
].join('\n')

export async function browserRenderDiagram(
  diagramText: string
): Promise<string> {
  const win = await appWindow()
  const runner = (win as any).Function('xmlText', DRAWIO_RENDER_CODE)
  const result = await runner(diagramText)
  return typeof result === 'string' ? result : ''
}
