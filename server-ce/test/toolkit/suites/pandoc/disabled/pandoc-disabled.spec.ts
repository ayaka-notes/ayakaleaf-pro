import { v4 as uuid } from 'uuid'
import { login } from '../../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../../helpers/project'
import { ensureUserExists } from '../../../../helpers/users'

// ENABLE_PANDOC_CONVERSIONS=false with the image still configured: neither
// the menus nor the routes for importing and exporting documents exist.

const user = `pandoc-disabled-${uuid()}@example.com`

before(function () {
  ensureUserExists(user)
})

it('hides document import and export', function () {
  login(user)
  createProject(projectName('NoPandoc')).then(projectId => {
    cy.visit('/project')
    cy.findAllByRole('button', { name: 'New project' }).first().click()
    cy.findByRole('menuitem', { name: 'Existing project (.zip)' }).should('exist')
    cy.findByRole('menuitem', { name: 'Word document' }).should('not.exist')
    cy.findByRole('menuitem', { name: 'Markdown document' }).should('not.exist')

    openProject(projectId)
    cy.findByRole('button', { name: 'Project title options' }).click()
    cy.findByRole('menuitem', { name: 'Rename' }).should('exist')
    cy.findByRole('menuitem', { name: /^Export as/ }).should('not.exist')

    cy.request({
      url: `/project/${projectId}/download/conversion/docx?responseFormat=json&rootResourcePath=main.tex`,
      failOnStatusCode: false,
    })
      .its('status')
      .should('equal', 404)
  })
})
