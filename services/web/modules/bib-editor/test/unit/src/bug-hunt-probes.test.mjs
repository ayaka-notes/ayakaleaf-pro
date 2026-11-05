import { describe, it, expect } from 'vitest'
import { parseBibFile, serializeBibEntry } from '../../../frontend/js/utils/bib-parser.ts'
import { planBibImport, planBibDelete, planBibBulkDelete } from '../../../frontend/js/utils/bib-write.ts'
import { nextEntry, prevEntry, selectedEntriesInOrder, bulkDeleteIds } from '../../../frontend/js/utils/preview-model.ts'
import { validateEntry, hasValidBiblatexDate } from '../../../frontend/js/utils/bib-validate.ts'
import { validateBibSource } from '../../../frontend/js/utils/bib-source-diagnostics.ts'
import {
  bibPreviewSessionKey,
  readBibPreviewSession,
  writeBibPreviewSession,
} from '../../../frontend/js/utils/bib-preview-session.ts'
import { escapeBibValue as serverEscape, serializeBibEntry as serverSerialize } from '../../../app/src/LibrarySerializer.mjs'
import { serializeMendeleyDocument } from '../../../deps/mendeley/app/src/MendeleyBibtexSerializer.mjs'

describe('BUG HUNT: parser edges', () => {
  it('escaped quote inside a BARE quoted value does not truncate the value', () => {
    const src = '@misc{k, note="he said \\"hi\\"", author={X}}'
    const [e] = parseBibFile(src)
    // raw-value model: the backslash is preserved (round-trips via serialize)
    expect(e.fields.note).toBe('he said \\"hi\\"')
    expect(e.fields.author).toBe('X')
  })

  it('comma + equals inside a BARE quoted value do not split the field', () => {
    const src = '@misc{k, title="a, b = c", author={X}}'
    const [e] = parseBibFile(src)
    expect(e.fields.title).toBe('a, b = c')
    expect(e.fields.author).toBe('X')
  })

  it('literal quotes inside braces stay literal (btparse semantics)', () => {
    const src = '@misc{k, title={"a, b = c"}, author={X}}'
    const [e] = parseBibFile(src)
    expect(e.fields.title).toBe('"a, b = c"')
  })
})

describe('BUG HUNT: import keyless entries (documented parity)', () => {
  it('a keyless pasted entry is rejected (parity with the reference: keys must materialize)', () => {
    const src = '@misc{a, title={T}}\n'
    const g = planBibImport(
      src,
      [{ type: 'misc', id: '', fields: { title: 'Keyless' } }],
      serializeBibEntry
    )
    expect(g.ok).toBe(false)
  })

  it('keyed duplicate ids in one import batch are rejected', () => {
    const src = '@misc{a, title={T}}\n'
    const g = planBibImport(
      src,
      [
        { type: 'misc', id: 'x', fields: {} },
        { type: 'misc', id: 'x', fields: {} },
      ],
      serializeBibEntry
    )
    expect(g.ok).toBe(false)
  })
})

describe('BUG HUNT: duplicate-key delete semantics', () => {
  const src = '@misc{a, title={T1}}\n@misc{a, title={T2}}\n@misc{z, title={T3}}\n'

  it('single delete of a duplicate key is rejected with an honest reason', () => {
    const g = planBibDelete(src, 'a')
    expect(g).toEqual({ ok: false, reason: 'duplicate-key' })
  })

  it('single delete of a unique key still works', () => {
    const g = planBibDelete(src, 'z')
    expect(g.ok).toBe(true)
    const out = src.slice(0, g.plan.from) + src.slice(g.plan.to)
    expect(parseBibFile(out).map(e => e.id)).toEqual(['a', 'a'])
  })

  it('bulk delete removes ALL occurrences of a selected duplicate key', () => {
    const g = planBibBulkDelete(src, ['a'])
    expect(g.ok).toBe(true)
    let out = src
    for (const c of [...g.changes].sort((a, b) => b.from - a.from)) {
      out = out.slice(0, c.from) + c.insert + out.slice(c.to)
    }
    expect(parseBibFile(out).map(e => e.id)).toEqual(['z'])
  })

  it('bulk delete still rejects when an id is absent (all-or-nothing)', () => {
    const g = planBibBulkDelete(src, ['a', 'missing'])
    expect(g).toEqual({ ok: false, reason: 'entry-gone' })
  })
})

