import { EditorView } from '@codemirror/view'
import { formatDocNameField, formatDocument } from './format-document'

// Shift+Alt+F (Shift+Option+F on macOS) formats the document, as in VS Code.
// CodeMirror's keymap leaves Option combinations on macOS to typing (this one
// types "Ï"), so the shortcut is matched on the physical key instead.
const formatShortcutHandler = EditorView.domEventHandlers({
  keydown(event, view) {
    if (
      event.code === 'KeyF' &&
      event.shiftKey &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      formatDocument(view)
    ) {
      event.preventDefault()
      return true
    }
    return false
  },
})

// sourceEditorExtensions modules export `extension`, a factory
export const extension = (options: { docName: string }) => [
  formatDocNameField.init(() => options.docName),
  formatShortcutHandler,
]
