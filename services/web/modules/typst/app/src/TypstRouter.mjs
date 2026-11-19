// @ts-check
// Typst module routes.

import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import TypstProjectController from './TypstProjectController.mjs'

export default {
  apply(webRouter) {
    // Create a Typst project (compiler 'typst') from one of the bundled
    // dependency-free templates. Mirrors the TeX /project/new shape (auth +
    // CSRF are applied by the web router; rate limiting is applied there for
    // the TeX route and can be extended to this one in router.mjs if needed).
    webRouter.post(
      '/project/new/typst',
      AuthenticationController.requireLogin(),
      TypstProjectController.newTypstProject
    )
  },
}
