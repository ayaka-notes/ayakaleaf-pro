import { describe, it, expect } from 'vitest'
import { diffBibEntry, planBibEditEntry } from '../../../frontend/js/utils/bib-write.ts'
import { parseBibFile } from '../../../frontend/js/utils/bib-parser.ts'

/** Apply non-overlapping changes the way CodeMirror would (single snapshot). */
function applyChanges(source, changes) {
  const cs = [...changes].sort((a, b) => b.from - a.from)
  let out = source
  for (const c of cs) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  return out
}

const entry = (id, fields = {}, type = 'misc') => ({
  type,
  id,
  fields: { ...fields },
})

describe('diffBibEntry (pure)', () => {
  it('reports nothing for an identical entry', () => {
    const e = entry('a', { title: 'T', author: 'X' })
    const d = diffBibEntry(e, { ...e, fields: { ...e.fields } })
    expect(d.key).toBe(null)
    expect(d.type).toBe(null)
    expect(d.fields).toEqual([])
  })

  it('ignores whitespace-only value differences', () => {
    const d = diffBibEntry(entry('a', { title: 'T' }), entry('a', { title: ' T ' }))
    expect(d.fields).toEqual([])
  })

  it('reports changed, added, removed fields and key changes', () => {
    const original = entry('a', { title: 'T', series: 'S' }, 'book')
    const edited = entry('b', { title: 'U', author: 'X' }, 'article')
    const d = diffBibEntry(original, edited)
    expect(d.key).toBe('b')
    expect(d.type).toBe('article')
    expect(d.fields).toEqual([
      { name: 'title', value: 'U' },
      { name: 'series', value: null },
      { name: 'author', value: 'X' },
    ])
  })

  it('clearing the key is the empty string, not null', () => {
    const d = diffBibEntry(entry('a', { title: 'T' }), entry('', { title: 'T' }))
    expect(d.key).toBe('')
    expect(d.fields).toEqual([])
  })

  it('empty-string field = removal', () => {
    const d = diffBibEntry(entry('a', { title: 'T' }), entry('a', { title: '' }))
    expect(d.fields).toEqual([{ name: 'title', value: null }])
  })
})

describe('planBibEditEntry — field replacement (surgical)', () => {
  const SRC = '@book{doe21,\n  title = {B},  % keep me\n  series = {S}\n}'

  it('replaces only the changed field, preserving bytes around it', () => {
    const edits = diffBibEntry(
      entry('doe21', { title: 'B', series: 'S' }, 'book'),
      entry('doe21', { title: 'New  Title', series: 'S' }, 'book')
    )
    const g = planBibEditEntry(SRC, entry('doe21', { title: 'New  Title', series: 'S' }, 'book'), edits)
    expect(g.ok).toBe(true)
    const out = applyChanges(SRC, g.changes)
    expect(out).toBe('@book{doe21,\n  title = {New  Title},  % keep me\n  series = {S}\n}')
    // exactly one change, touching only the title value
    expect(g.changes).toHaveLength(1)
  })

  it('handles nested braces in replaced values', () => {
    const src = '@misc{k, note = {a {b} c}, year = {1999}}'
    const edits = diffBibEntry(
      entry('k', { note: 'a {b} c', year: '1999' }),
      entry('k', { note: 'x', year: '1999' })
    )
    const g = planBibEditEntry(src, entry('k', { note: 'x', year: '1999' }), edits)
    expect(g.ok).toBe(true)
    expect(applyChanges(src, g.changes)).toBe('@misc{k, note = {x}, year = {1999}}')
  })

  it('escapes unbalanced braces in the new value (round-trips)', () => {
    const src = '@misc{k, title = {old}}'
    const edits = diffBibEntry(entry('k', { title: 'old' }), entry('k', { title: 'a{b' }))
    const g = planBibEditEntry(src, entry('k', { title: 'a{b' }), edits)
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    expect(out).toBe('@misc{k, title = {a\\{b}}')
    // and the result must still parse (the value keeps its escape)
    const [e] = parseBibFile(out)
    expect(e.fields.title).toBe('a\\{b')
  })

  it('supports quoted existing values', () => {
    const src = '@misc{k, url = "http://x", note = {n}}'
    const edits = diffBibEntry(
      entry('k', { url: 'http://x', note: 'n' }),
      entry('k', { url: 'http://y', note: 'n' })
    )
    const g = planBibEditEntry(src, entry('k', { url: 'http://y', note: 'n' }), edits)
    expect(g.ok).toBe(true)
    expect(applyChanges(src, g.changes)).toBe('@misc{k, url = {http://y}, note = {n}}')
  })
})

