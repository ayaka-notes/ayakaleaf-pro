import {
  AUTHENTIK_URL,
  authentikLogin,
  currentUser,
  expectSsoPasswordRefused,
  idpEmail,
  isSiteAdmin,
  requestPasswordReset,
  resetAuthentikUsers,
  setAuthentikEmail,
  setAuthentikGroup,
  setAuthentikName,
  ssoLogin,
  updatePassword,
} from '../../../../helpers/auth'
import { expectOwnAuditEntry } from '../../../../helpers/auditLog'
import { login, randomPassword } from '../../../../helpers/login'
import {
  deleteEmails,
  passwordResetLink,
  waitForEmail,
} from '../../../../helpers/mailpit'
import {
  adminUserInfo,
  createLocalAccount,
  setSuspended,
  setUserPassword,
} from '../../../../helpers/adminTools'
import { postWithCsrf } from '../../../../helpers/request'

// OIDC login against authentik (services/authentik). Admins are mapped from
// the groups claim containing "Admins". With OIDC the launchpad keeps the
// local form, the first admin gets a local password and keeps it.

before(function () {
  resetAuthentikUsers()
})

// Changed by the password reset case
let carolPassword = `Local-${Cypress._.random(1e9)}-Pass`

function oidcLogin(username: string) {
  ssoLogin('/oidc/login', username)
}

describe('launchpad with OIDC', function () {
  it('creates a local first admin with a password', function () {
    cy.visit('/launchpad')
    cy.findByLabelText('Email').type(idpEmail('carol'))
    cy.findByLabelText('Password').type(carolPassword)
    cy.findByRole('button', { name: 'Register' }).click()
    cy.url().should('contain', '/login')
  })

  it('keeps the first admin an admin after the first OIDC login', function () {
    oidcLogin('carol')
    isSiteAdmin().should('equal', true)
    currentUser().its('email').should('equal', idpEmail('carol'))
  })

  it('keeps the local password of the first admin', function () {
    cy.clearAllCookies()
    login(idpEmail('carol'), carolPassword)
    cy.visit('/project')
    cy.url().should('contain', '/project')
  })
})

describe('OIDC login', function () {
  it('makes a user whose groups contain Admins an admin', function () {
    oidcLogin('alice')
    isSiteAdmin().should('equal', true)
    currentUser().then(user => {
      expect(user.email).to.equal(idpEmail('alice'))
    })
  })

  it('does not make a user of other groups an admin', function () {
    oidcLogin('bob')
    isSiteAdmin().should('equal', false)
  })

  it('does not make a user with an empty groups claim an admin', function () {
    oidcLogin('dave')
    isSiteAdmin().should('equal', false)
  })

  it('updates the admin flag on every login', function () {
    setAuthentikGroup('alice', 'Admins', false)
    oidcLogin('alice')
    isSiteAdmin().should('equal', false)

    setAuthentikGroup('alice', 'Admins', true)
    oidcLogin('alice')
    isSiteAdmin().should('equal', true)
  })

  it('updates the name from the IdP on every login', function () {
    // authentik sends the full name as given_name and no family_name
    setAuthentikName('alice', 'Alicia Renamed')
    oidcLogin('alice')
    currentUser().its('first_name').should('equal', 'Alicia Renamed')

    setAuthentikName('alice', 'Alice Admin')
    oidcLogin('alice')
    currentUser().its('first_name').should('equal', 'Alice Admin')
  })
})

