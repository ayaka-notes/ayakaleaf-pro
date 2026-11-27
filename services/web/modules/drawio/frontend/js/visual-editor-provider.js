import customLocalStorage from '@/infrastructure/local-storage'
import DrawioViewer from './components/drawio-viewer'

/**
 * Visual-editor provider (Overleaf `visualEditorProviders` hook) for the
 * draw.io canvas editor (modules/drawio, AK-11 owner request 2026-10-08).
 *
 * When this provider claims a file (`.drawio`), the canvas editor (the
 * vendored draw.io app in an iframe) is rendered in the editor pane.
 * Owner 2026-10-13 (round 2, c): `.drawio` is FIXED TO VISUAL — the
 * Code|Visual toggle is not offered for this file type (the viewer no
 * longer mounts it); the provider defaults to visual mode.
 */

const STORAGE_KEY = 'editor.lastUsedMode.drawio'

// Product default: open .drawio documents in the canvas editor (visual is
// the only mode offered in the UI).
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
