import { keymap } from '@codemirror/view'
import { Prec, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'
import { getBibkeyArgumentNode } from '@/features/source-editor/utils/tree-operations/ancestors'

/**
 * Parse cite-argument text into non-separator tokens with their
 * start/end positions relative to the beginning of the text.
 * Separators are commas and whitespace (space, tab, newline).
 */
function parseTokens(
  text: string
): { value: string; start: number; end: number }[] {
  const tokens: { value: string; start: number; end: number }[] = []
  const re = /[^\s,%]+/g
  let m
  while ((m = re.exec(text)) !== null) {
    tokens.push({ value: m[0], start: m.index, end: m.index + m[0].length })
  }
  return tokens
}

export function openPickerIfInCite(view: EditorView): boolean {
  try {
    const mainSel = view.state.selection.main
    const pos = mainSel.head
    const node = getBibkeyArgumentNode(view.state, pos)
    if (node) {
      // Verify the node has proper matching braces — the tree parser
      // may produce incorrect boundaries during error recovery (e.g.
      // unclosed \cite{ or nested braces like {\bf ...}).
      const openChar = view.state.doc.sliceString(node.from, node.from + 1)
      const closeChar = view.state.doc.sliceString(node.to - 1, node.to)
      if (openChar !== '{' || closeChar !== '}') {
        return startCompletion(view)
      }

      const braceFrom = node.from + 1
      const braceTo = node.to - 1

      // Cursor must be inside the braces (between braceFrom and braceTo inclusive)
      if (pos < braceFrom || pos > braceTo) {
        return startCompletion(view)
      }

      // Clamp selection to brace boundaries
      const selFrom = Math.max(braceFrom, mainSel.from)
      const selTo = Math.min(braceTo, mainSel.to)
      const hasSelection = selFrom < selTo

      const fullContent = view.state.doc.sliceString(braceFrom, braceTo)
      if (hasSelection) {
        const selectedText = view.state.doc.sliceString(selFrom, selTo)
        // Parse the full cite content into tokens for partial-key expansion
        const tokens = parseTokens(fullContent)

        // Relative selection offsets within the cite content
        const relSelFrom = selFrom - braceFrom
        const relSelTo = selTo - braceFrom

        // Find tokens overlapping the selection and expand boundaries
        let expandedFrom = relSelFrom
        let expandedTo = relSelTo
        const selectedTokenValues: string[] = []

        for (const token of tokens) {
          if (token.end > relSelFrom && token.start < relSelTo) {
            expandedFrom = Math.min(expandedFrom, token.start)
            expandedTo = Math.max(expandedTo, token.end)
            selectedTokenValues.push(token.value)
          }
        }

        window.dispatchEvent(
          new CustomEvent('reference:openPicker', {
            detail: {
              braceFrom,
              braceTo,
              insertFrom: braceFrom + expandedFrom,
              insertTo: braceFrom + expandedTo,
              selectedTokens: selectedTokenValues,
            },
          })
        )
      } else {
        let insertPos = pos
        // If the insert position is inside a token, move it forward
        const relPos = pos - braceFrom
        if (relPos > 0 && !/[\s,%]/.test(fullContent[relPos - 1])) {
          for (let j = relPos; j <= fullContent.length; j++) {
            const ch = fullContent[j]
            if (j === fullContent.length || /[\s,%]/.test(ch)) {
              insertPos = braceFrom + j
              break
            }
          }
        }

        window.dispatchEvent(
          new CustomEvent('reference:openPicker', {
            detail: {
              braceFrom,
              braceTo,
              insertFrom: insertPos,
              insertTo: insertPos,
              selectedTokens: [],
            },
          })
        )
      }
      return true
    }
  } catch {
    // fall through to default completion
  }
  return startCompletion(view)
}

export const extension = (): Extension =>
  Prec.highest(
    keymap.of([
      { key: 'Ctrl-Space', run: openPickerIfInCite },
      { key: 'Alt-Space', run: startCompletion },
    ])
  )
