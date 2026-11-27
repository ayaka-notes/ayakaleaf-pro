import { v4 as uuid } from 'uuid'
import { login } from '../../../../helpers/login'
import { tryLogin } from '../../../../helpers/adminTools'
import { createProject, projectName } from '../../../../helpers/project'
import {
  activationLink,
  emailsTo,
  passwordResetLink,
  refuseEmails,
} from '../../../../helpers/mailpit'
import { postWithCsrf } from '../../../../helpers/request'
import { addConfirmedEmail } from '../../../../helpers/userEmails'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../../helpers/users'
import {
  closeDialog,
  confirmDialog,
  createUser,
  dialog,
  expectLogged,
  headerAction,
  interceptSearch,
  pickOwner,
  row,
  sendLink,
  uniqueAlias,
  userId,
  visitProject,
  visitUser,
} from '../panel'

// The admin panel's buttons that send email, with Overleaf's SMTP pointed at
// Mailpit (services/mailpit): the activation email again (a row, the ticked
// rows, a user's page), the deletion notice, a project invite again and the
// owner change notices. The tests read the emails back.

const run = uuid().slice(0, 8)
const email = (name: string) => `mail-${run}-${name}@example.com`

// Retries until the address got at least `count` emails, answers them
function waitForEmails(address: string, count: number, attempts = 30): Cypress.Chainable<{ ID: string }[]> {
  return emailsTo(address).then(messages => {
    if (messages.length >= count) return cy.wrap(messages)
    expect(attempts, `${count} emails to ${address}`).to.be.greaterThan(0)
    cy.wait(500)
    return waitForEmails(address, count, attempts - 1)
  })
}

// The link of a project invite email
function inviteLink(text: string) {
  return text.match(/\S*\/invite\/token\/\S+/)![0]
}

function lastEmailText(address: string) {
  return emailsTo(address).then(messages =>
    cy.request(`http://mailpit:8025/api/v1/message/${messages[0].ID}`).its('body.Text')
  )
}

// Registers an account like the Create account modal, which sends the first
// activation email
function createAccount(address: string) {
  cy.visit('/admin/user')
  return postWithCsrf('/admin/user/create', {
    email: address,
    first_name: 'Mail',
    last_name: 'Test',
  }).its('status').should('equal', 200)
}

function searchList(text: string) {
  const list = uniqueAlias('list')
  interceptSearch('/admin/users/list', text).as(list)
  cy.visit('/admin/user')
  cy.findByRole('textbox', { name: 'Search' }).type(text)
  cy.wait(`@${list}`)
}

before(function () {
  ensureAdminExists()
})

describe('activation emails', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('sends the activation email again from the row, and its link activates the account', function () {
    const address = email('row')
    createAccount(address)
    waitForEmails(address, 1)
    searchList(address)
    row(address).findByRole('button', { name: 'Send activation email' }).click()
    sendLink('Send activation email').then(shown => {
      dialog().should('contain.text', 'Email Sent')
      closeDialog()
      userId(address).then(id => {
        expectLogged(`/admin/user/${id}`, 'send-activation-email')
          .its('info.emailSent')
          .should('equal', true)
      })
      waitForEmails(address, 2)
      lastEmailText(address).then(text => {
        expect(activationLink(text)).to.equal(shown)
        cy.clearAllCookies()
        cy.visit(activationLink(text))
        cy.url().should('contain', '/user/activate')
      })
    })
  })

  it('sends it to every ticked user', function () {
    const addresses = [email('bulk-a'), email('bulk-b')]
    addresses.forEach(address => createAccount(address))
    addresses.forEach(address => waitForEmails(address, 1))
    searchList(`mail-${run}-bulk-`)
    cy.get('#admin-users-select-all').check()
    cy.get('.admin-panel-bulk-actions')
      .findByRole('button', { name: 'Send activation email' })
      .click()
    sendLink('Send activation email')
    dialog().find('.admin-panel-link code').should('have.length', 2)
    closeDialog()
    addresses.forEach(address => waitForEmails(address, 2))
  })

  it('sends it from the user’s page', function () {
    const address = email('page')
    createAccount(address)
    waitForEmails(address, 1)
    userId(address).then(id => {
      visitUser(id)
      headerAction('Send activation email').click()
      sendLink('Send activation email')
      closeDialog()
    })
    waitForEmails(address, 2)
  })

  it('still gives the link when the email cannot go out', function () {
    const address = email('refused')
    createAccount(address)
    waitForEmails(address, 1)
    searchList(address)
    refuseEmails(true)
    row(address).findByRole('button', { name: 'Send activation email' }).click()
    sendLink('Send activation email').then(link => {
      refuseEmails(false)
      expect(link).to.contain('/user/activate?token=')
      dialog().should('contain.text', 'No email was sent')
      closeDialog()
    })
  })
})

