import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import passport from 'passport'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AsyncFormHelper from '../../../../../app/src/Features/Helpers/AsyncFormHelper.mjs'
import SAMLAuthenticationManager from './SAMLAuthenticationManager.mjs'
import { endSession } from '../../../logout.mjs'
import UserSessionsManager from '../../../../../app/src/Features/User/UserSessionsManager.mjs'
import { handleAuthenticateErrors } from '../../../../../app/src/Features/Authentication/AuthenticationErrors.mjs'
import { xmlResponse } from '../../../../../app/src/infrastructure/Response.mjs'
import { readFilesContentFromEnv } from '../../../utils.mjs'

const SAMLAuthenticationController = {
  passportLogin(req, res, next) {
    if ( passport._strategy('saml')._saml.options.authnRequestBinding === 'HTTP-POST') {
      const csp = res.getHeader('Content-Security-Policy')
      if (csp) {
        res.setHeader(
          'Content-Security-Policy',
          csp.replace(/(?:^|\s)(default-src|form-action)[^;]*;?/g, '')
        )
      }
    }
    passport.authenticate('saml')(req, res, next)
  },
  passportLoginCallback(req, res, next) {
    // This function is middleware which wraps the passport.authenticate middleware,
    // so we can send back our custom `{message: {text: "", type: ""}}` responses on failure,
    // and send a `{redir: ""}` response on success
    passport.authenticate(
      'saml',
      { keepSessionInfo: true },
      async function (err, user, info) {
        if (err) {
          return next(err)
        }
        if (user) {
          // `user` is either a user object or false
          AuthenticationController.setAuditInfo(req, {
            method: 'SAML login',
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
  },
  async doPassportLogin(req, profile, done) {
    let user, info
    try {
      ;({ user, info } = await SAMLAuthenticationController._doPassportLogin(
        req,
        profile
      ))
    } catch (error) {
      return done(error)
    }
    return done(undefined, user, info)
  },
  async _doPassportLogin(req, profile) {
    const { fromKnownDevice } = AuthenticationController.getAuditInfo(req)
    const auditLog = {
      ipAddress: req.ip,
      info: { method: 'SAML login', fromKnownDevice },
    }

    let user
    try {
      user = await SAMLAuthenticationManager.promises.findOrCreateUser(profile, auditLog)
    } catch (error) {
      return {
        user: false,
        info: handleAuthenticateErrors(error, req),
      }
    }
    if (user) {
      user.externalAuth = 'saml'
      req.session.saml_extce = {nameID : profile.nameID, sessionIndex : profile.sessionIndex}
      return { user, info: undefined }
    } else { // we cannot be here, something is terribly wrong
      logger.debug({ email : profile.mail }, 'failed SAML log in')
      return {
        user: false,
        info: {
          type: 'error',
          text: 'Unknown error',
          status: 500,
        },
      }
    }
  },
  async passportLogout(req, res, next) {
    passport._strategy('saml').logout(req, async (err, url) => {
      await endSession(req)
      if (err) return next(err)
      AsyncFormHelper.redirect(req, res, url)
    })
  },
  passportLogoutCallback(req, res, next) {
//TODO: is it possible to close the editor?
    passport.authenticate('saml')(req, res, (err) => {
      if (err) return next(err)
      res.redirect('/login');
    })
  },
  async doPassportLogout(req, profile, done) {
    let user, info
    try {
      ;({ user, info } = await SAMLAuthenticationController._doPassportLogout(
        req,
        profile
      ))
    } catch (error) {
      return done(error)
    }
    return done(undefined, user, info)
  },
  async _doPassportLogout(req, profile) {
    if (req?.session?.saml_extce?.nameID === profile.nameID &&
        req?.session?.saml_extce?.sessionIndex === profile.sessionIndex) {
      profile = req.user
    }
    await UserSessionsManager.promises.untrackSession(req.user, req.sessionID).catch(err => {
      logger.warn({ err, userId: req.user._id }, 'failed to untrack session')
    })
    return { user: profile, info: undefined }
  },
  getSPMetadata(req, res) {
    const samlStratery = passport._strategy('saml')
    res.setHeader('Content-Disposition', `attachment; filename="${samlStratery._saml.options.issuer}-meta.xml"`)
    xmlResponse(res,
      samlStratery.generateServiceProviderMetadata(
        readFilesContentFromEnv(process.env.OVERLEAF_SAML_DECRYPTION_CERT),
        readFilesContentFromEnv(process.env.OVERLEAF_SAML_PUBLIC_CERT)
      )
    )
  },
}
export default SAMLAuthenticationController