describe('BUG HUNT: preview navigation (index-based) + selection order', () => {
  const mk = (id, i) => ({
    id,
    type: 'misc',
    fields: {},
    sourceStart: i,
    sourceEnd: i + 1,
    raw: '',
  })

  it('next/prev wrap and are index-stable for duplicate keys', () => {
    const entries = [mk('dup', 0), mk('dup', 1), mk('z', 2)]
    expect(nextEntry(entries, 0).id).toBe('dup')
    expect(nextEntry(entries, 1).id).toBe('z')
    expect(nextEntry(entries, 2).id).toBe('dup')
    expect(prevEntry(entries, 1).id).toBe('dup')
    expect(prevEntry(entries, 0).id).toBe('z')
  })

  it('selectedEntriesInOrder keeps document order for duplicates', () => {
    const entries = [mk('a', 0), mk('b', 1), mk('c', 2), mk('a', 3)]
    const sel = selectedEntriesInOrder(entries, ['a', 'c'])
    expect(sel.map(e => e.id)).toEqual(['a', 'c', 'a'])
  })

  it('bulkDeleteIds keeps only ids present in the parse', () => {
    const entries = [mk('a', 0), mk('b', 1), mk('a', 2)]
    expect(bulkDeleteIds(entries, ['a', 'b', 'ghost'])).toEqual(['a', 'b'])
  })
})

describe('BUG HUNT: validation contracts', () => {
  it('urldate: syntax is checked, calendar validity is not (documented)', () => {
    expect(hasValidBiblatexDate('2020')).toBe(true)
    expect(hasValidBiblatexDate('2020-05')).toBe(true)
    expect(hasValidBiblatexDate('2020-05-02')).toBe(true)
    expect(hasValidBiblatexDate('2020-13')).toBe(true) // syntax only
    expect(hasValidBiblatexDate('not-a-date')).toBe(false)
    expect(hasValidBiblatexDate('')).toBe(true) // empty = unchecked
  })

  it('a non-4-digit year is a warning (non-blocking), not an error', () => {
    const v = validateEntry(
      { type: 'article', id: 'k', fields: { year: '45', author: 'X', title: 'T', journal: 'J' } },
      'existing'
    )
    expect(v.byField.year?.kind).toBe('year-format')
    // only blocking message kinds are id-invalid / required-missing
    const blocking = Object.values(v.byField).filter(
      m => m.kind === 'id-invalid' || m.kind === 'required-missing'
    )
    expect(blocking).toEqual([])
  })
})

describe('BUG HUNT: source-diagnostics edges', () => {
  it('valid keys with dots/dashes/underscores are not flagged', () => {
    expect(validateBibSource('@misc{k.a_b-1, title={T}}')).toEqual([])
  })

  it('exotic quoted keys do not crash and do not report unterminated', () => {
    const diags = validateBibSource('@misc{"my key", title={T}}')
    expect(diags.some(d => d.code === 'bib_entry_unterminated')).toBe(false)
  })

  it('case-variant repeated fields are duplicates (names are lowercase)', () => {
    const diags = validateBibSource('@misc{k, TITLE = {A}, title = {B}}')
    expect(diags.some(d => d.code === 'bib_syntax_duplicate_field')).toBe(true)
  })
})

describe('BUG HUNT: preview session store', () => {
  it('never throws on hostile localStorage payloads', () => {
    const key = bibPreviewSessionKey('doc1')
    for (const v of ['[1,2,', '{', 'undefined', null, '42', '[]']) {
      try { window.localStorage.setItem(key, String(v)) } catch {}
      expect(() => readBibPreviewSession(key)).not.toThrow()
    }
    try { window.localStorage.removeItem(key) } catch {}
  })

  it('round-trips a valid session (shape: entryId + anchored listPosition)', () => {
    const key = bibPreviewSessionKey('docX')
    const session = {
      entryId: 'k1',
      listPosition: { entryId: 'k1', offset: 10, scrollTop: 55 },
    }
    writeBibPreviewSession(key, session)
    expect(readBibPreviewSession(key)).toEqual(session)
  })

  it('drops the WHOLE session when listPosition is malformed (documented)', () => {
    const key = bibPreviewSessionKey('docY')
    writeBibPreviewSession(key, {
      entryId: 'k2',
      listPosition: { offset: 10, scrollTop: 55 }, // missing entryId
    })
    expect(readBibPreviewSession(key)).toBeNull()
  })
})

describe('BUG HUNT: server serializers are brace-safe (regression)', () => {
  it('library serializer escapes an unmatched opening brace', () => {
    expect(serverEscape('a{b')).toBe('a\\{b')
    expect(serverEscape('a}b')).toBe('a\\}b')
    expect(serverEscape('a{b}c')).toBe('a{b}c')
    expect(serverEscape('x \\{ y')).toBe('x \\{ y')
  })

  it('library download output round-trips through the editor parser', () => {
    const entry = {
      key: 'k',
      type: 'misc',
      fields: [{ name: 'title', value: 'a{b' }],
    }
    const out = serverSerialize(entry)
    const [parsed] = parseBibFile(out)
    expect(parsed.fields.title).toBe('a\\{b')
  })

  it('mendeley fallback serializer escapes braces in values', () => {
    const doc = {
      id: 'abcDEF123',
      type: 'journal',
      title: 'A note about } braces {',
      year: 2020,
    }
    const out = serializeMendeleyDocument(doc)
    // no raw unbalanced brace may reach the file unescaped
    expect(out).toContain('\\} braces \\{')
  })
})