describe('password reset emails', function () {
  it('emails a reset link to an account that has logged in, and it sets a new password', function () {
    const address = email('reset')
    const newPassword = `${run}-New-Password-1`
    createUser(address)
    login(ADMIN_EMAIL)
    searchList(address)
    row(address).findByRole('button', { name: 'Send reset link' }).click()
    sendLink('Send reset link').then(shown => {
      dialog().should('contain.text', 'Email Sent')
      closeDialog()
      lastEmailText(address).then(text => {
        expect(passwordResetLink(text)).to.equal(shown)
      })
      cy.clearAllCookies()
      cy.visit(shown)
      cy.get('input[name="password"]').type(newPassword)
      cy.findByRole('button', { name: 'Set new password' }).click()
      // in the page from the start, shown once the password is set
      cy.contains('Your password has been successfully changed').should('be.visible')
      tryLogin(address, newPassword).its('body.redir').should('equal', '/project')
    })
  })
})

describe('deleting with a notice', function () {
  it('emails the user about the deletion only when the box is ticked', function () {
    const told = email('told')
    const silent = email('silent')
    createUser(told)
    createUser(silent)
    login(ADMIN_EMAIL)
    emailsTo(told).its('length').as('toldBefore')
    emailsTo(silent).its('length').as('silentBefore')

    searchList(told)
    row(told).findByRole('button', { name: 'Delete account' }).click()
    dialog().findByLabelText('Notify the user about the account deletion').check()
    confirmDialog('Delete account')
    cy.get<number>('@toldBefore').then(before => waitForEmails(told, before + 1))

    searchList(silent)
    row(silent).findByRole('button', { name: 'Delete account' }).click()
    confirmDialog('Delete account')
    cy.wait(2000)
    cy.get<number>('@silentBefore').then(before => {
      emailsTo(silent).its('length').should('equal', before)
    })
  })
})

