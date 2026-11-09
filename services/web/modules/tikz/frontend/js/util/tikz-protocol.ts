/**
 * TikZ editor embed protocol (candidate B adoption, 2026-09-29).
 *
 * Pure (DOM-free) reducer + message helpers for the postMessage bridge
 * between this visual editor (host) and the vendored tikz-editor app
 * (iframe, /static/tikz-editor/index.html — see public/static/tikz-editor/
 * PROVENANCE.txt). The protocol is the TeXlyre embed mirror's contract
 * (JSON-stringified postMessage, draw.io-style):
 *
 *   iframe -> host:
 *     { event: 'init', version }
 *     { event: 'loaded' }
 *     { event: 'change' | 'autosave' | 'save', source, xml?: source, svg? }
 *     { event: 'export', format?, data?, svg?, source, xml? }
 *     { event: 'persistence-save', key, value }
 *     { error }
 *
 *   host -> iframe:
 *     { action: 'load', source, autosave }
 *     { action: 'save' }
 *     { action: 'export', format: 'svg' | 'tex' }
 *     { action: 'status', modified: boolean }
 *
 * `xml` is intentionally an alias of the TikZ source in the embed so
 * draw.io-style host branches keep working.
 */

export const TIKZ_STORAGE_KEY = 'ollitex:tikz-editor:storage'

export type TikzHostAction =
  | { kind: 'boot-load'; source: string }
  | { kind: 'doc-update'; source: string }
  | { kind: 'export-result'; data: string | null }
  | { kind: 'persistence-save'; key: string; value: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'noop' }

/** Pull the document source out of a change/save/export message. */
export function readTikzSource (
  msg: Record<string, unknown>
): string | null {
  const source = msg.source
  const xml = msg.xml
  if (typeof source === 'string' && source.trim()) return source
  if (typeof xml === 'string' && xml.trim()) return xml
  return null
}

/**
 * Reduce one (already origin-checked, parsed) message from the embed into
 * the host's effects. Pure: no window, no state — so it is unit-testable
 * without a DOM (same discipline as the diagram module's utils).
 */
export function handleTikzEmbedMessage (
  msg: unknown,
  state: {
    /** current CodeMirror-backed document source */
    doc: string
  }
): TikzHostAction {
  if (msg == null || typeof msg !== 'object') return { kind: 'noop' }
  const m = msg as Record<string, unknown>

  if (typeof m.error === 'string') {
    return { kind: 'error', message: m.error }
  }

  switch (m.event) {
    case 'init':
      return { kind: 'boot-load', source: state.doc }

    case 'loaded':
      return { kind: 'ready' }

    case 'change':
    case 'autosave':
    case 'save': {
      const source = readTikzSource(m)
      if (source == null) return { kind: 'noop' }
      return { kind: 'doc-update', source }
    }

    case 'export': {
      let data: string | null = null
      if (typeof m.data === 'string' && m.data) data = m.data
      else if (typeof m.svg === 'string' && m.svg) data = m.svg
      else data = readTikzSource(m)
      return { kind: 'export-result', data }
    }

    case 'persistence-save':
      if (typeof m.key === 'string' && typeof m.value === 'string') {
        return { kind: 'persistence-save', key: m.key, value: m.value }
      }
      return { kind: 'noop' }

    default:
      return { kind: 'noop' }
  }
}

/** Encode a host->iframe action for postMessage (JSON-string contract). */
export function encodeTikzHostMessage (message: object): string {
  return JSON.stringify(message)
}

/**
 * Build the iframe boot URL: the embed app reads persisted editor state
 * from a `#storage=<json>` hash fragment (same mechanism as the TeXlyre
 * host reference) — we pass our persisted key/value pairs, if any.
 * Absolute same-origin path (house pattern: the diagram module hardcodes
 * /static/svgedit/... the same way — no base-path plumbing needed).
 */
export function tikzEmbedUrl (
  storage: Record<string, string> | null
): string {
  const url = '/static/tikz-editor/index.html'
  if (storage) {
    const entries = Object.entries(storage)
    if (entries.length > 0) {
      return `${url}#storage=${encodeURIComponent(JSON.stringify(storage))}`
    }
  }
  return url
}

/** Extensions the provider claims (case-insensitive, dot-leading stripped). */
export const TIKZ_FILE_EXTENSIONS = ['tikz', 'pgf']

export function isTikzFile (fileName: string | null | undefined): boolean {
  if (!fileName) return false
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext != null && TIKZ_FILE_EXTENSIONS.includes(ext)
}
