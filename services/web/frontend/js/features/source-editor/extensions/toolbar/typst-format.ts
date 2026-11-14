/**
 * In-browser Typst "Format document".
 *
 * Lazy-loads the typstyle wasm formatter (`@typstyle/typstyle-wasm-bundler`,
 * wasm-pack `bundler` target) on first use and rewrites the whole document.
 * webpack loads the wasm as an async WebAssembly module (see the webpack
 * rules alongside `typst_syntax_bg.wasm` for the lezer grammar).
 *
 * Core (not module-local, like the other toolbar helpers) because both the
 * typst module's shortcuts.ts (Ctrl/Cmd-Shift-F) and the toolbar button
 * import it.
 */
import { EditorView } from '@codemirror/view'

let formatModule: {
  format: (input: string, config: object) => string
} | null = null
let loading: Promise<NonNullable<typeof formatModule>> | null = null

async function loadTypstyle(): Promise<NonNullable<typeof formatModule>> {
  if (formatModule) return formatModule
  if (!loading) {
    loading = import('@typstyle/typstyle-wasm-bundler').then(mod => {
      return mod as unknown as NonNullable<typeof formatModule>
    })
  }
  return loading
}

export function typstFormatDocument(view: EditorView) {
  const doc = view.state.doc.toString()
  loadTypstyle()
    .then(mod => {
      if (!mod || typeof mod.format !== 'function') return
      const formatted = mod.format(doc, {})
      if (formatted !== doc) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: formatted },
        })
      }
    })
    .catch(err => {
      // The formatter is a best-effort enhancement; keep the failure visible
      // in logs without surfacing it to the toolbar.
      // eslint-disable-next-line no-console
      console.error('[typst-format] Formatting failed:', err)
    })
}