describe('project emails', function () {
  it('sends a project invite again', function () {
    const owner = email('owner')
    const invitee = email('invitee')
    createUser(owner)
    login(owner)
    createProject(projectName('Invite')).then(projectId => {
      cy.visit('/project')
      postWithCsrf(`/project/${projectId}/invite`, { email: invitee, privileges: 'readOnly' })
        .its('status')
        .should('equal', 200)
      waitForEmails(invitee, 1)
      login(ADMIN_EMAIL)
      visitProject(projectId, 'members')
      headerAction('Edit').click()
      row(invitee).findByRole('button', { name: 'Resend invite' }).click()
      confirmDialog('Resend invite')
      waitForEmails(invitee, 2)
    })
  })

  // Core replaces a resent invite: another link, and the old one is dead
  it('gives a resent invite a new link, and the old one stops working', function () {
    const owner = email('link-owner')
    const invitee = email('link-invitee')
    createUser(owner)
    createUser(invitee)
    login(owner)
    createProject(projectName('Invite link')).then(projectId => {
      cy.visit('/project')
      postWithCsrf(`/project/${projectId}/invite`, { email: invitee, privileges: 'readOnly' })
        .its('status')
        .should('equal', 200)
      waitForEmails(invitee, 1)
      lastEmailText(invitee).then(firstText => {
        const oldLink = inviteLink(firstText)
        login(ADMIN_EMAIL)
        visitProject(projectId, 'members')
        headerAction('Edit').click()
        row(invitee).findByRole('button', { name: 'Resend invite' }).click()
        confirmDialog('Resend invite')
        waitForEmails(invitee, 2)
        lastEmailText(invitee).then(secondText => {
          const newLink = inviteLink(secondText)
          expect(newLink).not.to.equal(oldLink)
          login(invitee)
          // a dead link answers 404
          cy.visit(oldLink, { failOnStatusCode: false })
          cy.contains('This is not a valid project invite').should('exist')
          cy.visit(newLink)
          cy.findByRole('button', { name: /join project/i }).should('exist')
        })
      })
    })
  })

  // On the same page, without a reload: it has to use the new invite's id
  it('ends the new link when a resent invite is revoked', function () {
    const owner = email('revoke-owner')
    const invitee = email('revoke-invitee')
    createUser(owner)
    createUser(invitee)
    login(owner)
    createProject(projectName('Invite revoke')).then(projectId => {
      cy.visit('/project')
      postWithCsrf(`/project/${projectId}/invite`, { email: invitee, privileges: 'readOnly' })
        .its('status')
        .should('equal', 200)
      waitForEmails(invitee, 1)
      login(ADMIN_EMAIL)
      visitProject(projectId, 'members')
      headerAction('Edit').click()
      row(invitee).findByRole('button', { name: 'Resend invite' }).click()
      confirmDialog('Resend invite')
      waitForEmails(invitee, 2)
      row(invitee).findByRole('button', { name: 'Revoke Invite' }).click()
      confirmDialog('Revoke Invite')
      row(invitee).should('not.exist')
      lastEmailText(invitee).then(text => {
        login(invitee)
        cy.visit(inviteLink(text), { failOnStatusCode: false })
        cy.contains('This is not a valid project invite').should('exist')
      })
    })
  })

  it('tells both owners when the admin changes the owner', function () {
    const owner = email('old-owner')
    const newOwner = email('new-owner')
    createUser(owner)
    createUser(newOwner)
    login(owner)
    createProject(projectName('Owner-mail')).then(projectId => {
      login(ADMIN_EMAIL)
      emailsTo(owner).its('length').as('ownerBefore')
      emailsTo(newOwner).its('length').as('newBefore')
      visitProject(projectId)
      headerAction('Edit').click()
      cy.get('.tab-pane.active').findByRole('button', { name: 'Change project owner' }).click()
      pickOwner(newOwner)
      confirmDialog('Change project owner')
      cy.get<number>('@ownerBefore').then(before => waitForEmails(owner, before + 1))
      cy.get<number>('@newBefore').then(before => waitForEmails(newOwner, before + 1))
    })
  })
})

