/**
 * "Export to PNG/SVG/PDF" for .tikz/.pgf project files.
 *
 * Rendering: the vendored tikz-editor app boots in a hidden same-origin
 * iframe; we load the file's source (`action:'load'`) and then request
 * the rendered preview through the app's host export protocol
 * (`action:'export'` → `event:'export'` with the SVG). The app answers
 * "not ready" until its preview has rendered, so we poll until the SVG
 * arrives. No changes to the vendored app are required for this flow.
 *
 * Artifact generation (host side, fully offline):
 * - SVG: the preview SVG as-is
 * - PNG: rasterised with an offscreen <canvas>
 * - PDF: the high-resolution PNG placed on a single page by a tiny
 *        dependency-free PDF writer (raw RGB + CompressionStream)
 *
 * The artifact is then saved into the project with the regular project
 * upload endpoint (uploadBatch).
 */
import { uploadBatch } from '@/infrastructure/batch-file-uploader'
import {
  encodeTikzHostMessage,
  isTikzFile,
  tikzEmbedUrl,
} from './tikz-protocol'
import {
  isTikzExportError,
  isTikzExportNotReady,
  parseTikzSvgViewBox,
  TIKZ_EXPORT_FORMATS,
  TIKZ_EXPORT_MIME,
  tikzExportTargetName,
  TikzExportFormat,
} from './tikz-export-util'

export {
  isTikzExportError,
  isTikzExportNotReady,
  parseTikzSvgViewBox,
  TIKZ_EXPORT_FORMATS,
  TIKZ_EXPORT_MIME,
  tikzExportTargetName,
}
export type { TikzExportFormat } from './tikz-export-util'

const RENDER_TIMEOUT_MS = 90_000
const POLL_MS = 1000
/** Consecutive "not ready" answers before we give up (≈ an empty document). */
const MAX_NOT_READY = 12
const PNG_LONG_EDGE = 1600
const PDF_LONG_EDGE = 2400

export type ExportTikzFileOptions = {
  format: TikzExportFormat
  /** The file's name, e.g. "drawing.tikz" (used for naming + the canvas). */
  baseFileName: string
  projectId: string
  /** Folder the artifact is saved into (the source file's folder). */
  parentFolderId: string
  /**
   * Either of:
   * - sourceText: the .tikz source already in hand, or
   * - downloadPath: `GET → source text` (the file tree's download URL).
   */
  sourceText?: string
  downloadPath?: string
}

async function fetchSourceText (downloadPath: string): Promise<string> {
  const res = await fetch(downloadPath)
  if (!res.ok) {
    throw new Error(`Could not read the file (HTTP ${res.status})`)
  }
  return res.text()
}

/**
 * Boot the headless embed, load the source, and collect the rendered
 * preview SVG via the host export protocol.
 */
function renderTikzSvg (
  source: string,
  baseFileName: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    let notReadyCount = 0

    // Off-screen but laid out (display:none would stop the preview render).
    const host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText =
      'position:fixed;left:-100000px;top:0;width:1400px;height:900px;'
    const frame = document.createElement('iframe')
    frame.setAttribute('title', 'TikZ export renderer')
    frame.style.cssText = 'width:100%;height:100%;border:0;'
    host.appendChild(frame)
    document.body.appendChild(host)

    let settled = false
    let poller: ReturnType<typeof setInterval> | null = null
    let initSeen = false

    const timer = setTimeout(() => {
      finish(new Error('TikZ export timed out while rendering the preview.'))
    }, RENDER_TIMEOUT_MS)

    function finish (err?: Error, svg?: string) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (poller) clearInterval(poller)
      window.removeEventListener('message', onMessage, true)
      try {
        host.remove()
      } catch {
        // the iframe is gone already
      }
      if (err) reject(err)
      else resolve(svg as string)
    }

    function parseMessage (event: MessageEvent) {
      if (event.source !== frame.contentWindow) return null
      let payload: unknown = event.data
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload)
        } catch {
          return null
        }
      }
      if (payload == null || typeof payload !== 'object') return null
      return payload as Record<string, unknown>
    }

    function postToEmbed (message: object) {
      frame.contentWindow?.postMessage(
        encodeTikzHostMessage(message),
        window.location.origin
      )
    }

    function onMessage (event: MessageEvent) {
      const m = parseMessage(event)
      if (!m) return

      if (m.event === 'init') {
        if (initSeen) return
        initSeen = true
        postToEmbed({
          action: 'load',
          source,
          autosave: 0,
          fileName: baseFileName,
        })
        return
      }

      if (m.event === 'export') {
        if (isTikzExportError(m)) {
          if (isTikzExportNotReady(m)) {
            notReadyCount += 1
            if (notReadyCount >= MAX_NOT_READY) {
              finish(
                new Error(
                  'The figure has no renderable preview (is the file empty or broken?).'
                )
              )
            }
            return // preview still rendering — the poller retries
          }
          finish(new Error(String(m.error)))
          return
        }
        if (typeof m.data === 'string' && m.data.length > 0) {
          finish(undefined, m.data)
          return
        }
        if (typeof m.svg === 'string' && m.svg.length > 0) {
          finish(undefined, m.svg)
        }
      }
    }

    function requestExport () {
      postToEmbed({ action: 'export', format: 'svg' })
    }

    function startPolling () {
      if (poller || settled) return
      poller = setInterval(() => {
        if (settled) return
        if (Date.now() - startedAt > RENDER_TIMEOUT_MS - 1000) return
        requestExport()
      }, POLL_MS)
    }

    window.addEventListener('message', onMessage, true)
    frame.addEventListener('load', startPolling)
    frame.src = tikzEmbedUrl(null)
  })
}

