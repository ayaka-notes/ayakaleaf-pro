import { v4 as uuid } from 'uuid'
import { DEFAULT_PASSWORD, login } from '../../../helpers/login'
import { projectAccess, tryLogin } from '../../../helpers/adminTools'
import { createGitToken } from '../../../helpers/git'
import { createProject, projectName } from '../../../helpers/project'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../helpers/users'
import {
  confirmDialog,
  createUser,
  dialog,
  everyRow,
  expectLogged,
  headerAction,
  interceptSearch,
  openTab,
  pickOwner,
  row,
  uniqueAlias,
  userId,
  visitUser,
} from './panel'

// A user's page in the admin panel (/admin/user/:id): the account, its
// features, sessions, integrations and audit log, and what the pencil
// changes. Each change is checked the way the user would notice it.

const run = uuid().slice(0, 8)
const email = (name: string) => `user-${run}-${name}@example.com`

// The value cell of a row of the details table
function detail(label: string) {
  return cy.contains('.tab-pane.active tr', label).find('td')
}

function edit() {
  headerAction('Edit').click()
  cy.get('.tab-pane.active').findByRole('button', { name: 'Save' }).should('exist')
}

function save() {
  cy.get('.tab-pane.active').findByRole('button', { name: 'Save' }).click()
  cy.get('.tab-pane.active').contains('Saved').should('exist')
}

// groups below log in as the admin first, also when GREP runs only them
before(function () {
  ensureAdminExists()
})

