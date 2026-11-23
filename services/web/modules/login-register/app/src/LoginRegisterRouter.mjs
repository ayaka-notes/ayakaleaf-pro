import logger from "@overleaf/logger"
import Settings from "@overleaf/settings"
import { expressify } from '@overleaf/promise-utils'
import RegisterController, {
  domainRegistrationEnabled,
  inviteRegistrationEnabled,
  openRegistration,
  warnAboutRegistrationWithoutEmail,
} from './RegisterController.mjs'
import LoginController, { localLoginDisabled } from "./LoginController.mjs"
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import RateLimiterMiddleware from "../../../../app/src/Features/Security/RateLimiterMiddleware.mjs"
import CaptchaMiddleware from "../../../../app/src/Features/Captcha/CaptchaMiddleware.mjs"
import { RateLimiter } from "../../../../app/src/infrastructure/RateLimiter.mjs"

// Limit registration attempts to 3 per minute per IP
const registrationRateLimiters = {
  postRegister: new RateLimiter('postRegister', {
    points: 5,
    duration: 60,
  }),
}

export default {
  apply(webRouter) {
    logger.debug({}, 'Init Registration module')

    warnAboutRegistrationWithoutEmail()

    // Public Register, or only for invited addresses
    if (openRegistration() || domainRegistrationEnabled() || inviteRegistrationEnabled()) {
      // remove default registration router if it exists
      webRouter.stack = webRouter.stack.filter(layer => {
        return !(layer.route && layer.route.path === '/register' && layer.route.methods.get)
      })

      webRouter.get(
        '/register',
        expressify(RegisterController.registerPage)
      )

      // 'true': registration with email and password
      // '@example.com,@*.example.org' or '@*': registration via an activation email for those domains
      if (openRegistration()) {
        webRouter.post(
          '/register',
          RateLimiterMiddleware.rateLimit(registrationRateLimiters.postRegister),
          CaptchaMiddleware.validateCaptcha('register'),
          RegisterController.registerWithUsernameAndPassword
        )
      }
      else if (domainRegistrationEnabled()) {
        webRouter.post(
          '/register',
          RateLimiterMiddleware.rateLimit(registrationRateLimiters.postRegister),
          CaptchaMiddleware.validateCaptcha('register'),
          RegisterController.registerWithEmail
        )
      }
      if (inviteRegistrationEnabled()) {
        webRouter.post(
          '/register/invite',
          RateLimiterMiddleware.rateLimit(registrationRateLimiters.postRegister),
          CaptchaMiddleware.validateCaptcha('register'),
          expressify(RegisterController.registerWithInvite)
        )
        AuthenticationController.addEndpointToLoginWhitelist('/register/invite')
      }
      AuthenticationController.addEndpointToLoginWhitelist('/register')
    }


    // Public login
    // remove default login router
    webRouter.stack = webRouter.stack.filter(layer => {
      return !(layer.route && layer.route.path === '/login' && (layer.route.methods.get || (layer.route.methods.post && localLoginDisabled())))
    })

    webRouter.get(
      '/login',
      expressify(RegisterController.inviteForLoginPage),
      LoginController.loginPage
    )
    AuthenticationController.addEndpointToLoginWhitelist('/login')
    // Where suspended users are sent on login, they have no session
    AuthenticationController.addEndpointToLoginWhitelist('/account-suspended')
    // The login form asks it before the captcha, with no session yet
    AuthenticationController.addEndpointToLoginWhitelist('/login/can-skip-captcha')

    if (Settings.ldap && Settings.ldap.enable) {
      webRouter.get('/ldap/login', LoginController.ldapLoginPage)
      AuthenticationController.addEndpointToLoginWhitelist('/ldap/login')
    }
  },
}
