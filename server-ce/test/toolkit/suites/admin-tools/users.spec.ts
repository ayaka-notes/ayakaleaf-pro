import { v4 as uuid } from 'uuid'
import { activateUser, DEFAULT_PASSWORD, login } from '../../../helpers/login'
import { createProject, openProject, projectName } from '../../../helpers/project'
import {
  adminUserInfo,
  dialog,
  projectAccess,
  row as userRow,
  rowAction,
  search as searchUsers,
  searchBox,
  selectNewOwner,
  setSuspended,
  tryLogin,
} from '../../../helpers/adminTools'
import { postWithCsrf } from '../../../helpers/request'
import { ADMIN_EMAIL, ensureUserExists } from '../../../helpers/users'

// Manage Users (/admin/user) of the admin-tools module: creating, finding,
// updating, disabling, deleting, restoring and purging accounts, as an admin
// does it in the browser. Each check of the result goes through what the
// user would notice: logging in, the projects they own, what they may do.

const user = `admin-tools-user-${uuid()}@example.com`

function visitManageUsers() {
  cy.visit('/admin/user')
  searchBox().should('exist')
}

function selectFilter(name: string) {
  cy.get('.user-list-filters').findByRole('button', { name }).click()
}

function createAccount(
  email: string,
  { firstName = 'Erika', lastName = 'Mustermann', isAdmin = false } = {}
) {
  cy.findAllByRole('button', { name: 'Create account' }).first().click()
  dialog().within(() => {
    cy.findByLabelText('Email address').type(email)
    cy.findByLabelText('First name').type(firstName)
    cy.findByLabelText('Last name').type(lastName)
    if (isAdmin) cy.findByLabelText('Set as admin').check()
    cy.findByRole('button', { name: 'Create' }).click()
  })
}

// The activation link that the Info modal shows for a new account
function activationLink(email: string) {
  searchUsers(email)
  rowAction(email, 'Info')
  dialog()
    .contains(/\/user\/activate\?token=/)
    .invoke('text')
    .as('activationLink', { type: 'static' })
  dialog().findByRole('button', { name: 'Close' }).click()
  dialog().should('not.exist')
  return cy
    .get<string>('@activationLink')
    .then(text => text.match(/\S*\/user\/activate\?token=\S+/)![0])
}

// Registers accounts the way the Create account modal does, without
// activating them
function createAccounts(emails: string[], firstName = 'Bulk') {
  cy.visit('/admin/user')
  emails.forEach((email, i) => {
    postWithCsrf('/admin/user/create', {
      email,
      first_name: `${firstName}${String(i).padStart(2, '0')}`,
      last_name: 'Tester',
    })
      .its('status')
      .should('equal', 200)
  })
}

function toolbar() {
  return cy.get('.user-tools')
}

function selectRows(emails: string[]) {
  for (const email of emails) {
    userRow(email).find('input[type="checkbox"]').check()
  }
}

before(function () {
  ensureUserExists(user)
})

describe('access', function () {
  it('sends signed out visitors to the login', function () {
    cy.request({ url: '/admin/user', followRedirect: false }).then(
      response => {
        expect(response.status).to.equal(302)
        expect(response.redirectedToUrl).to.contain('/login')
      }
    )
  })

  it('refuses the pages and the endpoints to users who are not admins', function () {
    const refused = `admin-tools-refused-${uuid()}@example.com`
    login(user)
    for (const url of ['/admin/user', '/admin/project']) {
      cy.request({ url, followRedirect: false }).then(response => {
        expect(response.status).to.equal(302)
        expect(response.redirectedToUrl).to.contain('/restricted')
      })
    }
    cy.visit('/project')
    for (const url of [
      '/admin/users',
      '/admin/users/search',
      '/admin/projects/search',
      '/admin/user/create',
    ]) {
      postWithCsrf(url, { search: user, email: refused }).then(response => {
        expect(response.status).to.equal(302)
        expect(response.redirectedToUrl).to.contain('/restricted')
      })
    }

    login(ADMIN_EMAIL)
    adminUserInfo(refused).should('equal', null)
  })

  it('links the pages from the Admin menu', function () {
    login(ADMIN_EMAIL)
    cy.visit('/project')
    cy.findByRole('menuitem', { name: 'Admin' }).click()
    cy.findByRole('menuitem', { name: 'Manage Users' }).click()
    cy.url().should('contain', '/admin/user')
    searchBox().should('exist')
  })
})

