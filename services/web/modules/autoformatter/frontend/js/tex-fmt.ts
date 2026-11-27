import init, { main } from './tex-fmt/wasm/tex_fmt'
import wasmPath from './tex-fmt/wasm/tex_fmt_bg.wasm'

// tex-fmt's defaults without line wrapping, as LaTeX Workshop runs it in
// VS Code (--nowrap): the editor wraps long lines itself, and rewrapping
// paragraphs would change most lines of a document
const config = 'wrap = false'

export async function loadTexFmt() {
  await init({ module_or_path: wasmPath })
  return (text: string): string => main(text, config).output
}
