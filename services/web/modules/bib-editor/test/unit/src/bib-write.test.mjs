import { describe, it, expect } from 'vitest'
import {
  planBibWrite,
  planBibDelete,
  planBibBulkDelete,
  planBibImport,
  isBibDocument,
  serializeBibEntry,
} from '../../../frontend/js/utils/bib-write.ts'
import { parseBibFile } from '../../../frontend/js/utils/bib-parser.ts'

describe('bib-write (R2 plan, pure)', () => {
  const src =
    '@article{k1,\n  title = {One},\n  year = {2020},\n}\n' +
    '@book{k2, title = {Two}, year = {2021}}\n'

  it('plans a replace for an existing entry using fresh offsets', () => {
    const guard = planBibWrite(src, { type: 'book', id: 'k2', fields: { title: 'Two (edited)', year: '2021' } }, 'existing', serializeBibEntry)
    expect(guard.ok).toBe(true)
    const { plan } = guard
    expect(plan.kind).toBe('replace')
    const [k2] = parseBibFile(src).filter(e => e.id === 'k2')
    expect(plan.from).toBe(k2.sourceStart)
    expect(plan.to).toBe(k2.sourceEnd)
    expect(plan.insert).toContain('title = {Two (edited)}')
    // applying the plan yields exactly one edit of the right range
    const applied = src.slice(0, plan.from) + plan.insert + src.slice(plan.to)
    const entries = parseBibFile(applied)
    expect(entries).toHaveLength(2)
    expect(entries.find(e => e.id === 'k2').fields.title).toBe('Two (edited)')
    expect(entries.find(e => e.id === 'k1')).toBeDefined()
  })

  it('rejects an existing-entry write when the entry is gone (Code-mode delete)', () => {
    const guard = planBibWrite(src, { type: 'book', id: 'k9', fields: {} }, 'existing', serializeBibEntry)
    expect(guard.ok).toBe(false)
    expect(guard.reason).toBe('entry-gone')
  })

  it('rejects an existing-entry write for a non-bib document', () => {
    const guard = planBibWrite('\n', { type: 'book', id: 'k1', fields: {} }, 'existing', serializeBibEntry)
    expect(guard.ok).toBe(false)
    expect(guard.reason).toBe('not-a-bib-file')
  })

  it('rejects ambiguous duplicate ids for an existing-entry write', () => {
    const dup = '@misc{a, title={X}}\n@misc{a, title={Y}}\n'
    const guard = planBibWrite(dup, { type: 'misc', id: 'a', fields: {} }, 'existing', serializeBibEntry)
    expect(guard.ok).toBe(false)
    expect(guard.reason).toBe('entry-gone')
  })

  it('plans a rename (new key) against the original key anchor, and rejects a collision', () => {
    // k2 → k9 (free): anchored by the original id, range preserved
    const ok = planBibWrite(src, { type: 'book', id: 'k9', fields: { title: 'Two', year: '2021' } }, 'existing', serializeBibEntry, 'k2')
    expect(ok.ok).toBe(true)
    const k2 = parseBibFile(src).find(e => e.id === 'k2')
    expect(ok.plan.from).toBe(k2.sourceStart)
    expect(ok.plan.to).toBe(k2.sourceEnd)
    expect(ok.plan.insert).toContain('k9')
    const applied = src.slice(0, ok.plan.from) + ok.plan.insert + src.slice(ok.plan.to)
    const entries = parseBibFile(applied)
    expect(entries.find(e => e.id === 'k9')).toBeDefined()
    expect(entries.find(e => e.id === 'k1')).toBeDefined()
    // k2 → k1 (a DIFFERENT entry owns k1): collision guard
    const clash = planBibWrite(src, { type: 'book', id: 'k1', fields: {} }, 'existing', serializeBibEntry, 'k2')
    expect(clash.ok).toBe(false)
    expect(clash.reason).toBe('key-taken')
  })

  it('appends a new entry at the end of the document', () => {
    const guard = planBibWrite(src, { type: 'misc', id: 'k3', fields: { title: 'New' } }, 'new', serializeBibEntry)
    expect(guard.ok).toBe(true)
    const { plan } = guard
    expect(plan.kind).toBe('append')
    expect(plan.from).toBe(src.length)
    expect(plan.to).toBe(src.length)
    const applied = src.slice(0, plan.from) + plan.insert + src.slice(plan.to)
    const entries = parseBibFile(applied)
    expect(entries).toHaveLength(3)
    expect(entries[2].id).toBe('k3')
  })

  it('appends without a leading newline for an empty document', () => {
    const guard = planBibWrite('', { type: 'misc', id: 'a', fields: { title: 'A' } }, 'new', serializeBibEntry)
    expect(guard.ok).toBe(true)
    expect(guard.plan.insert.startsWith('\n')).toBe(false)
    const applied = guard.plan.insert
    expect(parseBibFile(applied)).toHaveLength(1)
  })

  it('plans a delete that consumes the trailing newlines of an entry', () => {
    // k2 is the last entry and has one trailing newline: removing the entry
    // must not leave the stray blank line behind.
    const guard = planBibDelete(src, 'k2')
    expect(guard.ok).toBe(true)
    const { plan } = guard
    expect(plan.insert).toBe('')
    const applied = src.slice(0, plan.from) + plan.insert + src.slice(plan.to)
    expect(applied).toBe('@article{k1,\n  title = {One},\n  year = {2020},\n}\n')
    // deleting a MIDDLE entry consumes exactly its own trailing newline
    const guard2 = planBibDelete(src, 'k1')
    const applied2 = src.slice(0, guard2.plan.from) + guard2.plan.insert + src.slice(guard2.plan.to)
    const entries = parseBibFile(applied2)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('k2')
  })

  it('rejects delete of missing entries and non-bib documents', () => {
    expect(planBibDelete(src, 'nope').ok).toBe(false)
    expect(planBibDelete('\n', 'k1').ok).toBe(false)
  })

  it('isBibDocument matches the extension heuristic', () => {
    expect(isBibDocument('@article{k, x = {1}}')).toBe(true)
    expect(isBibDocument('\n\n% comment\n@misc{a}\n')).toBe(true)
    expect(isBibDocument('just text\n')).toBe(false)
    expect(isBibDocument('')).toBe(false)
  })

  it('isBibDocument: known heuristic limitation — a @type{ inside a leading comment matches (documented, acceptable)', () => {
    // The plan §3.3 notes this limitation; the test pins the CURRENT behavior
    // so any future change (e.g. filename-aware detection) must be deliberate.
    expect(isBibDocument('% a comment with @article{fake}\nreal text\n')).toBe(true)
    // a genuinely entry-less document stays non-bib
    expect(isBibDocument('just prose, no entry markers\n')).toBe(false)
  })
})