describe('finding users', function () {
  const email = `admin-tools-find-${uuid()}@example.com`
  let userId: string

  before(function () {
    ensureUserExists(email)
    login(ADMIN_EMAIL)
    adminUserInfo(email).then(info => {
      userId = info.id
    })
  })

  it('finds a user by part of the email address and by id', function () {
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(email.split('@')[0].slice(-12))
    userRow(email).should('exist')
    cy.get('tbody tr').should('have.length', 1)

    cy.then(() => searchUsers(userId))
    userRow(email).should('exist')

    searchUsers(`nobody-${uuid()}`)
    cy.findByText('No Search Results').should('exist')
  })

  it('finds a user by an email address with characters of a regular expression', function () {
    const plus = `admin-tools+${uuid()}@example.com`
    ensureUserExists(plus)
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(plus)
    userRow(plus).should('exist')
    cy.get('tbody tr').should('have.length', 1)
    // not a valid regular expression, searched as it is
    postWithCsrf('/admin/users/search', { search: '(' })
      .its('status')
      .should('equal', 200)
  })

  it('shows the account details in Info', function () {
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(email)
    rowAction(email, 'Info')
    dialog().within(() => {
      cy.contains(email).should('exist')
      cy.contains(userId).should('exist')
      cy.findByRole('button', { name: 'Close' }).click()
    })
    dialog().should('not.exist')
  })
})

describe('creating accounts', function () {
  it('creates an account that the user activates with the link from Info', function () {
    const email = `admin-tools-new-${uuid()}@example.com`
    login(ADMIN_EMAIL)
    visitManageUsers()
    createAccount(email, { firstName: 'Neu', lastName: 'Konto' })
    dialog().should('not.exist')
    userRow(email).should('contain.text', 'Neu Konto')

    activationLink(email).then(link => {
      cy.clearAllCookies()
      activateUser(link)
    })
    tryLogin(email).its('body.redir').should('equal', '/project')
  })

  it('creates an admin', function () {
    const email = `admin-tools-new-admin-${uuid()}@example.com`
    login(ADMIN_EMAIL)
    visitManageUsers()
    createAccount(email, { isAdmin: true })
    dialog().should('not.exist')
    adminUserInfo(email).its('isAdmin').should('equal', true)

    visitManageUsers()
    selectFilter('Admin')
    searchUsers(email)
    userRow(email).should('exist')
  })

  it('refuses an email address that is already registered', function () {
    login(ADMIN_EMAIL)
    visitManageUsers()
    createAccount(user)
    dialog()
      .should(
        'contain.text',
        'This email address is already associated with a different Overleaf account.'
      )
      .findByRole('button', { name: 'Cancel' })
      .click()
  })
})

