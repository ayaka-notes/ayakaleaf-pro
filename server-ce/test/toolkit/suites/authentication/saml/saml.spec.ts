import {
  AUTHENTIK_URL,
  authentikLogin,
  currentUser,
  idpEmail,
  isSiteAdmin,
  resetAuthentikUsers,
  setAuthentikGroup,
  setAuthentikName,
  ssoLogin,
} from '../../../../helpers/auth'
import { postWithCsrf } from '../../../../helpers/request'

// SAML login against authentik (services/authentik). Admins are mapped from
// the multi-valued Group attribute containing "Admins". The first admin is
// created on /launchpad, which runs on the fresh instance first.

before(function () {
  resetAuthentikUsers()
})

function samlLogin(username: string) {
  ssoLogin('/saml/login', username)
}

describe('launchpad with SAML', function () {
  it('asks only for the email of the first admin', function () {
    cy.visit('/launchpad')
    cy.findByRole('heading', { name: 'Create the first Admin account' })
    cy.findByRole('heading', { name: 'SAML' })
    cy.findByLabelText('Email')
    cy.get('input[name="password"]').should('not.exist')
  })

  it('refuses the LDAP admin registration', function () {
    cy.visit('/launchpad')
    postWithCsrf('/launchpad/register_ldap_admin', { email: idpEmail('carol') })
      .its('status')
      .should('equal', 403)
  })

  it('creates the first admin, who then logs in through SAML', function () {
    cy.visit('/launchpad')
    cy.findByLabelText('Email').type(idpEmail('carol'))
    cy.findByRole('button', { name: 'Register' }).click()
    cy.url().should('contain', '/login')

    samlLogin('carol')
    isSiteAdmin().should('equal', true)
    currentUser().its('email').should('equal', idpEmail('carol'))
    cy.visit('/launchpad')
    cy.findByRole('heading', { name: 'Status Checks' })
  })

  it('does not offer the form once the admin exists', function () {
    cy.visit('/launchpad')
    cy.url().should('contain', '/login')
  })
})

describe('SAML login', function () {
  it('makes a user whose Group attribute contains Admins an admin', function () {
    samlLogin('alice')
    isSiteAdmin().should('equal', true)
    currentUser().then(user => {
      expect(user.email).to.equal(idpEmail('alice'))
      expect(user.first_name).to.equal('Alice Admin')
    })
  })

  it('does not make a user of other groups an admin', function () {
    samlLogin('bob')
    isSiteAdmin().should('equal', false)
  })

  it('does not make a user without groups an admin', function () {
    samlLogin('dave')
    isSiteAdmin().should('equal', false)
  })

  it('updates the admin flag on every login', function () {
    setAuthentikGroup('alice', 'Admins', false)
    samlLogin('alice')
    isSiteAdmin().should('equal', false)

    setAuthentikGroup('alice', 'Admins', true)
    samlLogin('alice')
    isSiteAdmin().should('equal', true)
  })

  it('logs in an existing account again', function () {
    samlLogin('bob')
    currentUser().its('email').should('equal', idpEmail('bob'))
  })
})

describe('SAML profile and logout', function () {
  it('updates the name from the IdP on every login', function () {
    // The name attribute becomes the first name, the username the last name
    setAuthentikName('alice', 'Alicia Renamed')
    samlLogin('alice')
    currentUser().then(user => {
      expect(user.first_name).to.equal('Alicia Renamed')
      expect(user.last_name).to.equal('alice')
    })

    setAuthentikName('alice', 'Alice Admin')
    samlLogin('alice')
    currentUser().its('first_name').should('equal', 'Alice Admin')
  })

  it('logs out through the IdP and requires a fresh SSO login', function () {
    samlLogin('alice')
    cy.request(`${AUTHENTIK_URL}/api/v3/core/users/me/`)
      .its('body.user.username')
      .should('eq', 'alice')
    cy.intercept('GET', '**/application/saml/ayakaleaf-saml/slo/**').as(
      'idpLogout'
    )

    cy.visit('/logout')
    cy.findByRole('button', { name: /^Log Out$/ }).click()
    cy.wait('@idpLogout')
      .its('response.statusCode', { timeout: 30_000 })
      .should('be.lessThan', 400)

    // authentik ends its session in an invalidation flow that runs in the
    // page it redirects to, wait for that before leaving the page.
    function waitForIdpLogout(attempt = 1) {
      cy.request({
        url: `${AUTHENTIK_URL}/api/v3/core/users/me/`,
        failOnStatusCode: false,
      }).then(response => {
        if (response.status === 200 && attempt < 15) {
          cy.wait(2_000)
          waitForIdpLogout(attempt + 1)
        } else {
          expect(response.status, 'authentik session ended').not.to.equal(200)
        }
      })
    }
    waitForIdpLogout()

    cy.visit('/project')
    cy.url().should('contain', '/login')
    // Do not clear cookies: the IdP must have ended the existing SSO session,
    // so authentik asks for the credentials again.
    cy.get('a[href="/saml/login"]').click()
    authentikLogin('alice')
    cy.url({ timeout: 30_000 }).should('contain', '/project')
  })
})
