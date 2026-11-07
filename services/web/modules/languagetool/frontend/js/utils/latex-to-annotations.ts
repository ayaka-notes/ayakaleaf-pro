/**
 * Converts LaTeX source to a LanguageTool annotation array.
 *
 * The invariant is:
 *   annotations.map(a => a.text ?? a.markup).join('') === source
 *
 * This means that the character offsets returned by LanguageTool (which count
 * both text and markup characters) map directly to positions in the original
 * CodeMirror document — no offset remapping is needed.
 *
 * LaTeX commands, math environments, and comments are emitted as `markup`.
 * Regular text content is emitted as `text` and will be grammar-checked.
 */

export interface LTAnnotation {
  text?: string
  markup?: string
}

/** Math environments whose entire content should be treated as markup. */
const MATH_ENVS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'alignat',
  'alignat*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'displaymath',
  'eqnarray',
  'eqnarray*',
  'flalign',
  'flalign*',
  'subequations',
  'math',
  'dmath',
  'dgroup',
  'dgroup*',
])

export function latexToAnnotations(source: string): LTAnnotation[] {
  const annotations: LTAnnotation[] = []
  let textStart = 0 // start of the current un-emitted text segment
  let i = 0

  /** Emit accumulated plain text up to `end`. */
  function flushText(end: number): void {
    if (end > textStart) {
      annotations.push({ text: source.slice(textStart, end) })
    }
  }

  /**
   * Emit `source[start..end)` as markup, flushing any buffered text first.
   * Also advances `textStart` to `end`.
   */
  function addMarkup(start: number, end: number): void {
    flushText(start)
    if (end > start) {
      annotations.push({ markup: source.slice(start, end) })
    }
    textStart = end
  }

  while (i < source.length) {
    const ch = source[i]

    // ── LaTeX comments: % … (end of line) ──────────────────────────────────
    if (ch === '%') {
      let end = i + 1
      while (end < source.length && source[end] !== '\n') end++
      addMarkup(i, end)
      i = end
      continue
    }

    // ── Display math: $$…$$ ────────────────────────────────────────────────
    if (ch === '$' && i + 1 < source.length && source[i + 1] === '$') {
      const start = i
      let j = i + 2
      while (j + 1 < source.length) {
        if (source[j] === '$' && source[j + 1] === '$') {
          j += 2
          break
        }
        j++
      }
      addMarkup(start, j)
      i = j
      continue
    }

    // ── Inline math: $…$ ───────────────────────────────────────────────────
    if (ch === '$') {
      const start = i
      let j = i + 1
      while (j < source.length && source[j] !== '$') {
        if (source[j] === '\\') j++ // skip one escaped character
        j++
      }
      const end = j < source.length ? j + 1 : j
      addMarkup(start, end)
      i = end
      continue
    }

    // ── LaTeX commands ─────────────────────────────────────────────────────
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1]

      // \[…\]  (display math)
      if (next === '[') {
        const start = i
        let j = i + 2
        while (j + 1 < source.length) {
          if (source[j] === '\\' && source[j + 1] === ']') {
            j += 2
            break
          }
          j++
        }
        addMarkup(start, j)
        i = j
        continue
      }

      // \(…\)  (inline math)
      if (next === '(') {
        const start = i
        let j = i + 2
        while (j + 1 < source.length) {
          if (source[j] === '\\' && source[j + 1] === ')') {
            j += 2
            break
          }
          j++
        }
        addMarkup(start, j)
        i = j
        continue
      }

      // \begin{envname}
      if (source.startsWith('begin{', i + 1)) {
        const closeBrace = source.indexOf('}', i + 7)
        if (closeBrace !== -1) {
          const envName = source.slice(i + 7, closeBrace)

          if (MATH_ENVS.has(envName)) {
            // Entire math environment is markup
            const endTag = `\\end{${envName}}`
            const endIdx = source.indexOf(endTag, closeBrace + 1)
            const envEnd =
              endIdx !== -1 ? endIdx + endTag.length : source.length
            addMarkup(i, envEnd)
            i = envEnd
            continue
          }

          // Non-math environment: only mark up the \begin{...} tag itself
          addMarkup(i, closeBrace + 1)
          i = closeBrace + 1
          continue
        }
      }

      // \end{…}
      if (source.startsWith('end{', i + 1)) {
        const closeBrace = source.indexOf('}', i + 5)
        const end = closeBrace !== -1 ? closeBrace + 1 : i + 5
        addMarkup(i, end)
        i = end
        continue
      }

      // General alpha command: \commandname  (optional trailing whitespace)
      if (/[a-zA-Z]/.test(next)) {
        let j = i + 1
        while (j < source.length && /[a-zA-Z]/.test(source[j])) j++
        // Absorb trailing horizontal whitespace into the markup token
        while (j < source.length && (source[j] === ' ' || source[j] === '\t'))
          j++
        addMarkup(i, j)
        i = j
        continue
      }

      // Single non-letter command: \\, \%, \$, \{, \}, \&, \_, \#, etc.
      addMarkup(i, i + 2)
      i += 2
      continue
    }

    // ── Curly braces (LaTeX grouping — always markup) ──────────────────────
    if (ch === '{' || ch === '}') {
      addMarkup(i, i + 1)
      i++
      continue
    }

    // ── Regular text character ─────────────────────────────────────────────
    i++
  }

  flushText(source.length)
  return annotations
}