describe('password reset of an OIDC account', function () {
  it('refuses to send a reset email to an account made by OIDC', function () {
    oidcLogin('bob')
    requestPasswordReset(idpEmail('bob')).then(expectSsoPasswordRefused)
  })

  it('does not let an account made by OIDC change the password on the settings page', function () {
    oidcLogin('bob')
    cy.visit('/user/settings')
    cy.contains('p', 'because your group or organization uses single sign-on')
    // CE does not check change-password on the route, the current password
    // of an account without one never matches
    updatePassword('anything', `New-${Cypress._.random(1e9)}-Pass`)
      .its('status')
      .should('equal', 400)
  })

  // OIDC is linked to a local account, which keeps its password
  it('lets a local account that OIDC is linked to change the password on the settings page', function () {
    const newPassword = `Changed-${Cypress._.random(1e9)}-Pass`
    cy.clearAllCookies()
    login(idpEmail('carol'), carolPassword)
    cy.visit('/user/settings')
    cy.findByLabelText('Current password')
    updatePassword(carolPassword, newPassword).its('status').should('equal', 200)
    cy.then(() => {
      carolPassword = newPassword
    })
  })

  it('resets the password of a local account that OIDC is linked to', function () {
    const newPassword = `Reset-${Cypress._.random(1e9)}-Pass`
    deleteEmails()
    requestPasswordReset(idpEmail('carol')).its('status').should('equal', 200)
    waitForEmail(idpEmail('carol')).then(text => {
      cy.visit(passwordResetLink(text))
      cy.get('input[name="password"]').type(newPassword)
      cy.findByRole('button', { name: 'Set new password' }).click()
      cy.contains('Your password has been successfully changed')
    })
    cy.then(() => {
      carolPassword = newPassword
    })
    cy.clearAllCookies()
    login(idpEmail('carol'), newPassword)
    currentUser().its('email').should('equal', idpEmail('carol'))
  })

  it('does not let an admin give an account made by OIDC a password', function () {
    oidcLogin('alice')
    setUserPassword(idpEmail('bob'), `Admin-${Cypress._.random(1e9)}-Pass`)
      .its('status')
      .should('equal', 422)
  })

  it('does not let an admin change the role that OIDC keeps up to date', function () {
    oidcLogin('bob')
    oidcLogin('alice')
    adminUserInfo(idpEmail('bob')).then(user => {
      postWithCsrf(`/admin/user/${user.id}/update`, { isAdmin: true })
        .its('status')
        .should('equal', 422)
    })
    adminUserInfo(idpEmail('bob')).its('isAdmin').should('equal', false)
  })

  it('lets an admin set the password of a local account that OIDC is linked to', function () {
    const newPassword = `Admin-${Cypress._.random(1e9)}-Pass`
    oidcLogin('alice')
    setUserPassword(idpEmail('carol'), newPassword).its('status').should('equal', 200)
    cy.then(() => {
      carolPassword = newPassword
    })
    cy.clearAllCookies()
    login(idpEmail('carol'), newPassword)
    currentUser().its('email').should('equal', idpEmail('carol'))
  })
})

// The first OIDC login of a user links the account with the user's email,
// so a user must not take another email: the IdP owns it, as with LDAP and
// SAML. An admin can still change it.
describe('email of a local account on an OIDC instance', function () {
  const email = `local-${Cypress._.random(1e9)}@example.com`
  const password = randomPassword()

  before(function () {
    oidcLogin('alice')
    createLocalAccount(email)
    setUserPassword(email, password).its('status').should('equal', 200)
  })

  it('does not let the user take the email of an IdP user', function () {
    cy.clearAllCookies()
    login(email, password)
    cy.visit('/user/settings')
    postWithCsrf('/user/settings', { email: idpEmail('eve') })
      .its('status')
      .should('equal', 200)
    currentUser().its('email').should('equal', email)
    cy.get('#email-input').should('have.attr', 'readonly')
    oidcLogin('alice')
    adminUserInfo(idpEmail('eve')).should('equal', null)
  })

  it('lets an admin change the email', function () {
    const newEmail = `changed-${Cypress._.random(1e9)}@example.com`
    oidcLogin('alice')
    adminUserInfo(email).then(user => {
      postWithCsrf(`/admin/user/${user.id}/update`, { email: newEmail })
        .its('status')
        .should('equal', 200)
    })
    adminUserInfo(newEmail).its('email').should('equal', newEmail)
  })
})

