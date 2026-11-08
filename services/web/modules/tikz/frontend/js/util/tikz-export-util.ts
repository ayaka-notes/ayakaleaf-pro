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
