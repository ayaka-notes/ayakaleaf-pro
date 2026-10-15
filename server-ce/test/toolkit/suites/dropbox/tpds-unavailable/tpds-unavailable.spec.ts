import { login } from '../../../../helpers/login'
import { ensureUserExists } from '../../../../helpers/users'

// Without third-party-datastore, the webhook cannot queue the poll and must
// say so: Dropbox retries a notification answered with an error, not one
// answered with 200.

const MOCK = 'http://dropbox-mock:8080/_mock'

function mock(method: 'POST', path: string, body?: object) {
  return cy.request({ method, url: `${MOCK}${path}`, body })
}

function dropboxWidget() {
  return cy.contains('.settings-widget-container', 'Dropbox')
}

describe('the webhook', function () {
  it('answers an error when the poll cannot be queued', function () {
    const id = `dropbox-tpds-down-${Date.now()}`
    mock('POST', '/reset')
    mock('POST', '/account', { accountId: `dbid:${id}` })
    ensureUserExists(`${id}@example.com`)
    login(`${id}@example.com`)
    cy.visit('/user/settings')
    dropboxWidget().findByRole('link', { name: 'Link' }).click()
    dropboxWidget().findByRole('button', { name: 'Unlink' }).should('exist')

    mock('POST', '/notify').its('body.status').should('equal', 500)
  })
})
