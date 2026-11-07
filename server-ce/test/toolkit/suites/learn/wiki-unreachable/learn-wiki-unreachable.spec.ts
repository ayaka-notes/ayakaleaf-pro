import { login } from '../../../../helpers/login'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../../helpers/users'

// Pages cached by the main suite are stale and cannot be fetched again
// (variables.env), so they are served from the cache.

before(function () {
  ensureAdminExists()
})

describe('learn pages while the wiki is unreachable', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
  })

  it('keeps serving the cached copy of a stale page', function () {
    // The second visit finds the copy the failed refresh kept
    for (let visit = 0; visit < 2; visit++) {
      cy.visit('/learn/latex/Lists')
      cy.get('.page .page-header h1').should(h1 => {
        expect(h1.text().trim()).to.equal('Lists')
      })
      cy.get('.contents .mw-parser-output')
        .findByRole('link', { name: 'Lists' })
        .should('exist')
    }
  })
})
