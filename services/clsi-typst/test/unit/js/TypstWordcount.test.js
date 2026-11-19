import { describe, it, expect } from 'vitest'
import TypstWordcount from '../../../app/js/TypstWordcount.js'

const {
  parseMarkerText,
  buildInjectedDoc,
  buildWCCommand,
  parseWordcountOutput,
  WORDOMETER_MARKER,
} = TypstWordcount

describe('parseMarkerText', () => {
  it('parses the rendered marker', () => {
    const r = parseMarkerText(
      'junk WORDOMETER_OUTPUT_START TOTAL_WORDS: 123 HEADING_WORDS: 45 NUM_HEADINGS: 6 WORDOMETER_OUTPUT_END junk'
    )
    expect(r).toEqual({ total: 123, heading: 45, heads: 6, ok: true })
  })

  it('tolerates split fragments (extra spaces)', () => {
    const r = parseMarkerText('TOTAL_WORDS:   123    HEADING_WORDS: 45 NUM_HEADINGS: 6')
    expect(r.ok).toBe(true)
    expect(r.total).toBe(123)
  })

  it('is not ok when absent', () => {
    expect(parseMarkerText('nothing here').ok).toBe(false)
  })
})

describe('buildInjectedDoc', () => {
  it('imports the wordometer under a private alias and includes the root', () => {
    const doc = buildInjectedDoc('main.typ')
    expect(doc).toContain('#import "__clsi_wordometer.typ" as wo')
    expect(doc).toContain('#show: wo.word-count')
    expect(doc).toContain('#include "main.typ"')
    expect(doc).toContain('TOTAL_WORDS: #wo.total-words')
    expect(doc).toContain('HEADING_WORDS: #headWords')
    expect(doc).toContain('NUM_HEADINGS: #heads.len()')
  })

  it('escapes backslashes and quotes in the root path', () => {
    const doc = buildInjectedDoc('we"ird\\path.typ')
    expect(doc).toContain('#include "we\\"ird\\\\path.typ"')
  })
})

describe('buildWCCommand', () => {
  it('is a wc -w fallback with a safe echo', () => {
    const cmd = buildWCCommand('main.typ')
    expect(cmd[0]).toBe('sh')
    expect(cmd[1]).toBe('-c')
    expect(cmd[2]).toContain('wc -w "$COMPILE_DIR/main.typ"')
    expect(cmd[2]).toContain('|| echo "0 /compile/main.typ"')
  })
})

describe('parseWordcountOutput', () => {
  it('extracts the first number run', () => {
    expect(parseWordcountOutput('42 main.typ').textWords).toBe(42)
    expect(parseWordcountOutput('0 /compile/main.typ').textWords).toBe(0)
    expect(parseWordcountOutput('garbage').textWords).toBe(0)
  })
})

describe('WORDOMETER_MARKER', () => {
  it('matches the exact token order', () => {
    expect(WORDOMETER_MARKER).toBeInstanceOf(RegExp)
    expect(
      WORDOMETER_MARKER.test(
        'TOTAL_WORDS: 1 HEADING_WORDS: 2 NUM_HEADINGS: 3'
      )
    ).toBe(true)
  })
})
