import { promisify } from 'node:util'
import { store } from './providers/index.mjs'

// Passport keeps session fields across login, but core serialization filters
// externalAuth out of the user. Clear the marker on local login as well.
export function rememberExternalAuth(req, res, user, callback) {
  if (user.externalAuth) {
    req.session.externalAuth = user.externalAuth
    if (req.session.externalAuthProvider) {
      user.externalAuthProvider = req.session.externalAuthProvider
    }
  } else {
    delete req.session.externalAuth
    delete req.session.externalAuthProvider
  }
  callback()
}

// Local logout for SSO flows via the public passport/session primitives
// (core UserController.doLogout is private and not exported).
export async function endSession(req) {
  if (typeof req.logout === 'function') {
    await promisify(req.logout.bind(req))()
  }
  await promisify(req.session.destroy.bind(req.session))()
}

// logout is a router dispatcher that will call the appropriate
// SSO logout flow if the user is logged in via SSO,
// otherwise it calls next() to continue local logout flow.
export default async function logout(req, res, next) {
  const externalAuth = req.session?.externalAuth || req.user?.externalAuth
  if (req.user && externalAuth && (externalAuth === 'saml' || externalAuth === 'oidc')) {
    // the provider this session logged in with (set at login time)
    const providerId = req.session?.externalAuthProvider || req.user?.externalAuthProvider
    let provider = providerId ? store.get(providerId) : null
    if (!provider || provider.type !== externalAuth) {
      // fall back to the first enabled provider of that type
      provider = store.firstOfType(externalAuth)
    }
    if (provider) {
      if (externalAuth === 'saml') {
        const { default: SAMLAuthenticationController } = await import(
          './saml/app/src/SAMLAuthenticationController.mjs'
        )
        return SAMLAuthenticationController.passportLogout(provider)(req, res, next)
      }
      const { default: OIDCAuthenticationController } = await import(
        './oidc/app/src/OIDCAuthenticationController.mjs'
      )
      return OIDCAuthenticationController.passportLogout(provider)(req, res, next)
    }
  }
  next()
}