describe('planBibEditEntry — field add / remove', () => {
  it('appends a new field before the closing brace', () => {
    const src = '@book{k, series = {S}}'
    const edits = diffBibEntry(entry('k', { series: 'S' }, 'book'), entry('k', { series: 'S', publisher: 'P' }, 'book'))
    const g = planBibEditEntry(src, entry('k', { series: 'S', publisher: 'P' }, 'book'), edits)
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    expect(out).toBe('@book{k, series = {S}, publisher = {P}}')
  })

  it('removes a middle field and absorbs one separator comma', () => {
    const src = '@book{k, title = {T}, series = {S}, year = {1}}'
    const edits = diffBibEntry(
      entry('k', { title: 'T', series: 'S', year: '1' }, 'book'),
      entry('k', { title: 'T', year: '1' }, 'book')
    )
    const g = planBibEditEntry(src, entry('k', { title: 'T', year: '1' }, 'book'), edits)
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    expect(out).toBe('@book{k, title = {T}, year = {1}}')
  })

  it('removing the only field (with key) leaves a clean entry', () => {
    const src = '@misc{k, note = {x}}'
    const edits = diffBibEntry(entry('k', { note: 'x' }), entry('k', {}))
    const g = planBibEditEntry(src, entry('k', {}), edits)
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    expect(out).toBe('@misc{k}')
  })

  it('adding a field to an empty keyless entry keeps it keyless', () => {
    const src = '@misc{}'
    const edits = { key: null, type: null, fields: [{ name: 'title', value: 'T' }] }
    const g = planBibEditEntry(src, entry('', { title: 'T' }), edits)
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    const [e] = parseBibFile(out)
    expect(e.id).toBe('') // keyless, not a pseudo-key
    expect(e.fields.title).toBe('T')
  })

  it('adding key + field to an empty entry produces key then field', () => {
    const src = '@misc{}'
    const edits = { key: 'k1', type: null, fields: [{ name: 'title', value: 'T' }] }
    // anchor the ORIGINAL (keyless) entry: originalId ''
    const g = planBibEditEntry(src, entry('k1', { title: 'T' }), edits, '')
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    const [e] = parseBibFile(out)
    expect(e.id).toBe('k1')
    expect(e.fields.title).toBe('T')
  })
})

describe('planBibEditEntry — key and type edits', () => {
  it('renames the key and preserves fields', () => {
    const src = '@book{oldkey, title = {T}}'
    const edits = diffBibEntry(entry('oldkey', { title: 'T' }, 'book'), entry('newkey', { title: 'T' }, 'book'))
    expect(edits.key).toBe('newkey')
    const g = planBibEditEntry(src, entry('newkey', { title: 'T' }, 'book'), edits, 'oldkey')
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    expect(out).toBe('@book{newkey, title = {T}}')
  })

  it('rejects a rename onto a key owned by another entry', () => {
    const src = '@misc{a, n = {1}}\n@misc{b, n = {2}}'
    const g = planBibEditEntry(src, entry('b', { n: '1' }, 'misc'), {
      key: 'b', type: null, fields: [],
    }, 'a')
    expect(g).toEqual({ ok: false, reason: 'key-taken' })
  })

  it('clearing the key keeps a leading comma (fields stay fields)', () => {
    const src = '@misc{oldkey, title = {T}}'
    const g = planBibEditEntry(src, entry('', { title: 'T' }), {
      key: '', type: null, fields: [],
    }, 'oldkey')
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    const [e] = parseBibFile(out)
    expect(e.id).toBe('')
    expect(e.fields.title).toBe('T')
  })

  it('changes the entry type token', () => {
    const src = '@misc{k, title = {T}}'
    const g = planBibEditEntry(src, entry('k', { title: 'T' }, 'book'), {
      key: null, type: 'book', fields: [],
    }, 'k')
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    expect(out).toBe('@book{k, title = {T}}')
  })
})

describe('planBibEditEntry — combined + guards', () => {
  it('applies key + type + field edits in one non-overlapping plan', () => {
    const src = '@misc{old, a = {1}, b = {2}}'
    const edits = diffBibEntry(
      entry('old', { a: '1', b: '2' }),
      entry('new', { a: '9', c: '3' }, 'book')
    )
    const g = planBibEditEntry(src, entry('new', { a: '9', c: '3' }, 'book'), edits, 'old')
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    const [e] = parseBibFile(out)
    expect(e.id).toBe('new')
    expect(e.type).toBe('book')
    expect(e.fields.a).toBe('9')
    expect(e.fields.b).toBeUndefined()
    expect(e.fields.c).toBe('3')
  })

  it('no-op edits yield an empty, safe plan', () => {
    const src = '@misc{k, a = {1}}'
    const g = planBibEditEntry(src, entry('k', { a: '1' }), { key: null, type: null, fields: [] }, 'k')
    expect(g).toEqual({ ok: true, changes: [] })
  })

  it('falls back (field-not-found) when a value is structurally broken', () => {
    const src = '@misc{k, url = "unterminated}'
    const g = planBibEditEntry(src, entry('k', { url: 'x' }), {
      key: null, type: null, fields: [{ name: 'url', value: 'x' }],
    }, 'k')
    expect(g).toEqual({ ok: false, reason: 'field-not-found' })
  })

  it('guards: not a bib file / entry gone', () => {
    expect(
      planBibEditEntry('plain text', entry('k', {}), { key: null, type: null, fields: [] }, 'k')
    ).toEqual({ ok: false, reason: 'not-a-bib-file' })
    expect(
      planBibEditEntry(
        '@misc{k, a = {1}}',
        entry('zz', { a: '1' }),
        { key: null, type: null, fields: [] },
        'zz'
      )
    ).toEqual({ ok: false, reason: 'entry-gone' })
  })

  it('duplicate field names in source: the located (last) occurrence wins', () => {
    // duplicate fields are flagged by diagnostics (#5); the surgical writer
    // must still not corrupt the entry when updating one of them
    // (the parser itself also keeps the last occurrence).
    const src = '@misc{k, title = {A}, title = {B}}'
    const g = planBibEditEntry(src, entry('k', { title: 'C' }), {
      key: null, type: null, fields: [{ name: 'title', value: 'C' }],
    }, 'k')
    expect(g.ok).toBe(true)
    const out = applyChanges(src, g.changes)
    const [e] = parseBibFile(out)
    expect(Object.keys(e.fields)).toContain('title')
    expect(e.fields.title).toBe('C')
  })
})
