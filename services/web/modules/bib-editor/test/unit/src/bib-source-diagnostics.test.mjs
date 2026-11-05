import { describe, it, expect } from 'vitest'
import {
  validateBibSource,
  attachDiagnostics,
  diagnosticLabel,
} from '../../../frontend/js/utils/bib-source-diagnostics.ts'
import { parseBibFile } from '../../../frontend/js/utils/bib-parser.ts'

const CLEAN = [
  '@article{smith2020, title={A title}, author={Smith, J.}, year={2020}}',
  '@book{doe2021, title={B}, publisher={Acme}, year={2021}}',
].join('\n\n')

describe('validateBibSource (board #5 — pure diagnostics)', () => {
  it('reports nothing for a clean source', () => {
    expect(validateBibSource(CLEAN)).toEqual([])
  })

  it('flags an unterminated entry (which the parser silently drops)', () => {
    const src = '@article{ok, title={T}}\n@book{broken, title={never closed}'
    const diags = validateBibSource(src)
    expect(diags).toEqual([
      { from: 24, line: 2, code: 'bib_entry_unterminated' },
    ])
    // ...and the parser itself excludes it:
    expect(parseBibFile(src).map(e => e.id)).toEqual(['ok'])
  })

  it('flags a non-empty citation key outside the btparse identifier class', () => {
    const src = '@article{a b!, title={T}}'
    const diags = validateBibSource(src)
    expect(diags.map(d => d.code)).toEqual([
      'citation_key_contains_invalid_characters',
    ])
    expect(diags[0].from).toBe(9) // 'a b!' start after '@article{'
    expect(diags[0].line).toBe(1)
  })

  it('accepts keys with dashes/dots/unicode (btparse identifier class)', () => {
    expect(
      validateBibSource('@article{a-b.c_9, title={T}}')
    ).toEqual([])
    expect(
      validateBibSource('@article{müller2020, title={T}}')
    ).toEqual([])
  })

  it('flags a field set more than once in one entry, pointing at the duplicate', () => {
    const src = '@book{k, title={A}, series={S}, title={B}}'
    const diags = validateBibSource(src)
    expect(diags).toHaveLength(1)
    expect(diags[0].code).toBe('bib_syntax_duplicate_field')
    expect(diags[0].field).toBe('title')
    expect(diags[0].entryFrom).toBe(0)
    // points at the second 'title' (index 32), not the first (index 9)
    expect(diags[0].from).toBe(32)
  })

  it('ignores field-name looks inside braces and quoted values', () => {
    const src =
      '@article{k, title={nested {fake = x} , text}, note={"author = fake"}, author={Real}}'
    const diags = validateBibSource(src)
    const dups = diags.filter(d => d.code === 'bib_syntax_duplicate_field')
    expect(dups).toEqual([])
  })

  it('does not count a stray @type{ inside a closed entry as a top-level entry', () => {
    const src = '@article{k, note={see @book{weird title}}}'
    expect(validateBibSource(src)).toEqual([])
  })

  it('computes 1-based CRLF-aware line numbers', () => {
    const src =
      '@article{a, title={T}}\r\n\r\n@book{b, title={U}}\r\n@misc{c, note={x}'
    const diags = validateBibSource(src)
    expect(diags).toHaveLength(1)
    expect(diags[0].code).toBe('bib_entry_unterminated')
    expect(diags[0].line).toBe(4)
  })

  it('skips @preamble / @string blocks', () => {
    const src = '@preamble{"\\providecommand{\\noopsort}[1]{}"}\n@string{acme = Acme}'
    expect(validateBibSource(src)).toEqual([])
  })

  it('reports every problem, in source order', () => {
    const src = [
      '@article{bad key, title={A}}',
      '@book{k, author={X}, author={Y}}',
      '@misc{never-closed, note={x}',
    ].join('\n')
    const diags = validateBibSource(src)
    expect(diags.map(d => d.code)).toEqual([
      'citation_key_contains_invalid_characters',
      'bib_syntax_duplicate_field',
      'bib_entry_unterminated',
    ])
    expect(diags[0].from < diags[1].from && diags[1].from < diags[2].from).toBe(
      true
    )
  })
})

describe('attachDiagnostics', () => {
  it('attaches in-entry diagnostics to their entry; leaves the rest unattached', () => {
    const src =
      '@article{ok, title={A}, title={B}}\n@book{broken, note={x}'
    const entries = parseBibFile(src)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('ok')

    const { byEntry, unattached } = attachDiagnostics(entries, validateBibSource(src))
    expect(byEntry.get(entries[0])?.map(d => d.code)).toEqual([
      'bib_syntax_duplicate_field',
    ])
    expect(unattached.map(d => d.code)).toEqual(['bib_entry_unterminated'])
  })
})

describe('diagnosticLabel', () => {
  const t = (key, opts) =>
    key.replace(/__field__/, opts?.field ?? '').replace(/__count__/, opts?.count ?? '')

  it('maps codes to localizable messages', () => {
    expect(
      diagnosticLabel({ from: 0, line: 1, code: 'bib_entry_unterminated' }, t)
    ).toBe('An entry is not closed')
    expect(
      diagnosticLabel(
        { from: 0, line: 1, code: 'citation_key_contains_invalid_characters' },
        t
      )
    ).toBe('Citation key contains invalid characters')
    expect(
      diagnosticLabel(
        { from: 0, line: 1, code: 'bib_syntax_duplicate_field', field: 'title' },
        t
      )
    ).toBe('Field title is set more than once')
    expect(diagnosticLabel({ from: 0, line: 1, code: 'unknown_code' }, t)).toBe(
      'unknown_code'
    )
  })
})
