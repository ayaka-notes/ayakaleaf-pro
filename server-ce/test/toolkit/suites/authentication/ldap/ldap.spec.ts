import {
  currentUser,
  expectSsoPasswordRefused,
  idpEmail,
  isSiteAdmin,
  ldapLogin,
  requestPasswordReset,
  resetAuthentikUsers,
  setAuthentikAttributes,
  setAuthentikGroup,
  setAuthentikName,
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

// LDAP login through authentik's LDAP outpost (services/authentik). Admins
// are mapped from memberOf containing the Admins group. The first admin is
// created on /launchpad, which runs on the fresh instance first.

before(function () {
  resetAuthentikUsers()
})

function loginAs(username: string) {
  ldapLogin(username)
  cy.url().should('contain', '/project')
}

describe('launchpad with LDAP', function () {
  it('asks only for the email of the first admin', function () {
    cy.visit('/launchpad')
    cy.findByRole('heading', { name: 'Create the first Admin account' })
    cy.findByRole('heading', { name: 'LDAP' })
    cy.findByLabelText('Email')
    cy.get('input[name="password"]').should('not.exist')
  })

  it('refuses the SAML admin registration', function () {
    cy.visit('/launchpad')
    postWithCsrf('/launchpad/register_saml_admin', { email: idpEmail('carol') })
      .its('status')
      .should('equal', 403)
  })

  it('creates the first admin, who then logs in through LDAP', function () {
    cy.visit('/launchpad')
    cy.findByLabelText('Email').type(idpEmail('carol'))
    cy.findByRole('button', { name: 'Register' }).click()
    cy.url().should('contain', '/login')

    loginAs('carol')
    isSiteAdmin().should('equal', true)
    currentUser().its('email').should('equal', idpEmail('carol'))
  })

  it('does not offer the form once the admin exists', function () {
    cy.visit('/launchpad')
    cy.url().should('contain', '/login')
  })
})

describe('LDAP login', function () {
  it('makes a member of Admins an admin and takes over the name', function () {
    loginAs('alice')
    isSiteAdmin().should('equal', true)
    currentUser().then(user => {
      expect(user.email).to.equal(idpEmail('alice'))
      expect([user.first_name, user.last_name]).to.deep.equal(['Alice', 'Admin'])
    })
  })

  it('does not make a member of other groups an admin', function () {
    loginAs('bob')
    isSiteAdmin().should('equal', false)
  })

  it('does not make a user without groups an admin', function () {
    loginAs('dave')
    isSiteAdmin().should('equal', false)
  })

  it('updates the admin flag on every login', function () {
    setAuthentikGroup('alice', 'Admins', false)
    loginAs('alice')
    isSiteAdmin().should('equal', false)

    setAuthentikGroup('alice', 'Admins', true)
    loginAs('alice')
    isSiteAdmin().should('equal', true)
  })

  it('offers no sign up without public registration', function () {
    for (const path of ['/login', '/ldap/login']) {
      cy.visit(path)
      cy.findByRole('heading', { level: 1 })
      cy.findByRole('link', { name: 'Sign up' }).should('not.exist')
      cy.get('.navbar-right').should('not.exist')
    }
  })

  it('rejects a wrong password', function () {
    ldapLogin('bob', 'not-the-password')
    // The form has several alerts, only the matching one is shown
    cy.contains('[role="alert"]:visible', 'email or password is incorrect')
    cy.url().should('contain', '/ldap/login')
  })

  it('rejects an unknown user', function () {
    ldapLogin('nobody')
    // The form has several alerts, only the matching one is shown
    cy.contains('[role="alert"]:visible', 'email or password is incorrect')
    cy.url().should('contain', '/ldap/login')
  })
})

describe('LDAP profile and logout', function () {
  it('updates the name from the directory on every login', function () {
    // The name attribute is split into first and last name
    setAuthentikName('alice', 'Alicia Renamed')
    loginAs('alice')
    currentUser().then(user => {
      expect([user.first_name, user.last_name]).to.deep.equal([
        'Alicia',
        'Renamed',
      ])
    })

    setAuthentikName('alice', 'Alice Admin')
    loginAs('alice')
    currentUser().its('first_name').should('equal', 'Alice')
  })

  it('takes the first value of a name attribute with several values', function () {
    // Like cn in inetOrgPerson, the name attribute may hold several values
    setAuthentikAttributes('alice', { name: ['Ally Renamed', 'Alice Admin'] })
    loginAs('alice')
    currentUser().then(user => {
      expect([user.first_name, user.last_name]).to.deep.equal(['Ally', 'Renamed'])
    })
    setAuthentikAttributes('alice', {})
  })

  it('lists directory contacts when one of them has several names', function () {
    setAuthentikAttributes('alice', { name: ['Ally Renamed', 'Alice Admin'] })
    loginAs('bob')
    cy.request('/user/contacts').then(response => {
      const alice = response.body.contacts.find(
        (contact: { email: string }) => contact.email === idpEmail('alice')
      )
      expect([alice.first_name, alice.last_name]).to.deep.equal([
        'Ally',
        'Renamed',
      ])
    })
    setAuthentikAttributes('alice', {})
  })

  it('logs out and requires the password again', function () {
    loginAs('bob')
    cy.visit('/logout')
    cy.findByRole('button', { name: /^Log Out$/ }).click()
    cy.url().should('not.contain', '/logout')

    cy.visit('/project')
    cy.url().should('contain', '/login')
    loginAs('bob')
    currentUser().its('email').should('equal', idpEmail('bob'))
  })
})

describe('password reset of an LDAP account', function () {
  it('refuses to send a reset email, the password is in the directory', function () {
    loginAs('bob')
    requestPasswordReset(idpEmail('bob')).then(expectSsoPasswordRefused)
  })

  it('does not let the user change the password on the settings page', function () {
    loginAs('bob')
    cy.visit('/user/settings')
    cy.contains('p', 'because your group or organization uses single sign-on')
    // CE does not check change-password on the route, the current password
    // of an account without one never matches
    updatePassword('anything', `New-${Cypress._.random(1e9)}-Pass`)
      .its('status')
      .should('equal', 400)
  })

  it('does not let an admin give the user a password', function () {
    loginAs('carol')
    setUserPassword(idpEmail('bob'), `Admin-${Cypress._.random(1e9)}-Pass`)
      .its('status')
      .should('equal', 422)
  })
  it('lets a local account change the password on the settings page', function () {
    const email = `local-${Cypress._.random(1e9)}@example.com`
    const password = randomPassword()
    loginAs('carol')
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

describe('LDAP login of a disabled account', function () {
  it('sends the user to the account suspended page until enabled again', function () {
    loginAs('dave')
    loginAs('carol')
    setSuspended(idpEmail('dave'), true)
    ldapLogin('dave')
    cy.url().should('contain', '/account-suspended')
    cy.visit('/project')
    cy.url().should('contain', '/login')

    loginAs('carol')
    setSuspended(idpEmail('dave'), false)
    loginAs('dave')
    currentUser().its('email').should('equal', idpEmail('dave'))
  })
})

describe('LDAP audit log', function () {
  it('tells about the account a first login creates', function () {
    loginAs('dave')
    loginAs('carol')
    expectOwnAuditEntry(idpEmail('dave'), 'create-account')
      .its('info.method')
      .should('equal', 'LDAP password login')
  })

  it('tells when a login removes the password of a local account', function () {
    loginAs('carol')
    createLocalAccount(idpEmail('frank'))
    loginAs('frank')
    loginAs('carol')
    expectOwnAuditEntry(idpEmail('frank'), 'remove-password')
  })

  it('tells when a login changes the admin flag and the name', function () {
    setAuthentikGroup('alice', 'Admins', false)
    setAuthentikName('alice', 'Alicia Renamed')
    loginAs('alice')
    setAuthentikGroup('alice', 'Admins', true)
    setAuthentikName('alice', 'Alice Admin')
    loginAs('alice')
    expectOwnAuditEntry(idpEmail('alice'), 'change-admin-access')
      .its('info.isAdmin')
      .should('equal', true)
    expectOwnAuditEntry(idpEmail('alice'), 'change-name')
      .its('info.method')
      .should('equal', 'LDAP password login')
  })

  it('tells about a wrong password given with an email', function () {
    loginAs('bob')
    ldapLogin(idpEmail('bob'), 'not-the-password')
    cy.contains('[role="alert"]:visible', 'email or password is incorrect')
    loginAs('carol')
    expectOwnAuditEntry(idpEmail('bob'), 'failed-password-match')
      .its('info.method')
      .should('equal', 'LDAP password login')
  })
})

describe('emails of an LDAP account', function () {
  it('adds an email but refuses to make it primary', function () {
    const personal = `bob-${Cypress._.random(1e9)}@example.com`
    loginAs('bob')
    addConfirmedEmail(personal)
    makePrimary(personal)
    cy.contains('Sorry, something went wrong')
    postWithCsrf('/user/emails/default', { email: personal })
      .its('status')
      .should('equal', 403)
    currentUser().its('email').should('equal', idpEmail('bob'))
  })

  it('refuses a first login with the secondary email of another account', function () {
    // in the directory with this email and logs in nowhere else in this spec
    const email = 'eve@other.test'
    loginAs('bob')
    addConfirmedEmail(email)
    ldapLogin('eve')
    cy.contains('This email is already registered as a secondary email')
    cy.url().should('contain', '/ldap/login')

    loginAs('bob')
    cy.visit('/user/settings')
    postWithCsrf('/user/emails/delete', { email })
      .its('status')
      .should('equal', 200)
    loginAs('eve')
    currentUser().its('email').should('equal', email)
  })
})
