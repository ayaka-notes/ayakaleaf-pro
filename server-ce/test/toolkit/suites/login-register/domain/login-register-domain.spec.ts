import { v4 as uuid } from 'uuid'
import { postRegister } from '../../../../helpers/register'

// login-register module with OVERLEAF_ALLOW_PUBLIC_REGISTRATION=@example.com:
// only that domain can sign up, with the email alone. A successful sign up
// sends an activation email, which these tests do not cover.

describe('register restricted to a domain', function () {
  it('shows only the email field', function () {
    cy.visit('/register')
    cy.findByLabelText('email')
    cy.findByLabelText('password').should('not.exist')
    cy.findByRole('button', { name: 'Create account' })
  })

  it('rejects an address of another domain', function () {
    postRegister({ email: `new-${uuid()}@example.org` }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body.message).to.equal(
        'Email domain not allowed for registration'
      )
    })
  })

  it('rejects a subdomain of the allowed domain', function () {
    postRegister({ email: `new-${uuid()}@evil.example.com` }).then(
      response => {
        expect(response.status).to.equal(400)
        expect(response.body.message).to.equal(
          'Email domain not allowed for registration'
        )
      }
    )
  })

  it('rejects the allowed domain as a prefix of another domain', function () {
    postRegister({ email: `new-${uuid()}@example.com.evil.org` }).then(
      response => {
        expect(response.status).to.equal(400)
        expect(response.body.message).to.equal(
          'Email domain not allowed for registration'
        )
      }
    )
  })

  it('rejects an invalid email', function () {
    postRegister({ email: 'not-an-email' }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body.message.text).to.equal('email not valid')
    })
  })

  it('rejects a request without email', function () {
    postRegister({ email: '' }).then(response => {
      expect(response.status).to.equal(422)
    })
  })
})