describe('updating accounts', function () {
  let email: string

  beforeEach(function () {
    email = `admin-tools-update-${uuid()}@example.com`
    ensureUserExists(email)
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(email)
    rowAction(email, 'Update')
    dialog().should('contain.text', 'Update account info')
  })

  it('changes the name and the email address the user logs in with', function () {
    const newEmail = `admin-tools-renamed-${uuid()}@example.com`
    dialog().within(() => {
      cy.findByLabelText('Email address').clear().type(newEmail)
      cy.findByLabelText('First name').clear().type('Ada')
      cy.findByLabelText('Last name').clear().type('Lovelace')
      cy.findByRole('button', { name: 'Confirm' }).click()
    })
    dialog().should('not.exist')
    userRow(newEmail).should('contain.text', 'Ada Lovelace')

    tryLogin(newEmail).its('body.redir').should('equal', '/project')
    tryLogin(email).its('status').should('equal', 401)
  })

  it('refuses an email address that is not valid', function () {
    dialog().within(() => {
      cy.findByLabelText('Email address').clear().type('not@valid@example.com')
      cy.findByRole('button', { name: 'Confirm' }).click()
      cy.contains('Email address is invalid').should('exist')
      cy.findByRole('button', { name: 'Cancel' }).click()
    })
    adminUserInfo(email).its('email').should('equal', email)
  })

  it('sets a new password', function () {
    const password = `e2e-${uuid()}`
    dialog().within(() => {
      cy.findByRole('tab', { name: 'Password' }).click()
      cy.findByLabelText('New password').type(password)
      cy.findByRole('button', { name: 'Confirm' }).click()
    })
    dialog().should('not.exist')

    tryLogin(email, password).its('body.redir').should('equal', '/project')
    tryLogin(email).its('status').should('equal', 401)
  })

  it('refuses a password that is too short', function () {
    dialog().within(() => {
      cy.findByRole('tab', { name: 'Password' }).click()
      cy.findByLabelText('New password').type('short')
      cy.findByRole('button', { name: 'Confirm' }).click()
      cy.contains('Password must be at least 8 characters long').should(
        'exist'
      )
    })
    tryLogin(email).its('body.redir').should('equal', '/project')
  })

  it('makes the user an admin and back', function () {
    dialog().within(() => {
      cy.findByLabelText('Set as admin').check()
      cy.findByRole('button', { name: 'Confirm' }).click()
    })
    dialog().should('not.exist')
    login(email)
    cy.request('/admin/user').its('status').should('equal', 200)

    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(email)
    rowAction(email, 'Update')
    dialog().within(() => {
      cy.findByLabelText('Set as admin').uncheck()
      cy.findByRole('button', { name: 'Confirm' }).click()
    })
    dialog().should('not.exist')
    login(email)
    cy.request({ url: '/admin/user', followRedirect: false }).then(response => {
      expect(response.status).to.equal(302)
      expect(response.redirectedToUrl).to.contain('/restricted')
    })
  })

  it('limits the editors the user may invite', function () {
    dialog().within(() => {
      cy.findByRole('tab', { name: 'Features' }).click()
      cy.findByLabelText('Collaborator limit (use -1 for unlimited)')
        .clear()
        .type('1')
      cy.findByLabelText('Compile Timeout (In second, no more than 600s)')
        .clear()
        .type('42')
      cy.findByRole('button', { name: 'Confirm' }).click()
    })
    dialog().should('not.exist')
    adminUserInfo(email)
      .its('features')
      .should('deep.equal', { collaborators: 1, compileTimeout: 42 })

    visitManageUsers()
    searchUsers(email)
    rowAction(email, 'Update')
    dialog().within(() => {
      cy.findByRole('tab', { name: 'Features' }).click()
      cy.findByLabelText('Collaborator limit (use -1 for unlimited)').should(
        'have.value',
        '1'
      )
      cy.findByLabelText(
        'Compile Timeout (In second, no more than 600s)'
      ).should('have.value', '42')
      cy.findByRole('button', { name: 'Cancel' }).click()
    })

    login(email)
    createProject(projectName('Limit')).then(projectId => {
      cy.visit('/project')
      const invite = (to: string) =>
        postWithCsrf(`/project/${projectId}/invite`, {
          email: to,
          privileges: 'readAndWrite',
        })
      invite(`editor-1-${uuid()}@example.com`)
        .its('body.invite')
        .should('not.equal', null)
      // its() refuses null, the answer for a refused invite
      invite(`editor-2-${uuid()}@example.com`).then(response => {
        expect(response.body.invite).to.equal(null)
      })
      // Viewers do not count
      postWithCsrf(`/project/${projectId}/invite`, {
        email: `viewer-${uuid()}@example.com`,
        privileges: 'readOnly',
      })
        .its('body.invite')
        .should('not.equal', null)
    })
  })

  it('takes a compile timeout of up to 600 seconds', function () {
    const setCompileTimeout = (seconds: string) => {
      cy.findByRole('tab', { name: 'Features' }).click()
      cy.findByLabelText('Compile Timeout (In second, no more than 600s)')
        .clear()
        .type(seconds)
      cy.findByRole('button', { name: 'Confirm' }).click()
    }
    dialog().within(() => {
      setCompileTimeout('601')
      cy.contains('invalid_compile_timeout').should('exist')
      cy.findByRole('button', { name: 'Cancel' }).click()
    })
    adminUserInfo(email)
      .its('features.compileTimeout')
      .should('not.equal', 601)

    visitManageUsers()
    searchUsers(email)
    rowAction(email, 'Update')
    dialog().within(() => setCompileTimeout('600'))
    dialog().should('not.exist')
    adminUserInfo(email).its('features.compileTimeout').should('equal', 600)
  })

  it('turns AI off for the user and shows the token usage', function () {
    dialog().within(() => {
      cy.findByRole('tab', { name: 'AI features' }).click()
      cy.contains(/Usage: 0 \/ Limit: .+ tokens/).should('exist')
      cy.findByRole('button', { name: 'Reset' }).click()
      cy.findByRole('status').should('have.text', 'Done')
      cy.findByLabelText('Enable AI features').uncheck()
      cy.findByRole('button', { name: 'Confirm' }).click()
    })
    dialog().should('not.exist')
    adminUserInfo(email).its('aiFeatures.enabled').should('equal', false)
  })
})

