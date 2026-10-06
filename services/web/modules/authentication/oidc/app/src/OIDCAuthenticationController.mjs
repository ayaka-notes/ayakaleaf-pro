import logger from '@overleaf/logger'
import passport from 'passport'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AsyncFormHelper from '../../../../../app/src/Features/Helpers/AsyncFormHelper.mjs'
import { endSession } from '../../../logout.mjs'
import ThirdPartyIdentityManager from '../../../../../app/src/Features/User/ThirdPartyIdentityManager.mjs'
import OIDCAuthenticationManager from './OIDCAuthenticationManager.mjs'

const OIDCAuthenticationController = {
  passportLogin(req, res, next) {
    req.session.intent = req.query.intent
    passport.authenticate('openidconnect')(req, res, next)
  },
  passportLoginCallback(req, res, next) {
    passport.authenticate(
      'openidconnect',
      { keepSessionInfo: true },
      async function (err, user, info) {
        if (err) {
          return next(err)
        }
        if(req.session.intent === 'link') {
          delete req.session.intent
// After linking, log out from the OIDC provider and redirect back to '/user/settings'.
// Keycloak supports this; Authentik does not (yet).
          const logoutUrl = process.env.OVERLEAF_OIDC_LOGOUT_URL
          const redirectUri = `${Settings.siteUrl.replace(/\/+$/, '')}/user/settings`
          return res.redirect(`${logoutUrl}?id_token_hint=${info.idToken}&post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`)
	}
        if (user) {
          req.session.idToken = info.idToken
          user.externalAuth = 'oidc'
          // `user` is either a user object or false
          AuthenticationController.setAuditInfo(req, {
            method: 'OIDC login',
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
          } else {
            res.status(info.status || 401)
            delete info.status
            const body = { message: info }
            return res.json(body)
          }
        }
      }
    )(req, res, next)
  },
  async doPassportLogin(req, issuer, uiProfile, idProfile, context, idToken, accessToken, refreshToken, params, done) {
    // The 10-arg form is the only one where passport-openidconnect exposes the raw
    // userinfo claims (uiProfile._json), which non-standard admin claims live in
    const profile = { ...idProfile, ...uiProfile }
    let user, info
    try {
      if(req.session.intent === 'link') {
        ;({ user, info } = await OIDCAuthenticationController._doLink(
          req,
          profile
        ))
      } else {
        ;({ user, info } = await OIDCAuthenticationController._doLogin(
          req,
          profile
        ))
      }
    } catch (error) {
      return done(error)
    }
    if (user) {
      info = {
        ...(info || {}),
        idToken: idToken
      }
    }
    return done(null, user, info)
  },
  async _doLogin(req, profile) {
    const { fromKnownDevice } = AuthenticationController.getAuditInfo(req)
    const auditLog = {
      ipAddress: req.ip,
      info: { method: 'OIDC login', fromKnownDevice },
    }

    let user
    try {
      user = await OIDCAuthenticationManager.promises.findOrCreateUser(profile, auditLog)
    } catch (error) {
      logger.debug({ email : profile.emails[0].value }, `OIDC login failed: ${error}`)
      return {
        user: false,
        info: {
          type: 'error',
          text: error.message,
          status: 500,
        },
      }
    }
    if (user) {
      return { user, info: undefined }
    } else { // user account is not created
      logger.debug({ email : profile.emails[0].value }, 'OIDC JIT account creation is not allowed for this email')
      return {
        user: false,
        info: {
          redir: '/register',
          status: 401,
        },
      }
    }
  },
  async _doLink(req, profile) {
    const { user: { _id: userId }, ip } = req
    try {
      const auditLog = {
        ipAddress: ip,
        initiatorId: userId,
      }
      await OIDCAuthenticationManager.promises.linkAccount(userId, profile, auditLog)
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
  async passportLogout(req, res, next) {
// TODO: instead of storing idToken in session, use refreshToken to obtain a new idToken?
    const idTokenHint = req.session.idToken
    await endSession(req)
    const logoutUrl = process.env.OVERLEAF_OIDC_LOGOUT_URL
    const redirectUri = Settings.siteUrl
    AsyncFormHelper.redirect(req, res, `${logoutUrl}?id_token_hint=${idTokenHint}&post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`)
  },
  passportLogoutCallback(req, res, next) {
    const redirectUri = Settings.siteUrl
    res.redirect(redirectUri)
  },
}
export default OIDCAuthenticationController