/** Intrinsic size fallbacks for SVGs without a usable viewBox. */
function svgDimensions (
  svg: string
): { width: number; height: number } {
  const vb = parseTikzSvgViewBox(svg)
  if (vb) return vb
  return { width: 400, height: 300 }
}

/** Rasterise the preview SVG; returns the canvas at the requested long edge. */
async function svgToCanvas (
  svg: string,
  longEdge: number
): Promise<HTMLCanvasElement> {
  const { width, height } = svgDimensions(svg)
  const scale = Math.max(
    1,
    Math.min(8, longEdge / Math.max(width, height))
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable.')

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () =>
        reject(new Error('Could not rasterise the preview SVG.'))
      img.src = url
    })
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function svgToPng (
  svg: string,
  longEdge: number
): Promise<Blob> {
  const canvas = await svgToCanvas(svg, longEdge)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))),
      'image/png'
    )
  })
}

function concatBytes (chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

async function deflate (
  data: Uint8Array
): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([data as BlobPart]).stream()
        .pipeThrough(new CompressionStream('deflate'))
      const buf = await new Response(stream).arrayBuffer()
      const bytes = new Uint8Array(buf)
      if (bytes.length < data.length) {
        return { bytes, compressed: true }
      }
    } catch {
      // fall through to uncompressed
    }
  }
  return { bytes: data, compressed: false }
}

/**
 * Minimal, dependency-free single-page PDF: one page (the figure's
 * aspect ratio, in points) filled edge-to-edge by the rasterised image.
 */
async function svgToPdf (svg: string): Promise<Blob> {
  const { width: ptW, height: ptH } = svgDimensions(svg)
  const canvas = await svgToCanvas(svg, PDF_LONG_EDGE)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable.')
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = imgData.data
  // Flatten alpha onto white → raw RGB
  const rgb = new Uint8Array(canvas.width * canvas.height * 3)
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    const a = px[i + 3] / 255
    rgb[j] = Math.round(px[i] * a + 255 * (1 - a))
    rgb[j + 1] = Math.round(px[i + 1] * a + 255 * (1 - a))
    rgb[j + 2] = Math.round(px[i + 2] * a + 255 * (1 - a))
  }
  const { bytes: stream, compressed } = await deflate(rgb)
  const content = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${ptW} ${ptH}]/Resources<</XObject<</Im0 4 0 R>>/ProcSet[/PDF/Image/DeviceRGB]>>/Contents 5 0 R>>`,
    `<</Type/XObject/Subtype/Image/Width ${canvas.width}/Height ${canvas.height}/ColorSpace/DeviceRGB/BitsPerComponent 8${compressed ? '/Filter/FlateDecode' : ''}/Length ${stream.length}>`,
    `<</Length ${content.length}>\nstream\n${content}\nendstream`,
  ]
  return buildPdf({ objects, stream })
}

/** Assemble the PDF byte string with exact offsets (image inline in obj 4). */
function buildPdf (opts: {
  objects: string[]
  stream: Uint8Array
}): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = [enc.encode('%PDF-1.4\n')]
  const offsets: number[] = []
  opts.objects.forEach((body, i) => {
    offsets.push(parts.reduce((n, p) => n + p.length, 0))
    parts.push(enc.encode(`${i + 1} 0 obj\n`))
    if (i === 3) {
      // object 4: dict, then the binary image stream inline
      parts.push(enc.encode(body))
      parts.push(enc.encode('\nstream\n'))
      parts.push(opts.stream)
      parts.push(enc.encode(`\nendstream\nendobj\n`))
      return
    }
    parts.push(enc.encode(body))
    parts.push(enc.encode('\nendobj\n'))
  })
  const xrefPos = parts.reduce((n, p) => n + p.length, 0)
  let xref = `xref\n0 ${opts.objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<</Size ${opts.objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`
  parts.push(enc.encode(xref + trailer))
  return new Blob([concatBytes(parts) as BlobPart], { type: 'application/pdf' })
}

async function generateArtifact (
  svg: string,
  format: TikzExportFormat
): Promise<Blob> {
  switch (format) {
    case 'svg':
      return new Blob([svg], { type: TIKZ_EXPORT_MIME.svg })
    case 'png':
      return svgToPng(svg, PNG_LONG_EDGE)
    case 'pdf':
      return svgToPdf(svg)
    default:
      throw new Error(`Unsupported export format: ${format}`)
  }
}

/**
 * Render the file and save the artifact into the project.
 * Returns the created file's name (e.g. "drawing.png").
 */
export async function exportTikzFile (
  opts: ExportTikzFileOptions
): Promise<string> {
  if (!TIKZ_EXPORT_FORMATS.includes(opts.format)) {
    throw new Error(`Unsupported export format: ${opts.format}`)
  }
  let source = opts.sourceText
  if (source == null) {
    if (!opts.downloadPath) throw new Error('No source provided.')
    source = await fetchSourceText(opts.downloadPath)
  }

  const svg = await renderTikzSvg(source, opts.baseFileName)
  const blob = await generateArtifact(svg, opts.format)
  const fileName = tikzExportTargetName(opts.baseFileName, opts.format)

  const results = await uploadBatch(
    [{ file: blob, name: fileName }],
    { projectId: opts.projectId, folderId: opts.parentFolderId }
  )
  const result = results[0]
  if (!result || result.status !== 'success') {
    throw new Error(result?.error ?? 'Upload to the project failed.')
  }
  return fileName
}

/**
 * Shape consumed by the core file tree via `overleafModuleImports`.
 */
const tikzFileExportApi = {
  formats: TIKZ_EXPORT_FORMATS,
  isExportable: (name: string | null | undefined) => isTikzFile(name),
  targetName: tikzExportTargetName,
  export: exportTikzFile,
}

export default tikzFileExportApi
