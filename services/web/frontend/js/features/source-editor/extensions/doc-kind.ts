import { StateEffect, StateField, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * Editor document kind ("typst" | "latex" | other), set from the open file's
 * name in createExtensions().
 *
 * Both reference-picker (LaTeX, Ctrl-Space -> \cite) and typst-picker
 * (Typst, Ctrl-Space -> @key) bind the same key. The LaTeX handler's
 * startCompletion fallback returns true and would swallow the key before the
 * Typst handler ever runs, so the typst keybinding consults this field to
 * stay out of LaTeX documents (and vice versa).
 *
 * A module-level initial value is used because StateField.create() runs
 * during EditorState construction, after createExtensions() has run — and
 * this app has a single source editor at a time.
 */
export const setDocKind = StateEffect.define<string>()

export const docKindField = StateField.define<string>({
  create: () => initialDocKind,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setDocKind)) {
        return effect.value
      }
    }
    return value
  },
})

let initialDocKind = 'latex'

export function docKindExtension(kind: string): Extension {
  initialDocKind = kind
  return docKindField
}

export function docKindOf(view: EditorView): string {
  return view.state.field(docKindField)
}
