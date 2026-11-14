/**
 * Typst document outline — F3.6 (salvage source: the old typst fork's core
 * `tree-operations/outline.ts` Typst heading handling + texlyre
 * `typstOutlineParser`; heading syntax is the standardized `=`-run form that
 * the fork, the `mainbasic.typ` template, and the lezer grammar's own
 * `Heading`/`HeadingMarker` nodes all use).
 *
 * There are two pieces, and this file documents the relationship between them:
 *
 *   1. *Runtime* (what actually populates the source-editor outline pane):
 *      the lezer tree walk in core `tree-operations/outline.ts:enterNode`
 *      (which handles the `Heading` + `HeadingMarker` nodes the
 *      `codemirror-lang-typst` wasm grammar emits), registered into the
 *      `typst()` `Language` in this module's `index.ts` as the shared core
 *      `documentOutline` projection state field. That path is exercised by
 *      the browser / the webpack prod build (the lezer wasm grammar cannot be
 *      loaded in Node), and its extraction helper is
 *      `makeTypstHeadingOutlineItem` (positions-based, same 1-based `=`-run
 *      level convention as here).
 *
 *   2. *Reference spec* (this file): a pure `=`-run heading parser over
 *      document *text* — Node-safe (no wasm, no lezer tree) and therefore
 *      unit-testable in mocha. It encodes the same heading rules the runtime
 *      lezer walk must produce (level = number of leading `=`, title = the
 *      remainder, 1-based levels, `#`-code lines and comments skipped). It is
 *      exported so the module's outline behaviour has a stable, testable spec
 *      independent of the wasm grammar (the browser e2e gate verifies the
 *      runtime walk end-to-end, e.g. outline click→jump on `= title`).
 */

export interface TypstOutlineItem {
  /** 1-based line number (matches the outline pane expectation). */
  line: number
  /** The heading title (text after the `=` run, with any trailing
   *  `<label>` and surrounding whitespace trimmed). */
  title: string
  /** 1-based heading level: `=` → 1, `==` → 2, … (shallow → deep), matching
   *  the runtime lezer walk and `nestOutline`'s relative-depth expectation. */
  level: number
}

export function parseTypstOutline(code: string): TypstOutlineItem[] {
  const items: TypstOutlineItem[] = []
  const lines = code.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] ?? '').trim()
    if (raw.length === 0) {
      continue
    }

    // A line that starts with `#` is Typst code (or `#!` system) and can never
    // be a `=`-run heading; `//`-lines are comments per the module's
    // `commentTokens`. Skip both.
    if (raw.startsWith('#') || raw.startsWith('//')) {
      continue
    }

    // Heading: a leading run of one or more `=`, optionally followed by
    // whitespace + title. (Typst requires the space before the title; `=foo`
    // is not a heading and so does not match.)
    const match = raw.match(/^(=+)(?:\s+(.*))?$/)
    if (!match) {
      continue
    }

    let title = (match[2] ?? '').trim()
    // Strip a trailing inline label, e.g. `= Results<sec:results>` (texlyre
    // style); the pane shows only the title.
    title = title.replace(/<[^>]+>\s*$/, '').trim()

    // Mirror the runtime lezer extraction: an `=`-run with no title produces
    // no outline item (Typst requires a title, so the grammar won't emit a
    // title-less heading anyway — we simply don't invent one).
    if (title.length === 0) {
      continue
    }

    items.push({
      line: i + 1,
      title,
      level: match[1].length,
    })
  }

  return items
}

export default parseTypstOutline