describe('disabling accounts', function () {
  it('keeps a disabled user out until the account is enabled again', function () {
    const email = `admin-tools-suspend-${uuid()}@example.com`
    ensureUserExists(email)
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(email)
    rowAction(email, 'Disable')
    dialog().within(() => {
      cy.contains(email).should('exist')
      cy.findByRole('button', { name: 'Disable' }).click()
    })
    dialog().should('not.exist')
    selectFilter('Disabled')
    userRow(email).should('exist')

    tryLogin(email).its('body.redir').should('equal', '/account-suspended')

    login(ADMIN_EMAIL)
    visitManageUsers()
    selectFilter('Disabled')
    searchUsers(email)
    rowAction(email, 'Enable')
    dialog().findByRole('button', { name: 'Enable' }).click()
    dialog().should('not.exist')
    userRow(email).should('not.exist')

    tryLogin(email).its('body.redir').should('equal', '/project')
  })

  it('logs a user out when disabling the account', function () {
    const email = `admin-tools-suspend-session-${uuid()}@example.com`
    ensureUserExists(email)
    login(email)
    cy.getCookie('overleaf.sid').then(cookie => {
      login(ADMIN_EMAIL)
      setSuspended(email, true)

      // The session the user had before is gone
      cy.clearAllCookies()
      cy.setCookie('overleaf.sid', cookie!.value)
      cy.visit('/project')
      cy.url().should('contain', '/login')
    })
  })

  it('closes the editor a user has open when disabling the account', function () {
    const email = `admin-tools-suspend-editor-${uuid()}@example.com`
    ensureUserExists(email)
    login(ADMIN_EMAIL)
    adminUserInfo(email).its('id').as('userId', { type: 'static' })
    cy.getCookie('overleaf.sid').its('value').as('adminSid', { type: 'static' })

    login(email)
    createProject(projectName('Suspended editor')).then(openProject)

    // Disable the account as admin, from the open editor: switching the
    // cookie leaves its websocket connected
    cy.get<string>('@adminSid').then(adminSid => {
      cy.clearAllCookies()
      cy.setCookie('overleaf.sid', adminSid)
    })
    cy.request('/admin/user').then(response => {
      const csrfToken = response.body.match(
        /name="ol-csrfToken" content="([^"]+)"/
      )[1]
      cy.get<string>('@userId').then(userId => {
        cy.request({
          method: 'POST',
          url: `/admin/user/${userId}/update`,
          body: { suspended: true },
          headers: { 'X-Csrf-Token': csrfToken },
        })
      })
    })
    cy.clearAllCookies()

    dialog().should('contain', 'Removed from project')
    // Off to the dashboard, which asks for a login again
    cy.url({ timeout: 15_000 }).should('contain', '/login')
  })

  it('keeps a disabled user out when activating the account', function () {
    const email = `admin-tools-suspend-activate-${uuid()}@example.com`
    login(ADMIN_EMAIL)
    cy.visit('/admin/register')
    postWithCsrf('/admin/register', { email }).then(response => {
      expect(response.status).to.equal(200)
      setSuspended(email, true)

      cy.clearAllCookies()
      cy.visit(response.body.setNewPasswordUrl)
      cy.get('input[name="password"]').type(DEFAULT_PASSWORD)
      cy.findByRole('button', { name: 'Activate' }).click()
      cy.url().should('contain', '/account-suspended')
    })
  })

  it('disables and enables several selected users at once', function () {
    const prefix = `admin-tools-bulk-${uuid().slice(0, 8)}`
    const emails = [1, 2].map(i => `${prefix}-${i}@example.com`)
    login(ADMIN_EMAIL)
    createAccounts(emails)
    visitManageUsers()
    searchUsers(prefix)
    selectRows(emails)
    toolbar().findByRole('button', { name: 'Disable' }).click()
    dialog().within(() => {
      for (const email of emails) cy.contains(email).should('exist')
      cy.findByRole('button', { name: 'Disable' }).click()
    })
    dialog().should('not.exist')
    for (const email of emails) {
      adminUserInfo(email).its('suspended').should('equal', true)
    }

    visitManageUsers()
    selectFilter('Disabled')
    searchUsers(prefix)
    selectRows(emails)
    toolbar().findByRole('button', { name: 'Enable' }).click()
    dialog().findByRole('button', { name: 'Enable' }).click()
    dialog().should('not.exist')
    for (const email of emails) {
      // The list leaves suspended out for enabled users
      adminUserInfo(email).should('not.have.property', 'suspended')
    }
  })
})

