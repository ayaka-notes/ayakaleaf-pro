/**
 * Typst editor shortcuts (F2.8).
 *
 * Salvaged from the old typst fork (Levi Zim, kxxt): bold/italic use
 * Typst-style `*…*` / `*…*` wrapping (the lezer grammar marks these as
 * Strong/Emph spans) and `Ctrl/Cmd-Shift-F` runs the in-browser typstyle
 * formatter (F3.7, `typst-format.ts`).
 */
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { wrapRanges } from '@/features/source-editor/commands/ranges'
import { typstFormatDocument } from '@/features/source-editor/extensions/toolbar/typst-format'

export const shortcuts = () => {
  return Prec.high(
    keymap.of([
      {
        key: 'Ctrl-b',
        mac: 'Mod-b',
        preventDefault: true,
        run: wrapRanges('*', '*'),
      },
      {
        key: 'Ctrl-i',
        mac: 'Mod-i',
        preventDefault: true,
        run: wrapRanges('_', '_'),
      },
      {
        key: 'Ctrl-Shift-f',
        mac: 'Mod-Shift-f',
        preventDefault: true,
        run: (view) => {
          typstFormatDocument(view)
          return true
        },
      },
    ])
  )
}
