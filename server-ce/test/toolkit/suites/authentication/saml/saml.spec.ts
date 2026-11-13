import {
  AUTHENTIK_URL,
  authentikLogin,
  currentUser,
  expectSsoPasswordRefused,
  idpEmail,
  isSiteAdmin,
  requestPasswordReset,
  resetAuthentikUsers,
  setAuthentikAttributes,
  setAuthentikGroup,
  setAuthentikName,
  ssoLogin,
  updatePassword,
} from '../../../../helpers/auth'
import {
  createLocalAccount,
  setSuspended,
  setUserPassword,
} from '../../../../helpers/adminTools'
import { expectOwnAuditEntry } from '../../../../helpers/auditLog'
import { login, randomPassword } from '../../../../helpers/login'
import { postWithCsrf } from '../../../../helpers/request'
import { addConfirmedEmail, makePrimary } from '../../../../helpers/userEmails'

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

  it('takes the first value of a name attribute with several values', function () {
    setAuthentikAttributes('alice', { name: ['Ally Renamed', 'Alice Admin'] })
    samlLogin('alice')
    currentUser().its('first_name').should('equal', 'Ally Renamed')
    setAuthentikAttributes('alice', {})
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
    // alice is an admin
    expectOwnAuditEntry(idpEmail('alice'), 'logout')
  })
})

describe('password reset of a SAML account', function () {
  it('refuses to send a reset email, the password is at the IdP', function () {
    samlLogin('bob')
    requestPasswordReset(idpEmail('bob')).then(expectSsoPasswordRefused)
  })

  it('does not let the user change the password on the settings page', function () {
    samlLogin('bob')
    cy.visit('/user/settings')
    cy.contains('p', 'because your group or organization uses single sign-on')
    // CE does not check change-password on the route, the current password
    // of an account without one never matches
    updatePassword('anything', `New-${Cypress._.random(1e9)}-Pass`)
      .its('status')
      .should('equal', 400)
  })

  it('does not let an admin give the user a password', function () {
    samlLogin('carol')
    setUserPassword(idpEmail('bob'), `Admin-${Cypress._.random(1e9)}-Pass`)
      .its('status')
      .should('equal', 422)
  })
  it('lets a local account change the password on the settings page', function () {
    const email = `local-${Cypress._.random(1e9)}@example.com`
    const password = randomPassword()
    samlLogin('carol')
    createLocalAccount(email)
    setUserPassword(email, password).its('status').should('equal', 200)
    cy.clearAllCookies()
    login(email, password)
    cy.visit('/user/settings')
    cy.findByLabelText('Current password')
    updatePassword(password, `Changed-${Cypress._.random(1e9)}-Pass`)
      .its('status')
      .should('equal', 200)
  })
})

describe('SAML login of a disabled account', function () {
  it('sends the user to the account suspended page until enabled again', function () {
    samlLogin('dave')
    samlLogin('carol')
    setSuspended(idpEmail('dave'), true)
    ssoLogin('/saml/login', 'dave', '/account-suspended')
    cy.visit('/project')
    cy.url().should('contain', '/login')

    samlLogin('carol')
    setSuspended(idpEmail('dave'), false)
    samlLogin('dave')
    currentUser().its('email').should('equal', idpEmail('dave'))
  })
})

describe('SAML audit log', function () {
  it('tells about the account a first login creates and links', function () {
    samlLogin('dave')
    samlLogin('carol')
    expectOwnAuditEntry(idpEmail('dave'), 'create-account')
      .its('info.method')
      .should('equal', 'SAML login')
    expectOwnAuditEntry(idpEmail('dave'), 'link-institution-sso')
  })

  it('tells when a login takes over a local account and removes its password', function () {
    samlLogin('carol')
    createLocalAccount(idpEmail('frank'))
    samlLogin('frank')
    samlLogin('carol')
    expectOwnAuditEntry(idpEmail('frank'), 'link-institution-sso')
    expectOwnAuditEntry(idpEmail('frank'), 'remove-password')
  })

  it('tells when a login changes the admin flag and the name', function () {
    setAuthentikGroup('alice', 'Admins', false)
    setAuthentikName('alice', 'Alicia Renamed')
    samlLogin('alice')
    setAuthentikGroup('alice', 'Admins', true)
    setAuthentikName('alice', 'Alice Admin')
    samlLogin('alice')
    expectOwnAuditEntry(idpEmail('alice'), 'change-admin-access')
      .its('info.isAdmin')
      .should('equal', true)
    expectOwnAuditEntry(idpEmail('alice'), 'change-name')
      .its('info.method')
      .should('equal', 'SAML login')
  })
})

describe('emails of a SAML account', function () {
  it('adds an email but refuses to make it primary', function () {
    const personal = `bob-${Cypress._.random(1e9)}@example.com`
    samlLogin('bob')
    addConfirmedEmail(personal)
    makePrimary(personal)
    cy.contains('Sorry, something went wrong')
    postWithCsrf('/user/emails/default', { email: personal })
      .its('status')
      .should('equal', 403)
    currentUser().its('email').should('equal', idpEmail('bob'))
  })

  it('refuses a first login with the secondary email of another account', function () {
    // at the IdP with this email and logs in nowhere else in this spec
    const email = 'eve@other.test'
    samlLogin('bob')
    addConfirmedEmail(email)
    ssoLogin('/saml/login', 'eve', '/saml/login/callback')
    cy.contains('This email is already registered as a secondary email')
    cy.get('a[href^="mailto:"]').should('not.have.attr', 'href', 'mailto:undefined')

    samlLogin('bob')
    cy.visit('/user/settings')
    postWithCsrf('/user/emails/delete', { email })
      .its('status')
      .should('equal', 200)
    samlLogin('eve')
    currentUser().its('email').should('equal', email)
  })
})