describe('the page', function () {
  const address = email('page')

  before(function () {
    createUser(address)
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('shows the account and leads back to the list', function () {
    userId(address).then(id => {
      visitUser(id)
      cy.get('.admin-panel-user-header').should('contain.text', address)
      detail('ID').should('contain.text', id)
      detail('Emails').should('contain.text', address)
      detail('Login').should('contain.text', 'Password')
      detail('Role').should('contain.text', 'User')
      detail('Status').should('contain.text', 'Active')
      cy.findByRole('link', { name: /User administration/ }).click()
      cy.location('pathname').should('equal', '/admin/user')
    })
  })

  it('keeps the tab in the address', function () {
    userId(address).then(id => {
      visitUser(id, 'sessions')
      cy.findByRole('tab', { name: 'Sessions', selected: true }).should('exist')
      openTab('Features')
      cy.location('hash').should('equal', '#features')
    })
  })

  it('answers 404 for an unknown user', function () {
    for (const id of ['0123456789abcdef01234567', 'not-an-id']) {
      cy.request({ url: `/admin/user/${id}`, failOnStatusCode: false })
        .its('status')
        .should('equal', 404)
    }
  })

  it('shows the pencil only on the tabs it edits', function () {
    userId(address).then(id => {
      visitUser(id)
      headerAction('Edit').should('exist')
      openTab('Features')
      headerAction('Edit').should('exist')
      for (const tab of ['Projects', 'Integrations', 'Audit logs', 'Sessions']) {
        openTab(tab)
        headerAction('Edit').should('not.exist')
      }
    })
  })

  it('greys out the own account’s actions but lets the admin edit it', function () {
    userId(ADMIN_EMAIL).then(id => {
      visitUser(id)
      headerAction('Edit').should('be.enabled')
      for (const name of ['Disable', 'Delete account']) {
        headerAction(name).should('be.disabled')
      }
    })
  })
})

describe('editing the account', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('refuses a password that core refuses, and it changes nothing', function () {
    const address = email('password-rules')
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id)
      for (const password of [
        'short',
        // over bcrypt's limit
        `Aa1-${'x'.repeat(70)}`,
        'Aa1-with\ta-tab',
        // part of the email address
        address,
      ]) {
        postWithCsrf(`/admin/user/${id}/update`, { password })
          .its('status')
          .should('equal', 422)
      }
    })
    tryLogin(address).its('body.redir').should('equal', '/project')
  })

  it('changes the name and the email, and the user logs in with the new email', function () {
    const address = email('rename')
    const newAddress = email('renamed')
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id)
      edit()
      cy.get('#admin-user-firstName').clear().type('Ada')
      cy.get('#admin-user-lastName').clear().type('Lovelace')
      cy.get('#admin-user-email').clear().type(newAddress)
      save()
      cy.get('.admin-panel-user-header')
        .should('contain.text', 'Ada Lovelace')
        .and('contain.text', newAddress)
      // the new address is the primary one, unconfirmed
      detail('Emails').should('contain.text', newAddress).and('contain.text', 'Unconfirmed')
      cy.reload()
      detail('First name').should('contain.text', 'Ada')
    })
    tryLogin(newAddress).its('body.redir').should('equal', '/project')
    tryLogin(address).its('status').should('equal', 401)
  })

  it('throws the changes away on Cancel', function () {
    const address = email('cancel')
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id)
      edit()
      cy.get('#admin-user-firstName').clear().type('Changed')
      cy.get('.tab-pane.active').findByRole('button', { name: 'Cancel' }).click()
      cy.get('#admin-user-firstName').should('not.exist')
      detail('First name').should('not.contain.text', 'Changed')
    })
  })

  it('sets a new password and refuses one that is too short', function () {
    const address = email('password')
    const password = `e2e-${uuid()}`
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id)
      edit()
      cy.get('#admin-user-password').type('short')
      cy.get('.tab-pane.active').findByRole('button', { name: 'Save' }).click()
      cy.get('.tab-pane.active')
        .get('.notification-type-error')
        .should('contain.text', 'password is too short')
      cy.get('#admin-user-password').clear().type(password)
      save()
    })
    tryLogin(address, password).its('body.redir').should('equal', '/project')
    tryLogin(address, DEFAULT_PASSWORD).its('status').should('equal', 401)
  })

  it('makes the user an admin and back', function () {
    const address = email('admin')
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id)
      edit()
      cy.get('#admin-user-is-admin').check()
      save()
      detail('Role').should('contain.text', 'Admin')
    })
    login(address)
    cy.request({ url: '/admin/user', followRedirect: false }).its('status').should('equal', 200)

    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id)
      edit()
      cy.get('#admin-user-is-admin').uncheck()
      save()
      detail('Role').should('contain.text', 'User')
    })
  })

  it('does not let the admin take away their own admin rights', function () {
    userId(ADMIN_EMAIL).then(id => {
      visitUser(id)
      edit()
      cy.get('#admin-user-is-admin').should('be.disabled').and('be.checked')
    })
  })

  it('does not let the admin change their own features, or give their projects away', function () {
    userId(ADMIN_EMAIL).then(id => {
      visitUser(id, 'features')
      headerAction('Edit').should('be.disabled')
      detail('AI usage').findByRole('button', { name: 'Reset' }).should('be.disabled')
      headerAction('Send reset link').should('be.disabled')
      headerAction(/Transfer this user/).should('be.disabled')

      const page = `/admin/user/${id}`
      for (const body of [
        { features: { collaborators: 3 } },
        { aiFeatures: { enabled: false } },
        { suspended: true },
        { suspended: 'true' },
        { isAdmin: false },
        { isAdmin: 0 },
      ]) {
        postWithCsrf(`${page}/update`, body).its('status').should('equal', 422)
      }
      for (const path of ['transfer-projects', 'ai-usage/reset', 'send-password-reset']) {
        postWithCsrf(`${page}/${path}`, {}).its('status').should('equal', 422)
      }
      // what the settings page lets everybody change stays editable here
      postWithCsrf(`${page}/update`, { firstName: 'admin' }).its('status').should('equal', 200)
    })
  })
})

