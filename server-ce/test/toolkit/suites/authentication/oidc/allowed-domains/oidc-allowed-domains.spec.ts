import {
  authentikLogin,
  idpEmail,
  resetAuthentikUsers,
  ssoLogin,
} from '../../../../../helpers/auth'

// Same deployment as the oidc suite, restarted with
// OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS=ayakaleaf.test: only that domain gets
// an account on the first OIDC login, existing accounts are not affected.

before(function () {
  resetAuthentikUsers()
})

function firstOidcLogin(username: string) {
  cy.clearAllCookies()
  // Start on Overleaf, see ssoLogin
  cy.visit('/login')
  cy.get('a[href="/oidc/login"]').click()
  authentikLogin(username)
}

describe('OIDC with allowed email domains', function () {
  it('still logs in an existing account', function () {
    ssoLogin('/oidc/login', 'alice')
  })

  it(`refuses an account for ${idpEmail('eve')}`, function () {
    firstOidcLogin('eve')
    cy.url({ timeout: 30_000 }).should('contain', '/register')
  })

  it(`refuses an account for the subdomain address ${idpEmail('frank')}`, function () {
    firstOidcLogin('frank')
    cy.url({ timeout: 30_000 }).should('contain', '/register')
  })
})
