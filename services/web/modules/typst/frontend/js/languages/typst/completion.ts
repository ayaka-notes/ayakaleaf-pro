/**
 * Typst completion source (P4, F4.1 + F4.2) — the thin CodeMirror glue.
 *
 * All behavior (trigger matching, label extraction, option building, the
 * `Folder`-tree walk) lives in the *pure* `reference-completion.ts` next
 * door, which the F4.3 mocha unit (`test/frontend/languages/
 * typst-completion.test.ts`) exercises with synthetic metadata + a stub
 * view. This file only reads the live state and delegates.
 *
 * Registered in `index.ts` as a standalone `EditorState.languageData.of`
 * provider (the installed `codemirror-lang-typst` wasm grammar uses a plain
 * `Language`, so the `languageDataProp` attach point is inert — see the
 * F4.3 blocker-3 note in TYPST_PHASES.md).
 *
 * Feature parity (owner decision 2026-09-08 — reuse this repo's
 * infrastructure, port the texlyre handler's *behavior*, not its file
 * cache):
 *
 *   `#cite(§…`  → citation keys from `metadata.referenceKeys` (the
 *                 ReferenceIndexer's project-wide `.bib` keys).
 *   `#label(§…` → labels declared by `#label` lines in the current document.
 *   `#ref(§…`   → same label list (modern typst reference call).
 *   `@…`        → citation keys + labels combined (classic typst `@key`).
 *   `#include "…"` / `#import "…"` → `.typ` file paths from
 *                 `metadata.fileTreeData`, relative to the open doc's folder
 *                 (`docFolderFacet`, `null` at the project root).
 */
import type {
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import { metadataState } from '@/features/source-editor/extensions/language'
import type { Metadata } from '@/features/source-editor/extensions/language'
import { docFolderFacet, openDocPathFacet } from '@/features/source-editor/extensions/doc-folder'
import { buildTypstCompletion } from './reference-completion'

/**
 * The Typst completion source. Reads `state.field(metadataState)` (project-
 * wide bib keys + file tree), `state.facet(docFolderFacet)` (the open doc's
 * folder, `null` at the project root — for the relative-path display),
 * and `state.facet(openDocPathFacet)` (the open doc's slashed tree path —
 * to filter it out of `#include`/`#import` offers), then delegates to the
 * pure engine in `reference-completion.ts`.
 */
export function typstCompletionSource(
  context: CompletionContext
): CompletionResult | null {
  const { state, pos } = context
  const meta = state.field(metadataState, false) as Metadata | undefined
  const docFolder = state.facet(docFolderFacet) as string | null
  const openDocPath = state.facet(openDocPathFacet) as string | null
  const line = state.doc.lineAt(pos)
  // `before` is the line slice ending at the cursor; `pos` is the cursor's
  // document offset, so the engine's `from = pos - partialLength` is the
  // absolute document offset where the typed partial begins.
  return buildTypstCompletion(
    state.sliceDoc(line.from, pos),
    pos,
    meta,
    docFolder,
    state.doc.toString(),
    openDocPath
  )
}

export default typstCompletionSource
