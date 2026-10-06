import {
  currentUser,
  idpEmail,
  isSiteAdmin,
  ldapLogin,
  resetAuthentikUsers,
  setAuthentikGroup,
  setAuthentikName,
} from '../../../../helpers/auth'
import { postWithCsrf } from '../../../../helpers/request'

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
