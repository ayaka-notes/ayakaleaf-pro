import customLocalStorage from '@/infrastructure/local-storage'
import DrawioViewer from './components/drawio-viewer'

/**
 * Visual-editor provider (Overleaf `visualEditorProviders` hook) for the
 * draw.io canvas editor (modules/drawio, AK-11 owner request 2026-10-08).
 *
 * When this provider claims a file (`.drawio`), the code editor is hidden
 * and the full canvas editor (the vendored draw.io app in an iframe) is
 * rendered in the editor pane — the "Code | Visual" switch in the editor
 * toolbar toggles between the raw XML source and the canvas (same
 * house pattern as the tikz + diagram providers).
 */

const STORAGE_KEY = 'editor.lastUsedMode.drawio'

// Product default: open .drawio documents in the canvas editor; the user
// can switch to the raw source at any time (last-used mode remembered —
// house convention, same as the tikz + diagram modules).
try {
  if (customLocalStorage.getItem(STORAGE_KEY) === null) {
    customLocalStorage.setItem(STORAGE_KEY, 'visual')
  }
} catch (e) {
  // localStorage unavailable — the Code/Visual toggle still works.
}

export const id = 'drawio'

export const defaultVisual = true

export function isVisualEditorAvailable (filename) {
  return /\.drawio$/i.test(filename || '')
}

export function getVisualEditorComponent (filename) {
  return isVisualEditorAvailable(filename) ? DrawioViewer : null
}

export default {
  id,
  defaultVisual,
  isVisualEditorAvailable,
  getVisualEditorComponent,
}
