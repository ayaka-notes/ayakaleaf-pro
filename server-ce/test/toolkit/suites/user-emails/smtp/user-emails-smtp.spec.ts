import { v4 as uuid } from 'uuid'
import { setUserFeatures, tryLogin } from '../../../../helpers/adminTools'
import { currentUser, requestPasswordReset } from '../../../../helpers/auth'
import { login, randomPassword } from '../../../../helpers/login'
import { passwordResetLink, waitForEmail } from '../../../../helpers/mailpit'
import { postWithCsrf } from '../../../../helpers/request'
import {
  addConfirmedEmail,
  confirmationCode,
  emailRow,
  makePrimary,
} from '../../../../helpers/userEmails'
import { ADMIN_EMAIL, ensureUserExists } from '../../../../helpers/users'

// With a mail server the settings page lists the emails of the account: add
// one with a code sent to it, make it primary, remove it. The primary email is
// the only one that logs in and gets password resets, which is what lets
// someone leave an address that will be taken away, like a university's.

const password = randomPassword()
const address = (name: string) => `emails-${uuid()}-${name}@example.com`

function newUser(name: string) {
  const email = address(name)
  ensureUserExists(email, password)
  return email
}

function openAddEmailForm(email: string) {
  cy.visit('/user/settings')
  cy.findByRole('button', { name: 'Add another email' }).click()
  cy.findByTestId('affiliations-email').type(email)
}

function submitCode(code: string) {
  cy.get('#one-time-code').type(code)
  cy.findByRole('button', { name: 'Confirm' }).click()
}

describe('the emails of an account', function () {
  let user: string

  before(function () {
    user = newUser('list')
  })

  beforeEach(function () {
    login(user, password)
  })

  it('replaces the single email field with the list of emails', function () {
    cy.visit('/user/settings')
    cy.findByRole('heading', { name: 'Emails and affiliations' })
    emailRow(user).contains('Primary')
    cy.get('#email-input').should('not.exist')
  })

  it('does not ask about an institution', function () {
    openAddEmailForm(address('institution'))
    cy.findByRole('button', { name: 'Add new email' }).should('be.enabled')
    cy.contains('Let us know').should('not.be.visible')
  })

  it('adds an email once the code sent to it is entered', function () {
    const added = address('added')
    openAddEmailForm(added)
    cy.findByRole('button', { name: 'Add new email' }).click()
    waitForEmail(added).then(text => submitCode(confirmationCode(text)))
    emailRow(added).should('not.contain', 'Unconfirmed')
    emailRow(added).findByRole('button', { name: 'Make primary' })
  })

  it('tells the primary email that one was added', function () {
    const added = address('alert')
    addConfirmedEmail(added)
    waitForEmail(user).should('contain', added)
  })

  it('does not add an email with a wrong code', function () {
    const added = address('wrong-code')
    openAddEmailForm(added)
    cy.findByRole('button', { name: 'Add new email' }).click()
    waitForEmail(added).then(text => {
      const code = confirmationCode(text)
      submitCode(code === '000000' ? '000001' : '000000')
    })
    cy.contains(/didn.t work/)
    cy.visit('/user/settings')
    cy.contains('[data-testid="email-row"]', user)
    cy.contains('[data-testid="email-row"]', added).should('not.exist')
  })

  it('refuses the email of another account', function () {
    const other = newUser('taken')
    login(user, password)
    cy.visit('/user/settings')
    postWithCsrf('/user/emails/secondary', { email: other })
      .its('status')
      .should('equal', 409)
  })

  it('removes an email, which another account can then add', function () {
    const removed = address('removed')
    addConfirmedEmail(removed)
    cy.visit('/user/settings')
    emailRow(removed).findByRole('button', { name: 'Remove' }).click()
    cy.contains('[data-testid="email-row"]', removed).should('not.exist')

    const other = newUser('next-owner')
    login(other, password)
    cy.visit('/user/settings')
    postWithCsrf('/user/emails/secondary', { email: removed })
      .its('status')
      .should('equal', 200)
  })

  it('keeps what an admin turned off when an email is confirmed and removed', function () {
    const switched = newUser('switched')
    login(ADMIN_EMAIL)
    setUserFeatures(switched, { dropbox: false })
    login(switched, password)
    const added = address('switched-extra')
    addConfirmedEmail(added)
    cy.visit('/user/settings')
    postWithCsrf('/user/emails/delete', { email: added })
      .its('status')
      .should('equal', 200)
    currentUser().its('features.dropbox').should('equal', false)
  })

  it('lets an admin find a user by a secondary email and remove it, which frees the address', function () {
    const owner = newUser('kept-by-admin')
    const other = newUser('after-admin')
    const extra = address('removed-by-admin')
    login(owner, password)
    addConfirmedEmail(extra)
    currentUser()
      .its('id')
      .then(id => {
        login(ADMIN_EMAIL)
        const search = new URLSearchParams({ search: extra, status: 'all' })
        cy.request(`/admin/users/list?${search}`)
          .its('body.users')
          .then(users => {
            expect(users.map((u: { id: string }) => u.id)).to.include(id)
          })
        cy.visit(`/admin/user/${id}#account`)
      })
    cy.get('.admin-panel-user-header')
      .findByRole('button', { name: 'Edit' })
      .click()
    cy.contains('li', extra).findByRole('button', { name: 'Remove' }).click()
    cy.contains('li', extra).should('not.exist')

    login(other, password)
    cy.visit('/user/settings')
    postWithCsrf('/user/emails/secondary', { email: extra })
      .its('status')
      .should('equal', 200)
  })
})

describe('making an email primary', function () {
  it('moves the login to the new email', function () {
    const old = newUser('move-old')
    const added = address('move-new')
    login(old, password)
    addConfirmedEmail(added)
    makePrimary(added)
    emailRow(added).contains('Primary')

    tryLogin(old, password).its('status').should('not.equal', 200)
    login(added, password)
    currentUser().its('email').should('equal', added)
  })

  it('removes an old primary that was never confirmed', function () {
    const old = newUser('unconfirmed-old')
    const added = address('unconfirmed-new')
    login(old, password)
    addConfirmedEmail(added)
    makePrimary(added)
    emailRow(added).contains('Primary')
    cy.contains('[data-testid="email-row"]', old).should('not.exist')
  })

  it('keeps a confirmed old primary, which cannot reset the password', function () {
    const old = newUser('confirmed-old')
    const added = address('confirmed-new')
    const newPassword = randomPassword()
    login(old, password)
    cy.visit('/user/settings')
    postWithCsrf('/user/emails/send-confirmation-code', { email: old })
      .its('status')
      .should('equal', 204)
    waitForEmail(old).then(text =>
      postWithCsrf('/user/emails/confirm-code', {
        code: confirmationCode(text),
      })
        .its('status')
        .should('equal', 200)
    )
    addConfirmedEmail(added)
    makePrimary(added)
    emailRow(added).contains('Primary')
    emailRow(old).should('exist')

    requestPasswordReset(old).then(response => {
      expect(response.status).to.equal(404)
      expect(response.body.message).to.contain('secondary email')
    })
    requestPasswordReset(added).its('status').should('equal', 200)
    waitForEmail(added).then(text => {
      cy.visit(passwordResetLink(text))
      cy.get('input[name="password"]').type(newPassword)
      cy.findByRole('button', { name: 'Set new password' }).click()
      cy.contains('Your password has been successfully changed')
    })
    cy.clearAllCookies()
    login(added, newPassword)
    currentUser().its('email').should('equal', added)
  })
})
