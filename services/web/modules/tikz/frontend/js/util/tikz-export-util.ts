/**
 * Pure helpers for the file-tree "Export to PNG/SVG/PDF" feature
 * (see ../tikz-export.ts for the browser orchestrator).
 *
 * Kept dependency-free so the unit tests can import this file without
 * the app's `@` webpack alias (vitest has no alias for it).
 */

export type TikzExportFormat = 'png' | 'svg' | 'pdf'

export const TIKZ_EXPORT_FORMATS: TikzExportFormat[] = ['png', 'svg', 'pdf']

export const TIKZ_EXPORT_MIME: Record<TikzExportFormat, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}

/**
 * Target file name for an export: the base name of the source file with
 * the export extension. `drawing.tikz` → `drawing.png`,
 * `sub/fig.pgf` → `sub/fig.pdf` (only the last extension is replaced).
 */
export function tikzExportTargetName (
  baseFileName: string,
  format: TikzExportFormat
): string {
  const base = baseFileName.replace(/\.(tikz|pgf)$/i, '')
  return `${base}.${format}`
}

/**
 * Parse the rendered preview SVG's dimensions from its viewBox attribute
 * (`viewBox="minX minY width height"`). Returns null when the SVG carries
 * no usable viewBox (callers fall back to intrinsic dimensions).
 */
export function parseTikzSvgViewBox (
  svg: string
): { width: number; height: number } | null {
  const m = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i)
  if (!m) return null
  const parts = m[1]
    .split(/[\s,]+/)
    .map(Number)
    .filter(n => Number.isFinite(n))
  if (parts.length < 4) return null
  const width = parts[2]
  const height = parts[3]
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * True when a rendered preview SVG actually contains figure content
 * (as opposed to an empty canvas `<svg viewBox="..."</svg>` that the app
 * answers before its preview has rendered).
 */
export function hasTikzSvgContent (svg: string): boolean {
  if (typeof svg !== 'string') return false
  // strip the outer svg element, then look for anything left
  const inner = svg
    .replace(/<svg[^>]*>/i, '')
    .replace(/<\/svg>/i, '')
    .trim()
  return inner.length > 0
}

/**
 * True when the embed export message is a "preview not ready" retry
 * signal (as opposed to a hard failure).
 */
export function isTikzExportNotReady (
  msg: Record<string, unknown> | null | undefined
): boolean {
  return (
    msg != null &&
    typeof msg.error === 'string' &&
    /not ready/i.test(msg.error)
  )
}

/**
 * The five object bodies of the generated single-page PDF (pure, so the
 * structure can be unit-tested with a strict mini-parser).
 */
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

export function tikzPdfObjectBodies (params: {
  ptW: number
  ptH: number
  width: number
  height: number
  compressed: boolean
  streamLength: number
}): string[] {
  const content = `q ${params.ptW} 0 0 ${params.ptH} 0 0 cm /Im0 Do Q`
  return [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${params.ptW} ${params.ptH}]/Resources<</XObject<</Im0 4 0 R>>/ProcSet[/PDF/Image/DeviceRGB]>>/Contents 5 0 R>>`,
    `<</Type/XObject/Subtype/Image/Width ${params.width}/Height ${params.height}/ColorSpace/DeviceRGB/BitsPerComponent 8${params.compressed ? '/Filter/FlateDecode' : ''}/Length ${params.streamLength}>>`,
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ]
}

/** Assemble the PDF byte string with exact offsets (image inline in obj 4). */
export function buildPdf (opts: {
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

/**
 * True when the embed export message is a hard error.
 */
export function isTikzExportError (
  msg: Record<string, unknown> | null | undefined
): boolean {
  return (
    msg != null &&
    typeof msg.error === 'string' &&
    msg.error.length > 0
  )
}
