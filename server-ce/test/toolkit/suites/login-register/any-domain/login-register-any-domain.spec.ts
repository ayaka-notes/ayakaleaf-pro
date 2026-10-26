import { v4 as uuid } from 'uuid'
import { DEFAULT_PASSWORD } from '../../../../helpers/login'
import { activationLink, waitForEmail } from '../../../../helpers/mailpit'
import { postRegister } from '../../../../helpers/register'

// login-register module with OVERLEAF_ALLOW_PUBLIC_REGISTRATION=@*: any
// domain signs up, with the email alone, and sets the password through the
// activation email (services/mailpit).

describe('register open to any domain with an activation email', function () {
  it('shows only the email field', function () {
    cy.visit('/register')
    cy.findByLabelText('email')
    cy.findByLabelText('password').should('not.exist')
    cy.findByRole('button', { name: 'Create account' })
  })

  it('ignores a password sent with the sign up', function () {
    const email = `new-${uuid()}@example.org`
    postRegister({ email, password: DEFAULT_PASSWORD })
      .its('status')
      .should('equal', 200)
    cy.clearAllCookies()
    cy.visit('/login')
    cy.findByLabelText('Email').type(email)
    cy.findByLabelText('Password').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.url().should('contain', '/login')
  })

  it('signs up any domain, whose activation link sets the password', function () {
    const email = `new-${uuid()}@any-domain.test`
    postRegister({ email }).its('status').should('equal', 200)
    waitForEmail(email).then(text => {
      cy.clearAllCookies()
      cy.visit(activationLink(text))
      cy.get('input[name="password"]').type(DEFAULT_PASSWORD)
      cy.findByRole('button', { name: 'Activate' }).click()
      cy.url().should('contain', '/project')
    })
  })

  it('rejects an invalid email', function () {
    postRegister({ email: 'not-an-email' }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body.message.text).to.equal('email not valid')
    })
  })
})
