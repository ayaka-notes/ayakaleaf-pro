import { v4 as uuid } from 'uuid'
import { DEFAULT_PASSWORD } from '../../../../helpers/login'
import { submitDocs } from '../../../../helpers/openInOverleaf'
import { ensureUserExists } from '../../../../helpers/users'

// With public access the module's own login handling is reached: /devs is
// public, and a signed-out post is parked until the visitor has logged in.

const user = `user-${uuid()}@example.com`

before(function () {
  ensureUserExists(user)
})

it('shows the /devs page to signed-out visitors', function () {
  cy.clearAllCookies()
  cy.visit('/devs')
  cy.findByRole('heading', { name: 'Overleaf API' })
})

it('keeps a posted snippet through the login, once', function () {
  cy.clearAllCookies()
  submitDocs({ snip: 'Posted before logging in' }).then(response => {
    expect(response.status).to.equal(302)
    const resumeUrl = response.redirectedToUrl!.replace(
      Cypress.config('baseUrl')!,
      ''
    )
    expect(resumeUrl).to.match(/^\/docs\?resume=[0-9a-f-]{36}$/)

    cy.visit(resumeUrl)
    cy.url().should('contain', '/login')
    cy.get('input[name="email"]').type(user)
    cy.get('input[name="password"]').type(DEFAULT_PASSWORD)
    cy.findByRole('button', { name: 'Login' }).click()
    cy.url().should('match', /\/project\/[0-9a-f]{24}$/)
    cy.get('.cm-content').should('contain.text', 'Posted before logging in')

    cy.request({ url: resumeUrl, failOnStatusCode: false }).then(response => {
      expect(response.status).to.equal(422)
      expect(response.body).to.contain('has expired')
    })
  })
})
