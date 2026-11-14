import logger from '@overleaf/logger'
import passport from 'passport'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import HttpErrorHandler from '../../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import { endSession } from '../../../logout.mjs'
import { emailOnAnotherAccountInfo } from '../../../utils.mjs'
import OAuth2AuthenticationManager from './OAuth2AuthenticationManager.mjs'
function strategyName(provider) {
  return `oauth2:${provider.id}`
}
/**
 * All controller entry points are factories bound to one provider, so a
 * single set of routes (`/oauth2/:providerId/...`) serves every configured
 * source.
 */
const OAuth2AuthenticationController = {
  passportLogin(provider) {
    return (req, res, next) => {
      passport.authenticate(strategyName(provider))(req, res, next)
    }
  },
  passportLoginCallback(provider) {
    return (req, res, next) => {
      passport.authenticate(
        strategyName(provider),
        { keepSessionInfo: true },
        async function (err, user, info) {
          if (err) {
            return next(err)
          }
          if (user) {
            user.externalAuth = 'oauth2'
            // remember which provider this session came from (logout dispatch)
            req.session.externalAuthProvider = provider.id
            AuthenticationController.setAuditInfo(req, {
              method: `OAuth2 login (${provider.id})`,
            })
            try {
              await AuthenticationController.promises.finishLogin(user, req, res)
            } catch (error) {
              return next(error)
            }
          } else {
            if (info.redir != null) {
              await endSession(req)
              return res.redirect(info.redir)
            } else if (info.status === 409) {
              return HttpErrorHandler.conflict(req, res, info.text)
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
  /**
   * Passport verify callback. The 5-arg form (passReqToCallback) exposes
   * the access token, so the profile is fetched by the strategy's
   * `profileURL` handler.
   */
  doPassportLogin(provider) {
    return async (req, accessToken, refreshToken, profile, done) => {
      let user, info
      try {
        ;({ user, info } =
          await OAuth2AuthenticationController._doLogin(req, profile, provider))
      } catch (error) {
        return done(error)
      }
      return done(null, user, info)
    }
  },
  async _doLogin(req, profile, provider) {
    const { fromKnownDevice } = AuthenticationController.getAuditInfo(req)
    const auditLog = {
      ipAddress: req.ip,
      info: { method: `OAuth2 login (${provider.id})`, fromKnownDevice },
    }
    let result
    try {
      result =
        await OAuth2AuthenticationManager.promises.findOrCreateUser(profile, provider, auditLog)
    } catch (error) {
      if (error instanceof Errors.EmailExistsError) {
        return { user: false, info: emailOnAnotherAccountInfo(req) }
      }
      logger.debug({ providerId: provider.id, err: error }, 'OAuth2 login failed')
      return {
        user: false,
        info: {
          type: 'error',
          text: error.message,
          status: 500,
        },
      }
    }
    const { user, accessDenied, linkOnlyRefused } = result
    if (user) {
      return { user, info: undefined }
    }
    if (linkOnlyRefused) {
      const text = req.i18n
        ? req.i18n.translate('register_intercept_sso', {
            authProviderName: provider.name,
          })
        : `You can link your ${provider.name} account from the Account settings page after logging in.`
      return {
        user: false,
        info: {
          type: 'error',
          key: 'register_intercept_sso',
          text,
          status: 403,
          redir: `/login?sso_error=not_linked&provider=${encodeURIComponent(
            provider.name
          )}`,
        },
      }
    }
    if (accessDenied) {
      logger.info(
        { providerId: provider.id, reason: accessDenied.reason },
        'OAuth2 login blocked by provider filter'
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
    return {
      user: false,
      info: {
        type: 'error',
        text: 'SSO profile is missing an identity',
        status: 401,
      },
    }
  },
}
export default OAuth2AuthenticationController
