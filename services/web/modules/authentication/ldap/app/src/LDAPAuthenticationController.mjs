import logger from '@overleaf/logger'
import passport from 'passport'
import { handleAuthenticateErrors } from '../../../../../app/src/Features/Authentication/AuthenticationErrors.mjs'
import AuthenticationController from '../../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import LDAPAuthenticationManager from './LDAPAuthenticationManager.mjs'
import { logFailedLdapLogin } from '../../../auditLog.mjs'
import { emailOnAnotherAccountInfo } from '../../../utils.mjs'


const LDAPAuthenticationController = {
  passportLogin(req, res, next) {
    // This function is middleware which wraps the passport.authenticate middleware,
    // so we can send back our custom `{message: {text: "", type: ""}}` responses on failure,
    // and send a `{redir: ""}` response on success
    passport.authenticate(
      'ldapauth',
      { keepSessionInfo: true },
      async function (err, user, info, status) {
        if (err) { //we cannot be here as long as errors are treated as fails
          logger.error({ err }, 'LDAP passport error')
          return next(err)
        }
        if (user) {
          // `user` is either a user object or false
          AuthenticationController.setAuditInfo(req, {
            method: 'LDAP password login',
          })

          try {
            await AuthenticationController.promises.finishLogin(user, req, res)
            res.status(200)
            return
          } catch (err) {
            return next(err)
          }
        } else {
          logger.debug({ info, status }, 'LDAP authentication failed')
          if (status != 401) {
            logger.warn(status, 'LDAP: ' + info.message)
          } else {
            await logFailedLdapLogin(req)
          }
          if (info.redir != null) {
            return res.json({ redir: info.redir })
          } else {
            res.status(status || info.status || 401)
            delete info.status
            info.type = 'error'
            info.key ??= 'invalid-password-retry-or-reset'
            const body = { message: info }
            const { errorReason } = info
            if (errorReason) {
              body.errorReason = errorReason
              delete info.errorReason
            }
            return res.json(body)
          }
        }
      }
    )(req, res, next)
  },
  async doPassportLogin(req, profile, done) {
    let user, info
    try {
      ; ({ user, info } = await LDAPAuthenticationController._doPassportLogin(
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
      info: { method: 'LDAP password login', fromKnownDevice },
    }

    let user, isPasswordReused
    try {
      user = await LDAPAuthenticationManager.promises.findOrCreateUser(profile, auditLog)
    } catch (error) {
      if (error instanceof Errors.EmailExistsError) {
        return { user: false, info: emailOnAnotherAccountInfo(req) }
      }
      return {
        user: false,
        info: handleAuthenticateErrors(error, req),
      }
    }
    if (user && AuthenticationController.captchaRequiredForLogin(req, user)) {
      return {
        user: false,
        info: {
          text: req.i18n.translate('cannot_verify_user_not_robot'),
          type: 'error',
          errorReason: 'cannot_verify_user_not_robot',
          status: 400,
        },
      }
    } else if (user) {
      user.externalAuth = 'ldap'
      return { user, info: undefined }
    } else { //we cannot be here, something is terribly wrong
      logger.debug({ email: profile.mail }, 'failed LDAP log in')
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
}

export default LDAPAuthenticationController
