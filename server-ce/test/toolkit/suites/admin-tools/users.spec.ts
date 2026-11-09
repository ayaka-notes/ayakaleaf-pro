import { v4 as uuid } from 'uuid'
import { activateUser, DEFAULT_PASSWORD, login } from '../../../helpers/login'
import { createProject, projectName } from '../../../helpers/project'
import { projectAccess, setSuspended, tryLogin } from '../../../helpers/adminTools'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../helpers/users'
import {
  closeDialog,
  confirmDialog,
  createUser,
  dialog,
  everyRow,
  expectLogged,
  findUser,
  headerAction,
  interceptSearch,
  makeAdmin,
  ownerPicker,
  pickOwner,
  row,
  sendLink,
  uniqueAlias,
  userId,
  userRow,
  visitUser,
} from './panel'

// The user list of the admin panel (/admin/user): finding accounts by name,
// email and id, its filters, sorting and pages, creating accounts and what
// the row actions do to them. Each result is checked through what the user
// would notice: logging in, the projects they own.

// One prefix per run, so the list can be narrowed to this run's accounts
const run = uuid().slice(0, 8)
const email = (name: string) => `list-${run}-${name}@example.com`

function visitList(query = '') {
  cy.intercept('GET', '/admin/users/list*').as('list')
  cy.visit(`/admin/user${query}`)
  cy.findByRole('textbox', { name: 'Search' }).should('exist')
}

// Types into the search box and waits for the list to answer
function search(text: string) {
  const list = uniqueAlias('list')
  interceptSearch('/admin/users/list', text).as(list)
  cy.findByRole('textbox', { name: 'Search' }).clear().type(text)
  cy.wait(`@${list}`)
}

// Picks an option of a filter in the table header (Login, Role, Status)
function filter(id: string, option: string) {
  const list = uniqueAlias('list')
  cy.intercept('GET', '/admin/users/list*').as(list)
  cy.get(`#${id}`).click()
  cy.get('.dropdown-menu.show').contains('.dropdown-item', option).click()
  cy.wait(`@${list}`)
}

function rowAction(text: string, name: string) {
  row(text).findByRole('button', { name }).click()
}

// Registers an account like the Create account modal, not activated
function createAccount(address: string, firstName = 'List', lastName = 'User') {
  cy.visit('/admin/user')
  return postWithCsrf('/admin/user/create', {
    email: address,
    first_name: firstName,
    last_name: lastName,
  }).then(response => {
    expect(response.status).to.equal(200)
  })
}

// groups below log in as the admin first, also when GREP runs only them
before(function () {
  ensureAdminExists()
})

describe('access', function () {
  const visitor = email('visitor')
  const id = '0123456789abcdef01234567'

  before(function () {
    createUser(visitor)
  })

  it('sends signed out visitors to the login page', function () {
    for (const url of [
      '/admin/user',
      `/admin/user/${id}`,
      '/admin/project',
      `/admin/project/${id}`,
    ]) {
      cy.request({ url, followRedirect: false }).then(response => {
        expect(response.status, url).to.equal(302)
        expect(response.redirectedToUrl, url).to.contain('/login')
      })
    }
  })

  it('answers the lists of a signed out visitor with 401, which the pages show as an error', function () {
    for (const url of [
      '/admin/users/list',
      '/admin/projects/list',
      '/admin/templates/list',
      `/admin/user/${id}/projects/list`,
      `/admin/user/${id}/audit-log/list`,
      `/admin/project/${id}/audit-log/list`,
    ]) {
      cy.request({
        url,
        headers: { Accept: 'application/json' },
        followRedirect: false,
        failOnStatusCode: false,
      })
        .its('status')
        .should('equal', 401)
    }
  })

  it('refuses the pages and the endpoints to users who are not admins', function () {
    login(visitor)
    for (const url of [
      '/admin/user',
      `/admin/user/${id}`,
      '/admin/project',
      `/admin/project/${id}`,
      '/admin/users/list',
      '/admin/projects/list',
      '/admin/templates/list',
      `/admin/user/${id}/projects/list`,
      `/admin/user/${id}/audit-log/list`,
      `/admin/project/${id}/audit-log/list`,
    ]) {
      cy.request({ url, followRedirect: false }).then(response => {
        expect(response.status, url).to.equal(302)
        expect(response.redirectedToUrl, url).to.contain('/restricted')
      })
    }
    cy.visit('/project')
    for (const url of [
      `/admin/user/${id}/clear-sessions`,
      `/admin/user/${id}/transfer-projects`,
      `/admin/user/${id}/remove-email`,
      `/admin/project/${id}/doc/${id}/restore`,
    ]) {
      postWithCsrf(url, {}).then(response => {
        expect(response.status, url).to.not.equal(200)
        expect(response.status, url).to.be.within(300, 499)
      })
    }
  })
})

describe('finding accounts', function () {
  const ada = email('ada')

  before(function () {
    login(ADMIN_EMAIL)
    createAccount(ada, 'Ada', 'Lovelace')
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
    visitList()
  })

  it('tells in the search box what it searches', function () {
    cy.findByRole('textbox', { name: 'Search' }).should(
      'have.attr',
      'placeholder',
      'Search by name, email or ID'
    )
  })

  it('finds an account by email, first name, last name and id', function () {
    search(ada)
    row(ada).should('contain.text', 'Ada Lovelace')
    search('Lovelace')
    row(ada).should('exist')
    // the name as a row shows it
    search('Ada Lovelace')
    row(ada).should('exist')
    userId(ada).then(id => {
      search(id)
      cy.get('tbody tr').should('have.length', 1)
      row(ada).should('exist')
    })
  })

  it('opens the account from its name', function () {
    search(ada)
    row(ada).findByRole('link', { name: 'Ada Lovelace' }).click()
    cy.location('pathname').should('match', /^\/admin\/user\/[0-9a-f]{24}$/)
    cy.get('.admin-panel-user-header').should('contain.text', 'Ada Lovelace')
  })

  it('says when nothing matches', function () {
    search(`nobody-${uuid()}`)
    cy.get('tbody').should('contain.text', 'No Search Results')
  })
})

