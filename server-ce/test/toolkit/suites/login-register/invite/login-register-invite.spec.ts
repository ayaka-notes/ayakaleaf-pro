import { v4 as uuid } from 'uuid'
import { auditEntries } from '../../../../helpers/auditLog'
import { login, randomPassword } from '../../../../helpers/login'
import { inviteLink, waitForEmail } from '../../../../helpers/mailpit'
import { createProject, projectName } from '../../../../helpers/project'
import {
  expectInviteSignUp,
  expectNoInviteSignUp,
  openInviteSignedOut,
  signUpThroughInvite,
  waitForRegisterSlot,
} from '../../../../helpers/register'
import { postWithCsrf, requestWithCsrf } from '../../../../helpers/request'
import { inviteToProject } from '../../../../helpers/sharing'
import { addConfirmedEmail } from '../../../../helpers/userEmails'
import {
  ADMIN_EMAIL,
  ensureAdminExists,
  ensureUserExists,
} from '../../../../helpers/users'

// login-register module with
// OVERLEAF_ALLOW_PUBLIC_REGISTRATION=invite@uni.test, invite@*.uni.test: sign
// up is closed, except for an address that a project invite was emailed to
// (through Mailpit) by a user with an address of uni.test or its subdomains,
// or by an admin. The invite link leads a signed-out user to the login page,
// whose Sign up link offers an account for that address only.

const OWNER = `owner-${uuid()}@uni.test`

before(function () {
  ensureUserExists(OWNER)
})

// CE's page without the option: no form, ask the admin
function expectNoSignUpForm() {
  cy.visit('/register')
  cy.contains('Please contact')
  cy.findByRole('button', { name: 'Create account' }).should('not.exist')
}

describe('sign up through a project invite', function () {
  it('makes the invited address an account that sets its password and joins', function () {
    const guest = `guest-${uuid()}@example.org`
    const password = randomPassword()
    const name = projectName('Invite')
    login(OWNER)
    createProject(name).then(projectId => {
      inviteToProject(projectId, guest)
      waitForEmail(guest).then(text => {
        signUpThroughInvite(inviteLink(text), guest, password)
      })
      cy.url().should('match', new RegExp(`/project/${projectId}$`))
    })

    // The password logs in
    cy.clearAllCookies()
    login(guest, password)
    cy.visit('/project')
    cy.findByText(name)

    // The account is on its own audit log
    ensureAdminExists()
    login(ADMIN_EMAIL)
    auditEntries(guest, 'create-account').then(entries => {
      expect(entries).to.have.length(1)
      expect(entries[0].initiatorEmail).to.equal(guest)
    })
  })

  it('shows the inviter and the project above the address', function () {
    const guest = `guest-${uuid()}@example.org`
    openInviteSignedOut(guest, OWNER)
    cy.findByRole('link', { name: 'Sign up' }).click()
    cy.findByRole('heading', { level: 1 }).should(
      'contain.text',
      'would like you to join'
    )
    cy.findByLabelText('email').should('have.value', guest)
    cy.findByLabelText('password').should('not.exist')
  })

  it('offers no sign up form without an invite', function () {
    cy.clearAllCookies()
    expectNoSignUpForm()
    cy.visit('/login')
    waitForRegisterSlot()
    postWithCsrf('/register/invite', {}).then(response => {
      expect(response.status).to.equal(200)
      expect(response.body.redir).to.equal('/login')
    })
  })

  it('sends an invited address that has an account to log in', function () {
    const user = `user-${uuid()}@example.com`
    ensureUserExists(user)
    openInviteSignedOut(user, OWNER)
    expectNoSignUpForm()
    expectNoInviteSignUp()
  })

  it('stops offering sign up once the invite is revoked', function () {
    const guest = `guest-${uuid()}@example.org`
    login(OWNER)
    createProject(projectName('Invite')).then(projectId => {
      inviteToProject(projectId, guest).then(inviteId => {
        waitForEmail(guest).then(text => {
          requestWithCsrf(
            'DELETE',
            `/project/${projectId}/invite/${inviteId}`
          ).its('status').should('equal', 204)
          cy.clearAllCookies()
          cy.visit(inviteLink(text))
          cy.url().should('contain', '/login')
        })
      })
    })
    expectNoSignUpForm()
  })
})

describe('who can invite a new address to sign up', function () {
  it('a user of a subdomain, at any depth', function () {
    const inviter = `inviter-${uuid()}@ml.cs.uni.test`
    const guest = `guest-${uuid()}@example.org`
    ensureUserExists(inviter)
    openInviteSignedOut(guest, inviter)
    expectInviteSignUp(guest)
  })

  // Neither another domain, nor one that only ends with the name of the
  // allowed one
  for (const domain of ['example.com', 'xuni.test']) {
    it(`not a user of ${domain}`, function () {
      const inviter = `inviter-${uuid()}@${domain}`
      ensureUserExists(inviter)
      openInviteSignedOut(`guest-${uuid()}@example.org`, inviter)
      expectNoInviteSignUp()
    })
  }

  it('an admin, whatever the domain of the address', function () {
    const guest = `guest-${uuid()}@example.org`
    ensureAdminExists()
    openInviteSignedOut(guest, ADMIN_EMAIL)
    expectInviteSignUp(guest)
  })

  it('a user with a confirmed secondary email of the domain', function () {
    const inviter = `inviter-${uuid()}@example.com`
    const guest = `guest-${uuid()}@example.org`
    ensureUserExists(inviter)
    login(inviter)
    addConfirmedEmail(`inviter-${uuid()}@uni.test`)
    openInviteSignedOut(guest, inviter)
    expectInviteSignUp(guest)
  })

  it('not a guest who signed up through an invite', function () {
    const guest = `guest-${uuid()}@example.org`
    const next = `next-${uuid()}@example.org`
    login(OWNER)
    createProject(projectName('Invite')).then(projectId => {
      inviteToProject(projectId, guest)
      waitForEmail(guest).then(text => {
        signUpThroughInvite(inviteLink(text), guest, randomPassword())
      })
    })
    // Logged in as the guest, who invites the next address
    createProject(projectName('Invite')).then(projectId => {
      inviteToProject(projectId, next)
      waitForEmail(next).then(text => {
        cy.clearAllCookies()
        cy.visit(inviteLink(text))
        cy.url().should('contain', '/login')
      })
    })
    expectNoInviteSignUp()
  })

  it('not a user who only types an address of the domain into the account settings', function () {
    const user = `user-${uuid()}@example.org`
    ensureUserExists(user)
    login(user)
    cy.visit('/user/settings')
    postWithCsrf('/user/settings', { email: `user-${uuid()}@uni.test` })
      .its('status')
      .should('equal', 200)
    cy.request('/user/personal_info')
      .its('body.email')
      .should('equal', user)
    openInviteSignedOut(`guest-${uuid()}@example.org`, user)
    expectNoInviteSignUp()
  })
})