describe('deleting accounts', function () {
  let email: string
  let projectId: string
  const name = projectName('Owned')

  beforeEach(function () {
    email = `admin-tools-delete-${uuid()}@example.com`
    ensureUserExists(email)
    login(email)
    createProject(name).then(id => {
      projectId = id
    })
  })

  function deleteUser(transferTo?: string) {
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(email)
    rowAction(email, 'Delete')
    dialog().within(() => {
      cy.contains('Delete account').should('exist')
      if (transferTo) {
        cy.findByLabelText('Transfer this user’s projects').check()
        // Deleting waits for the new owner
        cy.findByRole('button', { name: 'Delete' }).should('be.disabled')
        selectNewOwner(transferTo)
      }
      cy.findByRole('button', { name: 'Delete' }).click()
    })
    dialog().should('not.exist')
  }

  it('deletes an account and gives its projects to another user', function () {
    deleteUser(user)
    selectFilter('Deleted user')
    userRow(email).should('exist')
    tryLogin(email).its('status').should('equal', 401)

    cy.then(() =>
      projectAccess(user).its(projectId).should('equal', 'owner')
    )
  })

  it('restores a deleted account with its projects', function () {
    deleteUser()
    tryLogin(email).its('status').should('equal', 401)

    login(ADMIN_EMAIL)
    visitManageUsers()
    selectFilter('Deleted user')
    searchUsers(email)
    rowAction(email, 'Restore')
    dialog().findByRole('button', { name: 'Restore' }).click()
    dialog().should('not.exist')
    selectFilter('All')
    userRow(email).should('exist')

    // Back under "<name> (Restored)"
    cy.then(() => projectAccess(email).its(projectId).should('equal', 'owner'))
    tryLogin(email).its('body.redir').should('equal', '/project')
  })

  it('refuses to restore an account whose email address is taken again', function () {
    deleteUser()
    login(ADMIN_EMAIL)
    visitManageUsers()
    createAccount(email)
    dialog().should('not.exist')

    selectFilter('Deleted user')
    searchUsers(email)
    rowAction(email, 'Restore')
    dialog().within(() => {
      cy.findByRole('button', { name: 'Restore' }).click()
      cy.contains(
        'This email address is already associated with a different Overleaf account.'
      ).should('exist')
    })
  })

  it('purges a deleted account for good', function () {
    deleteUser()
    login(ADMIN_EMAIL)
    visitManageUsers()
    selectFilter('Deleted user')
    searchUsers(email)
    rowAction(email, 'Delete permanently')
    dialog().findByRole('button', { name: 'Delete permanently' }).click()
    dialog().should('not.exist')
    // Gone from the search results too
    userRow(email).should('not.exist')

    adminUserInfo(email).should('equal', null)
    visitManageUsers()
    selectFilter('Deleted user')
    searchUsers(email)
    cy.findByText('No Search Results').should('exist')
  })
})

