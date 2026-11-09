import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { startCompletion } from '@codemirror/autocomplete'
import { getBibkeyArgumentNode } from '@/features/source-editor/utils/tree-operations/ancestors'

export const setCitationHint = StateEffect.define<Tooltip | null>()

export const citationHint = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCitationHint)) return effect.value
    }
    return transaction.docChanged ||
      !transaction.state.selection.eq(transaction.startState.selection)
      ? null
      : value
  },
  provide: field => showTooltip.from(field),
})

export function citationRange(view: EditorView) {
  const { doc, selection } = view.state
  const pos = selection.main.head
  const node = getBibkeyArgumentNode(view.state, pos)
  if (!node) return null

  const from = node.from + 1
  const to = node.to - 1
  if (
    pos < from || pos > to ||
    doc.sliceString(node.from, from) !== '{' ||
    doc.sliceString(to, node.to) !== '}'
  ) return null

  return { braceFrom: from, braceTo: to }
}

function openPickerIfInCite(view: EditorView): boolean {
  try {
    const range = citationRange(view)
    if (range) {
      window.dispatchEvent(new CustomEvent('reference:openPicker', { detail: range }))
      return true
    }
  } catch {
    // Fall back to ordinary completion during parser recovery.
  }
  return startCompletion(view)
}

export const extension = (): Extension => [
  citationHint,
  Prec.highest(
    keymap.of([
      { key: 'Ctrl-Space', run: openPickerIfInCite },
      { key: 'Alt-Space', run: startCompletion },
    ])
  ),
]
