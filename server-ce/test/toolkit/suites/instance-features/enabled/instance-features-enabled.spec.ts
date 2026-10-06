import { login } from '../../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../../helpers/project'
import { ensureUserExists } from '../../../../helpers/users'

// Every feature turned on: /system/features reports them and their UI shows
// up in the account settings, the project list and the editor.

const user = `instance-features-enabled-${Date.now()}@example.com`

// Clicking the tab of the open rail panel would close it
function openRailTab(name: string) {
  cy.findByRole('tab', { name }).then(tab => {
    if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
  })
}

before(function () {
  ensureUserExists(user)
})

it('reports every feature on', function () {
  login(user)
  cy.request('/system/features').its('body').should('deep.equal', {
    ai: true,
    githubSync: true,
    zotero: true,
    mendeley: true,
  })
})

it('shows the integrations in the account settings', function () {
  login(user)
  cy.visit('/user/settings')
  cy.contains('.settings-widget-container', 'Zotero')
    .findByRole('button', { name: 'Link to Zotero' })
    .should('exist')
  cy.contains('.settings-widget-container', 'Mendeley')
    .findByRole('button', { name: 'Link to Mendeley' })
    .should('exist')
  cy.contains('.settings-widget-container', 'GitHub').should('exist')
})

it('offers the GitHub import in the project list', function () {
  login(user)
  // Without projects the list shows a welcome page instead
  createProject(projectName('Features'))
  cy.visit('/project')
  cy.findAllByRole('button', { name: 'New project' }).first().click()
  cy.findByRole('menuitem', { name: 'Import from GitHub' }).should('exist')
})

it('shows the AI assistant and the integrations in the editor', function () {
  login(user)
  createProject(projectName('Features')).then(openProject)
  cy.findByRole('tab', { name: 'AI assistant' }).should('exist')
  openRailTab('Integrations')
  cy.findByRole('button', { name: /GitHub/ }).should('exist')
  cy.findByRole('button', { name: /Zotero/ }).should('exist')
  cy.findByRole('button', { name: /Mendeley/ }).should('exist')
})
