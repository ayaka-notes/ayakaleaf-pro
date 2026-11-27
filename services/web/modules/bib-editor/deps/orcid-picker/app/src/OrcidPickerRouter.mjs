import logger from '@overleaf/logger'
import AuthenticationController from '../../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { expressify } from '@overleaf/promise-utils'
import { searchAuthors, fetchWorks, fetchBibtexFromOrcid, isValidOrcid } from './OrcidService.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init orcid-picker router')

    // Search the ORCID registry by author name
    webRouter.get(
      '/orcid-picker/search',
      AuthenticationController.requireLogin(),
      expressify(async (req, res) => {
        const q = req.query.q
        if (!q || typeof q !== 'string' || !q.trim()) {
          return res.status(400).json({ error: 'q query parameter required' })
        }

        try {
          const results = await searchAuthors(q)
          res.json({ results })
        } catch (err) {
          logger.warn({ err, q }, 'ORCID search failed')
          res.status(502).json({ error: err?.message || 'ORCID search failed' })
        }
      })
    )

    // Fetch list of works for an ORCID
    webRouter.get(
      '/orcid-picker/works',
      AuthenticationController.requireLogin(),
      expressify(async (req, res) => {
        const orcid = req.query.orcid
        if (!orcid || typeof orcid !== 'string') {
          return res.status(400).json({ error: 'orcid query parameter required' })
        }

        if (!isValidOrcid(orcid)) {
          return res.status(400).json({ error: 'Invalid ORCID identifier' })
        }

        try {
          const works = await fetchWorks(orcid)
          res.json({ works })
        } catch (err) {
          logger.warn({ err, orcid }, 'Failed to fetch ORCID works')
          res
            .status(502)
            .json({ error: err?.message || 'Failed to fetch works' })
        }
      })
    )

    // Fetch BibTeX for a single work directly from ORCID (by put-code)
    webRouter.get(
      '/orcid-picker/fetch-bib',
      AuthenticationController.requireLogin(),
      expressify(async (req, res) => {
        const orcid = req.query.orcid
        const putCode = req.query.putCode

        if (!orcid || typeof orcid !== 'string') {
          return res.status(400).json({ error: 'orcid query parameter required' })
        }
        if (!isValidOrcid(orcid)) {
          return res.status(400).json({ error: 'Invalid ORCID identifier' })
        }
        if (!putCode || !Number.isFinite(Number(putCode))) {
          return res.status(400).json({ error: 'putCode query parameter required' })
        }

        try {
          const bibtex = await fetchBibtexFromOrcid(orcid, putCode)
          res.json({ bibtex })
        } catch (err) {
          logger.warn({ err, orcid, putCode }, 'Failed to fetch BibTeX from ORCID')
          res
            .status(502)
            .json({ error: err?.message || 'Failed to fetch BibTeX' })
        }
      })
    )
  },
}
