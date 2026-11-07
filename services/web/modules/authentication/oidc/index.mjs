import { rememberExternalAuth } from '../logout.mjs'
let oidcModule = {}
if (process.env.EXTERNAL_AUTH?.includes('oidc')) {
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
