/**
 * Highlights document lines changed by an AI suggestion.
 * Callers dispatch highlightFixEffect with a selection to show the highlight
 * or null to clear it.
 */
import { StateEffect, StateField, type EditorSelection } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

export const highlightFixEffect = StateEffect.define<{
  ranges: readonly { from: number; to: number }[]
} | null>()

const lineDecoration = Decoration.line({ class: 'ol-cm-highlight-fix' })

const highlightFixField = StateField.define({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(highlightFixEffect)) {
        decorations = effect.value
          ? Decoration.set(
              effect.value.ranges.flatMap(range => {
                const fromLine = tr.state.doc.lineAt(range.from)
                const toLine = tr.state.doc.lineAt(Math.max(range.to - 1, 0))
                const lines = []
                for (let n = fromLine.number; n <= toLine.number; n++) {
                  lines.push(lineDecoration.range(tr.state.doc.line(n).from))
                }
                return lines
              })
            )
          : Decoration.none
      }
    }
    return decorations
  },
  provide: field => EditorView.decorations.from(field),
})

const highlightFixTheme = EditorView.theme({
  '.ol-cm-highlight-fix': {
    background: 'rgba(255, 255, 155, 0.5) !important',
    transition: 'background 2s',
    '& @starting-style': {
      background: 'transparent',
    },
  },
})

export const extension = () => [highlightFixField, highlightFixTheme]

export type { EditorSelection }
