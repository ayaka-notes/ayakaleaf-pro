import { v4 as uuid } from 'uuid'
import { waitForEmail } from '../../../../helpers/mailpit'
import { postRegister } from '../../../../helpers/register'

// login-register module with
// OVERLEAF_ALLOW_PUBLIC_REGISTRATION=@example.com, @*.uni.test: example.com
// itself and the subdomains of uni.test sign up with an activation email.

function expectDomainNotAllowed(email: string) {
  postRegister({ email }).then(response => {
    expect(response.status).to.equal(400)
    expect(response.body.message).to.equal(
      'Email domain not allowed for registration'
    )
  })
}

describe('register restricted to a list of domains', function () {
  it('shows only the email field', function () {
    cy.visit('/register')
    cy.findByLabelText('email')
    cy.findByLabelText('password').should('not.exist')
  })

  it('signs up an address of the first domain', function () {
    const email = `new-${uuid()}@example.com`
    postRegister({ email }).its('status').should('equal', 200)
    waitForEmail(email).should('contain', '/user/activate?token=')
  })

  it('signs up a subdomain of the wildcard entry', function () {
    const email = `new-${uuid()}@cs.uni.test`
    postRegister({ email }).its('status').should('equal', 200)
    waitForEmail(email).should('contain', '/user/activate?token=')
  })

  it('signs up a deeper subdomain of the wildcard entry', function () {
    const email = `new-${uuid()}@lab.cs.uni.test`
    postRegister({ email }).its('status').should('equal', 200)
    waitForEmail(email).should('contain', '/user/activate?token=')
  })

  it('treats the domain case-insensitively', function () {
    postRegister({ email: `new-${uuid()}@CS.Uni.Test` })
      .its('status')
      .should('equal', 200)
  })

  it('rejects the domain of the wildcard entry itself', function () {
    expectDomainNotAllowed(`new-${uuid()}@uni.test`)
  })

  it('rejects a domain that only ends like the wildcard entry', function () {
    expectDomainNotAllowed(`new-${uuid()}@evil-uni.test`)
  })

  it('rejects a subdomain of an entry without wildcard', function () {
    expectDomainNotAllowed(`new-${uuid()}@sub.example.com`)
  })

  it('rejects a domain that is not listed', function () {
    expectDomainNotAllowed(`new-${uuid()}@example.org`)
  })
})