describe('features', function () {
  const address = email('features')
  const refreshAddress = email('refresh')
  const limitOwner = email('collaborator-limit')

  before(function () {
    createUser(address)
    createUser(refreshAddress)
    createUser(limitOwner)
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
    userId(address).then(id => visitUser(id, 'features'))
  })

  it('shows every feature on by default', function () {
    detail('Collaborators per project').should('contain.text', 'Unlimited')
    for (const label of ['Track changes', 'Full project history', 'Symbol palette']) {
      detail(label).find('.material-symbols').should('contain.text', 'check')
    }
  })

  it('turns features off and sets the limits, which stay after a reload', function () {
    edit()
    cy.get('#admin-user-feature-collaborators').clear().type('3')
    cy.get('#admin-user-feature-compileTimeout').clear().type('240')
    cy.get('#admin-user-feature-symbolPalette').uncheck()
    cy.get('#admin-user-feature-trackChanges').uncheck()
    save()
    cy.reload()
    detail('Collaborators per project').should('contain.text', '3')
    detail('Compile timeout').should('contain.text', '240s')
    detail('Symbol palette').find('.material-symbols').should('contain.text', 'remove')
    detail('Track changes').find('.material-symbols').should('contain.text', 'remove')
    detail('Full project history').find('.material-symbols').should('contain.text', 'check')
  })

  it('refuses limits out of range', function () {
    edit()
    cy.get('#admin-user-feature-compileTimeout').clear().type('601')
    cy.get('#admin-user-feature-compileTimeout').should('have.class', 'is-invalid')
    cy.get('.tab-pane.active').findByRole('button', { name: 'Save' }).should('be.disabled')
    cy.get('#admin-user-feature-compileTimeout').clear().type('600')
    cy.get('#admin-user-feature-collaborators').clear().type('-2')
    cy.get('.tab-pane.active').findByRole('button', { name: 'Save' }).should('be.disabled')
    // Core reads 0 as no limit set, which would mean unlimited
    cy.get('#admin-user-feature-collaborators').clear().type('0')
    cy.get('#admin-user-feature-collaborators').should('have.class', 'is-invalid')
    cy.get('.tab-pane.active').findByRole('button', { name: 'Save' }).should('be.disabled')
  })

  it('refuses a collaborator limit of 0 from a script too', function () {
    userId(address).then(id => {
      postWithCsrf(`/admin/user/${id}/update`, {
        features: { collaborators: 0 },
      })
        .its('status')
        .should('equal', 422)
    })
  })

  it('refuses a name longer than core keeps, from a script too', function () {
    userId(address).then(id => {
      for (const field of ['firstName', 'lastName']) {
        postWithCsrf(`/admin/user/${id}/update`, { [field]: 'n'.repeat(256) })
          .its('status')
          .should('equal', 422)
      }
      postWithCsrf(`/admin/user/${id}/update`, { lastName: 'n'.repeat(255) })
        .its('status')
        .should('equal', 200)
    })
  })

  it('keeps what the admin set when a change of email refreshes the features', function () {
    userId(refreshAddress).then(id => {
      const update = (body: Record<string, unknown>) =>
        postWithCsrf(`/admin/user/${id}/update`, body)
          .its('status')
          .should('equal', 200)
      update({
        features: {
          trackChanges: false,
          versioning: false,
          dropbox: false,
          collaborators: 3,
          compileTimeout: 240,
        },
      })
      update({ email: email('refresh-1') })
      // A later change of a switch joins the earlier ones
      update({ features: { versioning: true, compileTimeout: 120 } })
      update({ email: email('refresh-2') })
      visitUser(id, 'features')
      detail('Collaborators per project').should('contain.text', '3')
      detail('Compile timeout').should('contain.text', '120s')
      detail('Track changes').find('.material-symbols').should('contain.text', 'remove')
      detail('Dropbox').find('.material-symbols').should('contain.text', 'remove')
      detail('Full project history').find('.material-symbols').should('contain.text', 'check')
    })
  })

  it('stops editors over the collaborator limit, and not viewers, until it is raised', function () {
    userId(limitOwner).then(id => {
      postWithCsrf(`/admin/user/${id}/update`, {
        features: { collaborators: 1 },
      })
        .its('status')
        .should('equal', 200)
    })
    login(limitOwner)
    createProject(projectName('Limit')).then(projectId => {
      cy.visit('/project')
      const invite = (name: string, privileges: string) =>
        postWithCsrf(`/project/${projectId}/invite`, {
          email: email(name),
          privileges,
        }).then(response => response.body.invite)
      invite('limit-editor-1', 'readAndWrite').should('not.equal', null)
      invite('limit-editor-2', 'readAndWrite').should('equal', null)
      invite('limit-viewer', 'readOnly').should('not.equal', null)

      login(ADMIN_EMAIL)
      userId(limitOwner).then(id => {
        visitUser(id, 'features')
        postWithCsrf(`/admin/user/${id}/update`, {
          features: { collaborators: -1 },
        })
          .its('status')
          .should('equal', 200)
      })
      login(limitOwner)
      cy.visit('/project')
      invite('limit-editor-2', 'readAndWrite').should('not.equal', null)
    })
  })

  it('turns AI off for the user', function () {
    edit()
    cy.get('#admin-user-feature-ai').uncheck()
    save()
    cy.reload()
    detail('Enabled').find('.material-symbols').should('contain.text', 'remove')
  })

  it('shows the AI usage of this period, with nothing to reset yet', function () {
    detail('AI usage').should('contain.text', '0 /')
    detail('AI usage').findByRole('button', { name: 'Reset' }).should('be.disabled')
  })
})