describe('planBibBulkDelete (W5, pure)', () => {
  const src =
    '@article{k1,\n  title = {One},\n  year = {2020},\n}\n' +
    '@book{k2, title = {Two}, year = {2021}}\n' +
    '@misc{k3}\n' +
    '@inproceedings{k4, title = {Four}}\n'

  it('plans N non-adjacent deletes as ascending ranges (one dispatch)', () => {
    const g = planBibBulkDelete(src, ['k2', 'k4'])
    expect(g.ok).toBe(true)
    const { changes } = g
    // ascending + non-overlapping
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i].from).toBeGreaterThanOrEqual(changes[i - 1].to)
    }
    // applying the changes (from the BACK, so offsets stay valid for the
    // earlier ranges) deletes both entries, keeps the rest
    const applied = [...changes]
      .sort((a, b) => b.from - a.from)
      .reduce((acc, c) => acc.slice(0, c.from) + acc.slice(c.to), src)
    const ids = parseBibFile(applied).flatMap(e => e.id)
    expect(ids).not.toContain('k2')
    expect(ids).not.toContain('k4')
    expect(ids).toContain('k1')
    expect(ids).toContain('k3')
  })

  it('rejects the WHOLE op when one id is missing (no partial)', () => {
    const g = planBibBulkDelete(src, ['k1', 'nope'])
    expect(g.ok).toBe(false)
    expect(g.reason).toBe('entry-gone')
  })

  it('deduplicates ids (double-pick is a no-op on the second)', () => {
    const g = planBibBulkDelete(src, ['k1', 'k1'])
    expect(g.ok).toBe(true)
    expect(g.changes).toHaveLength(1)
  })

  it('an empty selection plans ZERO changes (no-op dispatch)', () => {
    const g = planBibBulkDelete(src, [])
    expect(g.ok).toBe(true)
    expect(g.changes).toHaveLength(0)
  })

  it('rejects a non-bib document', () => {
    expect(planBibBulkDelete('just text\n', ['k1']).ok).toBe(false)
  })

  it('consumes trailing newlines like the single planner (no blank lines)', () => {
    const s = '@misc{only}\n'
    const g = planBibBulkDelete(s, ['only'])
    expect(g.ok).toBe(true)
    const [c] = g.changes
    const applied = s.slice(0, c.from) + s.slice(c.to)
    // the whole entry, incl. its trailing newline, is removed (no blank line)
    expect(applied).toBe('')
  })
})

