import logger from '@overleaf/logger'
import passport from 'passport'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AsyncFormHelper from '../../../../../app/src/Features/Helpers/AsyncFormHelper.mjs'
import SAMLAuthenticationManager from './SAMLAuthenticationManager.mjs'
import { endSession } from '../../../logout.mjs'
import UserSessionsManager from '../../../../../app/src/Features/User/UserSessionsManager.mjs'
import { handleAuthenticateErrors } from '../../../../../app/src/Features/Authentication/AuthenticationErrors.mjs'
import { xmlResponse } from '../../../../../app/src/infrastructure/Response.mjs'
import { readFilesContentFromEnv } from '../../../utils.mjs'
import { logLogout } from '../../../auditLog.mjs'

function strategyName(provider) {
  return `saml:${provider.id}`
}

function getStrategy(provider) {
  return passport._strategy(strategyName(provider))
}

const SAMLAuthenticationController = {
  passportLogin(provider) {
    return (req, res, next) => {
      const strategy = getStrategy(provider)
      if (strategy?._saml?.options?.authnRequestBinding === 'HTTP-POST') {
        const csp = res.getHeader('Content-Security-Policy')
        if (csp) {
          res.setHeader(
            'Content-Security-Policy',
            csp.replace(/(?:^|\s)(default-src|form-action)[^;]*;?/g, '')
          )
        }
      }
      passport.authenticate(strategyName(provider))(req, res, next)
    }
  },

  passportLoginCallback(provider) {
    return (req, res, next) => {
      // This function is middleware which wraps the passport.authenticate middleware,
      // so we can send back our custom `{message: {text: "", type: ""}}` responses on failure,
      // and send a `{redir: ""}` response on success
      passport.authenticate(
        strategyName(provider),
        { keepSessionInfo: true },
        async function (err, user, info) {
          if (err) {
            return next(err)
          }
          if (user) {
            // `user` is either a user object or false
            AuthenticationController.setAuditInfo(req, {
              method: `SAML login (${provider.id})`,
            })
            try {
              await AuthenticationController.promises.finishLogin(user, req, res)
            } catch (err) {
              return next(err)
            }
          } else {
            if (info.redir != null) {
              return res.json({ redir: info.redir })
            } else {
              res.status(info.status || 401)
              delete info.status
              const body = { message: info }
              return res.json(body)
            }
          }
        }
      )(req, res, next)
    }
  },

  doPassportLogin(provider) {
    return async (req, profile, done) => {
      let user, info
      try {
        ;({ user, info } = await SAMLAuthenticationController._doPassportLogin(
          req,
          profile,
          provider
        ))
      } catch (error) {
        return done(error)
      }
      return done(undefined, user, info)
    }
  },

  async _doPassportLogin(req, profile, provider) {
    const { fromKnownDevice } = AuthenticationController.getAuditInfo(req)
    const auditLog = {
      ipAddress: req.ip,
      info: { method: `SAML login (${provider.id})`, fromKnownDevice },
    }
    let result
    try {
      result = await SAMLAuthenticationManager.promises.findOrCreateUser(
        profile,
        provider,
        auditLog
      )
    } catch (error) {
      return {
        user: false,
        info: handleAuthenticateErrors(error, req),
      }
    }
    const { user, accessDenied } = result
    if (user) {
      user.externalAuth = 'saml'
      // remember which IdP this session came from (logout dispatch)
      req.session.externalAuthProvider = provider.id
      req.session.saml_extce = {
        providerId: provider.id,
        nameID: profile.nameID,
        sessionIndex: profile.sessionIndex,
      }
      return { user, info: undefined }
    }
    if (accessDenied) {
      const email = profile?.mail
      logger.info(
        { providerId: provider.id, email, reason: accessDenied.reason },
        'SAML login blocked by provider filter'
      )
      return {
        user: false,
        info: {
          type: 'error',
          text:
            'Your account was not allowed to log in with this SSO provider. ' +
            'If this is a mistake, contact your administrator.',
          status: 401,
        },
      }
    }
    logger.debug({ email: profile?.mail }, 'failed SAML log in')
    return {
      user: false,
      info: {
        type: 'error',
        text: 'Unknown error',
        status: 500,
      },
    }
  },

  passportLogout(provider) {
    return (req, res, next) => {
      getStrategy(provider).logout(req, async (err, url) => {
        logLogout(req)
        await endSession(req)
        if (err) return next(err)
        AsyncFormHelper.redirect(req, res, url)
      })
    }
  },

  passportLogoutCallback(provider) {
    return (req, res, next) => {
      // TODO: is it possible to close the editor?
      passport.authenticate(strategyName(provider))(req, res, (err) => {
        if (err) return next(err)
        res.redirect('/login');
      })
    }
  },

  doPassportLogout(provider) {
    return async (req, profile, done) => {
      let user, info
      try {
        ;({ user, info } = await SAMLAuthenticationController._doPassportLogout(
          req,
          profile,
          provider
        ))
      } catch (error) {
        return done(error)
      }
      return done(undefined, user, info)
    }
  },

  async _doPassportLogout(req, profile, provider) {
    const extce = req?.session?.saml_extce || {}
    const fromSameIdP =
      extce.nameID === profile.nameID &&
      extce.sessionIndex === profile.sessionIndex &&
      // old sessions (pre multi-IdP) have no providerId recorded
      (extce.providerId === undefined || extce.providerId === provider.id)
    if (fromSameIdP) {
      profile = req.user
      // the IdP ends this session; a logout started here ended it already
      logLogout(req)
    }
    await UserSessionsManager.promises.untrackSession(req.user, req.sessionID).catch(err => {
      logger.warn({ err, userId: req.user._id }, 'failed to untrack session')
    })
    return { user: profile, info: undefined }
  },

  getSPMetadata(provider) {
    return (req, res) => {
      const strategy = getStrategy(provider)
      const issuer = strategy._saml.options.issuer
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${issuer || provider.id}-meta.xml"`
      )
      // per-provider decryption cert if configured, else the legacy env ones
      const cert =
        provider.saml.decryptionPvk?.[0] ||
        readFilesContentFromEnv(process.env.OVERLEAF_SAML_DECRYPTION_CERT)
      const key =
        provider.saml.privateKey?.[0] ||
        readFilesContentFromEnv(process.env.OVERLEAF_SAML_PUBLIC_CERT)
      xmlResponse(
        res,
        strategy.generateServiceProviderMetadata(cert, key)
      )
    }
  },
}

export default SAMLAuthenticationController
