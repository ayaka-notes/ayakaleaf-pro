// @ts-check
// Typst module (services/web/modules/typst).
//
// Backend: POST /project/new/typst — create a Typst project (compiler
// "typst") from a bundled dependency-free template. Compiles route to
// services/clsi-typst (selected by the project's `compiler` field in
// ClsiManager / CompileManager).
//
// Frontend assets (pulled in via Settings.overleafModuleImports):
//   - typstNewProjectMenu          → New-Project dropdown entry
//   - typstNewProjectModalWrapper  → the modal (basic / article / example)
//   - the Typst editor language    → registered via the source-editor language
//                                    pipeline (frontend/js/languages/typst)

import TypstRouter from './app/src/TypstRouter.mjs'

export default {
  router: TypstRouter,
}
