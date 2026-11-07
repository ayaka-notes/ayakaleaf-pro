import { EditorView, showTooltip, Tooltip, TooltipView } from '@codemirror/view'
import { EditorState, StateField } from '@codemirror/state'
import i18n from 'i18next'
import { getBibkeyArgumentNode } from '@/features/source-editor/utils/tree-operations/ancestors'
import { isMac } from '@/shared/utils/os'
import { openPickerIfInCite } from './reference-picker-keybinding'
import '../../stylesheets/reference-search-hint.scss'

// Recreates the upstream "advanced reference search" hint shown inside a \cite{}
// argument. Clicking it opens the reference picker, so the feature stays
// reachable by mouse (Ctrl/Alt-Space is frequently captured by the OS on macOS).

function createHintTooltipView(view: EditorView): TooltipView {
  const dom = document.createElement('div')
  dom.className = 'ol-cm-references-search-hint'

  const inner = document.createElement('div')
  inner.className = 'ol-cm-references-search-hint-inner'
  inner.setAttribute('role', 'button')
  inner.tabIndex = 0

  const text = document.createElement('div')

  const title = document.createElement('div')
  title.textContent = i18n.t('open_advanced_reference_search')

  const shortcut = document.createElement('div')
  shortcut.innerHTML = i18n.t('shortcut_to_open_advanced_reference_search', {
    ctrlSpace: isMac ? '⌃ Space' : 'Ctrl Space',
    altSpace: isMac ? '⌥ Space' : 'Alt Space',
  })

  text.append(title, shortcut)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'btn btn-secondary btn-sm'
  button.textContent = i18n.t('search')

  inner.append(text, button)
  dom.append(inner)

  // mousedown so we act before the editor loses focus / selection
  const open = (event: Event) => {
    event.preventDefault()
    openPickerIfInCite(view)
  }
  inner.addEventListener('mousedown', open)
  inner.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      open(event)
    }
  })

  return { dom }
}

type HintState = { tooltip: Tooltip; from: number; to: number } | null

function citeBraceRange(state: EditorState) {
  const pos = state.selection.main.head
  const node = getBibkeyArgumentNode(state, pos)
  if (!node) return null
  const openChar = state.doc.sliceString(node.from, node.from + 1)
  const closeChar = state.doc.sliceString(node.to - 1, node.to)
  if (openChar !== '{' || closeChar !== '}') return null
  const from = node.from + 1
  const to = node.to - 1
  if (pos < from || pos > to) return null
  return { from, to, pos }
}

function computeHint(state: EditorState, previous: HintState): HintState {
  const range = citeBraceRange(state)
  if (!range) return null
  // Anchor the hint to the opening brace of \cite{…} (range.from) instead of the
  // caret, so it stays put while the user types keys inside the braces.
  // reuse the tooltip while inside the same cite argument to avoid flicker
  if (previous && previous.from === range.from && previous.to === range.to) {
    return { ...previous, tooltip: { ...previous.tooltip, pos: range.from } }
  }
  return {
    from: range.from,
    to: range.to,
    tooltip: {
      pos: range.from,
      above: false,
      create: view => createHintTooltipView(view),
    },
  }
}

const referenceSearchHintField = StateField.define<HintState>({
  create(state) {
    return computeHint(state, null)
  },
  update(value, tr) {
    if (value) {
      value = {
        ...value,
        from: tr.changes.mapPos(value.from),
        to: tr.changes.mapPos(value.to),
      }
    }
    if (tr.docChanged || tr.selection) {
      return computeHint(tr.state, value)
    }
    return value
  },
  provide(field) {
    return showTooltip.from(field, value => (value ? value.tooltip : null))
  },
})

export const extension = () => referenceSearchHintField
