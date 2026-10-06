// External authentication against the authentik of services/authentik. Its
// test users (blueprint.yaml) all share one password:
//   alice  groups Admins, Staff
//   bob    group Staff
//   carol  group Admins
//   dave   no groups
//   eve    eve@other.test, frank  frank@sub.ayakaleaf.test
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

// Logs in through the IdP from /saml/login or /oidc/login.
export function ssoLogin(path: '/saml/login' | '/oidc/login', username: string) {
  cy.clearAllCookies()
  // Use the button on the login page like a user. A cy.visit() of the SSO
  // route would make authentik the top origin, and the session cookie that
  // keeps the OIDC state would not come back with the callback.
  cy.visit('/login')
  cy.get(`a[href="${path}"]`).click()
  authentikLogin(username)
  cy.url({ timeout: 30_000 }).should('contain', '/project')
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

// Puts the Admins group and alice's name back the way blueprint.yaml defines
// them, in case an earlier run stopped in the middle of changing them.
export function resetAuthentikUsers() {
  setAuthentikGroup('alice', 'Admins', true)
  setAuthentikGroup('carol', 'Admins', true)
  setAuthentikGroup('bob', 'Admins', false)
  setAuthentikGroup('dave', 'Admins', false)
  setAuthentikName('alice', 'Alice Admin')
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
