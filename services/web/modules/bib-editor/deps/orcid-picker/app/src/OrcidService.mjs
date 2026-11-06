import dns from 'node:dns'
import logger from '@overleaf/logger'

const ORCID_PUB_API = 'https://pub.orcid.org/v3.0'
const FETCH_TIMEOUT_MS = 10_000
const MAX_BODY_SIZE = 2 * 1024 * 1024 // 2 MB — works lists can be large
const MAX_REDIRECTS = 5
const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

/**
 * Validate an ORCID identifier format.
 */
export function isValidOrcid(raw) {
  return typeof raw === 'string' && ORCID_REGEX.test(raw.trim())
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

/**
 * True when the IP literal belongs to a non-public range. Covers IPv4
 * (loopback/private/link-local/CGNAT/special), IPv6 (loopback, ULA,
 * link-local, unspecified, site-local) and IPv4-mapped/compatible IPv6
 * forms (::ffff:127.0.0.1 etc.).
 */
export function isPrivateAddress(ip) {
  const s = String(ip).trim()
  // IPv4-mapped / IPv4-compatible IPv6
  const m = s.match(/^(?:\[?)::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)(?:\]?)$/i)
  if (m) {
    return isPrivateAddress(m[1])
  }
  const parts = s.split('.').map((p) => Number.parseInt(p, 10))
  if (s.includes('.') && parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts
    return (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10.0.0.0/8
      a === 127 || // 127.0.0.0/8
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
      (a === 169 && b === 254) || // 169.254.0.0/16 (link-local)
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 (benchmarking)
      a >= 224 // 224.0.0.0/3 (multicast) + reserved
    )
  }
  if (s.includes(':')) {
    const lower = s.toLowerCase()
    if (lower === '::' ) return true
    if (lower === '::1') return true
    if (/^fe[89ab]/.test(lower)) return true // fe80::/10 link-local
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true // fc00::/7 ULA
    if (/^fec0:/.test(lower)) return true // deprecated site-local
    if (/^ff/.test(lower)) return true // multicast
  }
  return false
}

/**
 * Resolve the hostname of a URL and reject if ANY result is in a
 * non-public range (DNS rebind mitigation at request time; the fetch
 * itself follows redirects hop-by-hop with the same check — see
 * safeFetch).
 */
async function checkUrlNotPrivate(url) {
  const records = await dns.promises.lookup(url.hostname, { all: true })
  for (const rec of records) {
    if (isPrivateAddress(rec.address)) {
      throw new Error('Blocked request to a non-public network address')
    }
  }
}

// ---------------------------------------------------------------------------
// Generic fetch helper with timeout + size guard + hop-by-hop SSRF check
// ---------------------------------------------------------------------------
async function safeFetch(url, accept, timeoutMs = FETCH_TIMEOUT_MS) {
  let current = new URL(url)

  for (let hop = 0; hop < MAX_REDIRECTS + 1; hop += 1) {
    await checkUrlNotPrivate(current)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(current, {
        method: 'GET',
        headers: { Accept: accept },
        signal: controller.signal,
        redirect: 'manual',
      })

      const status = res.status
      if (status >= 300 && status < 400) {
        const location = res.headers.get('location')
        if (!location) {
          void res.body?.cancel?.()
          throw new Error('Redirect without a Location header')
        }
        void res.body?.cancel?.()
        current = new URL(location, current)
        continue
      }

      if (!res.ok) {
        void res.body?.cancel?.()
        throw new Error(`Upstream API responded with ${status}`)
      }

      const len = res.headers.get('content-length')
      if (len && Number(len) > MAX_BODY_SIZE) {
        void res.body?.cancel?.()
        throw new Error('Response too large')
      }

      const text = await res.text()
      if (text.length > MAX_BODY_SIZE) {
        throw new Error('Response too large')
      }
      return text
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error('Too many redirects')
}

async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const text = await safeFetch(url, 'application/json', timeoutMs)
  return JSON.parse(text)
}

// ---------------------------------------------------------------------------
// Search ORCID registry by author name
// Returns an array of { orcid, givenNames, familyNames, institutionNames }
// ---------------------------------------------------------------------------
export async function searchAuthors(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('Search query required')
  }

  const q = query.trim()

  // Build a fielded search when the query has "FirstName LastName" form,
  // otherwise do a free-text search.
  const parts = q.split(/\s+/)
  let solrQ
  if (parts.length >= 2) {
    const given = encodeURIComponent(parts.slice(0, -1).join(' '))
    const family = encodeURIComponent(parts[parts.length - 1])
    solrQ = `given-names:${given} AND family-name:${family}`
  } else {
    solrQ = q
  }

  const url = `${ORCID_PUB_API}/expanded-search/?q=${encodeURIComponent(solrQ)}&start=0&rows=20`
  const data = await fetchJson(url)

  const results = (data['expanded-result'] || []).map(r => ({
    orcid: r['orcid-id'],
    givenNames: r['given-names'] || '',
    familyNames: r['family-names'] || '',
    institutionNames: r['institution-name'] || [],
  }))

  return results
}

