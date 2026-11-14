import { EditorSelection, EditorState, SelectionRange } from '@codemirror/state'
import { Command, EditorView } from '@codemirror/view'
import {
  closeSearchPanel,
  openSearchPanel,
  searchPanelOpen,
} from '@codemirror/search'
import { sendMB } from '@/infrastructure/event-tracking'
import { toggleRanges, wrapRanges } from '../../commands/ranges'
import {
  ancestorListType,
  toggleListForRanges,
  unwrapBulletList,
  unwrapDescriptionList,
  unwrapNumberedList,
  wrapInBulletList,
  wrapInDescriptionList,
  wrapInNumberedList,
} from './lists'
import { snippet, startCompletion } from '@codemirror/autocomplete'
import { snippets } from './snippets'
import { minimumListDepthForSelection } from '../../utils/tree-operations/ancestors'
import { isVisual } from '../visual/visual'
import { sendSearchEvent } from '@/features/event-tracking/search-events'

export const toggleBold = toggleRanges('\\textbf')
export const toggleItalic = toggleRanges('\\textit')

// Typst bold/italic use `*…*` / `_…_` wrapping (the lezer grammar marks
// these as Strong/Emph spans). Used by the typst toolbar group.
export const typstToggleBold = wrapRanges('*', '*')
export const typstToggleItalic = wrapRanges('_', '_')

// --- Typst toolbar commands (ported from texlyre reference) ---

export const typstInsertHeading: Command = view => {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const line = state.doc.lineAt(from)
  const text = state.sliceDoc(line.from, to)
  const heading = `= ${text || 'Heading'}`
  dispatch({
    changes: { from: line.from, to, insert: heading },
    selection: { anchor: line.from + heading.length },
  })
  return true
}

export const typstInsertInlineMath: Command = view => {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  const insert = text ? `$${text}$` : '$ '
  dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  return true
}

export const typstInsertCodeBlock: Command = view => {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  const insert = text ? `\n\u0060\u0060\u0060\n${text}\n\u0060\u0060\u0060\n` : '\n\u0060\u0060\u0060\n\n\u0060\u0060\u0060\n'
  dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  return true
}

export const typstInsertLink: Command = view => {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  const insert = text ? `#link("")[${text}]` : '#link("")[]'
  dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  return true
}

export const typstInsertFigure: Command = view => {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const insert = '#figure(\n  image("", width: 80%),\n  caption: []\n)'
  dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  return true
}

export const typstInsertTable: Command = view => {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const insert =
    '#figure(\n  table(\n    columns: (1fr, 1fr),\n    table.header([Column 1], [Column 2]),\n    [A], [B],\n  ),\n  caption: []\n)'
  dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  return true
}

export const typstInsertQuote: Command = view => {
  const { state, dispatch } = view
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  const insert = text ? `#quote[\n${text}\n]` : '#quote[\n\n]'
  dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  return true
}

/**
 * Typst reference picker: inserts `@` at the cursor to start a reference.
 * The user then types to get completions from available labels/citation keys.
 * If the cursor is already inside an `@ref`, it selects the reference
 * so the user can replace it.
 */
export const typstInsertRef: Command = view => {
  const { state, dispatch } = view
  const pos = state.selection.main.anchor
  const line = state.doc.lineAt(pos)
  const before = state.sliceDoc(line.from, pos)
  const after = state.sliceDoc(pos, line.to)
  
  // Check if cursor is already on an @ref
  const beforeMatch = before.match(/(@\w[\w:-]*)$/)
  const afterMatch = after.match(/^@(\w[\w:-]*)/)

  if (beforeMatch) {
    // Cursor is after part of an @ref — select the whole reference and trigger completion
    const refStart = pos - beforeMatch[1].length
    dispatch({
      selection: { anchor: refStart + 1, head: pos },
      userEvent: 'inputType',
    })
    requestAnimationFrame(() => {
      if (!view.destroyed) startCompletion(view)
    })
    return true
  }

  if (afterMatch) {
    // Cursor is directly before an @ref — select the reference (without the @) and trigger completion
    dispatch({
      selection: { anchor: pos + 1, head: pos + 1 + afterMatch[1].length },
      userEvent: 'inputType',
    })
    requestAnimationFrame(() => {
      if (!view.destroyed) startCompletion(view)
    })
    return true
  }

  if (before.endsWith('@')) {
    // Cursor is right after a bare @ (just typed) — just trigger completion
    requestAnimationFrame(() => {
      if (!view.destroyed) startCompletion(view)
    })
    return true
  }

  // Not on a reference — insert @ and trigger completion
  dispatch({
    changes: { from: pos, to: pos, insert: '@' },
    selection: { anchor: pos + 1 },
    userEvent: 'inputType',
  })
  // Trigger completion explicitly
  requestAnimationFrame(() => {
    if (!view.destroyed) startCompletion(view)
  })
  return true
}

