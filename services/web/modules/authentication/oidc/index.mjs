import { rememberExternalAuth } from '../logout.mjs'
import { store } from '../providers/index.mjs'

let oidcModule = {}
// The module is always active so the /oidc/<id>/... routes exist; enabled
// providers come from the provider store (JSON file, legacy env vars, or the
// admin UI). With no providers the routes answer 404 and no login buttons
// are shown.
{
  const { default: OIDCModuleManager } = await import('./app/src/OIDCModuleManager.mjs')
  const { default: router } = await import('./app/src/OIDCRouter.mjs')
  OIDCModuleManager.initSettings()
  OIDCModuleManager.initPolicy()
  oidcModule = {
    name: 'oidc-authentication',
    hooks: {
      preFinishLogin: rememberExternalAuth,
      passportSetup: OIDCModuleManager.passportSetup,
      getGroupPolicyForUser: OIDCModuleManager.getGroupPolicyForUser,
    },
    router: router,
  }
}
export default oidcModule
