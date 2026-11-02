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

/**
 * Fetch bibliographic metadata for a DOI and return it as BibTeX fields.
 * Throws an Error if the DOI is invalid or all sources fail.
 */
export async function fetchEntryFromDoi(raw: string): Promise<FetchedBibEntry> {
  const doi = normaliseDoi(raw)

  if (!doi || !/^10\.\d{4,9}\/.+$/.test(doi)) {
    throw new Error('Invalid DOI format (expected 10.xxxx/…)')
  }

  // --- 1. CrossRef ---
  try {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.ok) {
      const json: { message?: CrossRefMessage } = await res.json()
      if (json?.message) {
        return crossRefMessageToEntry(json.message)
      }
    }
  } catch {
    // fall through to next strategy
  }

  // --- 2. doi.org BibTeX content-negotiation ---
  try {
    const url = `https://doi.org/${encodeURIComponent(doi)}`
    const res = await fetch(url, {
      headers: { Accept: 'application/x-bibtex, text/x-bibtex;q=0.9' },
    })
    if (res.ok) {
      const text = await res.text()
      if (text.trim().startsWith('@')) {
        const parsed = parseBibEntry(text)
        if (parsed) {
          return { type: parsed.type, fields: parsed.fields, id: parsed.id }
        }
      }
    }
  } catch {
    // fall through to error
  }

  throw new Error(
    'Could not retrieve metadata for this DOI. Check the DOI and try again.'
  )
}
