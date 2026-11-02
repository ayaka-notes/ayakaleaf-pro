/**
 * Mendeley document → BibTeX serialization.
 *
 * Pure function (no imports) — the fallback used when api.mendeley.com
 * does not answer `Accept: application/x-bibtex` for a document, and unit-
 * tested directly.
 *
 * Mendeley document (bib/all view) field names, used defensively:
 *   title, type, year, doi,
 *   authors: [{ name }] | [string],
 *   journal: { name, volume, issue, firstPage, lastPage },
 *   conference: { name } | bookTitle, thesisInstitution, publisher.
 */

const TYPE_MAP = {
  journal: 'article',
  magazine_article: 'article',
  newspaper_article: 'article',
  conference_proceedings: 'inproceedings',
  book: 'book',
  book_section: 'incollection',
  thesis: 'phdthesis',
  dissertation: 'phdthesis',
  report: 'techreport',
  working_paper: 'techreport',
  web_page: 'misc',
  statute: 'misc',
  patent: 'misc',
  generic: 'misc',
  other: 'misc',
  '' : 'misc',
}

function firstAuthor(authors) {
  if (Array.isArray(authors)) {
    const a = authors[0]
    if (typeof a === 'string') return a
    if (a?.name) return a.name
    if (a?.firstName && a?.lastName) return `${a.lastName}, ${a.firstName}`
  }
  if (typeof authors === 'string') return authors
  return ''
}

export function serializeMendeleyDocument(doc) {
  if (!doc || typeof doc !== 'object') return ''
  const title = (doc.title || '').trim()
  const year = doc.year != null ? String(doc.year) : ''
  const type = TYPE_MAP[String(doc.type || '').toLowerCase()] || 'misc'
  const authors = firstAuthor(doc.authors)
  const doi = (doc.doi || '').trim()
  const venue =
    doc.journal?.name || doc.conference?.name || doc.bookTitle || ''
  const volume = doc.journal?.volume || doc.volume || ''
  const number = doc.journal?.issue || doc.issue || ''
  const firstPage = doc.journal?.firstPage || doc.firstPage || ''
  const lastPage = doc.journal?.lastPage || doc.lastPage || ''
  const pages =
    firstPage && lastPage && firstPage !== lastPage
      ? `${firstPage}--${lastPage}`
      : String(firstPage || lastPage || '')
  const publisher = doc.publisher || ''
  const school = doc.thesisInstitution || doc.institution || ''

  const fields = []
  fields.push(['title', title || 'Untitled'])
  if (authors) fields.push(['author', authors])
  if (year) fields.push(['year', year])
  if (type === 'article' && venue) fields.push(['journal', venue])
  if (type === 'incollection' && venue) fields.push(['booktitle', venue])
  if (type === 'inproceedings' && venue) fields.push(['booktitle', venue])
  if (volume) fields.push(['volume', volume])
  if (number) fields.push(['number', number])
  if (pages) fields.push(['pages', pages])
  if (publisher && (type === 'book' || type === 'incollection' || type === 'techreport')) {
    fields.push(['publisher', publisher])
  }
  if (school && type === 'phdthesis') fields.push(['school', school])
  if (doi) fields.push(['doi', doi])

  // cite key: Mendeley's document id is a stable UUID → hex letters/digits
  const id = String(doc.id || doc.key || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 24)
  const citeKey = id
    ? `mend_${id}`
    : `mend_${(authors.split(',')[0] || 'x').replace(/[^a-zA-Z]/g, '')}${year || 'nd'}`

  const lines = fields.map(([k, v]) => `\t${k} = {${v}},`)
  return `@${type}{${citeKey},\n${lines.join('\n')}\n}\n`
}