describe('what a row shows', function () {
  const pending = email('pending')
  const active = email('active')
  const disabled = email('disabled')

  before(function () {
    login(ADMIN_EMAIL)
    createAccount(pending)
    createUser(active)
    createUser(disabled)
    login(ADMIN_EMAIL)
    setSuspended(disabled, true)
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-`)
  })

  it('shows how each account logs in, and who never logged in', function () {
    // an account the admin creates has a random password until activated
    row(pending).should('contain.text', 'Password').and('contain.text', 'Pending')
    row(active).should('contain.text', 'Password').and('contain.text', 'Active')
  })

  it('shows the role: Admin for site admins, User for everyone else', function () {
    row(active).find('.admin-panel-badge').should('contain.text', 'User')
    search(ADMIN_EMAIL)
    userRow(ADMIN_EMAIL).should('contain.text', 'Admin')
  })

  it('shows disabled accounts as disabled', function () {
    row(disabled).should('contain.text', 'Disabled')
    row(active).should('contain.text', 'Active')
  })

  it('marks the own account and greys out what cannot be done to it', function () {
    search(ADMIN_EMAIL)
    userRow(ADMIN_EMAIL).should('contain.text', 'You')
    for (const name of ['Disable', 'Delete account']) {
      userRow(ADMIN_EMAIL).findByRole('button', { name }).should('be.disabled')
    }
  })
})

describe('filters, sorting and pages', function () {
  // their own prefix: the other groups have disabled accounts too. Twelve
  // accounts the admin created (a random password, never logged in), the first
  // one disabled; an admin (logged in now, never in the editor), a disabled
  // account and one that opened a project
  const prefix = `list-${run}-f-`
  const many = Array.from({ length: 12 }, (_, i) =>
    email(`f-page-${String(i).padStart(2, '0')}`)
  )
  const admin = email('f-admin')
  const disabled = email('f-disabled')
  const recent = email('f-recent')
  // made by services/inactive-user: no route writes the dates it needs
  const inactive = 'inactive-user@example.com'

  before(function () {
    login(ADMIN_EMAIL)
    many.forEach((address, i) =>
      createAccount(address, `Page${String(i).padStart(2, '0')}`, 'Tester')
    )
    createUser(admin)
    createUser(disabled)
    createUser(recent)
    login(recent)
    createProject(projectName('Recent')).then(projectId => {
      // opening the editor is what sets lastActive
      cy.visit(`/project/${projectId}`)
      cy.get('.cm-content').should('exist')
    })
    login(ADMIN_EMAIL)
    userId(admin).then(id => {
      cy.visit('/admin/user')
      postWithCsrf(`/admin/user/${id}/update`, { isAdmin: true })
        .its('status')
        .should('equal', 200)
    })
    setSuspended(disabled, true)
    setSuspended(many[0], true)
  })

  beforeEach(function () {
    login(ADMIN_EMAIL)
    visitList()
    search(prefix)
  })

  // The options of a header filter with their counts, as the menu shows them
  function menuCounts(id: string): Cypress.Chainable<Record<string, number>> {
    cy.get(`#${id}`).click()
    return cy
      .get('.dropdown-menu.show .dropdown-item')
      .then(items => {
        const counts: Record<string, number> = {}
        for (const item of [...items]) {
          // the icons' names are text too: check and the question mark's help
          const match = item.innerText.replace(/\s+/g, ' ').trim().match(/^(?:check )?(.*?)(?: help)? (\d+)$/)
          if (match) counts[match[1]] = Number(match[2])
        }
        return counts
      })
      .then(counts => {
        cy.get(`#${id}`).click()
        return cy.wrap(counts)
      })
  }

  it('gives each account one status: the counts add up to All, and each shows its accounts', function () {
    menuCounts('admin-users-filter-status').should('deep.equal', {
      All: 15,
      Active: 2,
      Disabled: 2,
      Pending: 11,
      Inactive: 0,
      'Deleted user': 0,
    })
    filter('admin-users-filter-status', 'Disabled')
    cy.get('tbody tr').should('have.length', 2)
    row(disabled).should('contain.text', 'Disabled')
    // disabled before it ever logged in: not Pending as well
    row(many[0]).should('contain.text', 'Disabled')
    cy.location('search').should('contain', 'status=suspended')

    filter('admin-users-filter-status', 'Pending')
    cy.get('tbody tr').should('have.length', 10)
    cy.contains('Showing 10 out of 11 users').should('exist')
    row(admin).should('not.exist')
    // the row says it too: never logged in (the newest come first)
    row(many[11]).should('contain.text', 'Pending')

    filter('admin-users-filter-status', 'Active')
    cy.get('tbody tr').should('have.length', 2)
    // logged in this year, though it never opened the editor
    row(admin).should('contain.text', 'Active')
    row(recent).should('contain.text', 'Active')

    filter('admin-users-filter-status', 'All')
    cy.contains('Showing 10 out of 15 users').should('exist')
    cy.location('search').should('not.contain', 'status=')
  })

  it('shows an account not seen for over a year as Inactive', function () {
    search(inactive)
    filter('admin-users-filter-status', 'Inactive')
    cy.get('tbody tr').should('have.length', 1)
    // neither logged in nor in the editor for over a year
    row(inactive).should('contain.text', 'Inactive')
  })

  it('counts the login methods; Pending only shows when an account waits for SSO', function () {
    menuCounts('admin-users-filter-auth').then(counts => {
      expect(counts).to.include({ All: 15, Password: 15 })
      expect(counts).not.to.have.property('Pending')
    })
    filter('admin-users-filter-auth', 'Password')
    cy.contains('Showing 10 out of 15 users').should('exist')
    cy.location('search').should('contain', 'auth=local')
  })

  it('filters by role: admins, or everyone else', function () {
    menuCounts('admin-users-filter-role').should('deep.equal', {
      All: 15,
      Admin: 1,
      User: 14,
    })
    filter('admin-users-filter-role', 'Admin')
    cy.get('tbody tr').should('have.length', 1)
    row(admin).should('contain.text', 'Admin')
    cy.location('search').should('contain', 'role=admin')

    filter('admin-users-filter-role', 'User')
    cy.contains('Showing 10 out of 14 users').should('exist')
    row(admin).should('not.exist')
  })

  // Hovering the question mark of an option of the open menu tells what it means
  function explains(option: string, text: string) {
    const questionMark = () =>
      cy
        .get('.dropdown-menu.show')
        .contains('.dropdown-item', option)
        .find('.material-symbols:contains("help")')
    questionMark().trigger('mouseover')
    cy.findByRole('tooltip').should('contain.text', text)
    questionMark().trigger('mouseout')
    cy.findByRole('tooltip').should('not.exist')
  }

  it('explains the statuses behind a question mark', function () {
    cy.get('#admin-users-filter-status').click()
    explains('All', 'Every account that is not deleted.')
    explains('Active', 'Logged in or opened a project in the last 12 months.')
    explains('Pending', 'Has never logged in.')
    explains(
      'Inactive',
      'Logged in before, but no login or opened project in the last 12 months.'
    )
  })

  it('explains the Pending login of an account waiting for SSO', function () {
    const external = email('help-external')
    postWithCsrf('/admin/user/create', { email: external, isExternal: true })
      .its('status')
      .should('equal', 200)
    search(external)
    cy.get('#admin-users-filter-auth').click()
    explains('Pending', 'An SSO account waiting for its first login.')
  })

  it('combines filters, and the counts of one follow the others', function () {
    filter('admin-users-filter-role', 'Admin')
    menuCounts('admin-users-filter-status').then(counts => {
      expect(counts).to.include({ All: 1, Active: 1, Disabled: 0, Pending: 0 })
    })
    filter('admin-users-filter-status', 'Pending')
    cy.get('tbody').should('contain.text', 'No Search Results')
  })

  it('keeps the filters in the address, so a reload shows the same', function () {
    visitList(`?search=${prefix}&status=suspended`)
    cy.get('tbody tr').should('have.length', 2)
    row(disabled).should('exist')
    cy.reload()
    cy.get('tbody tr').should('have.length', 2)
  })

  it('clears the search with its button', function () {
    cy.findByRole('button', { name: 'clear search' }).click()
    cy.findByRole('textbox', { name: 'Search' }).should('have.value', '')
    cy.location('search').should('not.contain', 'search=')
  })

  it('pages through the matches, to the last and the first page', function () {
    search(`${prefix}page-`)
    cy.get('tbody tr').should('have.length', 10)
    cy.contains('Showing 10 out of 12 users').should('exist')
    cy.findByRole('button', { name: 'Go to first page' }).should('not.exist')
    cy.intercept('GET', '/admin/users/list*').as('list')
    cy.findByRole('button', { name: 'Go to page 2' }).click()
    cy.wait('@list')
    cy.get('tbody tr').should('have.length', 2)
    cy.location('search').should('contain', 'page=2')
    cy.findByRole('button', { name: 'Go to last page' }).should('not.exist')
    cy.findByRole('button', { name: 'Go to first page' }).click()
    cy.wait('@list')
    cy.get('tbody tr').should('have.length', 10)
    cy.findByRole('button', { name: 'Go to last page' }).click()
    cy.wait('@list')
    cy.get('tbody tr').should('have.length', 2)
  })

  it('changes the page size', function () {
    search(`${prefix}page-`)
    cy.get('#admin-users-page-size').should('contain.text', '10 per page').click()
    cy.get('.dropdown-menu.show .dropdown-item').then(items => {
      // the current size carries a check icon
      expect([...items].map(i => i.innerText.replace(/^check\s*/, '').trim())).to.include.members([
        '10 per page',
        '20 per page',
        '50 per page',
        '100 per page',
        '200 per page',
      ])
    })
    cy.get('.dropdown-menu.show').contains('.dropdown-item', '20 per page').click()
    cy.get('tbody tr').should('have.length', 12)
    cy.location('search').should('contain', 'pageSize=20')
    cy.findByRole('button', { name: 'Go to page 2' }).should('not.exist')
  })

  it('sorts by name and by sign up date, both ways', function () {
    // the Sign up column shows from 1200px on
    cy.viewport(1400, 900)
    search(`${prefix}page-`)
    // newest first by default
    cy.get('tbody tr').first().should('contain.text', 'Page11')
    cy.intercept('GET', '/admin/users/list*').as('list')
    cy.get('thead').findByRole('button', { name: /Sign up/ }).click()
    cy.wait('@list')
    cy.get('tbody tr').first().should('contain.text', 'Page00')

    cy.get('thead').findByRole('button', { name: /Name/ }).click()
    cy.wait('@list')
    cy.get('tbody tr').first().should('contain.text', 'Page00')
    cy.location('search').should('contain', 'sort=name')
    cy.get('thead')
      .findByRole('button', { name: 'Reverse Name sort order' })
      .click()
    cy.wait('@list')
    cy.get('tbody tr').first().should('contain.text', 'Page11')
    cy.location('search').should('contain', 'order=desc')
  })
})

describe('creating accounts', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
    visitList()
  })

  it('creates an account that the user activates', function () {
    const address = email('created')
    cy.findAllByRole('button', { name: 'Create account' })
      .filter(':visible')
      .first()
      .click()
    dialog().within(() => {
      cy.findByLabelText('Email address').type(address)
      cy.findByLabelText('First name').type('Grace')
      cy.findByLabelText('Last name').type('Hopper')
      cy.findByRole('button', { name: 'Create' }).click()
      // no email on this site: the modal hands the link out instead
      cy.contains('No email was sent').should('exist')
      cy.contains('Grace Hopper').should('exist')
      cy.get('code').invoke('text').as('link', { type: 'static' })
      cy.findByRole('button', { name: 'Close' }).click()
    })
    dialog().should('not.exist')
    search(address)
    row(address).should('contain.text', 'Grace Hopper').and('contain.text', 'Pending')

    cy.get<string>('@link').then(link => {
      expect(link).to.contain('/user/activate?token=')
      activateUser(link)
    })
    tryLogin(address).its('body.redir').should('equal', '/project')
  })

  it('creates an admin', function () {
    const address = email('created-admin')
    cy.findAllByRole('button', { name: 'Create account' })
      .filter(':visible')
      .first()
      .click()
    dialog().within(() => {
      cy.findByLabelText('Email address').type(address)
      cy.findByLabelText('Admin').check()
      cy.findByRole('button', { name: 'Create' }).click()
      cy.findByRole('button', { name: 'Close' }).click()
    })
    dialog().should('not.exist')
    findUser(address).its('isAdmin').should('equal', true)
  })

  it('refuses an email that another account has', function () {
    cy.findAllByRole('button', { name: 'Create account' })
      .filter(':visible')
      .first()
      .click()
    dialog().within(() => {
      cy.findByLabelText('Email address').type(ADMIN_EMAIL)
      cy.findByRole('button', { name: 'Create' }).click()
      cy.get('.notification-type-error').should(
        'contain.text',
        'already associated with a different'
      )
    })
    dialog().findByRole('button', { name: 'Cancel' }).click()
    dialog().should('not.exist')
  })

  it('refuses something that is no email address, and says so', function () {
    cy.findAllByRole('button', { name: 'Create account' })
      .filter(':visible')
      .first()
      .click()
    dialog().within(() => {
      cy.findByLabelText('Email address').type('not-an-email')
      cy.findByRole('button', { name: 'Create' }).click()
      cy.get('.notification-type-error').should(
        'contain.text',
        'Email address is invalid'
      )
    })
    dialog().findByRole('button', { name: 'Cancel' }).click()
    dialog().should('not.exist')
  })

  it('refuses a name longer than core keeps, and creates nothing', function () {
    const address = email('long-name')
    for (const field of ['first_name', 'last_name']) {
      postWithCsrf('/admin/user/create', {
        email: address,
        [field]: 'n'.repeat(256),
      })
        .its('status')
        .should('equal', 422)
    }
    cy.request(`/admin/users/list?search=${encodeURIComponent(address)}`)
      .its('body.total')
      .should('equal', 0)
  })

  it('keeps an address given in capitals as the one email of the account', function () {
    const address = email('capitals')
    createAccount(address.toUpperCase())
    userId(address).then(id => {
      visitUser(id)
      cy.get('.tab-pane.active')
        .should('contain.text', address)
        .and('contain.text', 'Primary')
        .and('not.contain.text', address.toUpperCase())
      headerAction('Edit').click()
      cy.get('#admin-user-email').should('have.value', address)
    })
  })
})

