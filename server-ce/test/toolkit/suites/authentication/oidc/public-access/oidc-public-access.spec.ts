import { postWithCsrf } from '../../../../../helpers/request'

// Same deployment as the oidc suite, restarted with
// OVERLEAF_ALLOW_PUBLIC_ACCESS=true: no global login check runs before the
// routes, so each route needs its own.

describe('OIDC with public access', function () {
  it('sends a visitor who is not logged in to the login page on unlink', function () {
    cy.clearAllCookies()
    cy.visit('/login')
    postWithCsrf('/user/oauth-unlink', { providerId: 'authentik' }).then(
      response => {
        expect(response.status).to.equal(302)
        expect(response.headers.location).to.contain('/login')
      }
    )
  })
})
