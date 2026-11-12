import { ViewPlugin } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

/**
 * A custom extension that listens for an `editor:insert-symbol` event and inserts the given content into the document.
 * For Typst documents, inserts the Unicode character; for LaTeX, inserts the command.
 */
export const symbolPalette = () => {
  return ViewPlugin.define(view => {
    const listener = (event: Event) => {
      const symbol = (event as CustomEvent<{ command: string; codepoint?: string }>).detail

      view.focus()

      // Determine what to insert based on the document type.
      // Typst uses Unicode characters directly; LaTeX uses \commands.
      let insertText: string = symbol.command
      if (symbol.codepoint) {
        try {
          const langData = view.state.languageDataAt(view.state.selection.main.head)
          const lang = langData?.find((d: any) => d.name === 'typst')
          if (lang) {
            const cp = parseInt(symbol.codepoint.replace('U+', ''), 16)
            if (!isNaN(cp) && cp > 0) {
              insertText = String.fromCodePoint(cp)
            }
          }
        } catch {
          // fall through to command
        }
      }

      const spec = view.state.changeByRange(range => {
        const changeSet = view.state.changes([
          {
            from: range.from,
            to: range.to,
            insert: insertText,
          },
        ])

        return {
          range: EditorSelection.cursor(changeSet.mapPos(range.to, 1)),
          changes: changeSet,
        }
      })

      view.dispatch(spec, {
        scrollIntoView: true,
      })
    }

    window.addEventListener('editor:insert-symbol', listener)

    return {
      destroy() {
        window.removeEventListener('editor:insert-symbol', listener)
      },
    }
  })
}