describe('row actions', function () {
  it('says Not found when the account was deleted meanwhile', function () {
    const address = email('gone-meanwhile')
    login(ADMIN_EMAIL)
    createAccount(address)
    visitList()
    search(address)
    // another admin deletes it while the list still shows it
    userId(address).then(id => {
      postWithCsrf(`/admin/user/${id}/delete`, {}).its('status').should('equal', 200)
    })
    rowAction(address, 'Disable')
    dialog().within(() => {
      cy.findByRole('button', { name: 'Disable' }).click()
      cy.get('.notification-type-error').should('contain.text', 'Not found')
      cy.findByRole('button', { name: 'Cancel' }).click()
    })
  })

  it('disables an account, which logs the user out everywhere, and enables it', function () {
    const address = email('toggle')
    createUser(address)
    // the user's browser, logged in before the account is disabled
    login(address)
    cy.visit('/project')
    cy.getCookie('overleaf.sid').its('value').as('userCookie')

    login(ADMIN_EMAIL)
    visitList()
    search(address)
    rowAction(address, 'Disable')
    confirmDialog('Disable')
    row(address).should('contain.text', 'Disabled')
    // core's suspendUser ends the user's sessions
    cy.get<string>('@userCookie').then(value => {
      cy.clearAllCookies()
      cy.setCookie('overleaf.sid', value)
      cy.request({ url: '/user/personal_info', followRedirect: false })
        .its('status')
        .should('not.equal', 200)
    })
    // the password is right: core sends a disabled account to this page
    tryLogin(address).its('body.redir').should('equal', '/account-suspended')

    login(ADMIN_EMAIL)
    visitList()
    search(address)
    rowAction(address, 'Enable')
    confirmDialog('Enable')
    row(address).should('contain.text', 'Active')
    tryLogin(address).its('body.redir').should('equal', '/project')
  })

  it('transfers every project to another user, keeping the account', function () {
    const from = email('transfer-from')
    const to = email('transfer-to')
    createUser(from)
    createUser(to)
    login(from)
    createProject(projectName('Transfer-a')).as('projectA')
    createProject(projectName('Transfer-b')).as('projectB')

    login(ADMIN_EMAIL)
    visitList()
    search(from)
    rowAction(from, 'Transfer this user’s projects')
    dialog().within(() => {
      cy.findByRole('button', { name: 'Transfer this user’s projects' }).should(
        'be.disabled'
      )
    })
    pickOwner(to)
    confirmDialog('Transfer this user’s projects')

    cy.get<string>('@projectA').then(projectA => {
      cy.get<string>('@projectB').then(projectB => {
        projectAccess(to).then(access => {
          expect(access[projectA]).to.equal('owner')
          expect(access[projectB]).to.equal('owner')
        })
        // core keeps the old owner as an editor
        projectAccess(from).then(access => {
          expect(access[projectA]).to.equal('readWrite')
        })
      })
    })
    tryLogin(from).its('body.redir').should('equal', '/project')
  })

  it('deletes an account and gives its projects to another user', function () {
    const from = email('delete-from')
    const to = email('delete-to')
    createUser(from)
    createUser(to)
    login(from)
    createProject(projectName('Deleted-owner')).as('project')

    login(ADMIN_EMAIL)
    visitList()
    search(from)
    rowAction(from, 'Delete account')
    dialog().within(() => {
      cy.findByLabelText('Transfer this user’s projects').check()
      cy.findByRole('button', { name: 'Delete account' }).should('be.disabled')
    })
    pickOwner(to)
    confirmDialog('Delete account')

    tryLogin(from).its('status').should('equal', 401)
    cy.get<string>('@project').then(project => {
      projectAccess(to).its(project).should('equal', 'owner')
    })
  })

  it('finds deleted accounts from a search, restores and purges them', function () {
    const address = email('deleted')
    createUser(address)
    login(ADMIN_EMAIL)
    visitList()
    search(address)
    rowAction(address, 'Delete account')
    confirmDialog('Delete account')
    cy.get('tbody').should('contain.text', 'No Search Results')

    // the search tells about the deleted match and shows it
    cy.contains('.admin-panel-hint', 'Found 1 matching deleted users')
      .findByRole('button', { name: 'Display deleted users' })
      .click()
    row(address).should('contain.text', 'Deleted user')
    rowAction(address, 'Restore')
    confirmDialog('Restore')
    tryLogin(address).its('body.redir').should('equal', '/project')

    login(ADMIN_EMAIL)
    visitList()
    search(address)
    rowAction(address, 'Delete account')
    confirmDialog('Delete account')
    cy.findByRole('button', { name: 'Display deleted users' }).click()
    findUser(address, 'deleted').then(user => {
      rowAction(address, 'Delete permanently')
      dialog().should('contain.text', 'This action cannot be undone.')
      confirmDialog('Delete permanently')
      row(address).should('not.exist')
      cy.request({ url: `/admin/user/${user!.id}`, failOnStatusCode: false })
        .its('status')
        .should('equal', 404)
    })
    tryLogin(address, DEFAULT_PASSWORD).its('status').should('equal', 401)
  })

  it('offers an activation to a pending account, a reset to one that has logged in', function () {
    const pending = email('link-pending')
    const active = email('link-active')
    createUser(active)
    login(ADMIN_EMAIL)
    createAccount(pending)
    visitList()
    search(`list-${run}-link-`)
    row(pending).findByRole('button', { name: 'Send activation email' }).should('be.enabled')
    row(pending).findByRole('button', { name: 'Send reset link' }).should('not.exist')
    row(active).findByRole('button', { name: 'Send reset link' }).should('be.enabled')
    row(active).findByRole('button', { name: 'Send activation email' }).should('not.exist')
    userId(active).then(id => {
      visitUser(id)
      headerAction('Send reset link').should('be.enabled')
    })
  })

  it('shows the activation link, which activates the account', function () {
    const address = email('link-activate')
    login(ADMIN_EMAIL)
    createAccount(address)
    visitList()
    search(address)
    rowAction(address, 'Send activation email')
    dialog().find('.admin-panel-link').should('not.exist')
    sendLink('Send activation email').then(link => {
      // this site has no email settings
      dialog().should('contain.text', 'No email was sent')
      dialog().should('contain.text', 'Expires in 7 days')
      dialog().findByRole('button', { name: 'Cancel' }).should('not.exist')
      closeDialog()
      userId(address).then(id => {
        expectLogged(`/admin/user/${id}`, 'send-activation-email')
          .its('info.emailSent')
          .should('equal', false)
      })
      activateUser(link)
      tryLogin(address).its('body.redir').should('equal', '/project')
    })
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      cy.request(`/admin/user/${id}/audit-log/list?operation=send-activation-email`)
        .its('body.entries.0.initiatorEmail')
        .should('equal', ADMIN_EMAIL)
    })
  })

  it('shows a reset link, which sets a new password', function () {
    const address = email('link-reset')
    const newPassword = `${run}-New-Password-1`
    createUser(address)
    login(ADMIN_EMAIL)
    visitList()
    search(address)
    rowAction(address, 'Send reset link')
    sendLink('Send reset link').then(link => {
      dialog().should('contain.text', 'Expires in 1 hour')
      closeDialog()
      userId(address).then(id => {
        expectLogged(`/admin/user/${id}`, 'send-password-reset-email')
          .its('info.emailSent')
          .should('equal', false)
      })
      cy.clearAllCookies()
      cy.visit(link)
      cy.get('input[name="password"]').type(newPassword)
      cy.findByRole('button', { name: 'Set new password' }).click()
      // in the page from the start, shown once the password is set
      cy.contains('Your password has been successfully changed').should('be.visible')
      tryLogin(address, newPassword).its('body.redir').should('equal', '/project')
      tryLogin(address).its('status').should('equal', 401)
    })
    login(ADMIN_EMAIL)
    userId(address).then(id => {
      cy.request(`/admin/user/${id}/audit-log/list?operation=send-password-reset-email`)
        .its('body.entries.0.initiatorEmail')
        .should('equal', ADMIN_EMAIL)
    })
  })

  it('greys the links out on accounts that cannot use them, and the endpoints refuse them', function () {
    const offNever = email('grey-off-never')
    const offUsed = email('grey-off-used')
    const sso = email('grey-sso')
    const active = email('grey-active')
    const pending = email('grey-pending')
    createUser(offUsed)
    createUser(active)
    login(ADMIN_EMAIL)
    createAccount(offNever)
    createAccount(pending)
    postWithCsrf('/admin/user/create', { email: sso, isExternal: true })
      .its('status')
      .should('equal', 200)
    setSuspended(offNever, true)
    setSuspended(offUsed, true)
    visitList()
    search(`list-${run}-grey-`)
    row(offNever).findByRole('button', { name: 'Send activation email' }).should('be.disabled')
    row(offUsed).findByRole('button', { name: 'Send reset link' }).should('be.disabled')
    row(sso).findByRole('button', { name: 'Send activation email' }).should('be.disabled')

    const refused = (address: string, path: string) =>
      userId(address).then(id =>
        postWithCsrf(`/admin/user/${id}/${path}`, {}).its('status').should('equal', 422)
      )
    refused(offNever, 'send-activation')
    refused(offUsed, 'send-password-reset')
    refused(sso, 'send-activation')
    refused(sso, 'send-password-reset')
    refused(active, 'send-activation')
    refused(pending, 'send-password-reset')
  })

  it('forgets the picked new owner once the box is edited, and offers nobody disabled', function () {
    const from = email('picker-from')
    const to = email('picker-to')
    const other = email('picker-other')
    const off = email('picker-off')
    ;[from, to, other, off].forEach(address => createUser(address))
    login(ADMIN_EMAIL)
    setSuspended(off, true)
    visitList()
    search(from)
    rowAction(from, 'Transfer this user’s projects')
    const confirm = () =>
      dialog().findByRole('button', { name: 'Transfer this user’s projects' })

    pickOwner(to)
    confirm().should('be.enabled')
    // what the box then shows is not who the action would go to
    ownerPicker().clear()
    confirm().should('be.disabled')
    ownerPicker().type(other)
    confirm().should('be.disabled')
    dialog().find('.modal-title').click()
    ownerPicker().should('have.value', '')
    confirm().should('be.disabled')

    const list = uniqueAlias('list')
    interceptSearch('/admin/users/list', off).as(list)
    ownerPicker().type(off)
    cy.wait(`@${list}`)
    cy.findByRole('option', { name: new RegExp(off) }).should('not.exist')
    ownerPicker().clear()

    pickOwner(other)
    confirm().should('be.enabled')
    dialog().findByRole('button', { name: 'Cancel' }).click()
    dialog().should('not.exist')

    // nor directly
    userId(from).then(fromId =>
      userId(off).then(offId =>
        postWithCsrf(`/admin/user/${fromId}/transfer-projects`, { toUserId: offId })
          .its('status')
          .should('equal', 404)
      )
    )
  })

  it('ignores a late answer to an older search for a new owner', function () {
    const target = email('late-target')
    const newer = email('late-ab')
    const older = `list-${run}-late-a`
    createUser(target)
    createUser(email('late-a'))
    createUser(newer)
    login(ADMIN_EMAIL)
    visitList()
    search(target)
    rowAction(target, 'Transfer this user’s projects')
    cy.intercept({ pathname: '/admin/users/list', query: { search: older } }, req => {
      req.on('response', res => {
        res.setDelay(2000)
      })
    })
    ownerPicker().type(older)
    // past the picker's delay: that request is out
    cy.wait(500)
    ownerPicker().type('b')
    cy.contains('[role="option"]', newer).should('exist')
    // by now the older answer has come in
    cy.wait(2500)
    cy.findAllByRole('option').should('have.length', 1)
  })

  it('leaves no tag on the new owner for a user with no project to give', function () {
    const from = email('notag-from')
    const to = email('notag-to')
    createUser(from)
    createUser(to)
    login(ADMIN_EMAIL)
    visitList()
    userId(from).then(fromId =>
      userId(to).then(toId =>
        postWithCsrf(`/admin/user/${fromId}/transfer-projects`, { toUserId: toId })
          .its('body.projectCount')
          .should('equal', 0)
      )
    )
    login(to)
    cy.request('/tag')
      .its('body')
      .then((tags: { name: string }[]) => {
        expect(tags.map(tag => tag.name)).not.to.include(`transferred-from-${from}`)
      })
  })

  it('keeps a disabled account disabled through deleting and restoring it', function () {
    const address = email('stays-disabled')
    createUser(address)
    login(ADMIN_EMAIL)
    setSuspended(address, true)
    visitList()
    userId(address).then(id => {
      postWithCsrf(`/admin/user/${id}/delete`, {}).its('status').should('equal', 200)
      postWithCsrf(`/admin/user/${id}/restore`, {}).its('status').should('equal', 200)
    })
    findUser(address).its('suspended').should('equal', true)
    tryLogin(address).its('body.redir').should('equal', '/account-suspended')
  })

  it('brings back what went with the account, not what the user had deleted', function () {
    const address = email('restored-projects')
    createUser(address)
    login(address)
    createProject(projectName('Kept')).then(kept => {
      createProject(projectName('Deleted on purpose')).then(deleted => {
        cy.visit('/project')
        requestWithCsrf('DELETE', `/project/${deleted}`)
          .its('status')
          .should('be.lessThan', 300)
        login(ADMIN_EMAIL)
        visitList()
        userId(address).then(id => {
          postWithCsrf(`/admin/user/${id}/delete`, {}).its('status').should('equal', 200)
          postWithCsrf(`/admin/user/${id}/restore`, {}).its('status').should('equal', 200)
        })
        expectLogged(`/admin/project/${kept}`, 'project-restored')
        projectAccess(address).then(access => {
          expect(access[kept]).to.equal('owner')
          expect(access).not.to.have.property(deleted)
        })
      })
    })
  })

  // Their session only drops the isAdmin it logged in with
  it('keeps an admin who loses the role logged in, without the role', function () {
    const address = email('demoted')
    createUser(address)
    login(ADMIN_EMAIL)
    makeAdmin(address)
    // the browser of the new admin, logged in with the role
    login(address)
    cy.visit('/project')
    cy.getCookie('overleaf.sid').its('value').as('userCookie')

    login(ADMIN_EMAIL)
    visitList()
    userId(address).then(id => {
      postWithCsrf(`/admin/user/${id}/update`, { isAdmin: false })
        .its('status')
        .should('equal', 200)
    })
    cy.get<string>('@userCookie').then(value => {
      cy.clearAllCookies()
      cy.setCookie('overleaf.sid', value)
      cy.request({ url: '/user/personal_info', followRedirect: false })
        .its('status')
        .should('equal', 200)
      cy.request({ url: '/admin/user', followRedirect: false })
        .its('status')
        .should('not.equal', 200)
      cy.visit('/project')
      cy.findByRole('menubar')
        .findByRole('menuitem', { name: 'Admin' })
        .should('not.exist')
    })
  })

  it('gives a logged in user who gets the role the Admin menu, without a new login', function () {
    const address = email('promoted')
    createUser(address)
    login(address)
    cy.visit('/project')
    cy.findByRole('menubar')
      .findByRole('menuitem', { name: 'Admin' })
      .should('not.exist')
    cy.getCookie('overleaf.sid').its('value').as('userCookie')

    login(ADMIN_EMAIL)
    makeAdmin(address)
    cy.get<string>('@userCookie').then(value => {
      cy.clearAllCookies()
      cy.setCookie('overleaf.sid', value)
      cy.visit('/project')
      cy.findByRole('menubar').findByRole('menuitem', { name: 'Admin' })
    })
  })

  it('refuses a field or a value the forms do not send, and changes nothing', function () {
    const address = email('internal-field')
    createUser(address)
    login(ADMIN_EMAIL)
    visitList()
    userId(address).then(id => {
      for (const body of [
        { firstName: 'Changed', hashedPassword: 'not-a-hash' },
        { firstName: 'Changed', lastActive: '2020-01-01T00:00:00.000Z' },
        { firstName: 'Changed', isAdmin: 'yes' },
        { firstName: 'Changed', suspended: 1 },
        { firstName: 'Changed', email: 1 },
        { firstName: 1 },
        { firstName: 'Changed', features: 1 },
        { firstName: 'Changed', features: { papers: false } },
        { firstName: 'Changed', features: { dropbox: 'no' } },
        { firstName: 'Changed', features: { collaborators: '3' } },
        { firstName: 'Changed', aiFeatures: { enabled: true, quota: 1 } },
      ]) {
        postWithCsrf(`/admin/user/${id}/update`, body)
          .its('status')
          .should('equal', 422)
      }
    })
    findUser(address).then(user => {
      expect(user?.firstName).not.to.equal('Changed')
      expect(user?.isAdmin).to.equal(false)
      expect(user?.suspended).to.equal(false)
    })
    tryLogin(address).its('body.redir').should('equal', '/project')
  })

  // A stale page: somebody restored the account after the dialog opened
  it('answers 404 to a purge of a user who is not deleted, and logs nothing', function () {
    const address = email('purge-live')
    createUser(address)
    login(ADMIN_EMAIL)
    visitList()
    userId(address).then(id => {
      requestWithCsrf('DELETE', `/admin/user/${id}`)
        .its('status')
        .should('equal', 404)
      userId(ADMIN_EMAIL).then(adminId => {
        cy.request(
          `/admin/user/${adminId}/audit-log/list?operation=purge-deleted-user&search=&pageSize=200`
        )
          .its('body.entries')
          .then((entries: { info?: { userId?: string } }[]) => {
            expect(entries.map(entry => entry.info?.userId)).not.to.include(id)
          })
      })
    })
    tryLogin(address).its('body.redir').should('equal', '/project')
  })
})

