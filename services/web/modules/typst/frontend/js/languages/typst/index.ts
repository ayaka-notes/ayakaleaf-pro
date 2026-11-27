/* eslint-disable import/no-absolute-path */
/**
 * Typst language support for CodeMirror — native Lezer parser.
 *
 * Uses `codemirror-lang-typst@0.6.x`'s WASM-free native parser
 * (`typst_lezer()` from the `/lezer` entry). Layered with:
 *   - syntax highlighting (TypstHighlightSytle from the package)
 *   - project completions (citations / labels / refs / file paths)
 *   - document outline (shared `documentOutline` projection)
 *   - shortcuts (bold / italic / format)
 */
import { EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import type { CompletionSource } from '@codemirror/autocomplete'
import { LanguageSupport, syntaxHighlighting } from '@codemirror/language'

export async function typst(): Promise<LanguageSupport> {
  const { typst_lezer, TypstHighlightSytle } = await import(
    'codemirror-lang-typst/lezer'
  )
  const { shortcuts } = await import('./shortcuts')
  const { typstCompletionSource } = await import('./completion')
  const { documentOutline } = await import(
    '@/features/source-editor/languages/latex/document-outline'
  )
  const support = typst_lezer()
  const baseExtensions = (support.support as unknown as Extension[]).slice()
  return new LanguageSupport(support.language, [
    ...baseExtensions,
    syntaxHighlighting(TypstHighlightSytle),
    documentOutline,
    shortcuts(),
    EditorState.languageData.of(() => [
      // name: 'typst' is used by runtime language detection (e.g. the
      // typst-picker keybinding guard) via state.languageDataAt(pos)
      { name: 'typst', autocomplete: typstCompletionSource as CompletionSource },
    ]),
  ])
}

export default typst
