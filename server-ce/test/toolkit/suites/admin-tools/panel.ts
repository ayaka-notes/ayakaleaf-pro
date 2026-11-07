import { postWithCsrf } from '../../../helpers/request'
import { ADMIN_EMAIL, ensureUserExists } from '../../../helpers/users'

// The admin panel of the admin-tools module: the user list (/admin/user),
// a user's page (/admin/user/:id) and a project's page
// (/admin/project/:id). The helpers expect to be logged in as an admin.

// The latest entry of this operation on the log of a user's or a project's
// page (/admin/user/:id, /admin/project/:id), checking who did it
export function expectLogged(
  page: string,
  operation: string,
  initiator = ADMIN_EMAIL
) {
  const query = new URLSearchParams({ operation, pageSize: '200' })
  return cy
    .request(`${page}/audit-log/list?${query}`)
    .its('body.entries')
    .then((entries: { initiatorEmail?: string }[]) => {
      expect(entries, operation).to.have.length.at.least(1)
      expect(entries[0].initiatorEmail, operation).to.equal(initiator)
      return entries[0]
    })
}

export const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Waits for the list's answer to this search, not for a load of the list
// that is still on its way (a tab reloads when it is shown)
// cy.wait('@name') answers with the oldest request of that name nobody
// waited for, also one that an earlier intercept of the same name caught
// (the reloads after an action): a helper that intercepts on every call
// gives each call a name of its own
let aliases = 0
export function uniqueAlias(name: string) {
  aliases += 1
  return `${name}-${aliases}`
}

export function interceptSearch(pathname: string, text: string) {
  return cy.intercept({
    method: 'GET',
    pathname,
    query: { search: new RegExp(`^${escapeRegExp(text)}$`) },
  })
}

export type ListedUser = {
  id: string
  email: string
  firstName?: string
  lastName?: string
  isAdmin: boolean
  suspended: boolean
  deleted: boolean
  authMethods: { type: string; providerId?: string }[]
}

// The user as the list's endpoint finds it by email, also a deleted one
export function findUser(
  email: string,
  status: 'all' | 'deleted' = 'all'
): Cypress.Chainable<ListedUser | null> {
  const query = new URLSearchParams({ search: email, status })
  return cy
    .request(`/admin/users/list?${query}`)
    .then(
      response =>
        response.body.users.find((u: ListedUser) => u.email === email) ?? null
    )
}

export function userId(email: string): Cypress.Chainable<string> {
  return findUser(email).then(user => {
    expect(user, `user ${email}`).to.not.equal(null)
    return user!.id
  })
}

// Makes the user an admin like the Account tab's switch
export function makeAdmin(email: string) {
  userId(email).then(id => {
    cy.visit(`/admin/user/${id}`)
    postWithCsrf(`/admin/user/${id}/update`, { isAdmin: true })
      .its('status')
      .should('equal', 200)
  })
}

// The page of a user or a project, on one of its tabs (the URL hash)
export function visitUser(id: string, tab = 'account') {
  cy.visit(`/admin/user/${id}#${tab}`)
  cy.findByRole('tab', { selected: true }).should('exist')
}

export function visitProject(id: string, tab = 'overview') {
  cy.visit(`/admin/project/${id}#${tab}`)
  cy.findByRole('tab', { selected: true }).should('exist')
}

export function openTab(name: string) {
  cy.findByRole('tab', { name }).click()
  cy.findByRole('tab', { name, selected: true }).should('exist')
}

// The icons next to the name on a user's or a project's page
export function header() {
  return cy.get('.admin-panel-user-header')
}

export function headerAction(name: string | RegExp) {
  return header().findByRole('button', { name })
}

export function dialog() {
  return cy.findByRole('dialog')
}

// Confirms the open modal with its main button and waits for it to close
export function confirmDialog(button: string | RegExp) {
  dialog().within(() => {
    cy.findByRole('button', { name: button }).should('be.enabled').click()
  })
  dialog().should('not.exist')
}

// Confirms the modal of a password link, which stays open to show it, and
// answers the first link
export function sendLink(button: string): Cypress.Chainable<string> {
  dialog().within(() => {
    cy.findByRole('button', { name: button }).should('be.enabled').click()
  })
  return dialog().find('.admin-panel-link code').first().invoke('text')
}

export function closeDialog() {
  dialog().findByRole('button', { name: 'Close' }).click()
  dialog().should('not.exist')
}

// The new owner picker of the transfer, delete and change owner modals: it
// searches every user of the site
export function ownerPicker() {
  return cy.findByRole('combobox', { name: /Select a new owner/ })
}

export function pickOwner(email: string) {
  ownerPicker().type(email)
  cy.findByRole('option', { name: new RegExp(escapeRegExp(email)) }).click()
  // the picked user reads "Name <email>"
  ownerPicker().invoke('val').should('contain', email)
}

// The row of the shown tab's table that holds the text: every page keeps
// its tabs mounted, and a hidden audit log names the same users
export function row(text: string) {
  return cy.contains('.tab-pane.active tbody tr', text)
}

// The rows of the active tab's table, as their text
export function rowTexts(): Cypress.Chainable<string[]> {
  // read once a paged list has answered: its rows render with the answer
  cy.get('.tab-pane.active').should(pane => {
    expect(pane.find('.admin-panel-loading').length, 'loading').to.equal(0)
  })
  return cy
    .get('.tab-pane.active tbody tr')
    .then(rows => [...rows].map(r => r.innerText.replace(/\s+/g, ' ').trim()))
}

// ensureUserExists from any state: it checks the launchpad first, which a
// logged in admin can open too and would take for an empty instance
export function createUser(email: string) {
  cy.clearAllCookies()
  ensureUserExists(email)
}

// The row of a user by the exact email (row() matches part of a text, and
// "admin@example.com" is part of "list-x-admin@example.com")
export function userRow(email: string) {
  return cy
    .get('.tab-pane.active tbody tr')
    .filter((_, tr) =>
      [...tr.querySelectorAll('a, div, span')].some(
        el => el.children.length === 0 && el.textContent?.trim() === email
      )
    )
    .should('have.length', 1)
}

// Waits until every row of the active list matches (the list renders again
// after a search or filter answers)
export function everyRow(selector: string, test: (text: string) => boolean) {
  cy.get(selector).should(rows => {
    expect(rows.length, 'rows').to.be.greaterThan(0)
    for (const tr of [...rows]) {
      expect(test(tr.innerText), tr.innerText).to.equal(true)
    }
  })
}
