/**
 * Places a proposed edit in the document and applies it as a word diff, so
 * text the edit does not touch keeps its cursor positions and history.
 */
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { diffWordsWithSpace, type Change } from 'diff'

// How far, in lines, a proposal may have drifted from where it was made
const DRIFT_LINES = 10

export type ProposedEdit = {
  startLine: number
  oldText: string
  newText: string
}

export class EditMismatchError extends Error {
  constructor() {
    super('The document no longer contains the text this edit replaces, so it was not applied.')
    this.name = 'EditMismatchError'
  }
}

/**
 * Word diff of before -> after in which each run of changes, including the
 * blanks inside it, becomes one removal followed by one insertion.
 */
export function wordDiff(before: string, after: string): Change[] {
  const result: Change[] = []
  let removed = ''
  let added = ''
  const closeRun = () => {
    if (removed) result.push({ value: removed, removed: true, added: false, count: 1 })
    if (added) result.push({ value: added, added: true, removed: false, count: 1 })
    removed = ''
    added = ''
  }
  for (const part of diffWordsWithSpace(before, after)) {
    if (part.removed) {
      removed += part.value
    } else if (part.added) {
      added += part.value
    } else if ((removed || added) && part.value.trim() === '') {
      removed += part.value
      added += part.value
    } else {
      closeRun()
      result.push(part)
    }
  }
  closeRun()
  return result
}

/**
 * Offset of oldText as whole lines, nearest to startLine, or null when the
 * document no longer has it there.
 */
export function findEdit(view: EditorView, { startLine, oldText }: ProposedEdit) {
  const { doc } = view.state
  if (oldText === '') {
    return doc.line(Math.min(startLine, doc.lines)).from
  }
  const text = doc.toString()
  let best: number | null = null
  let bestDrift = DRIFT_LINES + 1
  for (let at = text.indexOf(oldText); at !== -1; at = text.indexOf(oldText, at + 1)) {
    const line = doc.lineAt(at)
    const end = at + oldText.length
    const drift = Math.abs(line.number - startLine)
    if (line.from === at && doc.lineAt(end).to === end && drift < bestDrift) {
      best = at
      bestDrift = drift
    }
  }
  return best
}

export function applyEdit(view: EditorView, edit: ProposedEdit, reverting = false) {
  const start = findEdit(view, edit)
  if (start === null) {
    throw new EditMismatchError()
  }
  const changes = []
  let position = start
  for (const part of wordDiff(edit.oldText, edit.newText)) {
    if (part.added) {
      changes.push({ from: position, insert: part.value })
    } else {
      if (part.removed) {
        changes.push({ from: position, to: position + part.value.length })
      }
      position += part.value.length
    }
  }
  view.dispatch({ changes, userEvent: reverting ? 'undo' : 'input' })
  revealRange(view, start, start + edit.newText.length)
}

export function revertEdit(view: EditorView, edit: ProposedEdit) {
  applyEdit(
    view,
    { startLine: edit.startLine, oldText: edit.newText, newText: edit.oldText },
    true
  )
}

/** Scrolls a range of the document to the middle of the editor. */
export function revealRange(view: EditorView, from: number, to: number) {
  view.dispatch({
    effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }),
  })
}
