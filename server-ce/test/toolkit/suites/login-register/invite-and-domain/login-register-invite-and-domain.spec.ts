import { v4 as uuid } from 'uuid'
import { activationLink, waitForEmail } from '../../../../helpers/mailpit'
import {
  expectInviteSignUp,
  expectNoInviteSignUp,
  openInviteSignedOut,
  postRegister,
} from '../../../../helpers/register'
import { ensureUserExists } from '../../../../helpers/users'

// login-register module with
// OVERLEAF_ALLOW_PUBLIC_REGISTRATION=@example.com,invite@example.com: both
// ways at once. Addresses of example.com sign up on /register with an
// activation email; the invites of its users let any other address sign up.

describe('sign up by domain and through invites', function () {
  it('signs up an address of the domain with an activation email', function () {
    const email = `new-${uuid()}@example.com`
    postRegister({ email }).its('status').should('equal', 200)
    waitForEmail(email).then(text => {
      expect(activationLink(text)).to.contain('/user/activate')
    })
  })

  it('refuses an address of another domain on /register', function () {
    postRegister({ email: `new-${uuid()}@example.org` })
      .its('status')
      .should('equal', 400)
  })

  it('lets the invite of a user of the domain sign up another address', function () {
    const inviter = `inviter-${uuid()}@example.com`
    const guest = `guest-${uuid()}@example.org`
    ensureUserExists(inviter)
    openInviteSignedOut(guest, inviter)
    expectInviteSignUp(guest)
  })

  it('shows the form of the domain for the invite of another user', function () {
    const inviter = `inviter-${uuid()}@example.org`
    ensureUserExists(inviter)
    openInviteSignedOut(`guest-${uuid()}@example.org`, inviter)
    expectNoInviteSignUp()
    cy.findByLabelText('email').should('have.value', '')
  })
})
