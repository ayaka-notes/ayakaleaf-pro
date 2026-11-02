/**
 * Formats the open document in the browser: tex-fmt (WebAssembly) for
 * .tex/.sty/.cls files and bibtex-tidy for .bib files.
 */
import { EditorState, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { setDocNameEffect } from '@/features/source-editor/extensions/doc-name'
import { debugConsole } from '@/utils/debugging'
import { formattingChanges } from './formatting-changes'
import { showFormatErrorToast } from './components/format-error-toast'

type Formatter = (text: string) => string
type FormatterKind = 'tex' | 'bib'

// bibtex-tidy's defaults, without the ones that change entries rather than
// their layout: escaping special characters, dropping duplicate fields and
// lowercasing field names and entry types
const bibtexTidyOptions = {
  escape: false,
  removeDuplicateFields: false,
  lowercase: false,
}

/**
 * The open document's name. Core's docName field is created for each editor
 * state, so this module keeps its own, updated by the same effect.
 */
export const formatDocNameField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDocNameEffect)) {
        value = effect.value
      }
    }
    return value
  },
})

function formatterKind(state: EditorState): FormatterKind | null {
  const extension = state
    .field(formatDocNameField, false)
    ?.split('.')
    .pop()
    ?.toLowerCase()
  if (extension === 'bib') {
    return 'bib'
  }
  // The other extensions tex-fmt formats
  if (extension === 'tex' || extension === 'sty' || extension === 'cls') {
    return 'tex'
  }
  return null
}

export function canFormat(state: EditorState) {
  return !state.readOnly && formatterKind(state) !== null
}

const loaders: Record<FormatterKind, () => Promise<Formatter>> = {
  tex: async () => {
    const { loadTexFmt } = await import(
      /* webpackChunkName: "tex-fmt" */ './tex-fmt'
    )
    return loadTexFmt()
  },
  bib: async () => {
    const { tidy } = await import(
      /* webpackChunkName: "bibtex-tidy" */ 'bibtex-tidy'
    )
    return (text: string) => tidy(text, bibtexTidyOptions).bibtex
  },
}

const loading: Partial<Record<FormatterKind, Promise<Formatter>>> = {}

function loadFormatter(kind: FormatterKind) {
  loading[kind] ??= loaders[kind]().catch(error => {
    // Let the next attempt load it again
    delete loading[kind]
    throw error
  })
  return loading[kind]
}

/**
 * Formats the document as a CodeMirror command. The formatter is loaded on
 * first use; the document is then read and changed in one go, so edits made
 * meanwhile are formatted too rather than overwritten.
 */
export function formatDocument(view: EditorView): boolean {
  const kind = formatterKind(view.state)
  if (!kind || view.state.readOnly) {
    return false
  }
  loadFormatter(kind)
    .then(format => {
      // Another document may have been opened while the formatter loaded
      if (formatterKind(view.state) !== kind || view.state.readOnly) {
        return
      }
      const before = view.state.doc.toString()
      const changes = formattingChanges(before, format(before))
      if (changes.length > 0) {
        view.dispatch({ changes, userEvent: 'input.format' })
      }
    })
    .catch(error => {
      debugConsole.error('Formatting the document failed', error)
      showFormatErrorToast()
    })
  return true
}
