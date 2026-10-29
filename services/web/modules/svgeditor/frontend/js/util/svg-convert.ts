/**
 * SVG → PDF / PNG conversion + upload into the project.
 *
 * Why: plain SVG files cannot be `\includegraphics`-ed by pdfLaTeX, so the
 * file tree offers conversions next to the original:
 *  - PDF (vector, via svg2pdf.js + jsPDF) — stays vector, ideal for LaTeX
 *  - PNG  (raster, via <canvas>)          — for non-vector contexts
 *
 * The conversion runs in the browser (no server surface added); the result
 * is uploaded with the standard project upload endpoint into the SAME folder
 * as the source file, under a derived name (logo.svg → logo.pdf / logo.png).
 *
 * The orchestration (fetch → convert → name → upload) is injectable so it
 * can be unit-tested in Node (fetch/convert are passed in; Node 22 provides
 * FormData/Blob). Browser-only conversion functions are isolated at the
 * bottom of this file.
 */

export type ConvertTarget = 'pdf' | 'png'

export const CONVERT_MIME: Record<ConvertTarget, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
}

export type ConvertBlob = (
  svgText: string,
  target: ConvertTarget
) => Promise<Blob>

/** "logo.svg" -> { base: "logo", ext: "svg" } */
export function splitFileName(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) {
    return { base: name, ext: '' }
  }
  return { base: name.slice(0, idx), ext: name.slice(idx + 1) }
}

/**
 * Pick the target file name for the conversion result.
 * logo.svg -> logo.pdf / logo.png; if the name is already used in the folder
 * (exists(name) === true), try logo-1.pdf, logo-2.pdf, ... (bounded).
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
 * Prefers explicit width/height, falls back to the viewBox aspect, then a
 * 1200px default (avoids rendering 0x0 for viewBox-only documents).
 */
export function computeSvgPixelSize(svgText: string): {
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
    const aspect = viewBox[2] / viewBox[3]
    if (Number.isFinite(width)) return { width, height: width / aspect }
    if (Number.isFinite(height)) return { width: height * aspect, height }
    return { width: DEFAULT, height: DEFAULT / aspect }
  }
  return { width: DEFAULT, height: DEFAULT }
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
  /** Injected converter (browser default: canvas / svg2pdf.js + jsPDF). */
  convert?: ConvertBlob
  /** CSRF token (from ol-csrfToken meta). */
  csrfToken?: string
}

export type ConvertAndUploadResult =
  | { ok: true; name: string; uploadedId: string | null }
  | { ok: false; error: string }

/**
 * Fetch the original SVG, convert it to the target format and upload the
 * result into the project (same folder as the source).
 */
export async function convertAndUpload(
  input: ConvertAndUploadInput
): Promise<ConvertAndUploadResult> {
  const fetchImpl = input.fetchImpl || fetch
  try {
    const res = await fetchImpl(input.downloadPath)
    if (!res.ok) {
      throw new Error(`svg fetch failed (HTTP ${res.status})`)
    }
    const svgText = await res.text()
    if (!svgText.trim()) {
      throw new Error('the SVG file is empty')
    }

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
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'svg conversion failed' }
  }
}

/* ------------------------------------------------------------------ */
/* Browser-only conversion implementations                             */
/* ------------------------------------------------------------------ */

async function svgToPngBlob(svgText: string): Promise<Blob> {
  const { width, height } = computeSvgPixelSize(svgText)
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  const img = new Image()
  img.src = url
  try {
    if (typeof img.decode === 'function') {
      await img.decode()
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('could not render the SVG'))
      })
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width))
    canvas.height = Math.max(1, Math.round(height))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('no 2d canvas context available')
    }
    ctx.imageSmoothingQuality = 'high'
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
  const { width, height } = computeSvgPixelSize(svgText)

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
  ) => Promise<any
  >
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
  return target === 'png'
    ? svgToPngBlob(svgText)
    : svgToPdfBlob(svgText)
}
