let oauth2Module = {}
// The module is always active so the /oauth2/<id>/... routes exist; enabled
// providers come from the provider store (JSON file or the admin UI).
// With no providers the routes answer 404 and no login buttons are shown.
{
  const { default: OAuth2ModuleManager } = await import('./app/src/OAuth2ModuleManager.mjs')
  const { default: router } = await import('./app/src/OAuth2Router.mjs')
  OAuth2ModuleManager.initSettings()
  oauth2Module = {
    name: 'oauth2-authentication',
    hooks: {
      passportSetup: OAuth2ModuleManager.passportSetup,
    },
    router: router,
  }
}
export default oauth2Module
