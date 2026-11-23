import {
  idpEmail,
  ldapLogin,
  resetAuthentikUsers,
  updatePassword,
} from '../../../../../helpers/auth'
import { login, randomPassword } from '../../../../../helpers/login'
import {
  deleteEmails,
  inviteLink,
  waitForEmail,
} from '../../../../../helpers/mailpit'
import { createProject, projectName } from '../../../../../helpers/project'
import {
  openInviteSignedOut,
  signUpThroughInvite,
} from '../../../../../helpers/register'
import { inviteToProject } from '../../../../../helpers/sharing'

// Same deployment as the ldap suite, restarted with
// OVERLEAF_ALLOW_PUBLIC_REGISTRATION=invite@ayakaleaf.test: a guest outside the
// directory signs up through the project invite of a directory user of
// ayakaleaf.test and logs in with a local password, which the LDAP password
// policy leaves to accounts that have one. The guest cannot let more people in.

before(function () {
  resetAuthentikUsers()
})

function loginAs(username: string) {
  ldapLogin(username)
  cy.url().should('contain', '/project')
}

describe('sign up through a project invite with LDAP', function () {
  it('signs up a guest outside the directory, who can change the password', function () {
    const guest = `guest-${Cypress._.random(1e9)}@example.org`
    const password = randomPassword()
    loginAs('carol')
    createProject(projectName('Invite')).then(projectId => {
      inviteToProject(projectId, guest)
      waitForEmail(guest).then(text => {
        signUpThroughInvite(inviteLink(text), guest, password)
      })
      cy.url().should('match', new RegExp(`/project/${projectId}$`))
    })

    const changed = randomPassword()
    updatePassword(password, changed).its('status').should('equal', 200)
    cy.clearAllCookies()
    login(guest, changed)
  })

  it('offers no sign up without an invite', function () {
    cy.clearAllCookies()
    cy.visit('/login')
    cy.findByRole('heading', { level: 1 })
    cy.findByRole('link', { name: 'Sign up' }).should('not.exist')
    cy.visit('/register')
    cy.url().should('contain', '/login')
  })

  it('offers no sign up to an invited directory user who has an account', function () {
    loginAs('bob')
    loginAs('carol')
    deleteEmails()
    createProject(projectName('Invite')).then(projectId => {
      inviteToProject(projectId, idpEmail('bob'))
    })
    waitForEmail(idpEmail('bob')).then(text => {
      cy.clearAllCookies()
      cy.visit(inviteLink(text))
      cy.url().should('contain', '/login')
      cy.findByRole('heading', { level: 1 })
      cy.findByRole('link', { name: 'Sign up' }).should('not.exist')
    })
  })

  it('offers no sign up to the invite of a directory user of another domain', function () {
    const guest = `guest-${Cypress._.random(1e9)}@example.org`
    loginAs('eve')
    createProject(projectName('Invite')).then(projectId => {
      inviteToProject(projectId, guest)
    })
    waitForEmail(guest).then(text => {
      cy.clearAllCookies()
      cy.visit(inviteLink(text))
      cy.url().should('contain', '/login')
    })
    cy.findByRole('heading', { level: 1 })
    cy.findByRole('link', { name: 'Sign up' }).should('not.exist')
  })

  it('offers no sign up to the invite of a guest who signed up through one', function () {
    const guest = `guest-${Cypress._.random(1e9)}@example.org`
    const password = randomPassword()
    loginAs('carol')
    createProject(projectName('Invite')).then(projectId => {
      inviteToProject(projectId, guest)
    })
    waitForEmail(guest).then(text => {
      signUpThroughInvite(inviteLink(text), guest, password)
    })
    const next = `next-${Cypress._.random(1e9)}@example.org`
    openInviteSignedOut(next, guest, password)
    cy.findByRole('heading', { level: 1 })
    cy.findByRole('link', { name: 'Sign up' }).should('not.exist')
  })
})