describe('planBibImport (C5 paste import, pure)', () => {
  const doc = '@misc{seed, title = {Seed}}\n'
  const ser = e => `@${e.type}{${e.id}}\n` // minimal-but-valid serializer

  it('plans a single append at end-of-file (ok:true, one change)', () => {
    const g = planBibImport(doc, [{ type: 'article', id: 'k1', fields: { title: 'One' } }], ser)
    expect(g.ok).toBe(true)
    expect(g.changes).toHaveLength(1)
    const c = g.changes[0]
    // append: from === to === end of the current source
    expect(c.from).toBe(doc.length)
    expect(c.to).toBe(doc.length)
    expect(c.insert).toContain('k1')
  })

  it('multiple entries → ONE single append (all-or-nothing, byte-compatible)', () => {
    const g = planBibImport(
      doc,
      [
        { type: 'article', id: 'k1', fields: { title: 'One' } },
        { type: 'article', id: 'k2', fields: { title: 'Two' } },
      ],
      (e) => `@${e.type}${e.id}`
    )
    expect(g.ok).toBe(true)
    expect(g.changes).toHaveLength(1) // ONE write
    const c = g.changes[0]
    expect(c.from).toBe(doc.length)
    expect(c.insert).toContain('k1')
    expect(c.insert).toContain('k2')
  })

  it('re-serializes entries with the passed serializer (not the caller copy)', () => {
    const g = planBibImport(
      doc,
      [{ type: 'article', id: 'k3', fields: { title: 'New' } }],
      (e) => `@${e.type}{${e.id}, title = ${e.fields.title}}\n`
    )
    expect(g.ok).toBe(true)
    expect(g.changes[0].insert).toBe('@article{k3, title = New}\n')
  })

  it('rejects when the document is NOT a bib file (incl. the empty doc)', () => {
    expect(
      planBibImport('just prose\n', [{ type: 'misc', id: 'a', fields: {} }], ser).ok
    ).toBe(false)
    expect(planBibImport('', [], ser).ok).toBe(false)
    expect(planBibImport(doc, [], ser).ok).toBe(true) // empty import into a bib doc is fine
  })

  it('rejects a conflict: the imported key already exists in the doc (key-conflict)', () => {
    const g = planBibImport(doc, [{ type: 'article', id: 'seed', fields: {} }], ser)
    expect(g.ok).toBe(false)
    expect(g.reason).toBe('key-conflict')
  })

  it('rejects a keyless entry (an import cannot produce an ID-less entry)', () => {
    const g = planBibImport(doc, [{ type: 'article', id: '', fields: {} }], ser)
    expect(g.ok).toBe(false)
    expect(g.reason).toBe('key-conflict')
  })

  it('dedups duplicate keys in the import (the second copy conflicts)', () => {
    const g = planBibImport(
      doc,
      [
        { type: 'article', id: 'k1', fields: {} },
        { type: 'article', id: 'k1', fields: {} },
      ],
      ser
    )
    expect(g.ok).toBe(false)
    expect(g.reason).toBe('key-conflict')
  })

  it('appends with a leading separator when the source lacks a trailing newline', () => {
    const s = '@misc{only}' // no trailing newline
    const g = planBibImport(s, [{ type: 'misc', id: 'a', fields: {} }], ser)
    expect(g.ok).toBe(true)
    const c = g.changes[0]
    expect(c.from).toBe(s.length)
    expect(c.insert.startsWith('\n')).toBe(true) // byte-compatible with planBibWrite 'new'
  })

  it('empty import into a bib doc → no-op (no changes, ok:true)', () => {
    const g = planBibImport(doc, [], ser)
    expect(g.ok).toBe(true)
    expect(g.changes).toHaveLength(0)
  })
})

