import { login } from './login'
import { inviteLink, waitForEmail } from './mailpit'
import { createProject, projectName } from './project'
import { createRateLimitWaiter } from './rateLimit'
import { postWithCsrf } from './request'
import { inviteToProject } from './sharing'

// POST /register allows 5 requests per minute per IP. Use 4, to leave room for
// requests this waiter does not count.
export const waitForRegisterSlot = createRateLimitWaiter(4, 60_000)

export function postRegister(body: Record<string, string>) {
  waitForRegisterSlot()
  cy.visit('/register')
  return postWithCsrf('/register', body).then(response => {
    if (response.status !== 429) return response
    // Requests from before this spec (e.g. the previous variant) used up the
    // window, wait for it to reset.
    cy.wait(61_000)
    return postWithCsrf('/register', body)
  })
}

// Opens the invite link of an address without an account logged out, signs up
// through the Sign up link of the login page it lands on, sets the password
// on the activation page and joins the project. Ends logged in as the address.
export function signUpThroughInvite(
  link: string,
  email: string,
  password: string
) {
  cy.clearAllCookies()
  cy.visit(link)
  cy.url().should('contain', '/login')
  cy.findByRole('link', { name: 'Sign up' }).click()
  cy.findByLabelText('email')
    .should('have.value', email)
    .and('have.attr', 'readonly')
  waitForRegisterSlot()
  cy.findByRole('button', { name: 'Create account' }).click()
  cy.url().should('contain', '/user/activate')
  cy.intercept('POST', '/user/password/set').as('activate')
  cy.get('input[name="password"]').type(password)
  cy.findByRole('button', { name: 'Activate' }).click()
  // The activation logs in and sends the page back to the invite. Under
  // Cypress that page still carries the session cookie from before the login
  // (a plain headless Chrome carries the new one), so log in with the new
  // password and open the invite the activation sent the page to.
  cy.wait('@activate')
    .its('response.body.redir')
    .should('contain', '/invite/token/')
    .then(redir => {
      cy.clearAllCookies()
      login(email, password)
      cy.visit(redir as unknown as string)
    })
  cy.findByRole('button', { name: 'Join Project' }).click()
}

// The inviter invites the address to a new project, then the invite link is
// opened signed out. Answers the project id.
export function openInviteSignedOut(
  email: string,
  inviter: string,
  inviterPassword?: string
) {
  login(inviter, inviterPassword)
  return createProject(projectName('Invite')).then(projectId => {
    inviteToProject(projectId, email)
    waitForEmail(email).then(text => {
      cy.clearAllCookies()
      cy.visit(inviteLink(text))
      cy.url().should('contain', '/login')
    })
    return cy.wrap(projectId)
  })
}

// The invite the session came with offers the form for its address
export function expectInviteSignUp(email: string) {
  cy.visit('/register')
  cy.findByLabelText('email')
    .should('have.value', email)
    .and('have.attr', 'readonly')
  cy.findByRole('button', { name: 'Create account' })
}

// The invite the session came with makes no account
export function expectNoInviteSignUp() {
  cy.visit('/register')
  cy.contains('would like you to join').should('not.exist')
  waitForRegisterSlot()
  postWithCsrf('/register/invite', {})
    .its('body.redir')
    .should('equal', '/login')
}

// Without invite sign up there is no /register/invite: signed out, it meets the
// login wall like any other page of a private instance
export function expectNoInviteRoute() {
  cy.clearAllCookies()
  cy.visit('/login')
  waitForRegisterSlot()
  postWithCsrf('/register/invite', {}).then(response => {
    expect(response.status).to.equal(302)
    expect(response.headers.location).to.contain('/login')
  })
}
