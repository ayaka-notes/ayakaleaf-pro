/**
 * Standalone verification of the parser + model (no test framework needed).
 * Run with:  npx tsx src/__tests__/bibtex-parser.test.ts
 * Exits non-zero if any assertion fails.
 */
import {
  parseBibtex,
  serializeEntry,
  replaceEntryInSource,
} from '../bibtex/bibtex-parser'
import { summarizeAuthors, authorDisplayList } from '../bibtex/author-names'

let failures = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log('  ok  ' + msg)
  } else {
    failures++
    console.error('  FAIL ' + msg)
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)
}

const sample = `
@string{ acmpub = {ACM Press} }

@article{doe2020,
  author  = {Doe, Jane and Smith, John},
  title   = {A Study of {BibTeX} Parsing},
  journal = {Journal of Tests},
  year    = 2020,
}

@book{knuth1984,
  author    = "Donald E. Knuth",
  title     = {The {\\TeX}book},
  publisher = acmpub # { International},
  date      = {1984-01-15},
}

@misc{dup2020, title={First} }
@misc{dup2020, title={Second} }
`

console.log('== parse ==')
const res = parseBibtex(sample)
eq(res.entries.length, 4, 'entry count (string/comment excluded)')
eq(res.macros.get('acmpub'), 'ACM Press', '@string macro resolved')
eq(res.duplicateKeys.has('dup2020'), true, 'duplicate key detected')

const doe = res.entries[0]
eq(doe.type, 'article', 'type')
eq(doe.key, 'doe2020', 'key')
eq(doe.getTitle(), 'A Study of BibTeX Parsing', 'title strips protective braces')
eq(doe.getYear(), '2020', 'year from bare number')
eq(doe.getAuthors(), ['Jane Doe', 'John Smith'], 'authors "Last, First" -> "First Last"')

const knuth = res.entries[1]
eq(knuth.getAuthors(), ['Donald E. Knuth'], 'author "First Last" form')
eq(knuth.getField('publisher').display, 'ACM Press International', 'macro + concat (#)')
eq(knuth.getYear(), '1984', 'year fallback from date field')

console.log('== authors summary ==')
eq(summarizeAuthors('Doe, Jane and Smith, John'), 'Doe & Smith', 'two authors summary')
eq(summarizeAuthors('A, X and B, Y and C, Z'), 'A et al.', '>2 authors summary')
eq(summarizeAuthors('Doe, Jane and others'), 'Doe et al.', 'others -> et al.')

console.log('== edit + write back to source range ==')
const edited = doe.setField('year', '2021').setKey('doe2021')
const serialized = serializeEntry(edited)
assert(serialized.includes('@article{doe2021,'), 'serialized has new key')
assert(serialized.includes('{2021}'), 'serialized has new year')
const newSource = replaceEntryInSource(sample, doe, serialized)
const reparsed = parseBibtex(newSource)
eq(reparsed.entries[0].key, 'doe2021', 'round-trip: edited key parses back')
eq(reparsed.entries[0].getYear(), '2021', 'round-trip: edited year parses back')
eq(reparsed.entries.length, 4, 'round-trip: entry count stable')

console.log('== round-trip: unchanged fields keep raw source ==')
eq(reparsed.entries[0].getTitle(), 'A Study of BibTeX Parsing', 'title preserved after edit')

console.log(failures === 0 ? '\nALL PASSED ✅' : `\n${failures} FAILURE(S) ❌`)
if (failures > 0) throw new Error(`${failures} assertion failure(s)`)
