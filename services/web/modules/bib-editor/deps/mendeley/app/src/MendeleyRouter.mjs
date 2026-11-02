import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import MendeleyController from './MendeleyController.mjs'

// Gating: like the vendored zotero router, enablement is the env-secret gate
// (MENDELEY_CLIENT_ID + MENDELEY_CLIENT_SECRET, seeded into Settings.mendeley
// at module boot in modules/bib-editor/index.mjs). Without both, the
// connector is off: routes 403, and the frontend hides the menu entries
// via GET /bib/services.
function ensureMendeleyEnabled(req, res, next) {
  const m = Settings.mendeley
  if (m && m.enabled !== false && (m.clientID || m.clientId) && m.clientSecret) {
    return next()
  }
  logger.info({}, 'mendeley: rejected — connector not configured')
  return res.status(403).send('Mendeley is disabled on this site')
}

export default {
  apply(webRouter) {
    // Link status + unlink
    webRouter.get(
      '/user/mendeley/status',
      AuthenticationController.requireLogin(),
      MendeleyController.getConnectionStatus
    )
    webRouter.delete(
      '/user/mendeley',
      AuthenticationController.requireLogin(),
      MendeleyController.unlink
    )

    // OAuth flow (callback does not pass the configured-gate: a started
    // flow must be completable even if config is revoked mid-flow)
    webRouter.get(
      '/user/mendeley/oauth',
      AuthenticationController.requireLogin(),
      ensureMendeleyEnabled,
      MendeleyController.oauth
    )
    webRouter.get(
      '/user/mendeley/oauth/callback',
      AuthenticationController.requireLogin(),
      MendeleyController.oauthCallback
    )

    // Picker: the user's Mendeley libraries + documents + BibTeX
    webRouter.get(
      '/user/mendeley/picker/libraries',
      AuthenticationController.requireLogin(),
      ensureMendeleyEnabled,
      MendeleyController.getPickerLibraries
    )
    webRouter.get(
      '/user/mendeley/picker/documents',
      AuthenticationController.requireLogin(),
      ensureMendeleyEnabled,
      MendeleyController.getPickerDocuments
    )
    webRouter.get(
      '/user/mendeley/picker/bibtex',
      AuthenticationController.requireLogin(),
      ensureMendeleyEnabled,
      MendeleyController.getPickerBibtex
    )
  },
}
