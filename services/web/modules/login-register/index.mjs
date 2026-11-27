import Settings from '@overleaf/settings'
import LoginRegisterRouter from './app/src/LoginRegisterRouter.mjs'

// reCAPTCHA v2 (invisible) on login, register and password reset.
// CaptchaMiddleware and the views read Settings.recaptcha, which CE ships
// without keys and with every action disabled.
if (process.env.RECAPTCHA_SITE_KEY) {
  Settings.recaptcha.siteKey = process.env.RECAPTCHA_SITE_KEY
  Settings.recaptcha.secretKey = process.env.RECAPTCHA_SECRET_KEY
  Settings.recaptcha.disabled.login = false
  Settings.recaptcha.disabled.register = false
  Settings.recaptcha.disabled.passwordReset = false
}

let RegisterModule = {
  router: LoginRegisterRouter,
}

export default RegisterModule