describe('sessions', function () {
  it('lists the user’s sessions and clears them after a confirmation', function () {
    const address = email('sessions')
    createUser(address)
    login(address)
    cy.visit('/project')
    cy.getCookie('overleaf.sid').its('value').as('userCookie')

    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id, 'sessions')
      cy.get('.tab-pane.active tbody tr').should('have.length.at.least', 1)
      cy.get('.tab-pane.active').findByRole('button', { name: 'Clear sessions' }).click()
      dialog().should('contain.text', address)
      // Cancel keeps them
      dialog().findByRole('button', { name: 'Cancel' }).click()
      dialog().should('not.exist')
      cy.get('.tab-pane.active tbody tr').should('have.length.at.least', 1)

      cy.get('.tab-pane.active').findByRole('button', { name: 'Clear sessions' }).click()
      confirmDialog('Clear sessions')
      cy.get('.tab-pane.active').should('contain.text', 'Sessions cleared')
      cy.get('.tab-pane.active').findByRole('button', { name: 'Clear sessions' }).should('not.exist')

      // the audit log tells who did it, without a reload: opening its tab
      // again asks for the entries
      openTab('Audit logs')
      row('Clear sessions').should('contain.text', ADMIN_EMAIL)
    })

    // the user's browser is logged out
    cy.get<string>('@userCookie').then(value => {
      cy.clearAllCookies()
      cy.setCookie('overleaf.sid', value)
      cy.request({ url: '/user/personal_info', followRedirect: false })
        .its('status')
        .should('not.equal', 200)
    })
  })
})

describe('integrations', function () {
  it('lists the user’s git tokens as the settings page shows them', function () {
    const address = email('git')
    createUser(address)
    login(address)
    createGitToken().then(token => {
      login(ADMIN_EMAIL)
      userId(address).then(id => {
        visitUser(id, 'integrations')
        cy.get('.tab-pane.active thead').should('contain.text', 'Token')
        row(token.slice(0, 8)).should('contain.text', '************')
      })
    })
  })
})