describe('bulk actions', function () {
  // the toolbar left of Create account, for the ticked rows
  function bulk(name: string) {
    return cy.get('.admin-panel-bulk-actions').findByRole('button', { name })
  }

  function tickAll() {
    cy.get('#admin-users-select-all').check()
  }

  it('says how many rows are ticked and starts afresh on a new search', function () {
    login(ADMIN_EMAIL)
    visitList()
    cy.get('.admin-panel-bulk-actions').should('not.exist')
    cy.get('tbody tr input[type="checkbox"]:not([disabled])').eq(0).check()
    cy.get('tbody tr input[type="checkbox"]:not([disabled])').eq(1).check()
    cy.get('.admin-panel-footer').should('contain.text', '2 selected')
    cy.get('.admin-panel-bulk-actions').should('exist')
    // a new search starts afresh
    search(`list-${run}-`)
    cy.get('.admin-panel-footer').should('not.contain.text', 'selected')
    cy.get('.admin-panel-bulk-actions').should('not.exist')
  })

  it('keeps the ticks when a bulk action is cancelled', function () {
    login(ADMIN_EMAIL)
    visitList()
    cy.get('tbody tr input[type="checkbox"]:not([disabled])').eq(0).check()
    cy.get('tbody tr input[type="checkbox"]:not([disabled])').eq(1).check()
    for (const name of ['Delete account', 'Disable', 'Make admin']) {
      bulk(name).click()
      dialog().findByRole('button', { name: 'Cancel' }).click()
      dialog().should('not.exist')
      cy.get('.admin-panel-footer').should('contain.text', '2 selected')
    }
  })

  it('does not tick the own account', function () {
    // an account the same search finds, so there is something to tick
    const peer = email('tickadmin')
    expect(peer).to.contain(ADMIN_EMAIL)
    createUser(peer)
    login(ADMIN_EMAIL)
    visitList()
    search(ADMIN_EMAIL)
    userRow(ADMIN_EMAIL).find('input[type="checkbox"]').should('be.disabled')
    // ticking all leaves it out
    cy.get('#admin-users-select-all').check()
    userRow(peer).find('input[type="checkbox"]').should('be.checked')
    userRow(ADMIN_EMAIL).find('input[type="checkbox"]').should('not.be.checked')
  })

  it('sends activations while every ticked account waits for one, and shows each link', function () {
    const pending = [email('bulklink-a'), email('bulklink-b')]
    const active = email('bulklink-active')
    createUser(active)
    login(ADMIN_EMAIL)
    pending.forEach(address => createAccount(address))
    visitList()
    search(`list-${run}-bulklink-`)
    pending.forEach(address => row(address).find('input[type="checkbox"]').check())
    bulk('Send activation email').should('be.enabled').click()
    sendLink('Send activation email')
    dialog().find('.admin-panel-link code').should('have.length', 2)
    pending.forEach(address => dialog().should('contain.text', address))
    closeDialog()

    tickAll()
    bulk('Send activation email').should('be.disabled')
  })

  it('logs enabling only on an account that was disabled', function () {
    const never = email('enable-never')
    const disabled = email('enable-disabled')
    createUser(never)
    createUser(disabled)
    login(ADMIN_EMAIL)
    setSuspended(disabled, true)
    visitList()
    search(`list-${run}-enable-`)
    tickAll()
    bulk('Enable').click()
    confirmDialog('Enable')
    const entries = (address: string) =>
      userId(address).then(id =>
        cy
          .request(`/admin/user/${id}/audit-log/list?operation=account-reactivation`)
          .its('body.entries')
      )
    entries(never).should('have.length', 0)
    entries(disabled).should('have.length', 1)
  })

  it('disables and enables the ticked users, admins them and back', function () {
    const users = ['bulk-a', 'bulk-b', 'bulk-c'].map(name => email(name))
    users.forEach(address => createUser(address))
    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-`)
    cy.get('tbody tr').should('have.length', 3)

    tickAll()
    cy.get('.admin-panel-footer').should('contain.text', '3 selected')
    bulk('Disable').click()
    dialog().within(() => users.forEach(address => cy.contains(address)))
    confirmDialog('Disable')
    everyRow('tbody tr', text => text.includes('Disabled'))
    // done: the ticks are gone
    cy.get('#admin-users-select-all').should('not.be.checked')
    cy.get('.admin-panel-bulk-actions').should('not.exist')
    tryLogin(users[0]).its('body.redir').should('equal', '/account-suspended')

    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-`)
    tickAll()
    bulk('Enable').click()
    confirmDialog('Enable')
    everyRow('tbody tr', text => text.includes('Active'))
    tryLogin(users[0]).its('body.redir').should('equal', '/project')

    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-`)
    tickAll()
    bulk('Make admin').click()
    confirmDialog('Make admin')
    everyRow('tbody tr', text => / Admin /.test(` ${text} `.replace(/\s+/g, ' ')))
    login(users[1])
    cy.request({ url: '/admin/user', followRedirect: false })
      .its('status')
      .should('equal', 200)

    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-`)
    tickAll()
    bulk('Remove admin').click()
    confirmDialog('Remove admin')
    everyRow('tbody tr', text => / User /.test(` ${text} `.replace(/\s+/g, ' ')))
    login(users[1])
    cy.request({ url: '/admin/user', followRedirect: false }).then(response => {
      expect(response.status).to.equal(302)
      expect(response.redirectedToUrl).to.contain('/restricted')
    })
  })

  it('deletes the ticked users and gives all their projects to one user', function () {
    const from = [email('bulk-gone-a'), email('bulk-gone-b')]
    const to = email('bulk-heir')
    for (const address of [...from, to]) createUser(address)
    login(from[0])
    createProject(projectName('Gone-a')).as('goneA')
    login(from[1])
    createProject(projectName('Gone-b')).as('goneB')

    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-gone-`)
    tickAll()
    bulk('Delete account').click()
    dialog().within(() => {
      cy.findByLabelText('Transfer this user’s projects').check()
      cy.findByRole('button', { name: 'Delete account' }).should('be.disabled')
    })
    pickOwner(to)
    confirmDialog('Delete account')
    tryLogin(from[0]).its('status').should('equal', 401)
    cy.get<string>('@goneA').then(goneA => {
      cy.get<string>('@goneB').then(goneB => {
        projectAccess(to).then(access => {
          expect(access[goneA]).to.equal('owner')
          expect(access[goneB]).to.equal('owner')
        })
      })
    })
  })

  it('transfers the projects of the ticked users to one user', function () {
    const from = [email('bulk-from-a'), email('bulk-from-b')]
    const to = email('bulk-to')
    for (const address of [...from, to]) createUser(address)
    login(from[0])
    createProject(projectName('Bulk-a')).as('projectA')
    login(from[1])
    createProject(projectName('Bulk-b')).as('projectB')

    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-from-`)
    tickAll()
    bulk('Transfer this user’s projects').click()
    // the ticked users cannot be the new owner
    cy.findByRole('combobox', { name: /Select a new owner/ }).type(`list-${run}-bulk-from-`)
    cy.get('.select-dropdown-menu').should('contain.text', 'No results found')
    cy.findByRole('combobox', { name: /Select a new owner/ }).clear()
    pickOwner(to)
    confirmDialog('Transfer this user’s projects')

    cy.get<string>('@projectA').then(projectA => {
      cy.get<string>('@projectB').then(projectB => {
        projectAccess(to).then(access => {
          expect(access[projectA]).to.equal('owner')
          expect(access[projectB]).to.equal('owner')
        })
      })
    })
  })

  it('deletes the ticked users, restores them and purges them', function () {
    const users = [email('bulk-del-a'), email('bulk-del-b')]
    users.forEach(address => createUser(address))
    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-del-`)
    tickAll()
    bulk('Delete account').click()
    confirmDialog('Delete account')
    cy.get('tbody').should('contain.text', 'No Search Results')
    tryLogin(users[0]).its('status').should('equal', 401)

    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-del-`)
    cy.findByRole('button', { name: 'Display deleted users' }).click()
    cy.get('tbody tr').should('have.length', 2)
    tickAll()
    // deleted users get restore and purge
    bulk('Disable').should('not.exist')
    bulk('Restore').click()
    confirmDialog('Restore')
    tryLogin(users[1]).its('body.redir').should('equal', '/project')

    login(ADMIN_EMAIL)
    visitList()
    search(`list-${run}-bulk-del-`)
    tickAll()
    bulk('Delete account').click()
    confirmDialog('Delete account')
    cy.findByRole('button', { name: 'Display deleted users' }).click()
    tickAll()
    bulk('Delete permanently').click()
    dialog().should('contain.text', 'This action cannot be undone.')
    confirmDialog('Delete permanently')
    cy.get('tbody').should('contain.text', 'No Search Results')
    findUser(users[0], 'deleted').should('equal', null)
  })

  // The table keeps the live rows when the list cannot answer: they must not
  // get the actions for deleted users
  it('keeps the live actions on live rows when the switch to Deleted fails', function () {
    const address = email('bulk-failed-switch')
    createUser(address)
    login(ADMIN_EMAIL)
    visitList()
    search(address)
    cy.intercept(
      { pathname: '/admin/users/list', query: { status: 'deleted' } },
      { statusCode: 500 }
    )
    filter('admin-users-filter-status', 'Deleted')
    cy.get('tbody').should('contain.text', address)
    tickAll()
    bulk('Disable').should('exist')
    bulk('Delete permanently').should('not.exist')
  })
})

describe('the License tab', function () {
  it('shows the license next to the user list', function () {
    login(ADMIN_EMAIL)
    visitList()
    cy.findByRole('tab', { name: 'License' }).click()
    cy.location('hash').should('equal', '#license')
    cy.findByRole('tab', { name: 'License', selected: true }).should('exist')
    cy.get('.tab-pane.active').invoke('text').should('not.be.empty')
    cy.findByRole('tab', { name: 'User administration' }).click()
    cy.findByRole('textbox', { name: 'Search' }).should('be.visible')
  })
})
