/**
 * Typst reference completion (P4, F4.1 + F4.2) — the *pure, Node-safe*
 * reference engine.
 *
 * This file holds everything that is a function of plain data (trigger text,
 * cursor offset, the project metadata + file tree, the document text) and
 * therefore runs in plain Node: the F4.3 mocha unit tests import ONLY this
 * file (no lezer, no wasm, no React, no CodeMirror state). The thin
 * CodeMirror glue that reads the live `state.field(metadataState)` /
 * `state.facet(docFolderFacet)` lives in `completion.ts` (webpack-only,
 * loaded via `await import('./completion')` inside `typst()`) and delegates
 * here.
 *
 * Feature parity (owner decision 2026-09-08 — reuse this repo's
 * infrastructure, port the texlyre handler's *behavior*, not its file cache):
 *
 *   `#cite(§…`  → citation keys from `metadata.referenceKeys` (the
 *                 ReferenceIndexer's project-wide `.bib` keys).
 *   `#label(§…` → labels declared by `#label` lines in the current doc.
 *   `#ref(§…`   → same label list (modern typst reference call).
 *   `@…`        → citation keys + labels combined (classic typst `@key`).
 *   `#include "…"` / `#import "…"` → `.typ` file paths from
 *                 `metadata.fileTreeData`, relative to the open doc's folder
 *                 (`docFolder`, `null` at the project root).
 *
 * Label declaration forms recognized (Typst 0.11-era + modern — same
 * convention as F3.6 `document-outline.ts`):
 *
 *   1. `#label(§sec:results)`  — the ledger / fork label-declaration form
 *   2. `#label "sec:results"`  — the classic quoted form (modern typst)
 *   3. `#label("sec:results")` — function-call quoted form
 *   4. `= Introduction <sec:intro>` — heading with an explicit `<label>`
 *      marker (any `=` run; the F3.6 outline parses the same convention)
 *
 * Span convention (so accepting an option always yields valid code): the
 * completion *span* is the text being written *after* the `§` (or after
 * the `@`), *inside* the quotes for `#label "…"` and `#include "…"` — the
 * `§`, the `(`, and every quote are OUTSIDE the span. Every option's
 * `apply` is the bare token: accepting replaces the typed partial and the
 * `§`/quotes stay in place. The displayed `label` keeps the `§` — or the
 * quoted path for `#include` (the quote itself is outside the span) — as
 * the tooltip text.
 */
import type { Completion, CompletionResult } from '@codemirror/autocomplete'

/**
 * Regex for a `#label` declaration line (after `trim()`):
 * `#label(§x)`, `#label(§"x")`, `#label "x"`, `#label("x"`, …
 * group 1 = the label token (quotes/parens/§ stripped).
 */
const LABEL_DECL_RE = /^#\s*label\s*["'(]?\s*§?\s*["']?([^"'\s()]*)/

/**
 * Regex for a heading label marker (after `trim()`), any heading depth:
 * `= Title <label>` or `== Title <label>` (the `<...>` is the heading's
 * final token — a trailing ` <...>` after a space, per F3.6 convention).
 */
const HEADING_LABEL_RE = /^[=]+\s+(?:\S.*?)\s*<([^<>]*)>\s*$/

/**
 * Extract the labels declared in a Typst source text, in first-seen order
 * (deduped). This is the "reference list" of the current document — the
 * same declaration lines the F3.6 outline pane recognizes.
 *
 * Skips comment (`//`), math (`$`), and non-`#label` code lines (`#!`, …) so
 * only label *declarations* are collected.
 *
 * @returns the label names (no `#`, no quotes, no `§`, no parens).
 */
export function extractTypstLabels(source: string): string[] {
  const labels: string[] = []
  const seen = new Set<string>()

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    // comments, math, and `#!`/other code lines are not label declarations
    if (!line || line.startsWith('//') || line.startsWith('$') ||
      line.startsWith('#!')) {
      continue
    }

    let label: string | null = null
    if (line.startsWith('#')) {
      const m = line.match(LABEL_DECL_RE)
      if (m) {
        label = (m[1] ?? '').trim() || null
      }
    } else {
      const m = line.match(HEADING_LABEL_RE)
      if (m) {
        label = (m[1] ?? '').trim() || null
      }
    }

    if (label && !seen.has(label)) {
      seen.add(label)
      labels.push(label)
    }
  }

  return labels
}

