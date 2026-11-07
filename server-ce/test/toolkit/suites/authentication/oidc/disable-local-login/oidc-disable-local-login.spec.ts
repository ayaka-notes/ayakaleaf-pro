import {
  currentUser,
  idpEmail,
  resetAuthentikUsers,
  ssoLogin,
} from '../../../../../helpers/auth'
import { postWithCsrf } from '../../../../../helpers/request'

// Same deployment as the oidc suite, restarted with
// OVERLEAF_DISABLE_LOCAL_LOGIN=true: the login page only offers OIDC and
// email and password can't be posted directly either.

before(function () {
  resetAuthentikUsers()
})

describe('OIDC with local login disabled', function () {
  it('only shows the OIDC button on the login page', function () {
    cy.clearAllCookies()
    cy.visit('/login')
    cy.get('a[href="/oidc/login"]').should('be.visible')
    cy.get('form[name="loginForm"]').should('not.be.visible')
    cy.get('.ciam-login-register-or-text-container').should('not.exist')
    cy.findByText('Log in with your OIDC account').should('be.visible')
  })

  it('refuses an email and password sent to /login', function () {
    cy.clearAllCookies()
    cy.visit('/login')
    postWithCsrf('/login', {
      email: idpEmail('carol'),
      password: 'any password',
    })
      .its('status')
      .should('equal', 404)
  })

  it('still logs in with OIDC', function () {
    ssoLogin('/oidc/login', 'bob')
    currentUser().its('email').should('equal', idpEmail('bob'))
  })
})
