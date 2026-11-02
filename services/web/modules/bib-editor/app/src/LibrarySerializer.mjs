/**
 * Library .bib download serializer (pure JS, no I/O).
 *
 * 1:1 port of the committed in-project serializer
 * (`frontend/js/utils/bib-parser.ts` `escapeBibValue` / `serializeBibEntry`)
 * so downloaded files parse identically through the editor's parser
 * (round-trip covered by `test/unit/src/library-serializer.test.mjs`).
 *
 * Format (one entry per block, entries separated by a blank line):
 *
 *   @article{smith2024,
 *     title = {Foo},
 *     author = {A and B},
 *   }
 */

/**
 * Escape a raw field value for writing inside braces: a `}` that is not
 * part of a balanced {…} pair gets a backslash (e.g. `a}b` → `a\}b`).
 * Balanced nested braces are preserved; already-escaped `\}` is idempotent.
 */
export function escapeBibValue(value) {
  let out = ''
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '\\' && (value[i + 1] === '{' || value[i + 1] === '}')) {
      out += c
      i++
      out += value[i]
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      if (depth === 0) {
        out += '\\}'
        continue
      }
      depth--
    }
    out += c
  }
  return out
}

/**
 * Serialize one entry `{key, type, fields: [{name, value}]}` to a BibTeX
 * string (fields in given order; empty values dropped; keyless entries
 * serialize without a trailing comma — same as the TS original).
 */
export function serializeBibEntry(entry) {
  const lines = []
  const fields = Array.isArray(entry.fields) ? entry.fields : []
  for (const field of fields) {
    const name = typeof field.name === 'string' ? field.name.trim() : ''
    const value = typeof field.value === 'string' ? field.value.trim() : ''
    if (name && value) {
      lines.push(`  ${name} = {${escapeBibValue(value)}}`)
    }
  }
  const linesText = lines.length > 0 ? lines.join(',\n') : ''
  const key = typeof entry.key === 'string' ? entry.key.trim() : ''
  if (key) {
    return linesText
      ? `@${entry.type}{${key},\n${linesText}\n}`
      : `@${entry.type}{${key}}\n`
  }
  return linesText ? `@${entry.type}{\n${linesText}\n}` : `@${entry.type}{}\n`
}

/**
 * Serialize a list of entries to a full .bib file (trailing newline per
 * entry, entries separated by one blank line).
 */
export function serializeBibFile(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : []
  const blocks = []
  for (const entry of list) {
    let text = serializeBibEntry(entry)
    if (!text.endsWith('\n')) text += '\n'
    blocks.push(text)
  }
  if (blocks.length === 0) return ''
  return blocks.join('\n')
}