// TODO: apply as a snippet?
// TODO: read URL from clipboard?
export const wrapInHref = wrapRanges('\\href{}{', '}', false, (range, view) =>
  isVisual(view) ? range : EditorSelection.cursor(range.from - 2)
)
export const toggleBulletList = toggleListForRanges('itemize')
export const toggleNumberedList = toggleListForRanges('enumerate')
export const wrapInInlineMath = wrapRanges('\\(', '\\)')
export const wrapInDisplayMath = wrapRanges('\n\\[', '\\]\n')

export const ensureEmptyLine = (
  state: EditorState,
  range: SelectionRange,
  direction: 'above' | 'below' = 'below'
) => {
  let pos = range.anchor
  let suffix = ''
  let prefix = ''

  const line = state.doc.lineAt(pos)

  if (line.text.trim().length) {
    if (direction === 'below') {
      pos = Math.min(line.to + 1, state.doc.length)
    } else {
      pos = Math.max(line.from - 1, 0)
    }
    const neighbouringLine = state.doc.lineAt(pos)

    if (neighbouringLine.length && direction === 'below') {
      suffix = '\n'
    } else if (neighbouringLine.length && direction === 'above') {
      prefix = '\n'
    }
  }
  return { pos, suffix, prefix }
}

export const insertFigure: Command = view => {
  const { state, dispatch } = view
  const { pos, suffix } = ensureEmptyLine(state, state.selection.main)
  const template = `\n${snippets.figure}\n${suffix}`
  snippet(template)({ state, dispatch }, { label: 'Figure' }, pos, pos)
  return true
}

export const insertTable = (view: EditorView, sizeX: number, sizeY: number) => {
  const { state, dispatch } = view
  const visual = isVisual(view)
  const placeholder = visual ? '' : '#{}'
  const placeholderAtStart = visual ? '#{}' : ''
  const { pos, suffix } = ensureEmptyLine(state, state.selection.main)
  const template = `${placeholderAtStart}\n\\begin{table}
\t\\centering
\t\\begin{tabular}{${'c'.repeat(sizeX)}}
${(
  '\t\t' +
  `${placeholder} & ${placeholder}`.repeat(sizeX - 1) +
  '\\\\\n'
).repeat(sizeY)}\t\\end{tabular}
\t\\caption{Caption}
\t\\label{tab:placeholder}
\\end{table}${suffix}`
  snippet(template)({ state, dispatch }, { label: 'Table' }, pos, pos)
  return true
}

export const insertCite: Command = view => {
  const { state, dispatch } = view
  const pos = state.selection.main.anchor
  const template = snippets.cite
  snippet(template)({ state, dispatch }, { label: 'Cite' }, pos, pos)
  return true
}

export const insertRef: Command = view => {
  const { state, dispatch } = view
  const pos = state.selection.main.anchor
  const template = snippets.ref
  snippet(template)({ state, dispatch }, { label: 'Ref' }, pos, pos)
  return true
}

export const indentDecrease: Command = view => {
  if (minimumListDepthForSelection(view.state) < 2) {
    return false
  }
  switch (ancestorListType(view.state)) {
    case 'itemize':
      return unwrapBulletList(view)
    case 'enumerate':
      return unwrapNumberedList(view)
    case 'description':
      return unwrapDescriptionList(view)
    default:
      return false
  }
}

export const cursorIsAtStartOfListItem = (state: EditorState) => {
  return state.selection.ranges.every(range => {
    const line = state.doc.lineAt(range.from)
    const prefix = state.sliceDoc(line.from, range.from)
    return /\\item\s*$/.test(prefix)
  })
}

export const indentIncrease: Command = view => {
  if (minimumListDepthForSelection(view.state) < 1) {
    return false
  }
  switch (ancestorListType(view.state)) {
    case 'itemize':
      return wrapInBulletList(view)
    case 'enumerate':
      return wrapInNumberedList(view)
    case 'description':
      return wrapInDescriptionList(view)
    default:
      return false
  }
}

export const toggleSearch: Command = view => {
  if (searchPanelOpen(view.state)) {
    closeSearchPanel(view)
  } else {
    sendSearchEvent('search-open', {
      searchType: 'document',
      method: 'button',
      location: 'toolbar',
      mode: isVisual(view) ? 'visual' : 'source',
    })
    openSearchPanel(view)
  }
  return true
}

export const addComment = (location: string) => {
  sendMB('add-comment', {
    location,
  })
  window.dispatchEvent(new Event('add-new-review-comment'))
}

export const deleteSelection: Command = view => {
  if (view.state.selection.ranges.every(range => range.empty)) return false

  const transaction = view.state.changeByRange(range => {
    if (range.empty) {
      return { changes: [], range }
    }

    return {
      changes: { from: range.from, to: range.to, insert: '' },
      range: EditorSelection.cursor(range.from),
    }
  })

  view.dispatch(transaction)
  return true
}
