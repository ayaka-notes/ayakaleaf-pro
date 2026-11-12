/**
 * Typst syntax-error highlighter (F2.7).
 *
 * Salvaged from the old typst fork (Levi Zim, kxxt). Walks the lezer tree
 * and marks `Error` nodes, so the lezer parser's own error spans become
 * CodeMirror diagnostics (red squiggle + "Syntax error" diagnostic).
 *
 * Dep: this repo's `createLinter` (extensions/linting.ts) — same shape as
 * the fork used; it wires the diagnostics into the shared diagnostic
 * gutter so they land in the output panel next to compile errors.
 */
import { syntaxTree } from '@codemirror/language'
import { Diagnostic, LintSource } from '@codemirror/lint'
import { createLinter } from '@/features/source-editor/extensions/linting'

export const typstLinter = () => createLinter(typstLintSource, { delay: 100 })

export const typstLintSource: LintSource = view => {
  const tree = syntaxTree(view.state)
  const diagnostics: Diagnostic[] = []

  tree.iterate({
    enter(node) {
      if (node.type.name === 'Error') {
        const { from, to } = node
        diagnostics.push({
          from,
          to,
          severity: 'error',
          message: 'Syntax error',
        })
      }
    },
  })

  return diagnostics
}
