import { v4 as uuid } from 'uuid'
import { DEFAULT_PASSWORD, login } from '../../../helpers/login'
import { postRegister, waitForRegisterSlot } from '../../../helpers/register'
import { postWithCsrf } from '../../../helpers/request'
import { ensureUserExists } from '../../../helpers/users'

// login-register module with OVERLEAF_ALLOW_PUBLIC_REGISTRATION=true: anyone
// can sign up with email and password. HaveIBeenPwned is enabled.

const LOGIN_ERROR = /Your email or password is incorrect/

describe('login', function () {
  const user = `user-${uuid()}@example.com`

  before(function () {
    ensureUserExists(user)
  })

  beforeEach(function () {
    cy.visit('/login')
  })

  it('shows the login form', function () {
    cy.findByRole('heading', { name: 'Log in' })
    cy.findByLabelText('Email')
    cy.findByLabelText('Password')
    cy.findByRole('button', { name: 'Login' })
  })

  it('logs in with the right password', function () {
    cy.findByLabelText('Email').type(user)
    cy.findByLabelText('Password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.url().should('contain', '/project')
  })

  it('treats the email case-insensitively', function () {
    cy.findByLabelText('Email').type(user.toUpperCase())
    cy.findByLabelText('Password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.url().should('contain', '/project')
  })

  it('rejects a wrong password', function () {
    cy.findByLabelText('Email').type(user)
    cy.findByLabelText('Password').type(`wrong-${DEFAULT_PASSWORD}`)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.findByText(LOGIN_ERROR)
    cy.url().should('contain', '/login')
  })

  it('rejects an unknown email', function () {
    cy.findByLabelText('Email').type(`unknown-${uuid()}@example.com`)
    cy.findByLabelText('Password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.findByText(LOGIN_ERROR)
    cy.url().should('contain', '/login')
  })

  it('returns to the requested page after login', function () {
    cy.visit('/user/settings')
    cy.url().should('contain', '/login')
    cy.findByLabelText('Email').type(user)
    cy.findByLabelText('Password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.url().should('contain', '/user/settings')
  })

  it('logs out', function () {
    login(user)
    cy.visit('/logout')
    cy.findByRole('button', { name: 'Log Out' }).click()
    cy.url().should('not.contain', '/logout')

    cy.visit('/project')
    cy.url().should('contain', '/login')
  })
})

describe('register', function () {
  const existingUser = `existing-${uuid()}@example.com`

  before(function () {
    ensureUserExists(existingUser)
  })

  it('shows email and password fields', function () {
    cy.visit('/register')
    cy.findByLabelText('email')
    cy.findByLabelText('password')
    cy.findByRole('button', { name: 'Create account' })
  })

  it('creates an account that can log in', function () {
    const email = `new-${uuid()}@example.com`
    waitForRegisterSlot()
    cy.visit('/register')
    cy.findByLabelText('email').type(email)
    cy.findByLabelText('password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Create account' }).click()
    cy.url().should('contain', '/login')

    // Once a page fetch() has set the session cookie, Cypress keeps sending
    // that one and drops the cookie of the login response, so the login would
    // not stick. A real browser does not do this, start over with no cookies.
    cy.clearAllCookies()
    cy.visit('/login')
    cy.findByLabelText('Email').type(email)
    cy.findByLabelText('Password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.url().should('contain', '/project')
  })

  it('rejects 123456 as too short', function () {
    waitForRegisterSlot()
    cy.visit('/register')
    cy.findByLabelText('email').type(`weak-${uuid()}@example.com`)
    cy.findByLabelText('password').type('123456')
    cy.findByRole('button', { name: 'Create account' }).click()
    cy.findByText('password is too short')
    cy.url().should('contain', '/register')
  })

  it('rejects a password seen in a data breach', function () {
    waitForRegisterSlot()
    cy.visit('/register')
    cy.findByLabelText('email').type(`breached-${uuid()}@example.com`)
    cy.findByLabelText('password').type('qwertyuiop')
    cy.findByRole('button', { name: 'Create account' }).click()
    cy.findByText(/This password has been seen in a data breach/)
    cy.url().should('contain', '/register')
  })

  it('rejects a password that contains the email', function () {
    const localPart = `similar-${uuid()}`
    postRegister({
      email: `${localPart}@example.com`,
      password: `${localPart}!1`,
    }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body.message.text).to.equal(
        'password contains part of email address'
      )
    })
  })

  it('rejects an invalid email', function () {
    postRegister({ email: 'not-an-email', password: DEFAULT_PASSWORD }).then(
      response => {
        expect(response.status).to.equal(400)
        expect(response.body.message.text).to.equal('email not valid')
      }
    )
  })

  it('rejects an email that is already registered', function () {
    postRegister({ email: existingUser, password: DEFAULT_PASSWORD }).then(
      response => {
        expect(response.status).to.equal(400)
      }
    )
  })

  it('rejects a request without password', function () {
    postRegister({ email: `nopass-${uuid()}@example.com` }).then(response => {
      expect(response.status).to.equal(422)
    })
  })

  it('sends logged in users away from the register page', function () {
    login(existingUser)
    cy.visit('/register')
    cy.url().should('not.contain', '/register')
  })

  it('rate limits sign ups to 5 per minute', function () {
    // Start from a fresh window, then use it up.
    cy.wait(62_000)
    cy.visit('/register')
    for (let i = 0; i < 5; i++) {
      postWithCsrf('/register', { email: 'not-an-email', password: '' })
    }
    postWithCsrf('/register', { email: 'not-an-email', password: '' }).then(
      response => {
        expect(response.status).to.equal(429)
      }
    )
  })
})
