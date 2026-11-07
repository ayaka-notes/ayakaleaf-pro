import { login } from '../../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../../helpers/project'
import { postWithCsrf } from '../../../../helpers/request'
import { ensureUserExists } from '../../../../helpers/users'

// With rate limits on: 'Manual syncing is limited to one per minute', per
// project and user.

const MOCK = 'http://dropbox-mock:8080/_mock'

function mock(method: 'POST', path: string, body?: object) {
  return cy.request({ method, url: `${MOCK}${path}`, body })
}

function dropboxWidget() {
  return cy.contains('.settings-widget-container', 'Dropbox')
}

describe('syncing a project now', function () {
  it('is limited to one sync per minute', function () {
    const id = `dropbox-limit-${Date.now()}`
    mock('POST', '/reset')
    mock('POST', '/account', { accountId: `dbid:${id}` })
    ensureUserExists(`${id}@example.com`)
    login(`${id}@example.com`)
    createProject(projectName('Limit')).then(projectId => {
      cy.visit('/user/settings')
      dropboxWidget().findByRole('link', { name: 'Link' }).click()
      dropboxWidget().findByRole('button', { name: 'Unlink' }).should('exist')

      openProject(projectId)
      cy.findByRole('tab', { name: 'Integrations' }).then(tab => {
        if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
      })
      cy.findByRole('button', { name: /Dropbox/ }).click()
      cy.findByRole('button', { name: 'sync this project now' }).click()
      cy.findByRole('dialog').should(
        'contain.text',
        'A manual sync for this project has been started'
      )
      postWithCsrf(`/project/${projectId}/dropbox/sync-now`, {})
        .its('status')
        .should('equal', 429)
      // the dialog says so too
      cy.findAllByRole('button', { name: 'Close' }).last().click()
      cy.findByRole('button', { name: /Dropbox/ }).click()
      cy.findByRole('button', { name: 'sync this project now' }).click()
      cy.findByRole('dialog').should(
        'contain.text',
        'Manual syncing is limited to one per minute'
      )
    })
  })
})