/**
 * Build the `#label(§` / `#ref(§` / `@` completion options for a list of
 * labels.
 *
 * The matching field `label` is the *bare* label, so the typed partial
 * prefix-matches it at position 0 (no fuzzy penalty). `displayLabel`
 * shows the fork `§` marker in the tooltip. (Without this split the filter
 * would score the `§`-prefixed label −800: NotStart −700 + NotFull −100,
 * so a snippet with the same bare key could rank above ours.
 * See improve_typst.md item 7.)
 *
 * Mirrors the texlyre `ReferenceCompletionHandler` output shape: `type`
 * names the completion class and `info` is the detail shown on hover
 * (where the label was declared).
 *
 * @param labels   the label list (see {@link extractTypstLabels})
 * @param detail   what the `detail` string says (the trigger, e.g. `ref`)
 */
export function buildLabelCompletions(
  labels: string[],
  detail = 'ref'
): Completion[] {
  return labels.map(label => ({
    type: 'ref',
    label,
    displayLabel: `§${label}`,
    detail,
    info: `Label: #label(§${label})`,
    apply: label,
  }))
}

/**
 * Build the `#cite(§…` completion options from the project-wide bib key
 * set (`metadata.referenceKeys`).
 *
 * Same `label` / `displayLabel` convention as {@link buildLabelCompletions}
 * (so the typed partial prefix-matches at position 0 and the tooltip still
 * shows the fork `§` marker). `apply` is a *function* (not a string) so it
 * can auto-close the call: when the user has typed `#cite(§kxxt` (the span
 * is just `kxxt`, the `)` is *outside* the span and the char *after* the
 * cursor is `)`), the inserted text is `kxxt2019` with no extra `)`, so
 * the doc ends up as `#cite(§kxxt2019)`. When the cursor's next char is
 * anything else the insertion is `key + ")"` (the user hasn't closed the
 * call — the engine closes it for them). (improve_typst.md item 18:
 * parity with the LaTeX `extendRequiredParameter` in `apply.ts`; this fork
 * of `@codemirror/autocomplete` has no `extend` field, so the `apply`-as-
 * function is the standard CM mechanism.)
 *
 * `autoClose = false` (used by the `@` trigger, where `@key` has no parens)
 * falls back to a plain string `apply`.
 *
 * @param referenceKeys the project-wide citation keys
 * @param autoClose     insert a `)` unless the cursor's next char is `)`
 */
export function buildCitationCompletions(
  referenceKeys: ReadonlySet<string>,
  autoClose = true
): Completion[] {
  return [...referenceKeys].map(key => ({
    type: 'bib',
    label: key,
    displayLabel: `§${key}`,
    detail: 'cite',
    info: `Citation: #cite(§${key})`,
    apply: autoClose
      ? (view: unknown, _completion: unknown, from: number, to: number) => {
        const v = view as {
          state: { doc: { sliceString(a: number, b: number): string } }
          dispatch(tr: { changes: { from: number; to: number; insert: string } }): void
        }
        if (!v) return
        const nextChar = v.state.doc.sliceString(to, to + 1)
        v.dispatch({
          changes: {
            from,
            to,
            // the char after the cursor is `)` — the call is already
            // closed (the user typed `#cite(§k)`), don't double-close
            insert: nextChar === ')' ? key : key + ')',
          },
        })
      }
      : key,
  }))
}

// ---------------------------------------------------------------------------
// Trigger matching (cursor-relative, over the text before the cursor)
// ---------------------------------------------------------------------------

/** Cap on how many options one offer returns (the default fuzzy filter
 *  narrows after this; more keys are reachable by typing). */
export const MAX_OPTIONS = 50

export type Trigger =
  | { kind: 'cite'; from: number }
  | { kind: 'label'; from: number }
  | { kind: 'ref'; from: number }
  | { kind: 'at'; from: number }
  | { kind: 'include' | 'import'; from: number }

/**
 * Resolve the completion trigger just before the cursor: the span the
 * completion's options replace (`from` = index of the typed partial text).
 *
 * `before` is the text on the current line up to (but not including) the
 * cursor; `pos` is the cursor offset (normally `before.length`). Returns
 * `null` when the cursor is not inside a recognized trigger. Order matters
 * (most specific first); the last regex is the loosest.
 */
