import logger from '@overleaf/logger'
import passport from 'passport'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AsyncFormHelper from '../../../../../app/src/Features/Helpers/AsyncFormHelper.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import HttpErrorHandler from '../../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import { endSession } from '../../../logout.mjs'
import { logLogout } from '../../../auditLog.mjs'
import { emailOnAnotherAccountInfo } from '../../../utils.mjs'
import ThirdPartyIdentityManager from '../../../../../app/src/Features/User/ThirdPartyIdentityManager.mjs'
import OIDCAuthenticationManager from './OIDCAuthenticationManager.mjs'

const siteUrl = () => Settings.siteUrl.replace(/\/+$/, '')

function strategyName(provider) {
  return `oidc:${provider.id}`
}

/**
 * All controller entry points are factories bound to one provider, so a
 * single set of routes (`/oidc/:providerId/...`) serves every configured
 * source.
 */
const OIDCAuthenticationController = {
  passportLogin(provider) {
    return (req, res, next) => {
      req.session.intent = req.query.intent
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
          if (req.session.intent === 'link') {
            delete req.session.intent
            // After linking, log out from the OIDC provider and redirect
            // back to '/user/settings'.
            // Keycloak supports this; Authentik does not (yet).
            const logoutUrl = provider.oidc.logoutUrl
            const redirectUri = `${siteUrl()}/user/settings`
            if (!logoutUrl) {
              return AsyncFormHelper.redirect(req, res, redirectUri)
            }
            return res.redirect(
              `${logoutUrl}?id_token_hint=${info?.idToken}&post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`
            )
          }
          if (user) {
            if (info?.idToken) {
              req.session.idToken = info.idToken
            }
            user.externalAuth = 'oidc'
            // remember which provider this session came from (logout dispatch)
            req.session.externalAuthProvider = provider.id
            AuthenticationController.setAuditInfo(req, {
              method: `OIDC login (${provider.id})`,
            })
            try {
              await AuthenticationController.promises.finishLogin(user, req, res)
            } catch (err) {
              return next(err)
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
   * Passport verify callback. The 10-arg form is the only one where
   * passport-openidconnect exposes the raw userinfo claims (uiProfile._json),
   * which non-standard admin claims and EduGAIN attributes live in.
   */
  doPassportLogin(provider) {
    return async function (
      req,
      issuer,
      uiProfile,
      idProfile,
      context,
      idToken,
      accessToken,
      refreshToken,
      params,
      done
    ) {
      const profile = { ...idProfile, ...uiProfile }
      let user, info
      try {
        if (req.session.intent === 'link') {
          ;({ user, info } = await OIDCAuthenticationController._doLink(
            req,
            profile,
            provider
          ))
        } else {
          ;({ user, info } = await OIDCAuthenticationController._doLogin(
            req,
            profile,
            provider
          ))
        }
      } catch (error) {
        return done(error)
      }
      if (user) {
        info = {
          ...(info || {}),
          idToken: idToken,
        }
      }
      return done(null, user, info)
    }
  },

  async _doLogin(req, profile, provider) {
    const { fromKnownDevice } = AuthenticationController.getAuditInfo(req)
    const auditLog = {
      ipAddress: req.ip,
      info: { method: `OIDC login (${provider.id})`, fromKnownDevice },
    }
    let result
    try {
      result = await OIDCAuthenticationManager.promises.findOrCreateUser(
        profile,
        provider,
        auditLog
      )
    } catch (error) {
      if (error instanceof Errors.EmailExistsError) {
        return { user: false, info: emailOnAnotherAccountInfo(req) }
      }
      logger.debug({ providerId: provider.id, err: error }, 'OIDC login failed')
      return {
        user: false,
        info: {
          type: 'error',
          text: error.message,
          status: 500,
        },
      }
    }
    const { user, accessDenied } = result
    if (user) {
      return { user, info: undefined }
    }
    if (accessDenied) {
      const email = profile?.emails?.[0]?.value
      logger.info(
        { providerId: provider.id, email, reason: accessDenied.reason },
        'OIDC login blocked by provider filter'
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

  async _doLink(req, profile, provider) {
    const { user: { _id: userId }, ip } = req
    try {
      const auditLog = {
        ipAddress: ip,
        initiatorId: userId,
      }
      await OIDCAuthenticationManager.promises.linkAccount(
        userId,
        profile,
        provider,
        auditLog
      )
    } catch (error) {
      logger.error(error.info, error.message)
      return {
        user: true,
        info: {
          type: 'error',
          text: error.message,
          status: 200,
        },
      }
    }
    return { user: true, info: undefined }
  },

  async unlinkAccount(req, res, next) {
    try {
      const { user: { _id: userId }, body: { providerId }, ip } = req
      const auditLog = {
        ipAddress: ip,
        initiatorId: userId,
      }
      await ThirdPartyIdentityManager.promises.unlink(userId, providerId, auditLog)
      return res.status(200).end()
    } catch (error) {
      logger.error(error.info, error.message)
      return res.status(500).json({
        user: false,
        info: {
          type: 'error',
          text: 'Can not unlink account',
          status: 500,
        }
      })
    }
  },

  passportLogout(provider) {
    return async (req, res, next) => {
      // TODO: instead of storing idToken in session, use refreshToken to obtain a new idToken?
      const idTokenHint = req.session.idToken
      logLogout(req)
      await endSession(req)
      const logoutUrl = provider.oidc.logoutUrl
      const redirectUri = siteUrl()
      if (!logoutUrl) {
        return AsyncFormHelper.redirect(req, res, redirectUri)
      }
      AsyncFormHelper.redirect(
        req,
        res,
        `${logoutUrl}?id_token_hint=${idTokenHint}&post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`
      )
    }
  },

  passportLogoutCallback(provider) {
    return (req, res, next) => {
      const redirectUri = siteUrl()
      res.redirect(redirectUri)
    }
  },
}

export default OIDCAuthenticationController
