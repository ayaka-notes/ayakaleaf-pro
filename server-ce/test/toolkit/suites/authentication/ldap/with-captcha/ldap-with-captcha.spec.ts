import { ldapLogin, resetAuthentikUsers } from '../../../../../helpers/auth'
import {
  resetRecaptchaMock,
  stubRecaptcha,
  verifiedTokens,
} from '../../../../../helpers/recaptcha'
import { postWithCsrf } from '../../../../../helpers/request'

// Same deployment as the ldap suite, restarted with RECAPTCHA_SITE_KEY: the
// LDAP login needs a captcha, checked against services/recaptcha-mock. The
// form sends the LDAP username, not an email, so a known device does not skip
// it.

before(function () {
  resetAuthentikUsers()
})

beforeEach(function () {
  resetRecaptchaMock()
})

describe('LDAP login with captcha', function () {
  it('logs in after the captcha passes', function () {
    stubRecaptcha()
    ldapLogin('bob')
    cy.url().should('contain', '/project')
    verifiedTokens().should('deep.equal', ['e2e-pass'])
  })

  it('refuses the login when the captcha fails', function () {
    stubRecaptcha('e2e-fail')
    ldapLogin('bob')
    // The form has several alerts, only the matching one is shown
    cy.contains('[role="alert"]:visible', 'not a robot')
    cy.url().should('contain', '/ldap/login')
  })

  it('refuses a login request without a captcha', function () {
    cy.clearAllCookies()
    cy.visit('/ldap/login')
    postWithCsrf('/ldap/login', {
      login: 'bob',
      password: Cypress.env('AUTHENTIK_USER_PASSWORD'),
    }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body.errorReason).to.equal('cannot_verify_user_not_robot')
    })
  })
})
