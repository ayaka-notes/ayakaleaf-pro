import { login } from '../../../../helpers/login'
import { createProject, projectName } from '../../../../helpers/project'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../../helpers/users'
import { headerAction, visitProject } from '../panel'

// OVERLEAF_DISABLE_LINK_SHARING: the project page says nothing about link
// sharing, and saving its settings works as anywhere else.

before(function () {
  ensureAdminExists()
})

describe('a site without link sharing', function () {
  it('leaves link sharing out of the project page', function () {
    const renamed = projectName('Renamed')
    login(ADMIN_EMAIL)
    createProject(projectName('No links')).then(projectId => {
      visitProject(projectId)
      cy.get('.tab-pane.active')
        .should('contain.text', 'Compiler')
        .and('not.contain.text', 'Link sharing')
      headerAction('Edit').click()
      cy.get('#admin-project-name').clear().type(renamed)
      cy.get('.tab-pane.active').findByRole('button', { name: 'Save' }).click()
      cy.get('.tab-pane.active').contains('Saved').should('exist')
      cy.get('.admin-panel-user-header').should('contain.text', renamed)
    })
  })
})
