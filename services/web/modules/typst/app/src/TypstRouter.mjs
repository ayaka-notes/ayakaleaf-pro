// @ts-check
// Typst module routes.

import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import TypstProjectController from './TypstProjectController.mjs'

// Same limiter name and options as the `createProject` limiter in
// app/src/router.mjs: RateLimiter keys its Redis counters by name
// (rate-limit:create-project), so /project/new/typst and /project/new
// share one project-creation budget.
const createProject = new RateLimiter('create-project', {
  points: 20,
  duration: 60,
})

export default {
  apply(webRouter) {
    // Create a Typst project (compiler 'typst') from one of the bundled
    // dependency-free templates. Mirrors the TeX /project/new shape
    // (auth + CSRF are applied by the web router, and the same
    // create-project rate limit is applied here).
    webRouter.post(
      '/project/new/typst',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(createProject),
      TypstProjectController.newTypstProject
    )
  },
}
