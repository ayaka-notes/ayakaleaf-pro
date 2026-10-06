import { rememberExternalAuth } from '../logout.mjs'
let samlModule = {}
if (process.env.EXTERNAL_AUTH?.includes('saml')) {
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
