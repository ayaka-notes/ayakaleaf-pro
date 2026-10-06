import { activateUser, DEFAULT_PASSWORD, login } from './login'
import { postWithCsrf } from './request'

// Every suite runs on its own fresh instance, so suites create their users
// over HTTP the way an admin would, instead of relying on another suite.
export const ADMIN_EMAIL = 'admin@example.com'

// Creates the first admin through the launchpad, unless one exists already.
export function ensureAdminExists(password = DEFAULT_PASSWORD) {
  cy.visit('/launchpad')
  cy.url().then(url => {
    // Anonymous visitors are sent to /login once an admin exists.
    if (!url.includes('/launchpad')) return
    cy.get('meta[name="ol-adminUserExists"]')
      .invoke('attr', 'content')
      .then(adminUserExists => {
        if (adminUserExists === 'true') return
        postWithCsrf('/launchpad/register_admin', {
          email: ADMIN_EMAIL,
          password,
        })
          .its('status')
          .should('equal', 200)
      })
  })
}

// Lets the admin register the user and activates it with the given password.
// Leaves the browser logged out.
export function ensureUserExists(email: string, password = DEFAULT_PASSWORD) {
  ensureAdminExists()
  login(ADMIN_EMAIL)
  cy.visit('/admin/register')
  postWithCsrf('/admin/register', { email }).then(response => {
    expect(response.status).to.equal(200)
    activateUser(response.body.setNewPasswordUrl, password)
  })
  cy.clearAllCookies()
}
