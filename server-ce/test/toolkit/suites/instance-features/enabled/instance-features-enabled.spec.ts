import {
  setUserFeatures,
  visitWithFeatures,
} from '../../../../helpers/adminTools'
import { login } from '../../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../../helpers/project'
import { ADMIN_EMAIL, ensureUserExists } from '../../../../helpers/users'

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
    gitlabSync: true,
    giteaSync: true,
    dropbox: true,
    zotero: true,
    mendeley: true,
    gitBridge: true,
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
  cy.contains('.settings-widget-container', 'Dropbox').should('exist')
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
  cy.findByRole('button', { name: /Dropbox/ }).should('exist')
  cy.findByRole('button', { name: /Zotero/ }).should('exist')
  cy.findByRole('button', { name: /Mendeley/ }).should('exist')
})

describe('what an admin turned off for one user', function () {
  const offUser = `instance-features-off-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(offUser)
    login(ADMIN_EMAIL)
    setUserFeatures(offUser, {
      github: false,
      dropbox: false,
      zotero: false,
      mendeley: false,
      gitBridge: false,
    })
  })

  it('reports it off for them, with the rest of the instance on', function () {
    login(offUser)
    cy.request('/system/features').its('body').should('deep.equal', {
      ai: true,
      githubSync: false,
      gitlabSync: true,
      giteaSync: true,
      dropbox: false,
      zotero: false,
      mendeley: false,
      gitBridge: false,
    })
  })

  it('hides it in the account settings, and leaves the rest', function () {
    login(offUser)
    visitWithFeatures('/user/settings')
    cy.contains('.settings-widget-container', 'GitLab').should('exist')
    for (const name of ['Zotero', 'Mendeley', 'GitHub', 'Dropbox', 'Git integration']) {
      cy.contains('.settings-widget-container', name).should('not.exist')
    }
  })

  it('leaves no empty group or stray line in the account settings', function () {
    login(offUser)
    visitWithFeatures('/user/settings')
    cy.contains('.settings-widget-container', 'GitLab').should('exist')
    cy.findByRole('heading', { name: 'Reference managers' }).should('not.exist')
    // GitLab and Gitea are left in this group: one line between them
    cy.get('#project-sync ~ .settings-widgets-container')
      .first()
      .find('> hr:visible')
      .should('have.length', 1)
  })

  it('hides it in the editor, and leaves the rest', function () {
    login(offUser)
    createProject(projectName('Off')).then(projectId => {
      cy.intercept('GET', '/system/features').as('features')
      openProject(projectId)
      cy.wait('@features')
    })
    openRailTab('Integrations')
    cy.findByRole('button', { name: /GitLab/ }).should('exist')
    for (const name of [/GitHub/, /Dropbox/, /Zotero/, /Mendeley/]) {
      cy.findByRole('button', { name }).should('not.exist')
    }
    cy.findByText('Git clone this project.').should('not.exist')
    cy.findByText('MCP server').should('not.exist')
  })

  it('leaves everyone else as they were', function () {
    login(user)
    cy.request('/system/features').its('body.githubSync').should('equal', true)
    cy.request('/system/features').its('body.gitBridge').should('equal', true)
  })
})
