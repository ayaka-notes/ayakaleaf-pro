import { v4 as uuid } from 'uuid'
import {
  expectNoInviteRoute,
  postRegister,
} from '../../../../helpers/register'

// login-register module with OVERLEAF_ALLOW_PUBLIC_REGISTRATION=@*,invite@*
// but no email server (OVERLEAF_EMAIL_FROM_ADDRESS unset): the activation
// emails and invites could not go out, so both entries are ignored and sign up
// stays closed, as without the option.

describe('sign up by email without an email server', function () {
  it('shows CE page that asks to contact the admin', function () {
    cy.visit('/register')
    cy.contains('Please contact')
    cy.findByRole('button', { name: 'Create account' }).should('not.exist')
  })

  it('makes no account by domain', function () {
    postRegister({ email: `new-${uuid()}@example.com` })
      .its('status')
      .should('equal', 404)
  })

  it('makes no account through an invite', function () {
    expectNoInviteRoute()
  })
})
