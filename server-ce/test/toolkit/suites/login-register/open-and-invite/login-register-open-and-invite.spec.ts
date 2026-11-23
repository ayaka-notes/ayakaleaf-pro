import { v4 as uuid } from 'uuid'
import { randomPassword } from '../../../../helpers/login'
import {
  expectNoInviteRoute,
  postRegister,
} from '../../../../helpers/register'

// login-register module with
// OVERLEAF_ALLOW_PUBLIC_REGISTRATION=true,invite@example.com: 'true' anywhere
// in the list opens sign up with email and password to anyone, so the invite
// entry is not needed and has no route of its own.

describe('open sign up next to an invite entry', function () {
  it('signs up anyone with email and password', function () {
    cy.visit('/register')
    cy.findByLabelText('email')
    cy.findByLabelText('password')
    postRegister({
      email: `new-${uuid()}@example.org`,
      password: randomPassword(),
    })
      .its('body.redir')
      .should('equal', '/login')
  })

  it('has no route to sign up through an invite', function () {
    expectNoInviteRoute()
  })
})
