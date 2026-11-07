// External authentication against the authentik of services/authentik. Its
// test users (blueprint.yaml) all share one password:
//   alice  groups Admins, Staff
//   bob    group Staff
//   carol  group Admins
//   dave   no groups
//   eve    eve@other.test, frank  frank@sub.ayakaleaf.test
import { postWithCsrf } from './request'

export const AUTHENTIK_URL = 'http://authentik:9000'

export function idpEmail(username: string) {
  if (username === 'eve') return 'eve@other.test'
  if (username === 'frank') return 'frank@sub.ayakaleaf.test'
  return `${username}@ayakaleaf.test`
}

// Fills authentik's identification and password stages. The flow is a web
// component, its inputs live in shadow DOM.
export function authentikLogin(username: string) {
  cy.origin(
    AUTHENTIK_URL,
    { args: { username, password: Cypress.env('AUTHENTIK_USER_PASSWORD') } },
    ({ username, password }) => {
      const options = { includeShadowDom: true, timeout: 30_000 }
      cy.get('input[name="uidField"]', options).type(username)
      cy.contains('button', 'Log in', options).click()
      // The identification stage also has a hidden password input, wait for
      // the password stage before typing.
      cy.contains('a', 'Not you?', options)
      cy.get('input[name="password"]:visible', options).type(password)
      cy.contains('button', 'Continue', options).click()
    }
  )
}

// Logs in through the IdP from /saml/login or /oidc/login, landing on
// /project or the given page.
export function ssoLogin(
  path: '/saml/login' | '/oidc/login',
  username: string,
  landing = '/project'
) {
  cy.clearAllCookies()
  // Use the button on the login page like a user. A cy.visit() of the SSO
  // route would make authentik the top origin, and the session cookie that
  // keeps the OIDC state would not come back with the callback.
  cy.visit('/login')
  cy.get(`a[href="${path}"]`).click()
  authentikLogin(username)
  cy.url({ timeout: 30_000 }).should('contain', landing)
}

export function ldapLogin(username: string, password?: string) {
  cy.clearAllCookies()
  cy.visit('/ldap/login')
  cy.get('form[name="loginForm"] input[name="login"]').type(username)
  cy.get('form[name="loginForm"] input[name="password"]').type(
    password ?? Cypress.env('AUTHENTIK_USER_PASSWORD')
  )
  cy.get('form[name="loginForm"] button[type="submit"]').click()
}

function authentikApi(method: string, path: string, body?: object) {
  return cy.request({
    method,
    url: `${AUTHENTIK_URL}/api/v3/${path}`,
    headers: { Authorization: `Bearer ${Cypress.env('AUTHENTIK_TOKEN')}` },
    body,
  })
}

// Adds the authentik user to or removes it from a group.
export function setAuthentikGroup(
  username: string,
  group: string,
  member: boolean
) {
  authentikApi('GET', `core/users/?username=${username}`).then(users => {
    authentikApi('GET', `core/groups/?name=${encodeURIComponent(group)}`).then(
      groups => {
        authentikApi(
          'POST',
          `core/groups/${groups.body.results[0].pk}/${member ? 'add_user' : 'remove_user'}/`,
          { pk: users.body.results[0].pk }
        )
      }
    )
  })
}

export function setAuthentikName(username: string, name: string) {
  authentikApi('GET', `core/users/?username=${username}`).then(users => {
    authentikApi('PATCH', `core/users/${users.body.results[0].pk}/`, { name })
  })
}

export function setAuthentikEmail(username: string, email: string) {
  authentikApi('GET', `core/users/?username=${username}`).then(users => {
    authentikApi('PATCH', `core/users/${users.body.results[0].pk}/`, { email })
  })
}

// Replaces the user's custom attributes. The LDAP outpost returns them as LDAP
// attributes, overriding built-in ones of the same name; a list is returned
// as an attribute with several values.
export function setAuthentikAttributes(username: string, attributes: object) {
  authentikApi('GET', `core/users/?username=${username}`).then(users => {
    authentikApi('PATCH', `core/users/${users.body.results[0].pk}/`, {
      attributes,
    })
  })
}

// Puts the Admins group, alice's name, carol's email and the custom attributes
// back the way blueprint.yaml defines them, in case an earlier run stopped in
// the middle of changing them.
export function resetAuthentikUsers() {
  setAuthentikGroup('alice', 'Admins', true)
  setAuthentikGroup('carol', 'Admins', true)
  setAuthentikGroup('bob', 'Admins', false)
  setAuthentikGroup('dave', 'Admins', false)
  setAuthentikName('alice', 'Alice Admin')
  setAuthentikEmail('carol', idpEmail('carol'))
  setAuthentikAttributes('alice', {})
  setAuthentikAttributes('bob', {})
}

// Whether the logged in user may open the admin pages.
export function isSiteAdmin() {
  return cy
    .request({ url: '/admin/register', followRedirect: false })
    .then(response => response.status === 200)
}

// The logged in user as the pages see it (email, first_name, ...).
export function currentUser() {
  cy.visit('/user/settings')
  return cy
    .get('meta[name="ol-user"]')
    .invoke('attr', 'content')
    .then(content => JSON.parse(content as string))
}

// Asks for a password reset email like the form of /user/password/reset,
// logged out.
export function requestPasswordReset(email: string) {
  cy.clearAllCookies()
  cy.visit('/user/password/reset')
  return postWithCsrf('/user/password/reset', { email })
}

// The answer for an account whose password is managed by the IdP
export function expectSsoPasswordRefused(response: Cypress.Response<any>) {
  expect(response.status).to.equal(403)
  expect(response.body.message.key).to.equal('no-password-allowed-due-to-sso')
}

// Changes the password on the settings page like its form, logged in
export function updatePassword(currentPassword: string, newPassword: string) {
  cy.visit('/user/settings')
  return postWithCsrf('/user/password/update', {
    currentPassword,
    newPassword1: newPassword,
    newPassword2: newPassword,
  })
}
