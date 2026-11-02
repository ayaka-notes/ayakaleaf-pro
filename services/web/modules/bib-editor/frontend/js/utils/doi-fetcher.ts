/**
 * Client-side DOI metadata fetcher.
 *
 * Strategy:
 *  1. CrossRef API (api.crossref.org) — CORS-friendly, returns JSON we convert to BibTeX fields.
 *  2. doi.org content-negotiation with Accept: application/x-bibtex — may fail on some publishers
 *     due to redirect CORS restrictions, but works for many.
 */
import { parseBibEntry } from './bib-parser'

export interface FetchedBibEntry {
  type: string
  fields: Record<string, string>
  /** An id when the source BibTeX (doi.org content negotiation) had one */
  id?: string
}

// ---- CrossRef helpers --------------------------------------------------

interface CrossRefAuthor {
  family?: string
  given?: string
}

interface CrossRefMessage {
  type?: string
  title?: string[]
  author?: CrossRefAuthor[]
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
  volume?: string
  issue?: string
  page?: string
  DOI?: string
  URL?: string
  publisher?: string
}

function crossRefTypeToBibtex(crType?: string): string {
  switch (crType) {
    case 'book':
    case 'monograph':
      return 'book'
    case 'book-chapter':
      return 'inbook'
    case 'proceedings-article':
      return 'inproceedings'
    case 'proceedings':
      return 'proceedings'
    case 'thesis':
      return 'phdthesis'
    case 'report':
      return 'techreport'
    case 'dataset':
      return 'misc'
    default:
      return 'article'
  }
}

function crossRefMessageToEntry(msg: CrossRefMessage): FetchedBibEntry {
  const type = crossRefTypeToBibtex(msg.type)
  const fields: Record<string, string> = {}

  if (msg.title?.[0]) fields.title = msg.title[0]

  if (msg.author?.length) {
    fields.author = msg.author
      .map(a => [a.family, a.given].filter(Boolean).join(', '))
      .join(' and ')
  }

  const year = msg.issued?.['date-parts']?.[0]?.[0]
  if (year) fields.year = String(year)

  if (msg['container-title']?.[0]) {
    if (type === 'inproceedings' || type === 'proceedings') {
      fields.booktitle = msg['container-title'][0]
    } else {
      fields.journal = msg['container-title'][0]
    }
  }

  if (msg.volume) fields.volume = msg.volume
  if (msg.issue) fields.number = String(msg.issue)
  if (msg.page) fields.pages = msg.page
  if (msg.DOI) fields.doi = msg.DOI
  if (msg.URL) fields.url = msg.URL
  if (msg.publisher) fields.publisher = msg.publisher

  return { type, fields }
}

// ---- Main export -------------------------------------------------------

/**
 * Normalise raw DOI input: strip leading URL prefix and whitespace.
 */
function normaliseDoi(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
}

async function fetchCrossref(doi: string): Promise<FetchedBibEntry | null> {
  // Crossref looks are registered with publisher-native casing; DOIs are
  // case-insensitive identifiers, so a 404 on the given spelling is not
  // conclusive — retry lowercase before giving up (covers e.g. `ARXIV` vs
  // `arXiv`-style typos).
  for (const candidate of [doi, doi.toLowerCase()].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  )) {
    try {
      const res = await fetch(
        `https://api.crossref.org/works/${encodeURIComponent(candidate)}`,
        { headers: { Accept: 'application/json' } },
      )
      if (res.ok) {
        const json: { message?: CrossRefMessage } = await res.json()
        if (json?.message) return crossRefMessageToEntry(json.message)
      }
      // 404/405 → try next candidate/source; 429 → this source is rate
      // limited, the other sources can still answer.
    } catch {
      // network/CORS — continue
    }
  }
  return null
}

interface DataCiteResponse {
  data?: {
    attributes?: {
      titles?: { title: string }[]
      'container-title'?: string
      publicationYear?: number
      publisher?: string
      volume?: string
      issue?: string
      creators?: { name?: string }[]
    }
  }
}

function dataCiteToEntry(doi: string, d: DataCiteResponse['data']): FetchedBibEntry | null {
  const a = d?.attributes
  if (!a?.titles?.[0]?.title) return null
  const fields: Record<string, string> = { title: a.titles[0].title }
  if (a['container-title']) fields.journal = a['container-title']
  if (a.publicationYear) fields.year = String(a.publicationYear)
  if (a.publisher) fields.publisher = a.publisher
  if (a.volume) fields.volume = a.volume
  if (a.issue) fields.number = a.issue
  if (a.creators?.length) {
    fields.author = a.creators.map(c => c.name).filter(Boolean).join(' and ')
  }
  fields.doi = doi
  return { type: a['container-title'] ? 'article' : 'misc', fields }
}

// arXiv preprints have no journal — make the citation honest by adding the
// archive/eprint fields (recognized by natbib/biblatex).
function withArXivFields(entry: FetchedBibEntry): FetchedBibEntry {
  if (entry.fields.journal || entry.fields.booktitle) return entry
  const doi = entry.fields.doi || ''
  let m = doi.match(/10\.48550\/arxiv\.(\d{4}\.\d+(v\d+)?)\/?(v\d+)?/i)
  let arxivId = m?.[1] || ''
  if (!arxivId) m = entry.fields.url?.match(/arxiv\.org\/abs\/(\d{4}\.\d+(v\d+)?)?/i)
  arxivId = arxivId || m?.[1] || ''
  if (!arxivId) return entry
  return {
    ...entry,
    fields: { ...entry.fields, eprint: arxivId, archivePrefix: 'arXiv' },
  }
}

/**
 * Fetch bibliographic metadata for a DOI and return it as BibTeX fields.
 * Throws an Error if the DOI is invalid or all sources fail.
 */
export async function fetchEntryFromDoi(raw: string): Promise<FetchedBibEntry> {
  const doi = normaliseDoi(raw)

  if (!doi || !/^10\.\d{4,9}\/.+$/.test(doi)) {
    throw new Error('Invalid DOI format (expected 10.xxxx/…)')
  }

  // --- 1. CrossRef (with a lower-case retry) ---
  const fromCrossref = await fetchCrossref(doi)
  if (fromCrossref) return withArXivFields(fromCrossref)

  // --- 2. doi.org BibTeX content-negotiation ---
  {
    try {
      const res = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
        headers: { Accept: 'application/x-bibtex, text/x-bibtex;q=0.9' },
      })
      if (res.ok) {
        const text = await res.text()
        if (text.trim().startsWith('@')) {
          const parsed = parseBibEntry(text)
          if (parsed) {
            return withArXivFields({
              type: parsed.type,
              fields: parsed.fields,
              id: parsed.id,
            })
          }
        }
      }
    } catch {
      // fall through to next strategy
    }
  }

  // --- 3. DataCite (preprints / publishers not in Crossref) ---
  {
    try {
      const res = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`)
      if (res.ok) {
        const json = await res.json()
        const entry = dataCiteToEntry(doi, json?.data)
        if (entry) return withArXivFields(entry)
      }
    } catch {
      // all sources failed
    }
  }

  throw new Error(
    'Could not retrieve metadata for this DOI. Check the DOI and try again.\n'
    + '(Preprints, e.g. arXiv, have no journal title — that field is expected to be empty.)',
  )
}