describe('several selected users', function () {
  let prefix: string
  let emails: string[]

  beforeEach(function () {
    prefix = `admin-tools-many-${uuid().slice(0, 8)}`
    emails = [1, 2].map(i => `${prefix}-${i}@example.com`)
    login(ADMIN_EMAIL)
    createAccounts(emails)
    visitManageUsers()
    searchUsers(prefix)
    selectRows(emails)
  })

  it('makes them admins and back', function () {
    toolbar().findByRole('button', { name: 'set_admin' }).click()
    dialog().findByRole('button', { name: 'Grant admin' }).click()
    dialog().should('not.exist')
    for (const email of emails) {
      adminUserInfo(email).its('isAdmin').should('equal', true)
    }

    visitManageUsers()
    selectFilter('Admin')
    searchUsers(prefix)
    selectRows(emails)
    toolbar().findByRole('button', { name: 'unset_admin' }).click()
    dialog().findByRole('button', { name: 'Revoke admin' }).click()
    dialog().should('not.exist')
    for (const email of emails) {
      adminUserInfo(email).its('isAdmin').should('equal', false)
    }
  })

  it('deletes, restores and purges them', function () {
    toolbar().findByRole('button', { name: 'Delete' }).click()
    dialog().within(() => {
      for (const email of emails) cy.contains(email).should('exist')
      cy.findByRole('button', { name: 'Delete' }).click()
    })
    dialog().should('not.exist')
    for (const email of emails) {
      adminUserInfo(email).its('deleted').should('equal', true)
    }

    visitManageUsers()
    selectFilter('Deleted user')
    searchUsers(prefix)
    selectRows(emails)
    toolbar().findByRole('button', { name: 'Restore' }).click()
    dialog().findByRole('button', { name: 'Restore' }).click()
    dialog().should('not.exist')
    for (const email of emails) {
      adminUserInfo(email).its('deleted').should('equal', false)
    }

    visitManageUsers()
    // The page keeps the last filter
    selectFilter('All')
    searchUsers(prefix)
    selectRows(emails)
    toolbar().findByRole('button', { name: 'Delete' }).click()
    dialog().findByRole('button', { name: 'Delete' }).click()
    dialog().should('not.exist')
    visitManageUsers()
    selectFilter('Deleted user')
    searchUsers(prefix)
    selectRows(emails)
    toolbar().findByRole('button', { name: 'Delete permanently' }).click()
    dialog().findByRole('button', { name: 'Delete permanently' }).click()
    dialog().should('not.exist')
    for (const email of emails) userRow(email).should('not.exist')
    for (const email of emails) {
      adminUserInfo(email).should('equal', null)
    }
  })

  it('sends them new activation links', function () {
    cy.intercept('POST', '/admin/user/*/send-activation').as('send')
    toolbar().findByRole('button', { name: 'Resend' }).click()
    dialog().findByRole('button', { name: 'Resend' }).click()
    cy.wait('@send').its('response.statusCode').should('equal', 200)
    cy.wait('@send').its('response.statusCode').should('equal', 200)
    dialog().should('not.exist')
  })
})

describe('activation links', function () {
  it('sends a new activation link that activates the account', function () {
    const email = `admin-tools-resend-${uuid()}@example.com`
    login(ADMIN_EMAIL)
    createAccounts([email])
    visitManageUsers()
    searchUsers(email)
    cy.intercept('POST', '/admin/user/*/send-activation').as('send')
    rowAction(email, 'Resend')
    dialog().findByRole('button', { name: 'Resend' }).click()
    cy.wait('@send').its('response.statusCode').should('equal', 200)
    dialog().should('not.exist')

    activationLink(email).then(link => {
      cy.clearAllCookies()
      activateUser(link)
    })
    tryLogin(email).its('body.redir').should('equal', '/project')
  })

  it('shows the link in the Password tab of Update, or a generated password', function () {
    const email = `admin-tools-link-${uuid()}@example.com`
    login(ADMIN_EMAIL)
    createAccounts([email])
    visitManageUsers()
    searchUsers(email)
    rowAction(email, 'Update')
    dialog().within(() => {
      cy.findByRole('tab', { name: 'Password' }).click()
      cy.contains('code', /\/user\/activate\?token=/).should('exist')
      cy.findByRole('button', { name: 'Generate password' }).click()
      cy.findByLabelText('New password')
        .invoke('val')
        .should('match', /^[A-Z0-9]{12}$/)
        .then(password => {
          cy.contains('code', password as string).should('exist')
          cy.findByRole('button', { name: 'Confirm' }).click()
          cy.wrap(password).as('password')
        })
    })
    dialog().should('not.exist')
    cy.get<string>('@password').then(password => {
      tryLogin(email, password).its('body.redir').should('equal', '/project')
    })
  })
})