// ---------------------------------------------------------------------------
// Fetch the list of works (publications) for a given ORCID
// Returns simplified work summaries with title, year, DOI, type, putCode
// ---------------------------------------------------------------------------
export async function fetchWorks(orcid) {
  if (!isValidOrcid(orcid)) {
    throw new Error('Invalid ORCID identifier')
  }

  const url = `${ORCID_PUB_API}/${encodeURIComponent(orcid.trim())}/works`
  const data = await fetchJson(url)

  const works = []
  for (const group of data.group || []) {
    const summaries = group['work-summary'] || []
    if (summaries.length === 0) continue

    // Take the first (preferred) summary in each group
    const s = summaries[0]
    const title = s.title?.title?.value || ''
    const year = s['publication-date']?.year?.value || ''
    const type = s.type || ''
    const putCode = s['put-code']

    // Extract external identifiers (DOI, etc.)
    let doi = null
    const extIds = s['external-ids']?.['external-id'] || []
    for (const eid of extIds) {
      if (eid['external-id-type'] === 'doi' && eid['external-id-value']) {
        doi = eid['external-id-value']
        break
      }
    }

    works.push({ title, year, type, doi, putCode })
  }

  // Sort by year descending
  works.sort((a, b) => {
    const ya = parseInt(a.year, 10) || 0
    const yb = parseInt(b.year, 10) || 0
    return yb - ya
  })

  return works
}

// ---------------------------------------------------------------------------
// Fetch BibTeX for a specific work from ORCID.
//
// Strategy:
//  1. Fetch the full work record as JSON
//  2. If the record contains a citation of type "bibtex", use it directly
//  3. Otherwise, if there is a DOI, resolve it via doi.org content negotiation
//  4. Otherwise, construct a minimal BibTeX entry from the ORCID metadata
// ---------------------------------------------------------------------------
export async function fetchBibtexFromOrcid(orcid, putCode) {
  if (!isValidOrcid(orcid)) {
    throw new Error('Invalid ORCID identifier')
  }
  if (!putCode || !Number.isFinite(Number(putCode))) {
    throw new Error('Invalid put-code')
  }

  const url = `${ORCID_PUB_API}/${encodeURIComponent(orcid.trim())}/work/${encodeURIComponent(String(putCode))}`
  const data = await fetchJson(url)

  // --- 1. Try embedded BibTeX citation ---
  const citation = data.citation
  if (
    citation &&
    citation['citation-type'] === 'bibtex' &&
    citation['citation-value'] &&
    citation['citation-value'].trim().startsWith('@')
  ) {
    return citation['citation-value'].trim()
  }

  // --- 2. Try DOI-based fetch ---
  const extIds = data['external-ids']?.['external-id'] || []
  let doi = null
  for (const eid of extIds) {
    if (eid['external-id-type'] === 'doi' && eid['external-id-value']) {
      doi = eid['external-id-value']
      break
    }
  }

  if (doi) {
    try {
      const doiBibtex = await fetchBibtexFromDoiUrl(doi)
      if (doiBibtex) return doiBibtex
    } catch (err) {
      logger.warn({ err, doi, orcid, putCode }, 'DOI BibTeX fetch failed, falling back to metadata')
    }
  }

  // --- 3. Construct minimal BibTeX from ORCID metadata ---
  return buildBibtexFromOrcidWork(data, doi)
}

// ---------------------------------------------------------------------------
// Fetch BibTeX from doi.org using content negotiation
// ---------------------------------------------------------------------------
const DOI_BASE = 'https://doi.org'

async function fetchBibtexFromDoiUrl(doi) {
  // Only resolve DOIs that cannot encode a URL/localhost trickery in the
  // path; doi.org then redirects to the publisher's page.
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) {
    return null
  }
  const url = `${DOI_BASE}/${encodeURI(doi)}`
  const text = await safeFetch(
    url,
    'application/x-bibtex, text/x-bibtex, text/bibliography; style=bibtex'
  )
  if (text && text.trim().startsWith('@')) {
    return text.trim()
  }
  return null
}

// ---------------------------------------------------------------------------
// Build a minimal BibTeX entry from the work metadata returned by ORCID
// ---------------------------------------------------------------------------
export function buildBibtexFromOrcidWork(work, doi) {
  const title = work.title?.title?.value || 'Untitled'
  const year = work['publication-date']?.year?.value || ''
  const journal = work['journal-title']?.value || ''
  const type = work.type || 'misc'

  // Extract author names from contributors
  const contributors = work.contributors?.contributor || []
  const authors = contributors
    .map(c => c['credit-name']?.value)
    .filter(Boolean)
    .join(' and ')

  // Map ORCID work types to BibTeX entry types
  const typeMap = {
    'journal-article': 'article',
    'conference-paper': 'inproceedings',
    'book': 'book',
    'book-chapter': 'incollection',
    'dissertation': 'phdthesis',
    'report': 'techreport',
    'edited-book': 'book',
  }
  const bibType = typeMap[type] || 'misc'

  // Build a citation key from first author surname + year
  const firstAuthor = contributors[0]?.['credit-name']?.value || 'unknown'
  const surname = firstAuthor.split(/\s+/).pop().replace(/[^a-zA-Z]/g, '')
  const key = `${surname}${year || 'nd'}`.toLowerCase()

  let entry = `@${bibType}{${key},\n`
  if (authors) entry += `  author = {${authors}},\n`
  entry += `  title = {${title}},\n`
  if (year) entry += `  year = {${year}},\n`
  if (journal) entry += `  journal = {${journal}},\n`
  if (doi) entry += `  doi = {${doi}},\n`
  entry += `}\n`

  return entry
}