describe('audit log', function () {
  it('tells what an admin changed, with the admin as the initiator', function () {
    const address = email('audit-changes')
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      const page = `/admin/user/${id}`
      visitUser(id, 'audit-logs')
      const update = (body: object) =>
        postWithCsrf(`${page}/update`, body).its('status').should('equal', 200)
      update({ firstName: 'Changed' })
      update({ isAdmin: true })
      update({ isAdmin: false })
      update({ features: { collaborators: 5 } })
      update({ aiFeatures: { enabled: false } })
      update({ suspended: true })
      update({ suspended: false })
      postWithCsrf(`${page}/ai-usage/reset`, {})
        .its('status')
        .should('equal', 200)
      for (const operation of [
        'change-name',
        'change-admin-access',
        'change-features',
        'change-ai-features',
        'account-suspension',
        'account-reactivation',
        'reset-ai-usage',
      ]) {
        expectLogged(page, operation)
      }
      cy.reload()
      row('Change admin access').should('contain.text', ADMIN_EMAIL)
    })
  })

  it('tells about a new password, which ends the sessions of the old one', function () {
    const address = email('audit-password')
    createUser(address)
    login(address)
    cy.visit('/project')
    cy.getCookie('overleaf.sid').its('value').as('userCookie')
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id, 'audit-logs')
      postWithCsrf(`/admin/user/${id}/update`, { password: `e2e-${uuid()}` })
        .its('status')
        .should('equal', 200)
      expectLogged(`/admin/user/${id}`, 'update-password')
    })
    cy.get<string>('@userCookie').then(value => {
      cy.clearAllCookies()
      cy.setCookie('overleaf.sid', value)
      cy.request({ url: '/user/personal_info', followRedirect: false })
        .its('status')
        .should('not.equal', 200)
    })
  })

  it('tells who created, deleted and restored an account, and who purged it', function () {
    const address = email('audit-lifecycle')
    login(ADMIN_EMAIL)
    cy.visit('/admin/user')
    postWithCsrf('/admin/user/create', {
      email: address,
      first_name: 'Audit',
      last_name: 'Lifecycle',
    })
      .its('status')
      .should('equal', 200)
    userId(address).then(id => {
      const page = `/admin/user/${id}`
      expectLogged(page, 'create-account')
      const remove = () =>
        postWithCsrf(`${page}/delete`, { sendEmail: false })
          .its('status')
          .should('equal', 200)
      remove()
      postWithCsrf(`${page}/restore`, {}).its('status').should('equal', 200)
      expectLogged(page, 'delete-account')
      expectLogged(page, 'restore-account')
      remove()
      requestWithCsrf('DELETE', page).its('status').should('equal', 200)
      cy.request(`${page}/audit-log/list`).its('body.total').should('equal', 0)
    })
    // a purge deletes the account's log too: the admin's own log tells
    userId(ADMIN_EMAIL).then(adminId => {
      expectLogged(`/admin/user/${adminId}`, 'purge-deleted-user')
        .its('info.email')
        .should('equal', address)
    })
  })

  it('tells which admin gave all the projects of a user away', function () {
    const owner = email('audit-owner')
    const peer = email('audit-peer')
    createUser(owner)
    createUser(peer)
    login(owner)
    createProject(projectName('Audit transfer')).then(projectId => {
      login(ADMIN_EMAIL)
      userId(peer).then(peerId => {
        userId(owner).then(ownerId => {
          visitUser(ownerId, 'audit-logs')
          postWithCsrf(`/admin/user/${ownerId}/transfer-projects`, {
            toUserId: peerId,
          })
            .its('body.projectCount')
            .should('equal', 1)
          expectLogged(`/admin/user/${ownerId}`, 'transfer-projects')
          expectLogged(`/admin/project/${projectId}`, 'transfer-ownership')
        })
      })
    })
  })

  it('searches the entries and filters them by operation', function () {
    const address = email('audit')
    createUser(address)
    login(address)
    cy.visit('/project')
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id, 'audit-logs')
      cy.get('.tab-pane.active tbody tr').should('have.length.at.least', 1)
      cy.get('.tab-pane.active')
        .findByRole('textbox', { name: 'Search' })
        .should('have.attr', 'placeholder', 'Search by operation or IP address')
      interceptSearch('/admin/user/*/audit-log/list', 'login').as('log')
      cy.get('.tab-pane.active').findByRole('textbox', { name: 'Search' }).type('login')
      cy.wait('@log')
      everyRow('.tab-pane.active tbody tr', text => /Login/.test(text))
      cy.get('#admin-user-audit-operation').click()
      cy.get('.dropdown-menu.show').contains('.dropdown-item', 'Login').click()
      cy.wait('@log')
      cy.get('#admin-user-audit-operation').should('contain.text', 'Operation: Login')
    })
  })

  it('names operations as the table shows them, and finds them by that name', function () {
    const address = email('audit-label')
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      cy.visit('/admin/user')
      for (const path of ['ai-usage/reset', 'clear-sessions']) {
        postWithCsrf(`/admin/user/${id}/${path}`, {})
          .its('status')
          .should('equal', 200)
      }
      visitUser(id, 'audit-logs')
      row('Reset AI usage').should('exist')
      for (const term of ['Clear sessions', 'clear sessions', 'clear-sessions']) {
        const log = uniqueAlias('log')
        interceptSearch('/admin/user/*/audit-log/list', term).as(log)
        cy.get('.tab-pane.active')
          .findByRole('textbox', { name: 'Search' })
          .clear()
          .type(term)
        cy.wait(`@${log}`)
        cy.get('.tab-pane.active tbody tr').should('have.length', 1)
        everyRow('.tab-pane.active tbody tr', text => /Clear sessions/.test(text))
      }
    })
  })

  it('finds the entries of an IP address, and the operation menu counts them', function () {
    const address = email('audit-ip')
    createUser(address)
    login(address)
    cy.visit('/project')
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id, 'audit-logs')
      // the IP address of the first entry
      cy.get('.tab-pane.active tbody tr')
        .first()
        .find('td')
        .eq(3)
        .invoke('text')
        .then(ip => {
          expect(ip.trim()).to.match(/^[0-9a-f.:]+$/)
          interceptSearch('/admin/user/*/audit-log/list', ip.trim()).as('log')
          cy.get('.tab-pane.active').findByRole('textbox', { name: 'Search' }).type(ip.trim())
          cy.wait('@log')
          everyRow('.tab-pane.active tbody tr', text => text.includes(ip.trim()))
        })
      // each option counts the entries it shows
      cy.get('#admin-user-audit-operation').click()
      cy.get('.dropdown-menu.show .dropdown-item')
        .contains(/^(check )?Login/)
        .invoke('text')
        .then(text => {
          const count = Number(text.trim().match(/(\d+)$/)![1])
          expect(count).to.be.at.least(1)
          cy.get('.dropdown-menu.show').contains('.dropdown-item', 'Login').click()
          cy.get('.tab-pane.active tbody tr').should('have.length', Math.min(count, 10))
        })
    })
  })
})

