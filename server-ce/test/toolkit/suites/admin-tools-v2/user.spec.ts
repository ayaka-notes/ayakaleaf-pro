import { v4 as uuid } from 'uuid'
import { DEFAULT_PASSWORD, login } from '../../../helpers/login'
import { projectAccess, tryLogin } from '../../../helpers/adminTools'
import { createGitToken } from '../../../helpers/git'
import { createProject, projectName } from '../../../helpers/project'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../helpers/users'
import {
  confirmDialog,
  createUser,
  dialog,
  everyRow,
  headerAction,
  interceptSearch,
  openTab,
  pickOwner,
  row,
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
        .should('contain.text', 'Password must be at least 8 characters long')
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
})

describe('features', function () {
  const address = email('features')

  before(function () {
    createUser(address)
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
      visitUser(id)
      headerAction('Delete account').click()
      confirmDialog('Delete account')
      cy.get('.admin-panel-user-header').should('contain.text', 'Deleted user')
      cy.findAllByRole('tab').should('have.length', 1)
      detail('Deleted By email').should('contain.text', ADMIN_EMAIL)
      headerAction('Restore').should('exist')
      headerAction('Delete permanently').should('exist')
    })
    tryLogin(address).its('status').should('equal', 401)
  })
})