// An account only gets more emails on an instance that can send the codes
describe('secondary emails', function () {
  function accountWithSecondary(name: string) {
    const primary = email(name)
    const secondary = email(`${name}-secondary`)
    createUser(primary)
    login(primary)
    addConfirmedEmail(secondary)
    return { primary, secondary }
  }

  function listedIds(search: string, status: 'all' | 'deleted') {
    const query = new URLSearchParams({ search, status })
    return cy
      .request(`/admin/users/list?${query}`)
      .its('body.users')
      .then((users: { id: string }[]) => users.map(user => user.id))
  }

  it('finds an account by a secondary email, and shows which one', function () {
    const { primary, secondary } = accountWithSecondary('found')
    login(ADMIN_EMAIL)
    searchList(secondary)
    row(primary).should('contain.text', secondary).and('contain.text', 'Primary')

    // found by the primary email, the row shows no other
    searchList(primary)
    row(primary).should('not.contain.text', secondary).and('not.contain.text', 'Primary')
  })

  it('finds the projects of an owner by a secondary email', function () {
    const { secondary } = accountWithSecondary('owner')
    const name = projectName('Secondary owner')
    createProject(name)
    login(ADMIN_EMAIL)
    const list = uniqueAlias('projects')
    interceptSearch('/admin/projects/list', secondary).as(list)
    cy.visit('/admin/project')
    cy.get('.tab-pane.active').findByRole('textbox', { name: 'Search' }).type(secondary)
    cy.wait(`@${list}`)
    row(name).should('contain.text', secondary).and('contain.text', 'Primary')
  })

  it('finds a deleted account by a secondary email, and does not offer editing it', function () {
    const { primary, secondary } = accountWithSecondary('deleted')
    login(ADMIN_EMAIL)
    userId(primary).then(id => {
      cy.visit('/admin/user')
      postWithCsrf(`/admin/user/${id}/delete`, {})
        .its('status')
        .should('equal', 200)
      listedIds(secondary, 'deleted').should('include', id)
      visitUser(id)
      cy.contains('li', secondary)
      headerAction('Edit').should('not.exist')
    })
  })

  it('removes a secondary email only while editing, and logs who did it', function () {
    const { primary, secondary } = accountWithSecondary('removed')
    login(ADMIN_EMAIL)
    userId(primary).then(id => {
      visitUser(id)
      cy.contains('li', secondary)
        .findByRole('button', { name: 'Remove' })
        .should('not.exist')
      headerAction('Edit').click()
      // the secondary email's, the primary email has none
      cy.get('.admin-panel-email-list')
        .findAllByRole('button', { name: 'Remove' })
        .should('have.length', 1)
      cy.contains('li', secondary).findByRole('button', { name: 'Remove' }).click()
      cy.contains('li', secondary).should('not.exist')

      cy.reload()
      cy.contains('li', primary)
      cy.contains('li', secondary).should('not.exist')
      expectLogged(`/admin/user/${id}`, 'remove-email')
        .its('info.removedEmail')
        .should('equal', secondary)
      listedIds(secondary, 'all').should('not.include', id)
    })
  })

  it('does not remove the primary email', function () {
    const primary = email('kept')
    createUser(primary)
    login(ADMIN_EMAIL)
    userId(primary).then(id => {
      cy.visit('/admin/user')
      postWithCsrf(`/admin/user/${id}/remove-email`, { email: primary })
        .its('status')
        .should('be.at.least', 400)
      visitUser(id)
      cy.contains('li', primary)
    })
  })

  // Deleting frees the emails, so another account can take one before the
  // restore: the admin removes it from the deleted account, then restores
  it('restores a deleted account without the secondary email another account took', function () {
    const { primary, secondary } = accountWithSecondary('taken')
    const taker = email('taken-taker')
    login(ADMIN_EMAIL)
    userId(primary).then(id => {
      cy.visit('/admin/user')
      postWithCsrf(`/admin/user/${id}/delete`, {}).its('status').should('equal', 200)
      createUser(taker)
      login(taker)
      addConfirmedEmail(secondary)

      login(ADMIN_EMAIL)
      visitUser(id)
      headerAction('Restore').click()
      dialog().findByRole('button', { name: 'Restore' }).click()
      dialog().should('contain.text', `Another account already uses ${secondary}`)
      dialog().findByRole('button', { name: 'Cancel' }).click()
      dialog().should('not.exist')

      cy.contains('li', secondary).findByRole('button', { name: 'Remove' }).click()
      cy.contains('li', secondary).should('not.exist')
      expectLogged(`/admin/user/${id}`, 'remove-email')
        .its('info.removedEmail')
        .should('equal', secondary)
      headerAction('Restore').click()
      confirmDialog('Restore')
      listedIds(primary, 'all').should('include', id)
      listedIds(secondary, 'all').should('not.include', id)
      userId(taker).then(takerId => {
        listedIds(secondary, 'all').should('include', takerId)
      })
    })
  })

  it('does not restore a deleted account whose primary email another account took', function () {
    const primary = email('taken-primary')
    createUser(primary)
    login(ADMIN_EMAIL)
    userId(primary).then(id => {
      cy.visit('/admin/user')
      postWithCsrf(`/admin/user/${id}/delete`, {}).its('status').should('equal', 200)
      createUser(email('taken-primary-taker'))
      login(email('taken-primary-taker'))
      addConfirmedEmail(primary)

      login(ADMIN_EMAIL)
      visitUser(id)
      cy.contains('li', primary).findByRole('button', { name: 'Remove' }).should('not.exist')
      postWithCsrf(`/admin/user/${id}/remove-email`, { email: primary })
        .its('status')
        .should('equal', 404)
      headerAction('Restore').click()
      dialog().findByRole('button', { name: 'Restore' }).click()
      dialog().should('contain.text', `Another account already uses ${primary}`)
      dialog().findByRole('button', { name: 'Cancel' }).click()
      dialog().should('not.exist')
      listedIds(primary, 'deleted').should('include', id)
    })
  })
})
