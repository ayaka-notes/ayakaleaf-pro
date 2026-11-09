import customLocalStorage from '@/infrastructure/local-storage'
import TikzViewer from './components/tikz-viewer'
import { isTikzFile } from './util/tikz-protocol'

/**
 * Visual-editor provider (Overleaf `visualEditorProviders` hook) for the
 * TikZ editor (modules/tikz, candidate B adoption 2026-09-29).
 *
 * When this provider claims a file (`.tikz` / `.pgf`), the code editor is
 * hidden and the full canvas editor is rendered in the editor pane — the
 * "Code | Visual" switch in the editor toolbar toggles between the raw
 * TikZ source and the canvas (last-used mode is remembered per the
 * `editor.lastUsedMode.<id>` storage key, house convention — same as the
 * diagram module).
 */

const STORAGE_KEY = 'editor.lastUsedMode.tikz'

// Product default: open TikZ documents in the canvas editor; the user can
// switch to the raw source at any time.
try {
  if (customLocalStorage.getItem(STORAGE_KEY) === null) {
    customLocalStorage.setItem(STORAGE_KEY, 'visual')
  }
} catch (e) {
  // localStorage unavailable — the Code/Visual toggle still works.
}

export const id = 'tikz'

export const defaultVisual = true

export function isVisualEditorAvailable (filename) {
  return isTikzFile(filename)
}

export function getVisualEditorComponent (filename) {
  return isTikzFile(filename) ? TikzViewer : null
}
