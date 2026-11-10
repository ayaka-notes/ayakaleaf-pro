import { rememberExternalAuth } from '../logout.mjs'
import { store } from '../providers/index.mjs'

let samlModule = {}
// The module is always active so the /saml/<id>/... routes exist; enabled
// IdPs come from the provider store (JSON file, legacy env vars, or the
// admin UI). With no IdPs the routes answer 404 and no login buttons are
// shown.
{
  const { default: SAMLModuleManager } = await import('./app/src/SAMLModuleManager.mjs')
  const { default: router } = await import('./app/src/SAMLRouter.mjs')
  const { default: nonCsrfRouter } = await import('./app/src/SAMLNonCsrfRouter.mjs')
  SAMLModuleManager.initSettings()
  SAMLModuleManager.initPolicy()
  samlModule = {
    name: 'saml-authentication',
    hooks: {
      preFinishLogin: rememberExternalAuth,
      passportSetup: SAMLModuleManager.passportSetup,
      getGroupPolicyForUser: SAMLModuleManager.getGroupPolicyForUser,
    },
    router: router,
    nonCsrfRouter: nonCsrfRouter,
  }
}
export default samlModule
