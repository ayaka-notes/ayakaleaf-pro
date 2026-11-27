import { v4 as uuid } from 'uuid'
import { DEFAULT_PASSWORD } from '../../../../helpers/login'
import { waitForEmail } from '../../../../helpers/mailpit'
import {
  resetRecaptchaMock,
  stubRecaptcha,
  verifiedTokens,
} from '../../../../helpers/recaptcha'
import { postRegister, waitForRegisterSlot } from '../../../../helpers/register'
import { postWithCsrf } from '../../../../helpers/request'
import { ensureUserExists } from '../../../../helpers/users'

// Same deployment as the login-register suite, restarted with
// RECAPTCHA_SITE_KEY: login, register and password reset need a captcha,
// checked against services/recaptcha-mock. CAPTCHA_TRUSTED_USERS lists
// trusted-captcha@example.com, DEVICE_HISTORY_SECRET turns on the device
// history that lets a device skip the captcha after a login.

const ROBOT_ERROR = /could not verify that you are not a robot/
const TRUSTED_USER = 'trusted-captcha@example.com'

function submitLogin(email: string) {
  cy.visit('/login')
  cy.findByLabelText('Email').type(email)
  cy.findByLabelText('Password').type(DEFAULT_PASSWORD)
  cy.findByRole('button', { name: 'Login' }).click()
}

beforeEach(function () {
  // The admin of ensureUserExists logs in through /login too
  stubRecaptcha()
})

describe('login with captcha', function () {
  const user = `captcha-${uuid()}@example.com`

  before(function () {
    stubRecaptcha()
    ensureUserExists(user)
    ensureUserExists(TRUSTED_USER)
  })

  beforeEach(function () {
    // No device history, a new device
    cy.clearAllCookies()
    resetRecaptchaMock()
  })

  it('logs in after the captcha passes', function () {
    submitLogin(user)
    cy.url().should('contain', '/project')
    verifiedTokens().should('deep.equal', ['e2e-pass'])
  })

  it('refuses the login when the captcha fails', function () {
    stubRecaptcha('e2e-fail')
    submitLogin(user)
    cy.findByText(ROBOT_ERROR)
    cy.url().should('contain', '/login')
    verifiedTokens().should('include', 'e2e-fail')
  })

  it('refuses a login request without a captcha', function () {
    cy.visit('/login')
    postWithCsrf('/login', { email: user, password: DEFAULT_PASSWORD }).then(
      response => {
        expect(response.status).to.equal(400)
        expect(response.body.errorReason).to.equal(
          'cannot_verify_user_not_robot'
        )
      }
    )
  })

  it('skips the captcha on a device that logged in before', function () {
    submitLogin(user)
    cy.url().should('contain', '/project')
    // Log out but keep the deviceHistory cookie of the login
    cy.clearCookie('overleaf.sid')
    resetRecaptchaMock()

    stubRecaptcha('e2e-fail')
    submitLogin(user)
    cy.url().should('contain', '/project')
    verifiedTokens().should('deep.equal', [])
  })

  it('skips the captcha for a trusted user', function () {
    stubRecaptcha('e2e-fail')
    submitLogin(TRUSTED_USER)
    cy.url().should('contain', '/project')
    verifiedTokens().should('deep.equal', [])
  })
})

describe('register with captcha', function () {
  beforeEach(function () {
    cy.clearAllCookies()
    resetRecaptchaMock()
  })

  it('creates an account after the captcha passes', function () {
    const email = `new-${uuid()}@example.com`
    waitForRegisterSlot()
    cy.visit('/register')
    cy.findByLabelText('email').type(email)
    cy.findByLabelText('password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Create account' }).click()
    cy.url().should('contain', '/login')
    verifiedTokens().should('deep.equal', ['e2e-pass'])
  })

  it('refuses to register when the captcha fails', function () {
    stubRecaptcha('e2e-fail')
    waitForRegisterSlot()
    cy.visit('/register')
    cy.findByLabelText('email').type(`robot-${uuid()}@example.com`)
    cy.findByLabelText('password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Create account' }).click()
    cy.findByText(ROBOT_ERROR)
    cy.url().should('contain', '/register')
  })

  it('refuses a register request without a captcha', function () {
    postRegister({
      email: `robot-${uuid()}@example.com`,
      password: DEFAULT_PASSWORD,
    }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body.errorReason).to.equal('cannot_verify_user_not_robot')
    })
  })
})

describe('password reset with captcha', function () {
  const user = `reset-${uuid()}@example.com`

  before(function () {
    stubRecaptcha()
    ensureUserExists(user)
  })

  beforeEach(function () {
    cy.clearAllCookies()
    resetRecaptchaMock()
  })

  it('sends the reset email after the captcha passes', function () {
    cy.visit('/user/password/reset')
    cy.findByLabelText('Email').type(user)
    cy.findByRole('button', { name: 'Reset password' }).click()
    cy.findByRole('heading', { name: 'Check your email' })
    waitForEmail(user)
    verifiedTokens().should('deep.equal', ['e2e-pass'])
  })

  it('refuses a reset request without a captcha', function () {
    cy.visit('/user/password/reset')
    postWithCsrf('/user/password/reset', { email: user }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body.errorReason).to.equal('cannot_verify_user_not_robot')
    })
  })
})
