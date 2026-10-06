import { login } from '../../../helpers/login'
import { createProject, openProject, projectName } from '../../../helpers/project'
import { ensureUserExists } from '../../../helpers/users'

// GET /system/features tells the browser which instance features the
// operator turned on, and the bundled UI of AI, GitHub Sync, Zotero and
// Mendeley hides itself when its feature is off. This instance keeps the
// toolkit's defaults, all of them off; the enabled/ variant turns them on.

const user = `instance-features-${Date.now()}@example.com`

// Visits the page and waits until it knows the features, so that checking
// for missing UI cannot pass before the UI could have appeared
function visitWithFeatures(url: string) {
  cy.intercept('GET', '/system/features').as('features')
  cy.visit(url)
  cy.wait('@features')
}

before(function () {
  ensureUserExists(user)
})

it('requires a login', function () {
  cy.request({ url: '/system/features', followRedirect: false }).then(
    response => {
      expect(response.status).to.equal(302)
      expect(response.redirectedToUrl).to.contain('/login')
    }
  )
})

it('reports every feature off', function () {
  login(user)
  cy.request('/system/features').its('body').should('deep.equal', {
    ai: false,
    githubSync: false,
    zotero: false,
    mendeley: false,
  })
})

it('hides the integrations in the account settings', function () {
  login(user)
  visitWithFeatures('/user/settings')
  cy.findByRole('heading', { name: 'Change password' }).should('exist')
  cy.contains('.settings-widget-container', 'Zotero').should('not.exist')
  cy.contains('.settings-widget-container', 'Mendeley').should('not.exist')
  cy.contains('.settings-widget-container', 'GitHub').should('not.exist')
})

it('hides the GitHub import in the project list', function () {
  login(user)
  // Without projects the list shows a welcome page instead
  createProject(projectName('Features'))
  cy.visit('/project')
  // The menu asks for the features when it opens
  cy.intercept('GET', '/system/features').as('features')
  cy.findAllByRole('button', { name: 'New project' }).first().click()
  cy.wait('@features')
  cy.findByRole('menuitem', { name: 'Blank project' }).should('exist')
  cy.findByRole('menuitem', { name: 'Import from GitHub' }).should('not.exist')
})

it('hides the AI assistant in the editor', function () {
  login(user)
  createProject(projectName('Features')).then(projectId => {
    cy.intercept('GET', '/system/features').as('features')
    openProject(projectId)
    cy.wait('@features')
  })
  cy.findByRole('tab', { name: 'File tree' }).should('exist')
  cy.findByRole('tab', { name: 'AI assistant' }).should('not.exist')
})
