import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import crypto from 'node:crypto'
import SessionManager from '../../../../../../app/src/Features/Authentication/SessionManager.mjs'
import HttpErrorHandler from '../../../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import * as Api from './MendeleyApiClient.mjs'

// ---------------------------------------------------------------------------
// OAuth link flow
// ---------------------------------------------------------------------------

async function oauth(req, res) {
  try {
    Api.assertMendeleyConfigured()
    const state = crypto.randomBytes(16).toString('hex')
    const isPopup = req.query.popup === '1'
    req.session.mendeleyOAuth = { state, isPopup }
    res.redirect(Api.getMendeleyAuthorizeUrl(state))
  } catch (err) {
    const info = OError.getFullInfo(err)
    if (info?.status === 403) {
      res.setHeader('Content-Type', 'application/json')
      return res.status(403).send('Mendeley is disabled on this site')
    }
    logger.error(OError.getFullStack(err))
    HttpErrorHandler.badRequest(req, res, 'Failed to start Mendeley authorization')
  }
}

async function oauthCallback(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const { code, state } = req.query
  const saved = req.session.mendeleyOAuth
  delete req.session.mendeleyOAuth

  if (!saved || !code || !state || saved.state !== state) {
    HttpErrorHandler.forbidden(req, res, 'Invalid Mendeley OAuth state')
    return
  }

  try {
    const creds = await Api.exchangeMendeleyCode(code)
    await Api.storeMendeleyCredentials(userId, creds)
  } catch (err) {
    logger.error(OError.getFullStack(err))
    logger.error({ info: OError.getFullInfo(err) }, 'Failed to exchange Mendeley code')
    HttpErrorHandler.badRequest(req, res, 'Failed to link Mendeley account')
    return
  }

  const nonce = crypto.randomBytes(16).toString('base64')
  const csp = res.getHeader('Content-Security-Policy')
  res.setHeader('Content-Security-Policy', `${csp}; script-src 'nonce-${nonce}'`)
  res.send(`
    <!doctype html>
    <html>
      <body>
        <script nonce="${nonce}">
          const channel = new BroadcastChannel('mendeley')
          channel.postMessage({ type: 'mendeley-linked' })
          ${saved.isPopup
            ? 'window.close()'
            : "location.href = '/user/settings#references'"}
        </script>
      </body>
    </html>
  `)
}

// ---------------------------------------------------------------------------
// status / unlink
// ---------------------------------------------------------------------------

async function getConnectionStatus(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const configured = Api.isMendeleyConfigured()
  let connected = false
  if (configured) {
    try {
      connected = await Api.isMendeleyConnected(userId)
    } catch {
      connected = false
    }
  }
  res.json({ configured, connected })
}

async function unlink(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  try {
    await Api.unlinkMendeley(userId)
    res.sendStatus(200)
  } catch (err) {
    const info = OError.getFullInfo(err)
    logger.error({ info }, 'error unlinking Mendeley account')
    res.status(info?.status || 500).json({ message: err.message })
  }
}

// ---------------------------------------------------------------------------
// Picker (login-required; 404/403 → 409 "mendeley_not_linked" like zotero)
// ---------------------------------------------------------------------------

function _pickerError(req, res, err) {
  const info = OError.getFullInfo(err)
  if (info?.status === 404 || info?.status === 403) {
    return res.status(409).json({ message: 'mendeley_not_linked' })
  }
  const status = info?.status || 500
  logger.error({ err, info }, 'mendeley picker request failed')
  res.status(status).json({ message: err.message })
}

async function getPickerLibraries(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  let groups
  try {
    groups = await Api.getMendeleyGroups(userId)
  } catch (err) {
    return _pickerError(req, res, err)
  }
  if (groups === null) {
    return res.status(409).json({ message: 'mendeley_not_linked' })
  }
  res.json([
    { id: '', kind: 'user', name: 'My Library' },
    ...groups.map(g => ({ id: g.id, kind: 'group', name: g.name })),
  ])
}

/** GET /user/mendeley/picker/documents?... → { items, next } */
async function getPickerDocuments(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const scope = {
    groupId: req.query.libraryKind === 'group' ? String(req.query.library || '') : '',
  }
  try {
    const result = await Api.getMendeleyDocuments(userId, {
      ...scope,
      query: String(req.query.query || ''),
      cursor: String(req.query.cursor || ''),
      limit: req.query.limit,
    })
    res.json({
      items: result.items.map(normDoc),
      next: result.next || null,
    })
  } catch (err) {
    _pickerError(req, res, err)
  }
}

function normDoc(doc) {
  const title = doc?.title || ''
  const authors = Array.isArray(doc?.authors)
    ? doc.authors.map(a => (typeof a === 'string' ? a : a?.name || '')).filter(Boolean)
    : typeof doc?.authors === 'string'
      ? [doc.authors]
      : []
  return {
    key: String(doc?.id || doc?.key || ''),
    title,
    type: String(doc?.type || ''),
    year: doc?.year != null ? String(doc.year) : '',
    firstCreator: authors[0] || '',
    venue:
      doc?.journal?.name || doc?.conference?.name || doc?.bookTitle || doc?.thesisInstitution || '',
  }
}

/** GET /user/mendeley/picker/bibtex?ids=… → { bibtex } */
async function getPickerBibtex(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const ids = String(req.query.ids || '')
    .split(',')
    .map(s => decodeURIComponent(s.trim()))
    .filter(Boolean)
  if (!ids.length) {
    return res.status(400).json({ message: 'no items selected' })
  }
  const parts = []
  const failed = []
  for (let i = 0; i < ids.length; i++) {
    if (i) await new Promise(r => setTimeout(r, 120))
    try {
      const bib = await Api.getMendeleyDocumentBibtex(userId, ids[i])
      if (bib) parts.push(bib)
      else failed.push(ids[i])
    } catch (err) {
      failed.push(ids[i])
      const status = OError.getFullInfo(err)?.status
      if (status === 404 || status === 403) {
        // Token rejected — everything else will fail the same way.
        return _pickerError(req, res, err)
      }
      logger.warn(
        { id: ids[i], err: err?.message },
        'mendeley: bibtex for one selected item failed, continuing',
      )
    }
  }
  if (!parts.length) {
    return res.status(400).json({
      message:
        'Selected items could not be resolved in Mendeley (they may have been deleted). Try again, or pick different items.',
    })
  }
  res.json({ bibtex: parts.join('\n') })
}

export default {
  oauth,
  oauthCallback,
  getConnectionStatus,
  unlink,
  getPickerLibraries,
  getPickerDocuments,
  getPickerBibtex,
}
