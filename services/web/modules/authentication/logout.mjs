import { promisify } from 'node:util'

// Passport keeps session fields across login, but core serialization filters
// externalAuth out of the user. Clear the marker on local login as well.
export function rememberExternalAuth(req, res, user, callback) {
  if (user.externalAuth) {
    req.session.externalAuth = user.externalAuth
  } else {
    delete req.session.externalAuth
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
  if (req.user && externalAuth) {
    switch (externalAuth) {
      case 'saml': {
        const { default: SAMLAuthenticationController } = await import(
          './saml/app/src/SAMLAuthenticationController.mjs'
        )
        return SAMLAuthenticationController.passportLogout(req, res, next)
      }
      case 'oidc': {
        const { default: OIDCAuthenticationController } = await import(
          './oidc/app/src/OIDCAuthenticationController.mjs'
        )
        return OIDCAuthenticationController.passportLogout(req, res, next)
      }
      default:
        next()
    }
  } else {
    next()
  }
}
