import Settings from '@overleaf/settings'
import UserEmailsRouter from './app/src/UserEmailsRouter.mjs'

// The add email form already sends a captcha; CE ships the action disabled
if (process.env.RECAPTCHA_SITE_KEY) {
  Settings.recaptcha.disabled.addEmail = false
}

const UserEmailsModule = {
  router: UserEmailsRouter,
}

export default UserEmailsModule