describe('the own account', function () {
  it('cannot be disabled, deleted or demoted by the admin', function () {
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(ADMIN_EMAIL)
    // Resend, suspend and Delete stay in the layout, but hidden
    userRow(ADMIN_EMAIL)
      .findAllByRole('button')
      .then(buttons => [...buttons].map(b => b.getAttribute('aria-label') ?? b.textContent))
      .should('deep.equal', ['Info', 'Update'])
    rowAction(ADMIN_EMAIL, 'Update')
    dialog().within(() => {
      cy.findByLabelText('Set as admin').should('be.checked').and('be.disabled')
      cy.findByRole('button', { name: 'Cancel' }).click()
    })

    // Nor selected for the tools above the list
    userRow(ADMIN_EMAIL).find('input[type="checkbox"]').should('be.disabled')
    cy.get('thead input[type="checkbox"]').should('be.disabled')
  })

  it('refuses a direct request to disable, delete or demote it', function () {
    login(ADMIN_EMAIL)
    adminUserInfo(ADMIN_EMAIL).then(admin => {
      for (const [url, body] of [
        [`/admin/user/${admin.id}/update`, { suspended: true }],
        [`/admin/user/${admin.id}/update`, { isAdmin: false }],
        [`/admin/user/${admin.id}/delete`, {}],
      ] as const) {
        postWithCsrf(url, body).its('status').should('equal', 422)
      }
    })
    // Still an admin, not disabled, not deleted
    adminUserInfo(ADMIN_EMAIL).then(admin => {
      expect(admin.isAdmin).to.equal(true)
      expect(admin.suspended).to.equal(undefined)
      expect(admin.deleted).to.equal(false)
    })
  })
})

describe('the list', function () {
  const prefix = `admin-tools-list-${uuid().slice(0, 8)}`
  const emails = Array.from(
    { length: 12 },
    (_, i) => `${prefix}-${String(i).padStart(2, '0')}@example.com`
  )

  before(function () {
    login(ADMIN_EMAIL)
    createAccounts(emails, 'List')
  })

  it('shows ten users at a time', function () {
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(prefix)
    cy.get('tbody tr').should('have.length', 10)
    cy.contains('Showing 10 out of 12 users').should('exist')
    cy.findByRole('button', { name: 'Show 2 more users' }).click()
    cy.get('tbody tr').should('have.length', 12)
    cy.contains('Showing 12 out of 12 users').should('exist')
  })

  it('sorts by name and by email', function () {
    login(ADMIN_EMAIL)
    visitManageUsers()
    searchUsers(prefix)
    cy.findByRole('button', { name: 'View all' }).click()
    // Names are List00 … List11 Tester
    cy.get('tbody tr').first().should('contain.text', emails[0])
    cy.findByRole('button', { name: /Sort by Email/ }).click()
    cy.get('tbody tr').first().should('contain.text', emails[0])
    cy.findByRole('button', { name: /Email/ }).click()
    cy.get('tbody tr').first().should('contain.text', emails[11])
    cy.get('tbody tr').last().should('contain.text', emails[0])
  })

  it('opens Manage Users from the projects page', function () {
    login(ADMIN_EMAIL)
    cy.visit('/admin/project')
    cy.findByRole('menuitem', { name: 'Admin' }).click()
    cy.findByRole('menuitem', { name: 'Manage Users' }).click()
    cy.url().should('contain', '/admin/user')
  })
})

describe('the license tab', function () {
  it('counts the users active in the last year', function () {
    login(ADMIN_EMAIL)
    visitManageUsers()
    cy.findByRole('tab', { name: 'License' }).click()
    cy.get('#license-usage')
      .should('be.visible')
      .invoke('text')
      .should('match', /\d+/)
  })
})
