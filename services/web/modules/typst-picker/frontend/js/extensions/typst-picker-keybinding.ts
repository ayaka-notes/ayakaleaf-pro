import { keymap } from '@codemirror/view'
import { Prec, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'

/**
 * Typst reference picker keybinding.
 * Detects @key citation patterns and opens the reference picker.
 * Independent from the LaTeX reference picker to avoid conflicts.
 */
export function openTypstPickerIfInCite(view: EditorView): boolean {
  try {
    const mainSel = view.state.selection.main
    const pos = mainSel.head
    const line = view.state.doc.lineAt(pos)
    const lineText = view.state.sliceDoc(line.from, line.to)

    // Find @key patterns in the line (key = word chars, hyphens, colons, dots)
    const atRefRegex = /@([a-zA-Z0-9_][a-zA-Z0-9_.\-:]*)/g
    let atMatch: RegExpExecArray | null = null
    let atMatchIndex = -1
    while ((atMatch = atRefRegex.exec(lineText)) !== null) {
      const matchStart = line.from + atMatch.index
      const matchEnd = matchStart + atMatch[0].length
      if (pos >= matchStart && pos <= matchEnd) {
        atMatchIndex = atMatch.index
        break
      }
    }

    if (atMatchIndex < 0) return false

    const matchStart = line.from + atMatchIndex
    const matchEnd = matchStart + atMatch![0].length
    const keyText = atMatch![1]

    window.dispatchEvent(
      new CustomEvent('typst:openPicker', {
        detail: {
          from: matchStart,
          to: matchEnd,
          insertFrom: matchStart,
          insertTo: matchEnd,
          selectedKeys: [keyText],
        },
      })
    )
    return true
  } catch {
    return false
  }
}

export const typstPickerKeybindingExtension: Extension =
  Prec.highest(
    keymap.of([
      { key: 'Ctrl-Space', run: openTypstPickerIfInCite },
    ])
  )