export function resolveTrigger(before: string, pos: number): Trigger | null {
  // `before` is the line slice from the start of the line up to (and NOT
  // including) the cursor — the glue computes it as `state.doc.sliceDoc(
  // state.lineAt(pos).from, pos)`. `pos` is the absolute document offset of
  // the cursor. For every trigger, capture the *typed partial* in group 1
  // (nothing else, no trailing quote / paren / `§`), so the span to be
  // replaced by a completion option is exactly the partial's length and
  // the span starts at `pos - partialLength` (document offset).
  const spanFrom = (len: number) => pos - len

  // `#include "partial` / `#import "partial` — partial is what's typed
  // inside the opening quote (a closing quote ends the trigger). Group 1
  // captures the *keyword* (include|import) so the offer can show the
  // accurate chip (improve_typst.md item 11).
  const mInclude = before.match(/#(include|import)\s*["']([^"']*)$/)
  if (mInclude) {
    return {
      kind: mInclude[1] === 'include' ? 'include' : 'import',
      from: spanFrom((mInclude[2] ?? '').length),
    }
  }

  // `#cite(§partial` (fork) and `#cite(§partial` (ledger, no parens) —
  // partial is the typed key after the `§` (or nothing, right after the `§`).
  const mCite = before.match(/#cite\s*\(?\s*§?([^\s)\n]*)$/)
  if (mCite) return { kind: 'cite', from: spanFrom((mCite[1] ?? '').length) }

  // `#label(§partial` (fork, group 1 = the §-bare form), and `#label
  // "partial"` (modern quoted, group 1 = the partial *inside* the opening
  // quote — the regex stops at the first closing quote, so the char class
  // excludes `"` and `'`). Both are valid declaration forms on this image
  // (see F4.1 note in TYPST_PHASES.md).
  const mLabel = before.match(/#label\s*["'(]?\s*§?\s*([^\s)\n"']*)$/)
  if (mLabel) return { kind: 'label', from: spanFrom((mLabel[1] ?? '').length) }

  // `#ref(§partial` (modern reference call) — same §-form as `#cite`.
  const mRef = before.match(/#ref\s*\(?\s*§?([^\s)\n]*)$/)
  if (mRef) return { kind: 'ref', from: spanFrom((mRef[1] ?? '').length) }

  // Bare `@partial` (classic typst reference: `@sec:intro` or `@key`).
  // Requires a preceding boundary (line start / space / newline / `(`) so
  // prose like `hello @ world` doesn't match mid-word.
  const mAt = before.match(/(?:^|[\s(])(@[^\s]*)$/)
  if (mAt) return { kind: 'at', from: spanFrom(((mAt[1] ?? '').length) - 1) }

  return null
}

// ---------------------------------------------------------------------------
// Include / import path completion
// ---------------------------------------------------------------------------

/**
 * A (structural) folder node: the subset of the project `Folder` shape this
 * engine reads. `docs` + `folders` are optional so tests can pass minimal
 * trees.
 */
export type TypstFolder = {
  name: string
  docs?: { name: string }[]
  folders?: TypstFolder[]
}

/**
 * Collect every `.typ` file path (forward-slash, relative to the project
 * root the tree starts from) under `folder`, skipping `_`-prefixed folders
 * *and* `_`-prefixed files.
 */
export function collectTypPaths(
  folder: TypstFolder,
  prefix = ''
): string[] {
  const paths: string[] = []
  for (const doc of folder.docs ?? []) {
    if (doc.name.endsWith('.typ') && !doc.name.startsWith('_')) {
      paths.push(prefix ? `${prefix}/${doc.name}` : doc.name)
    }
  }
  for (const child of folder.folders ?? []) {
    if (child.name.startsWith('_')) continue
    for (const p of collectTypPaths(child, prefix ? `${prefix}/${child.name}` : child.name)) {
      paths.push(p)
    }
  }
  return paths
}

/**
 * Build the relative path of `target` (a project-root-relative tree path)
 * against the open doc's **folder** (`docFolder`, slash-encoded — the value
 * of the `docFolderFacet`, `null` at the project root), mirroring texlyre
 * `FilePathCompletionHandler.getRelativePath` (folder parts split on `/`;
 * every doc-folder segment counts as a directory):
 *
 *   - `null` docFolder            → `target` unchanged
 *   - file in the open doc folder → bare name (`sibling.typ`)
 *   - file in a parent folder     → `../<file>.typ`
 *   - nested below                → plain relative path
 */
export function relativeToDocFolder(
  docFolder: string | null,
  target: string,
): string {
  if (!docFolder) return target
  const fromParts = docFolder.split('/').filter(Boolean)
  const toParts = target.split('/').filter(Boolean)
  let common = 0
  while (
    common < fromParts.length &&
    common < toParts.length &&
    toParts[common] === fromParts[common]
  ) {
    common += 1
  }
  const upLevels = fromParts.length - common
  const rel = [...Array(upLevels).fill('..'), ...toParts.slice(common)].join(
    '/'
  )
  return rel || (toParts[toParts.length - 1] ?? target)
}

/**
 * The minimal metadata the pure engine reads (the same shape as the module's
 * `Metadata`, narrowed to the fields `#cite`/`#include` consume).
 */
export type TypstCompletionMeta = {
  referenceKeys?: ReadonlySet<string>
  fileTreeData?: TypstFolder | null
}

/**
 * Build the completion offer for the trigger before `pos`, given the project
 * metadata `meta`, the open doc's folder id `docFolder` (`null` at the
 * project root), the full document `docText`, and the open doc's **tree
 * path** `openDocPath` (used by `#include`/`#import` to exclude the open
 * doc from its own offer — improve_typst.md item 8).
 *
 * @returns a `CompletionResult` (`{from,to,options}`) or `null` when no
 *          trigger is present, or the trigger is present but has nothing to
 *          offer (empty key set / no `.typ` files).
 */
export function buildTypstCompletion(
  before: string,
  pos: number,
  meta: TypstCompletionMeta | undefined,
  docFolder: string | null,
  docText = before,
  openDocPath: string | null = null
): CompletionResult | null {
  const trigger = resolveTrigger(before, pos)
  if (!trigger) return null

  switch (trigger.kind) {
    case 'include':
    case 'import':
      return includeOffer(trigger, meta, docFolder, pos, openDocPath)

    case 'cite': {
      const opts = buildCitationCompletions(
        meta?.referenceKeys ?? new Set<string>()
      ).slice(0, MAX_OPTIONS)
      return opts.length ? { from: trigger.from, to: pos, options: opts } : null
    }

    case 'label':
    case 'ref': {
      const labels = extractTypstLabels(docText)
      const opts = buildLabelCompletions(
        labels,
        trigger.kind === 'label' ? 'label' : 'ref'
      ).slice(0, MAX_OPTIONS)
      return opts.length ? { from: trigger.from, to: pos, options: opts } : null
    }

    case 'at': {
      const opts = [
        // `@key` has no parens — a string apply, no `)` auto-close (item 18
        // only applies to the `#cite` call form)
        ...buildCitationCompletions(
          meta?.referenceKeys ?? new Set<string>(),
          false
        ),
        ...buildLabelCompletions(extractTypstLabels(docText), 'label'),
      ].slice(0, MAX_OPTIONS)
      return opts.length ? { from: trigger.from, to: pos, options: opts } : null
    }
  }

  return null
}

/**
 * `#include`/`#import "…` offer: `.typ` paths from `metadata.fileTreeData`,
 * made relative to the open doc's folder (`docFolder`) so
 * `#include "introduction.typ"` is suggested for a doc that includes its
 * sibling `introduction.typ` (texlyre parity, see {@link relativeToDocFolder}).
 *
 * The open doc itself (`openDocPath`) is filtered out (improve_typst.md
 * item 8): a doc can't `#include`/`#import` itself — the compile would
 * error on the cycle, and listing it is dead weight (often near the top
 * of the fuzzy-sorted list, because the relative path is short and matches
 * the partial best). `openDocPath` is the tree path; `docFolder` is the
 * open doc's folder. Both come from the same glue dispatch, so the offer
 * only needs to filter the single tree-path string.
 *
 * `detail` is the actual trigger kind (`'include'` or `'import'`) so the
 * chip the user sees matches the keyword they typed (improve_typst.md
 * item 11).
 */
function includeOffer(
  trigger: { kind: 'include' | 'import'; from: number },
  meta: TypstCompletionMeta | undefined,
  docFolder: string | null,
  pos: number,
  openDocPath: string | null
): CompletionResult | null {
  const paths = meta?.fileTreeData ? collectTypPaths(meta.fileTreeData) : []
  const options: Completion[] = paths
    .filter(p => p !== openDocPath) // item 8: exclude the open doc itself
    .map(p => relativeToDocFolder(docFolder, p))
    .filter(p => !!p)
    .slice(0, MAX_OPTIONS)
    .map(p => ({
      type: 'file' as const,
      label: p,
      detail: trigger.kind,
      apply: p,
    }))

  if (!options.length) return null
  return { from: trigger.from, to: pos, options }
}

export default extractTypstLabels
