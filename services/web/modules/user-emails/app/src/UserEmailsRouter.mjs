import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import CaptchaMiddleware from '../../../../app/src/Features/Captcha/CaptchaMiddleware.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import UserEmailsController from '../../../../app/src/Features/User/UserEmailsController.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'

const rateLimiters = {
  addEmail: new RateLimiter('user-emails-add', { points: 10, duration: 60 }),
  checkCode: new RateLimiter('user-emails-check-code', {
    points: 10,
    duration: 60,
  }),
  resendCode: new RateLimiter('user-emails-resend-code', {
    points: 1,
    duration: 60,
  }),
  deleteEmail: new RateLimiter('user-emails-delete', {
    points: 10,
    duration: 60,
  }),
}

// Only the primary email logs in and gets password resets. LDAP finds an
// account by that email alone, so changing it loses the account; SAML removes
// the local password at every login, so a new primary gives no way back in.
function refuseWithLdapOrSaml(req, res, next) {
  if (Settings.ldap?.enable || Settings.saml?.enable) {
    return HttpErrorHandler.forbidden(req, res)
  }
  next()
}

export default {
  apply(webRouter) {
    // Every new email is confirmed by a code sent to it
    if (!Settings.email?.parameters) {
      return
    }

    // Only the settings page sees this: core's emails section is behind it, and
    // the affiliations feature itself stays off because it needs Overleaf's v1
    webRouter.get('/user/settings', (req, res, next) => {
      res.locals.ExposedSettings.hasAffiliationsFeature = true
      next()
    })

    // The form looks up the institution of each address it is given; CE has none
    webRouter.get(
      '/institutions/domains',
      AuthenticationController.requireLogin(),
      (req, res) => res.json([])
    )

    webRouter.post(
      '/user/emails/secondary',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiters.addEmail),
      CaptchaMiddleware.validateCaptcha('addEmail'),
      UserEmailsController.addWithConfirmationCode
    )

    webRouter.post(
      '/user/emails/confirm-secondary',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiters.checkCode),
      UserEmailsController.checkNewSecondaryEmailConfirmationCode
    )

    webRouter.post(
      '/user/emails/resend-secondary-confirmation',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiters.resendCode),
      UserEmailsController.resendNewSecondaryEmailConfirmationCode
    )

    webRouter.post(
      '/user/emails/default',
      AuthenticationController.requireLogin(),
      refuseWithLdapOrSaml,
      UserEmailsController.setDefault
    )

    webRouter.post(
      '/user/emails/delete',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiters.deleteEmail),
      UserEmailsController.remove
    )
  },
}