describe('the actions next to the name', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('disables and enables the account', function () {
    const address = email('header-toggle')
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id)
      headerAction('Disable').click()
      confirmDialog('Disable')
      cy.get('.admin-panel-user-header').should('contain.text', 'Disabled')
      headerAction('Enable').click()
      confirmDialog('Enable')
      cy.get('.admin-panel-user-header').should('contain.text', 'Active')
    })
    tryLogin(address).its('body.redir').should('equal', '/project')
  })

  it('transfers every project to another user', function () {
    const from = email('header-from')
    const to = email('header-to')
    createUser(from)
    createUser(to)
    login(from)
    createProject(projectName('Header')).then(projectId => {
      login(ADMIN_EMAIL)
      userId(from).then(id => {
        visitUser(id)
        headerAction('Transfer this user’s projects').click()
        pickOwner(to)
        confirmDialog('Transfer this user’s projects')
      })
      projectAccess(to).its(projectId).should('equal', 'owner')
    })
  })

  it('deletes the account, and its page shows it deleted with who did it', function () {
    const address = email('header-delete')
    createUser(address)
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      visitUser(id, 'sessions')
      headerAction('Delete account').click()
      confirmDialog('Delete account')
      cy.get('.admin-panel-user-header').should('contain.text', 'Deleted user')
      cy.findAllByRole('tab').should('have.length', 2)
      detail('Deleted By email').should('contain.text', ADMIN_EMAIL)
      openTab('Audit logs')
      row('Delete account').should('contain.text', ADMIN_EMAIL)
      headerAction('Restore').should('exist')
      // the page is gone after a purge: back to the user list
      headerAction('Delete permanently').click()
      confirmDialog('Delete permanently')
      cy.location('pathname').should('equal', '/admin/user')
    })
    tryLogin(address).its('status').should('equal', 401)
  })
})
