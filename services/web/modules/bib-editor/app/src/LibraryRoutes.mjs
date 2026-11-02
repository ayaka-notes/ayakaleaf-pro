/**
 * Library routes (module `router` interface — registered by the web app at
 * boot, LIBRARY_PLAN.md §4). All endpoints are session-scoped: the user id
 * always comes from the session (never from the request body).
 *
 * Route order: the concrete `/library/references/<verb>` paths are declared
 * BEFORE the `/library/references/:key` PATCH (Express matches in
 * registration order).
 */
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AsyncLocalStorage from '../../../../app/src/infrastructure/AsyncLocalStorage.mjs'
import PermissionsController from '../../../../app/src/Features/Authorization/PermissionsController.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import LibraryController from './LibraryController.mjs'

const rateLimiterPage = new RateLimiter('bib-library-page', {
  points: 60,
  duration: 60,
})
const rateLimiterApi = new RateLimiter('bib-library-api', {
  points: 120,
  duration: 60,
})
const rateLimiterWrites = new RateLimiter('bib-library-writes', {
  points: 60,
  duration: 60,
})

export default {
  apply(webRouter) {
    // ── Pages ─────────────────────────────────────────────────────────
    webRouter.get(
      '/library',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterPage),
      AsyncLocalStorage.middleware,
      PermissionsController.useCapabilities(),
      LibraryController.libraryPage
    )
    webRouter.get(
      '/library/trashed',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterPage),
      AsyncLocalStorage.middleware,
      PermissionsController.useCapabilities(),
      LibraryController.libraryTrashPage
    )

    // ── API (SaaS surface, LIBRARY_PLAN.md §1.1) ───────────────────────
    webRouter.get(
      '/library/references',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterApi),
      LibraryController.listReferences
    )
    webRouter.post(
      '/library/references',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      LibraryController.createReferences
    )
    webRouter.post(
      '/library/references/match',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterApi),
      LibraryController.matchReferences
    )
    webRouter.get(
      '/library/references/count',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterApi),
      LibraryController.countReferences
    )
    webRouter.get(
      '/library/references/download',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterApi),
      LibraryController.downloadReferences
    )
    webRouter.get(
      '/library/references/citation-key-suggestions',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterApi),
      LibraryController.citationKeySuggestions
    )
    webRouter.post(
      '/library/references/delete',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      LibraryController.deleteReferences
    )
    webRouter.post(
      '/library/references/restore',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      LibraryController.restoreReferences
    )
    // `:key` last (after every concrete path above).
    webRouter.patch(
      '/library/references/:key',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiterWrites),
      LibraryController.updateReference
    )
  },
}