describe('linking OIDC to an account', function () {
  function unlink() {
    cy.visit('/user/settings')
    postWithCsrf('/user/oauth-unlink', { providerId: 'authentik' })
      .its('status')
      .should('equal', 200)
  }

  it('links the account again on the next OIDC login after unlinking', function () {
    login(idpEmail('carol'), carolPassword)
    unlink()

    oidcLogin('carol')
    currentUser().its('email').should('equal', idpEmail('carol'))
    isSiteAdmin().should('equal', true)
  })

  // The state reported in issue #96: admin flag gone and OIDC unlinked
  it('restores the admin flag when an unlinked, demoted admin logs in again', function () {
    setAuthentikGroup('carol', 'Admins', false)
    oidcLogin('carol')
    isSiteAdmin().should('equal', false)

    login(idpEmail('carol'), carolPassword)
    unlink()

    setAuthentikGroup('carol', 'Admins', true)
    oidcLogin('carol')
    currentUser().its('email').should('equal', idpEmail('carol'))
    isSiteAdmin().should('equal', true)
  })

  it('links the account from the settings page', function () {
    login(idpEmail('carol'), carolPassword)
    unlink()

    // The Link button of the settings page, see ssoLogin for why not cy.visit()
    cy.visit('/user/settings')
    cy.get('a[href="/oidc/login?intent=link"]').click()
    authentikLogin('carol')
    // The link flow returns to the settings page, still logged in as carol
    cy.url({ timeout: 30_000 }).should('contain', '/user/settings')
    currentUser().its('email').should('equal', idpEmail('carol'))
  })

  it('links the account when the IdP sends its email in other case', function () {
    login(idpEmail('carol'), carolPassword)
    unlink()

    // The local account is lowercase, the IdP keeps the case it was given
    setAuthentikEmail('carol', 'Carol@ayakaleaf.test')
    oidcLogin('carol')
    currentUser().its('email').should('equal', idpEmail('carol'))
    isSiteAdmin().should('equal', true)
  })

  // Also when a case fails, so later logins of carol are not affected
  after(function () {
    setAuthentikEmail('carol', idpEmail('carol'))
  })
})

describe('OIDC logout', function () {
  it('logs out through the IdP and requires a fresh SSO login', function () {
    ssoLogin('/oidc/login', 'alice')
    cy.request(`${AUTHENTIK_URL}/api/v3/core/users/me/`)
      .its('body.user.username')
      .should('eq', 'alice')
    cy.intercept('GET', '**/application/o/ayakaleaf-oidc/end-session/**').as(
      'idpLogout'
    )

    cy.visit('/logout')
    cy.findByRole('button', { name: /^Log Out$/ }).click()
    cy.wait('@idpLogout').then(({ request, response }) => {
      expect(response?.statusCode, 'IdP received the logout request').to.be.lessThan(
        400
      )
      expect(request.headers.cookie, 'IdP cookies on the logout request').to.exist
    })

    cy.location('origin', { timeout: 30_000 }).should('eq', 'http://sharelatex')
    cy.visit('/project')
    cy.url().should('contain', '/login')
    // Do not clear cookies: the IdP must have ended the existing SSO session.
    cy.get('a[href="/oidc/login"]').click()
    authentikLogin('alice')
    cy.url({ timeout: 30_000 }).should('contain', '/project')
    // alice is an admin
    expectOwnAuditEntry(idpEmail('alice'), 'logout')
  })
})

describe('OIDC login of a disabled account', function () {
  it('sends the user to the account suspended page until enabled again', function () {
    oidcLogin('dave')
    oidcLogin('carol')
    setSuspended(idpEmail('dave'), true)
    ssoLogin('/oidc/login', 'dave', '/account-suspended')
    cy.visit('/project')
    cy.url().should('contain', '/login')

    oidcLogin('carol')
    setSuspended(idpEmail('dave'), false)
    oidcLogin('dave')
    currentUser().its('email').should('equal', idpEmail('dave'))
  })
})

describe('OIDC audit log', function () {
  it('tells about the account a first login creates and links', function () {
    oidcLogin('dave')
    oidcLogin('alice')
    expectOwnAuditEntry(idpEmail('dave'), 'create-account')
      .its('info.method')
      .should('equal', 'OIDC login')
    expectOwnAuditEntry(idpEmail('dave'), 'link-sso')
  })

  it('tells when a login changes the admin flag and the name', function () {
    setAuthentikGroup('alice', 'Admins', false)
    setAuthentikName('alice', 'Alicia Renamed')
    oidcLogin('alice')
    setAuthentikGroup('alice', 'Admins', true)
    setAuthentikName('alice', 'Alice Admin')
    oidcLogin('alice')
    expectOwnAuditEntry(idpEmail('alice'), 'change-admin-access')
      .its('info.isAdmin')
      .should('equal', true)
    expectOwnAuditEntry(idpEmail('alice'), 'change-name')
      .its('info.method')
      .should('equal', 'OIDC login')
  })
})
