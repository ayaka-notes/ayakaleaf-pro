import { DEFAULT_PASSWORD, login } from './login'
import { requestWithCsrf, postWithCsrf } from './request'

// Doing what the admin panel (/admin/user) does, for the suites that need an
// account in a given state.

// The user as the admin's list reports it, or null. Expects to be logged in
// as admin, and leaves the browser on a page with a CSRF token.
export function adminUserInfo(email: string) {
  cy.visit('/admin/user')
  const query = new URLSearchParams({ search: email, pageSize: '200' })
  return cy
    .request(`/admin/users/list?${query}`)
    .then(
      response =>
        response.body.users.find((u: { email: string }) => u.email === email) ??
        null
    )
}

// Suspends or resumes the user like the Disable and Enable actions of the
// list. Expects to be logged in as admin.
export function setSuspended(email: string, suspended: boolean) {
  adminUserInfo(email).then(user => {
    postWithCsrf(`/admin/user/${user.id}/update`, { suspended })
      .its('status')
      .should('equal', 200)
  })
}

// Sets features of the user like the Features tab of their page. Expects to be
// logged in as admin.
export function setUserFeatures(
  email: string,
  features: Record<string, boolean | number>
) {
  adminUserInfo(email).then(user => {
    postWithCsrf(`/admin/user/${user.id}/update`, { features })
      .its('status')
      .should('equal', 200)
  })
}

// Visits the page and waits until it knows what the user can use, so that
// checking for missing UI cannot pass before the UI could have appeared
export function visitWithFeatures(url: string) {
  cy.intercept('GET', '/system/features').as('features')
  cy.visit(url)
  cy.wait('@features')
}

type Route = [
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: Record<string, unknown>,
]

// What each route answers to a script, whatever the page offers. Expects to be
// on a page with a CSRF token.
export function expectRoutesAnswer(status: number, routes: Route[]) {
  for (const [method, url, body] of routes) {
    const request =
      method === 'GET'
        ? cy.request({ url, failOnStatusCode: false, followRedirect: false })
        : requestWithCsrf(method, url, body)
    request.then(response => {
      expect(response.status, `${method} ${url}`).to.equal(status)
    })
  }
}

// Creates a local account like the Create account modal, not activated.
// Expects to be logged in as admin.
export function createLocalAccount(email: string) {
  cy.visit('/admin/user')
  postWithCsrf('/admin/user/create', {
    email,
    first_name: 'Local',
    last_name: 'Account',
  })
    .its('status')
    .should('equal', 200)
}

// Sets a new password for the user like the edit form of a user's page.
// Expects to be logged in as admin.
export function setUserPassword(email: string, password: string) {
  return adminUserInfo(email).then(user =>
    postWithCsrf(`/admin/user/${user.id}/update`, { password })
  )
}

// Posts the login form like the login page does, without keeping the
// session. Answers {redir} where the page would go next, or 401.
export function tryLogin(email: string, password = DEFAULT_PASSWORD) {
  cy.clearAllCookies()
  cy.visit('/login')
  return cy
    .get('meta[name="ol-csrfToken"]')
    .invoke('attr', 'content')
    .then(csrfToken =>
      cy.request({
        method: 'POST',
        url: '/login',
        body: { email, password },
        headers: {
          'X-Csrf-Token': csrfToken as string,
          Accept: 'application/json',
        },
        failOnStatusCode: false,
        followRedirect: false,
      })
    )
}

// How the user may access each of their projects that is not trashed, by id
export function projectAccess(
  email: string
): Cypress.Chainable<Record<string, string>> {
  login(email)
  return cy
    .request('/user/projects')
    .then(response =>
      Object.fromEntries(
        response.body.projects.map(
          (p: { _id: string; accessLevel: string }) => [p._id, p.accessLevel]
        )
      )
    )
}
