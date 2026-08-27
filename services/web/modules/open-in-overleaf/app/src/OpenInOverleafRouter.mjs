import logger from '@overleaf/logger'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import OpenInOverleafController from './OpenInOverleafController.mjs'

// "Open in Overleaf" / Prefilled-Project API (documented at /devs). Reproduces
// the SaaS-only `/docs` endpoint on Ayakaleaf Pro.
//
//   GET  /docs   — link form (`/docs?snip_uri=…` / `?encoded_snip=…`). No Origin
//                  header on a top-level navigation, so it is never blocked by
//                  blockCrossOriginRequests, and requireLogin's postLoginRedirect
//                  carries the query params through a login round-trip.
//   POST /docs   — form/AJAX form. CSRF is disabled here (external submitters
//                  have no token). Cross-origin POSTs still need the submitting
//                  site's origin in Settings.allowedOrigins; same-origin (the
//                  /devs examples) always works.
//   GET  /devs   — public "Overleaf API" documentation page.

// Same budget as /project/new and /project/new/upload: every /docs hit is a
// project creation, usually with a remote download and an archive extraction.
const openInOverleafRateLimiter = new RateLimiter('open-in-overleaf', {
  points: 20,
  duration: 60,
})

export default {
  apply(webRouter) {
    logger.debug({}, 'Init open-in-overleaf router')

    // External sites post here without a CSRF token; exempt the route (the
    // csurf middleware still attaches req.csrfToken() for rendered forms).
    if (webRouter.csrf) {
      webRouter.csrf.disableDefaultCsrfProtection('/docs', 'POST')
    }

    webRouter.get(
      '/docs',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(openInOverleafRateLimiter),
      OpenInOverleafController.openInOverleaf
    )
    webRouter.post(
      '/docs',
      // Rate-limit first (by user id when logged in, otherwise by IP): a
      // signed-out submitter must not be able to park unlimited bodies in
      // redis via stashForLogin, which runs — and redirects — before requireLogin.
      RateLimiterMiddleware.rateLimit(openInOverleafRateLimiter),
      // Must run before requireLogin: it parks the POST body for signed-out
      // (or cross-site) submitters, which a login redirect would drop.
      OpenInOverleafController.stashForLogin,
      AuthenticationController.requireLogin(),
      OpenInOverleafController.openInOverleaf
    )

    webRouter.get('/devs', OpenInOverleafController.devsPage)
  },
}
