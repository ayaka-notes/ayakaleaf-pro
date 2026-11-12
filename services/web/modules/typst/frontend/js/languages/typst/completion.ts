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
  const before = state.sliceDoc(line.from, pos)
  const after = state.sliceDoc(pos, line.to)
  
  // First try with the text before the cursor (normal typing case).
  let result = buildTypstCompletion(
    before,
    pos,
    meta,
    docFolder,
    state.doc.toString(),
    openDocPath
  )
  if (result) return result
  
  // "Edit-existing" case: cursor is positioned at or before an existing
  // reference (e.g. `@fig:frog`, `#label(§x)`, `#ref(§x)`). The text AFTER
  // the cursor starts with a known trigger pattern. We synthesise a `before`
  // that includes the trigger so the regex matches, and adjust `pos` so the
  // completion span covers the existing reference.
  const afterTrigger = after.match(/^(@(\w[\w:-]*))|^#label\s*["'(]?\s*§?\s*([^\s)\n"']*)|^#ref\s*\(?\s*§?\s*([^\s)\n]*)|^#cite\s*\(?\s*§?\s*([^\s)\n]*)/)
  if (afterTrigger) {
    // Determine the full trigger text and the partial
    let triggerText = ''
    let partial = ''
    if (afterTrigger[1]) {
      // @ref
      triggerText = afterTrigger[1]
      partial = afterTrigger[2] || ''
    } else if (afterTrigger[3] !== undefined) {
      // #label
      triggerText = after.slice(0, after.indexOf(afterTrigger[3]) + afterTrigger[3].length)
      partial = afterTrigger[3]
    } else if (afterTrigger[4] !== undefined) {
      // #ref
      triggerText = after.slice(0, after.indexOf(afterTrigger[4]) + afterTrigger[4].length)
      partial = afterTrigger[4]
    } else if (afterTrigger[5] !== undefined) {
      // #cite
      triggerText = after.slice(0, after.indexOf(afterTrigger[5]) + afterTrigger[5].length)
      partial = afterTrigger[5]
    }
    
    if (triggerText && partial) {
      // Synthesise: pretend the cursor is at the end of the existing reference
      const syntheticBefore = before + triggerText
      const syntheticPos = pos + triggerText.length
      result = buildTypstCompletion(
        syntheticBefore,
        syntheticPos,
        meta,
        docFolder,
        state.doc.toString(),
        openDocPath
      )
      if (result) {
        // Adjust the span so it covers the existing reference
        if (result.from !== undefined && result.to !== undefined) {
          result.from = pos
          result.to = pos + triggerText.length
        }
        return result
      }
    }
  }
  
  return null
}

export default typstCompletionSource
