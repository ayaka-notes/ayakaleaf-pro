import { setSuspended } from '../../../helpers/adminTools'
import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import { shareProject } from '../../../helpers/sharing'
import { ADMIN_EMAIL, ensureUserExists } from '../../../helpers/users'

// Dropbox sync against services/dropbox-mock, which answers as Dropbox on the
// toolkit's network and sends Overleaf a signed webhook after each change,
// like Dropbox. Its control API resets it, changes the app folder the way
// the user would, reads it back and makes calls fail.

const MOCK = 'http://dropbox-mock:8080/_mock'
// Syncing goes through the webhook and the third-party-datastore queue
const SYNC_TIMEOUT = 30000

type MockFiles = { files: Record<string, string>; folders: string[] }
type MockStats = {
  calls: Record<string, number>
  refreshes: number
  tokens: { revoked: boolean }[]
}

function mock(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: object
) {
  return cy.request({ method, url: `${MOCK}${path}`, body })
}

// The app folder of the account of the last newUser, or of the given one
function dropboxFiles(account?: string): Cypress.Chainable<MockFiles> {
  const query = account ? `?account=${encodeURIComponent(account)}` : ''
  return mock('GET', `/files${query}`).its('body')
}

function mockStats(): Cypress.Chainable<MockStats> {
  return mock('GET', '/stats').its('body')
}

// Retries until the app folder satisfies the check, while the sync runs
function waitForDropbox(
  check: (files: MockFiles) => boolean,
  attempts = 60,
  account?: string
) {
  dropboxFiles(account).then(files => {
    if (check(files)) return
    expect(attempts, `Dropbox app folder ${JSON.stringify(files)}`).to.be.greaterThan(0)
    cy.wait(500)
    waitForDropbox(check, attempts - 1, account)
  })
}

function projectPaths(projectId: string): Cypress.Chainable<string[]> {
  return cy
    .request(`/project/${projectId}/entities`)
    .its('body.entities')
    .then((entities: { path: string }[]) => entities.map(e => e.path).sort())
}

// Retries until the project's file tree satisfies the check
function waitForProject(
  projectId: string,
  check: (paths: string[]) => boolean,
  attempts = 60
) {
  projectPaths(projectId).then(paths => {
    if (check(paths)) return
    expect(attempts, `project files ${JSON.stringify(paths)}`).to.be.greaterThan(0)
    cy.wait(500)
    waitForProject(projectId, check, attempts - 1)
  })
}

function docText(projectId: string, docId: string) {
  return cy
    .request(`/Project/${projectId}/doc/${docId}/download`)
    .its('body')
}

// Retries until third-party-datastore has no work queued for the user
function waitForSynced(attempts = 60) {
  cy.request('/user/tpds/queues').then(({ body }) => {
    if (body.tpdsToWeb === 0 && body.webToTpds === 0) return
    expect(attempts, `queues ${JSON.stringify(body)}`).to.be.greaterThan(0)
    cy.wait(500)
    waitForSynced(attempts - 1)
  })
}

function dropboxWidget() {
  return cy.contains('.settings-widget-container', 'Dropbox')
}

function connectionStatus() {
  return cy.request('/user/dropbox/status').its('body')
}

// Each test has its own user, with its own Dropbox account: one Dropbox
// account links to one user
function newUser(prefix: string) {
  const id = `${prefix}-${Date.now()}`
  ensureUserExists(`${id}@example.com`)
  login(`${id}@example.com`)
  mock('POST', '/account', { accountId: `dbid:${id}` })
  return `${id}@example.com`
}

// The settings page's Link button runs the whole OAuth flow
function linkDropboxAccount() {
  cy.visit('/user/settings')
  dropboxWidget().findByRole('link', { name: 'Link' }).click()
  cy.location('search').should('contain', 'oauth-complete=dropbox')
  dropboxWidget().findByRole('button', { name: 'Unlink' }).should('exist')
}

function addDoc(projectId: string, name: string, parentFolderId?: string) {
  return postWithCsrf(`/project/${projectId}/doc`, {
    name,
    parent_folder_id: parentFolderId,
  }).then(response => {
    expect(response.status).to.equal(200)
    return response.body._id as string
  })
}

function addFolder(projectId: string, name: string) {
  return postWithCsrf(`/project/${projectId}/folder`, {
    name,
    parent_folder_id: null,
  }).then(response => {
    expect(response.status).to.equal(200)
    return response.body._id as string
  })
}

// Clicking the tab of the open rail panel would close it
function openRailTab(name: string) {
  cy.findByRole('tab', { name }).then(tab => {
    if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
  })
}

// Retries until the edit typed in the editor reached the document updater
function waitForDocumentUpdater(projectId: string, text: string, attempts = 20) {
  cy.get('[data-file-type="doc"]')
    .first()
    .invoke('attr', 'data-file-id')
    .then(docId => cy.request(`/Project/${projectId}/doc/${docId}/download`))
    .then(({ body }) => {
      if (String(body).includes(text)) return
      expect(attempts, `${text} in the document updater`).to.be.greaterThan(0)
      cy.wait(250)
      waitForDocumentUpdater(projectId, text, attempts - 1)
    })
}

// Edits are saved a few minutes after everyone left the project; syncing
// the project now saves and sends them right away
function syncProjectNow(projectId: string) {
  postWithCsrf(`/project/${projectId}/dropbox/sync-now`, {})
    .its('status')
    .should('equal', 204)
}

function openSyncModal(projectId: string) {
  openProject(projectId)
  openRailTab('Integrations')
  cy.findByRole('button', { name: /Dropbox/ }).click()
  return cy.contains('[role="dialog"]', 'Sync with Dropbox').should('be.visible')
}

// The folder Dropbox numbered for a project named like another one, e.g.
// '/Thesis (1)' next to '/Thesis'
function numberedFolder(folders: string[], name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return folders.find(folder => new RegExp(`^/${escaped} \\(\\d+\\)$`).test(folder))
}

// Retries until Dropbox got at least count calls of the endpoint
function waitForCalls(endpoint: string, count: number, attempts = 60) {
  mockStats().then(({ calls }) => {
    if ((calls[endpoint] || 0) >= count) return
    expect(attempts, `${endpoint} calls`).to.be.greaterThan(0)
    cy.wait(500)
    waitForCalls(endpoint, count, attempts - 1)
  })
}

// Retries until a token was revoked at Dropbox, which unlinking does in the
// background
function waitForRevoked(attempts = 60) {
  mockStats().then(({ tokens }) => {
    if (tokens.some(token => token.revoked)) return
    expect(attempts, 'token revoked').to.be.greaterThan(0)
    cy.wait(500)
    waitForRevoked(attempts - 1)
  })
}

// Retries until third-party-datastore unlinked the Dropbox account
function waitForUnlinked(attempts = 60) {
  connectionStatus().then(linked => {
    if (!linked) return
    expect(attempts, 'unlinked').to.be.greaterThan(0)
    cy.wait(500)
    waitForUnlinked(attempts - 1)
  })
}

// A 1x1 PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

beforeEach(function () {
  mock('POST', '/reset')
})

describe('linking the Dropbox account', function () {
  it('links through the OAuth flow and unlinks again', function () {
    newUser('dropbox-link')
    cy.visit('/user/settings')
    dropboxWidget()
      .findByRole('link', { name: 'Link' })
      .should('have.attr', 'href', '/user/dropbox/oauth')
    dropboxWidget().should('contain.text', 'Keep your')
    connectionStatus().should('equal', false)

    linkDropboxAccount()
    cy.contains('successfully linked your Dropbox account').should('exist')
    connectionStatus().should('equal', true)

    dropboxWidget().findByRole('button', { name: 'Unlink' }).click()
    cy.findByRole('dialog')
      .should('contain.text', 'Unlink Dropbox Account')
      .and('contain.text', 'no longer kept in sync with Dropbox')
      .findByRole('button', { name: 'Unlink' })
      .click()
    dropboxWidget().findByRole('link', { name: 'Link' }).should('exist')
    connectionStatus().should('equal', false)
    // revoked in the background
    waitForRevoked()
  })

  it('shows the sync state on the settings page once linked', function () {
    newUser('dropbox-settings-status')
    cy.visit('/user/settings')
    dropboxWidget().find('[data-testid="dropbox-sync-status"]').should('not.exist')

    linkDropboxAccount()
    waitForSynced()
    cy.visit('/user/settings')
    dropboxWidget()
      .find('[data-testid="dropbox-sync-status"]')
      .should('contain.text', 'Overleaf and Dropbox have processed all updates')
  })

  describe('when connecting to Dropbox takes over a second', function () {
    afterEach(function () {
      mock('POST', '/connect-delay', { ms: 0 })
    })

    it('links the account and unlinks it again', function () {
      newUser('dropbox-slow')
      // fetch-utils' default agent gives up connecting after 1s
      mock('POST', '/connect-delay', { ms: 1200 })
      linkDropboxAccount()
      connectionStatus().should('equal', true)

      dropboxWidget().findByRole('button', { name: 'Unlink' }).click()
      cy.findByRole('dialog').findByRole('button', { name: 'Unlink' }).click()
      dropboxWidget().findByRole('link', { name: 'Link' }).should('exist')
      connectionStatus().should('equal', false)
      waitForRevoked()
    })
  })

  it('sends the app key, callback, offline access and a state to Dropbox', function () {
    newUser('dropbox-authorize')
    cy.visit('/user/settings')
    cy.request({ url: '/user/dropbox/oauth', followRedirect: false }).then(
      response => {
        expect(response.status).to.equal(302)
        const url = new URL(response.redirectedToUrl!)
        expect(url.origin + url.pathname).to.equal(
          'https://meta-dropbox.example.com/oauth2/authorize'
        )
        expect(url.searchParams.get('client_id')).to.equal('e2e-dropbox-app')
        expect(url.searchParams.get('redirect_uri')).to.equal(
          'http://sharelatex/user/dropbox/oauth/callback'
        )
        expect(url.searchParams.get('response_type')).to.equal('code')
        expect(url.searchParams.get('token_access_type')).to.equal('offline')
        expect(url.searchParams.get('state')).to.have.length.greaterThan(0)
      }
    )
  })

  it('refuses a callback without a valid state', function () {
    newUser('dropbox-state')
    cy.request({
      url: '/user/dropbox/oauth/callback?code=anything&state=forged',
      failOnStatusCode: false,
      followRedirect: false,
    })
      .its('status')
      .should('equal', 403)
    connectionStatus().should('equal', false)
  })

  it('stays unlinked when the user does not allow access', function () {
    newUser('dropbox-deny')
    mock('POST', '/deny-next-authorize')
    cy.visit('/user/settings')
    dropboxWidget().findByRole('link', { name: 'Link' }).click()
    cy.location('search').should('contain', 'oauth-complete=dropbox')
    dropboxWidget().findByRole('link', { name: 'Link' }).should('exist')
    connectionStatus().should('equal', false)
  })

  it('refuses a Dropbox account that is linked to another user', function () {
    const accountId = `dbid:shared-${Date.now()}`
    newUser('dropbox-first')
    mock('POST', '/account', { accountId })
    linkDropboxAccount()
    newUser('dropbox-second')
    mock('POST', '/account', { accountId })
    cy.visit('/user/settings')
    dropboxWidget().findByRole('link', { name: 'Link' }).click()
    cy.contains('already linked with another Overleaf account').should('exist')
    connectionStatus().should('equal', false)
  })

  it('sends a linked user back to the settings instead of linking again', function () {
    newUser('dropbox-relink')
    linkDropboxAccount()
    cy.request({ url: '/user/dropbox/oauth', followRedirect: false }).then(
      response => {
        expect(response.status).to.equal(302)
        expect(response.redirectedToUrl).to.match(/\/user\/settings\?oauth-complete=dropbox/)
      }
    )
  })

  it('refuses to link while projects share a name', function () {
    newUser('dropbox-duplicates')
    const name = projectName('Twin')
    createProject(name)
    createProject(name)
    cy.visit('/user/settings')
    dropboxWidget().findByRole('link', { name: 'Link' }).click()
    cy.contains('more than one project with the same name').should(
      'contain.text',
      name
    )
    connectionStatus().should('equal', false)
  })

  it('refuses to link while a trashed project shares a name', function () {
    newUser('dropbox-trashed-twin')
    const name = projectName('TrashedTwin')
    createProject(name)
    createProject(name).then(projectId => {
      postWithCsrf(`/project/${projectId}/trash`, {})
        .its('status')
        .should('equal', 200)
    })
    cy.visit('/user/settings')
    dropboxWidget().findByRole('link', { name: 'Link' }).click()
    cy.contains('more than one project with the same name').should(
      'contain.text',
      name
    )
    connectionStatus().should('equal', false)
  })
})

describe('Overleaf to Dropbox', function () {
  it('sends the projects to Dropbox when linking', function () {
    newUser('dropbox-initial')
    const name = projectName('Initial')
    createProject(name)
    linkDropboxAccount()
    waitForDropbox(({ files }) =>
      (files[`/${name}/main.tex`] || '').includes('Introduction')
    )
  })

  // web sends a project's changes to all its invited members, so linking
  // sends the projects the user was invited to as well
  it('sends the projects shared with the user when linking', function () {
    const owner = newUser('dropbox-sharer')
    const name = projectName('SharedBefore')
    createProject(name).as('projectId')
    const editor = `dropbox-invited-${Date.now()}@example.com`
    ensureUserExists(editor)
    cy.get<string>('@projectId').then(projectId => {
      login(owner)
      shareProject(projectId, editor, 'readAndWrite')
      // now logged in as the editor, who links Dropbox only now
      mock('POST', '/account', { accountId: `dbid:${editor.split('@')[0]}` })
      linkDropboxAccount()
      waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    })
  })

  it('sends edits, new docs and folders, renames, moves and deletions', function () {
    newUser('dropbox-outbound')
    const name = projectName('Outbound')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)

    cy.get<string>('@projectId').then(projectId => {
      // an edit in the editor
      openProject(projectId)
      cy.findByText('Introduction').type('{end}\nWritten in Overleaf')
      waitForDocumentUpdater(projectId, 'Written in Overleaf')
      syncProjectNow(projectId)
      waitForDropbox(({ files }) =>
        (files[`/${name}/main.tex`] || '').includes('Written in Overleaf')
      )

      // a new doc, renamed, moved into a new folder, then deleted
      addDoc(projectId, 'notes.tex').then(docId => {
        waitForDropbox(({ files }) => `/${name}/notes.tex` in files)
        postWithCsrf(`/project/${projectId}/doc/${docId}/rename`, {
          name: 'renamed.tex',
        })
        waitForDropbox(
          ({ files }) =>
            `/${name}/renamed.tex` in files && !(`/${name}/notes.tex` in files)
        )
        addFolder(projectId, 'chapters').then(folderId => {
          postWithCsrf(`/project/${projectId}/doc/${docId}/move`, {
            folder_id: folderId,
          })
          waitForDropbox(
            ({ files }) =>
              `/${name}/chapters/renamed.tex` in files &&
              !(`/${name}/renamed.tex` in files)
          )
        })
        requestWithCsrf('DELETE', `/project/${projectId}/doc/${docId}`)
        waitForDropbox(
          ({ files }) => !(`/${name}/chapters/renamed.tex` in files)
        )
      })
      // the deletions coming back from Dropbox change nothing in Overleaf
      waitForProject(projectId, paths =>
        paths.includes('/main.tex') && paths.length === 1
      )
    })
  })

  // Dropbox gets a doc only when document-updater writes it to docstore: on a
  // compile, or once nobody has had the project open for 3 minutes
  it('sends an edit once the project is closed, without compiling or Sync now', function () {
    newUser('dropbox-closed')
    const name = projectName('Closed')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)

    cy.get<string>('@projectId').then(projectId => {
      // a compile would write the docs to docstore: leave it out
      cy.intercept('POST', `/project/${projectId}/compile*`, { statusCode: 503 })
      openProject(projectId)
      cy.findByText('Introduction').type('{end}\nWritten before closing')
      waitForDocumentUpdater(projectId, 'Written before closing')
    })
    cy.visit('/project')
    waitForDropbox(
      ({ files }) =>
        (files[`/${name}/main.tex`] || '').includes('Written before closing'),
      600
    )
  })

  it('sends binary files', function () {
    newUser('dropbox-binary-out')
    const name = projectName('BinaryOut')
    // the example project has a picture, frog.jpg
    createProject(name, 'example')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/frog.jpg` in files)
  })

  it('skips a file Dropbox refuses and sends the next changes', function () {
    newUser('dropbox-refused')
    const name = projectName('Refused')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      mock('POST', '/fail', {
        endpoint: 'files/upload',
        status: 409,
        summary: 'path/disallowed_name/',
      })
      addDoc(projectId, 'refused.tex')
      addDoc(projectId, 'next.tex')
      waitForDropbox(({ files }) => `/${name}/next.tex` in files)
      dropboxFiles().its('files').should('not.have.property', `/${name}/refused.tex`)
    })
  })

  it('moves the project folder when the project is renamed', function () {
    newUser('dropbox-rename')
    const name = projectName('Before')
    const newName = projectName('After')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      postWithCsrf(`/project/${projectId}/rename`, { newProjectName: newName })
      waitForDropbox(
        ({ files }) =>
          `/${newName}/main.tex` in files && !(`/${name}/main.tex` in files)
      )
      // still the same project, not marked as deleted by the old folder
      cy.request(`/project/${projectId}/entities`).its('status').should('equal', 200)
    })
  })

  // Dropbox ignores case: such a rename conflicts with the entity itself
  it('renames a doc and a folder when only the case changes', function () {
    newUser('dropbox-case')
    const name = projectName('Case')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      addFolder(projectId, 'figures').then(folderId => {
        addDoc(projectId, 'fig.tex', folderId).then(docId => {
          waitForDropbox(({ files }) => `/${name}/figures/fig.tex` in files)
          postWithCsrf(`/project/${projectId}/doc/${docId}/rename`, {
            name: 'Fig.tex',
          })
          waitForDropbox(({ files }) => `/${name}/figures/Fig.tex` in files)
          postWithCsrf(`/project/${projectId}/folder/${folderId}/rename`, {
            name: 'Figures',
          })
          waitForDropbox(({ files }) => `/${name}/Figures/Fig.tex` in files)
        })
      })
      waitForSynced()
      waitForProject(
        projectId,
        paths => paths.join() === '/Figures/Fig.tex,/main.tex'
      )
    })
  })

  it('keeps the order of the changes when Dropbox fails for a while', function () {
    newUser('dropbox-order')
    const name = projectName('Order')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      // the upload of the new doc fails once, and is retried after its
      // deletion was queued: the deletion still comes last
      mock('POST', '/fail', { endpoint: 'files/upload', status: 503 })
      addDoc(projectId, 'gone.tex').then(docId => {
        requestWithCsrf('DELETE', `/project/${projectId}/doc/${docId}`)
      })
      // the retry backs off for 10 seconds
      waitForSynced()
      mockStats()
        .its('calls')
        .its('files/delete_v2')
        .should('be.greaterThan', 0)
      dropboxFiles()
        .its('files')
        .should('not.have.property', `/${name}/gone.tex`)
    })
  })
})

describe('Dropbox to Overleaf', function () {
  it('applies edits, new files, folders and deletions made in Dropbox', function () {
    newUser('dropbox-inbound')
    const name = projectName('Inbound')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)

    cy.get<string>('@projectId').then(projectId => {
      mock('PUT', '/files', {
        path: `/${name}/chapter.tex`,
        content: 'Chapter from Dropbox',
      })
      mock('POST', '/folders', { path: `/${name}/figures` })
      mock('PUT', '/files', {
        path: `/${name}/figures/caption.tex`,
        content: 'Caption',
      })
      waitForProject(
        projectId,
        paths =>
          paths.includes('/chapter.tex') &&
          paths.includes('/figures/caption.tex')
      )

      dropboxFiles().then(({ files }) => {
        mock('PUT', '/files', {
          path: `/${name}/main.tex`,
          content: files[`/${name}/main.tex`] + '\nEdited in Dropbox\n',
        })
      })
      openProject(projectId)
      cy.get('.cm-content', { timeout: SYNC_TIMEOUT }).should(
        'contain.text',
        'Edited in Dropbox'
      )

      mock('DELETE', '/files', { path: `/${name}/chapter.tex` })
      waitForProject(projectId, paths => !paths.includes('/chapter.tex'))
    })
  })

  it('does not send a change from Dropbox back to Dropbox', function () {
    newUser('dropbox-echo')
    const name = projectName('Echo')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      mock('PUT', '/files', { path: `/${name}/echo.tex`, content: 'Once\n' })
      waitForProject(projectId, paths => paths.includes('/echo.tex'))
      // Overleaf sends the new doc to Dropbox once; with the same contents,
      // which is no new change in Dropbox
      waitForSynced()
      mockStats().then(({ calls }) => {
        cy.wait(5000)
        mockStats()
          .its('calls')
          .its('files/upload')
          .should('equal', calls['files/upload'])
      })
      dropboxFiles().its('files').its(`/${name}/echo.tex`).should('equal', 'Once\n')
    })
  })

  it('keeps an edit made in Dropbox when Overleaf sends the file again before reading it', function () {
    newUser('dropbox-race')
    const name = projectName('Race')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    waitForSynced()
    cy.get<string>('@projectId').then(projectId => {
      // the webhook of the edit comes only after Sync now sent the project
      mock('POST', '/webhooks', { enabled: false })
      dropboxFiles().then(({ files }) => {
        mock('PUT', '/files', {
          path: `/${name}/main.tex`,
          content: files[`/${name}/main.tex`] + '\nNewer in Dropbox\n',
        })
      })
      syncProjectNow(projectId)
      waitForSynced()
      mock('POST', '/webhooks', { enabled: true })
      mock('POST', '/notify')
      waitForSynced()

      dropboxFiles()
        .its('files')
        .its(`/${name}/main.tex`)
        .should('contain', 'Newer in Dropbox')
      openProject(projectId)
      cy.get('.cm-content', { timeout: SYNC_TIMEOUT }).should(
        'contain.text',
        'Newer in Dropbox'
      )
    })
  })

  it('creates a project for a new folder in Dropbox', function () {
    newUser('dropbox-new-project')
    linkDropboxAccount()
    const name = projectName('FromDropbox')
    // the first poll after linking sets the cursor
    waitForSynced()
    mock('PUT', '/files', {
      path: `/${name}/main.tex`,
      content: '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n',
    })
    const findProject = (attempts = 60) => {
      cy.request('/user/projects').then(response => {
        const project = response.body.projects.find(
          (p: { name: string }) => p.name === name
        )
        if (project) return
        expect(attempts, 'project created').to.be.greaterThan(0)
        cy.wait(500)
        findProject(attempts - 1)
      })
    }
    findProject()
  })

  it('retries a failed download without losing the change', function () {
    newUser('dropbox-retry')
    const name = projectName('Retry')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      mock('POST', '/fail', { endpoint: 'files/download', status: 500 })
      mock('PUT', '/files', { path: `/${name}/late.tex`, content: 'Late\n' })
      waitForProject(projectId, paths => paths.includes('/late.tex'))
      mockStats().its('calls').its('files/download').should('be.greaterThan', 1)
    })
  })

  it('lists the whole folder again after its cursor was reset', function () {
    newUser('dropbox-reset')
    const name = projectName('Reset')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      mock('POST', '/reset-cursors')
      mock('PUT', '/files', { path: `/${name}/after.tex`, content: 'After\n' })
      waitForProject(projectId, paths => paths.includes('/after.tex'))
    })
  })

  it('adds binary files made in Dropbox as files', function () {
    newUser('dropbox-binary-in')
    const name = projectName('BinaryIn')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      mock('PUT', '/files', { path: `/${name}/logo.png`, base64: PNG_BASE64 })
      waitForProject(projectId, paths => paths.includes('/logo.png'))
      cy.request(`/project/${projectId}/entities`)
        .its('body.entities')
        .should('deep.include', { path: '/logo.png', type: 'file' })
    })
  })

  it('leaves the files Overleaf ignores in Dropbox', function () {
    newUser('dropbox-ignored')
    const name = projectName('Ignored')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      mock('PUT', '/files', { path: `/${name}/.DS_Store`, content: 'Finder\n' })
      mock('PUT', '/files', { path: `/${name}/kept.tex`, content: 'Kept\n' })
      waitForProject(projectId, paths => paths.includes('/kept.tex'))
      waitForSynced()
      projectPaths(projectId).should('not.include', '/.DS_Store')
      dropboxFiles().its('files').should('have.property', `/${name}/.DS_Store`)
    })
  })

  it('syncs a shared project both ways for an editor', function () {
    const owner = newUser('dropbox-owner-rw')
    const name = projectName('SharedRW')
    createProject(name).as('projectId')
    const editor = `dropbox-editor-${Date.now()}@example.com`
    ensureUserExists(editor)
    login(owner)
    cy.get<string>('@projectId').then(projectId => {
      shareProject(projectId, editor, 'readAndWrite')
      // now logged in as the editor
      linkDropboxAccount()
      // a change of the owner puts the shared project into the editor's
      // Dropbox
      login(owner)
      cy.visit('/project')
      addDoc(projectId, 'owner.tex')
      waitForDropbox(({ files }) => `/${name}/owner.tex` in files)
      // and the editor's changes in Dropbox come back to the project
      mock('PUT', '/files', { path: `/${name}/editor.tex`, content: 'Editor\n' })
      waitForProject(projectId, paths => paths.includes('/editor.tex'))
    })
  })

  it('marks the project as deleted when its folder is deleted in Dropbox', function () {
    newUser('dropbox-folder-deleted')
    const name = projectName('FolderDeleted')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    // the first poll after linking set the cursor, so the deletion is read
    waitForCalls('files/list_folder/get_latest_cursor', 1)
    cy.get<string>('@projectId').then(projectId => {
      mockStats().then(({ calls }) => {
        mock('DELETE', '/files', { path: `/${name}` })
        waitForCalls(
          'files/list_folder/continue',
          (calls['files/list_folder/continue'] || 0) + 1
        )
      })
      waitForSynced()
      // the editor tells when the project is opened
      cy.visit(`/project/${projectId}`)
      cy.contains('[role="dialog"]', 'Project Renamed or Deleted', {
        timeout: SYNC_TIMEOUT,
      }).should('be.visible')
    })
  })

  it('keeps changes of read-only collaborators out of the project', function () {
    const owner = newUser('dropbox-owner')
    const name = projectName('Shared')
    createProject(name).as('projectId')
    const reader = `dropbox-reader-${Date.now()}@example.com`
    ensureUserExists(reader)
    login(owner)
    cy.get<string>('@projectId').then(projectId => {
      shareProject(projectId, reader, 'readOnly')
      // now logged in as the reader
      linkDropboxAccount()
      // an edit of the owner, synced by the reader, puts the shared project
      // into the reader's Dropbox
      login(owner)
      openProject(projectId)
      cy.findByText('Introduction').type('{end}\nFrom the owner')
      waitForDocumentUpdater(projectId, 'From the owner')
      login(reader)
      cy.visit('/project')
      syncProjectNow(projectId)
      waitForDropbox(({ files }) =>
        (files[`/${name}/main.tex`] || '').includes('From the owner')
      )
      waitForSynced()
      mock('PUT', '/files', { path: `/${name}/reader.tex`, content: 'No\n' })
      cy.wait(2000)
      waitForSynced()
      projectPaths(projectId).should('not.include', '/reader.tex')
      // and no project of the same name was made for the reader
      cy.request('/user/projects')
        .its('body.projects')
        .then((projects: { name: string; _id: string }[]) => {
          expect(projects.filter(p => p.name === name)).to.have.length(1)
        })
    })
  })
})

describe('projects with the same name', function () {
  it('reads the folder of a purged project as a new project', function () {
    const email = newUser('dropbox-purged')
    const name = projectName('Purged')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      requestWithCsrf('DELETE', `/project/${projectId}`)
      login(ADMIN_EMAIL)
      cy.visit('/project')
      requestWithCsrf('DELETE', `/admin/project/${projectId}/purge`)
        .its('status')
        .should('equal', 200)
      login(email)
    })
    mock('PUT', '/files', { path: `/${name}/after.tex`, content: 'After\n' })
    const findProject = (attempts = 60) => {
      cy.request('/user/projects').then(response => {
        const project = response.body.projects.find(
          (p: { name: string }) => p.name === name
        )
        if (project) return
        expect(attempts, 'project created').to.be.greaterThan(0)
        cy.wait(500)
        findProject(attempts - 1)
      })
    }
    findProject()
  })

  it('keeps a folder named like a project out of it when the project has a folder of its own', function () {
    newUser('dropbox-stray')
    const name = projectName('Stray')
    createProject(name).as('firstId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    createProject(name).as('secondId')
    waitForDropbox(({ folders }) => Boolean(numberedFolder(folders, name)))
    cy.get<string>('@firstId').then(firstId => {
      postWithCsrf(`/project/${firstId}/rename`, { newProjectName: `${name}-old` })
    })
    waitForDropbox(({ folders }) => !folders.includes(`/${name}`))
    // a folder of the name of the second project, which syncs with its own
    mock('PUT', '/files', { path: `/${name}/stray.tex`, content: 'Stray\n' })
    dropboxFiles().then(({ folders }) => {
      mock('PUT', '/files', {
        path: `${numberedFolder(folders, name)}/marker.tex`,
        content: 'Marker\n',
      })
    })
    cy.get<string>('@secondId').then(secondId => {
      waitForProject(secondId, paths => paths.includes('/marker.tex'))
      waitForSynced()
      projectPaths(secondId).should('not.include', '/stray.tex')
    })
  })

  it('gives a new project named like another one a folder of its own', function () {
    newUser('dropbox-same-name')
    const name = projectName('Same')
    createProject(name).as('firstId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    createProject(name).as('secondId')
    cy.get<string>('@secondId').then(secondId => {
      addDoc(secondId, 'second.tex')
      waitForDropbox(({ files, folders }) => {
        const folder = numberedFolder(folders, name)
        return Boolean(folder) && `${folder}/second.tex` in files
      })
      dropboxFiles().then(({ files, folders }) => {
        expect(files).not.to.have.property(`/${name}/second.tex`)
        // and the changes in its folder go to the second project only
        mock('PUT', '/files', {
          path: `${numberedFolder(folders, name)}/from-dropbox.tex`,
          content: 'Second\n',
        })
      })
      waitForProject(secondId, paths => paths.includes('/from-dropbox.tex'))
    })
    cy.get<string>('@firstId').then(firstId => {
      projectPaths(firstId).should('not.include', '/from-dropbox.tex')
    })
  })

  it('gives a project renamed like another one a folder of its own', function () {
    newUser('dropbox-rename-taken')
    const name = projectName('Taken')
    const other = projectName('Other')
    createProject(name)
    createProject(other).as('otherId')
    linkDropboxAccount()
    waitForDropbox(
      ({ files }) => `/${name}/main.tex` in files && `/${other}/main.tex` in files
    )
    cy.get<string>('@otherId').then(otherId => {
      postWithCsrf(`/project/${otherId}/rename`, { newProjectName: name })
      waitForDropbox(({ files, folders }) => {
        const folder = numberedFolder(folders, name)
        return (
          Boolean(folder) &&
          `${folder}/main.tex` in files &&
          !(`/${other}/main.tex` in files)
        )
      })
      dropboxFiles().its('files').should('have.property', `/${name}/main.tex`)
    })
  })

  it('gives a shared project named like one of the user a folder of its own', function () {
    const editor = newUser('dropbox-same-editor')
    const name = projectName('SameShared')
    createProject(name)
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    const owner = `dropbox-same-owner-${Date.now()}@example.com`
    ensureUserExists(owner)
    login(owner)
    createProject(name).as('sharedId')
    cy.get<string>('@sharedId').then(sharedId => {
      shareProject(sharedId, editor, 'readAndWrite')
      login(owner)
      cy.visit('/project')
      addDoc(sharedId, 'owner.tex')
      waitForDropbox(({ files, folders }) => {
        const folder = numberedFolder(folders, name)
        return Boolean(folder) && `${folder}/owner.tex` in files
      })
      dropboxFiles().its('files').should('not.have.property', `/${name}/owner.tex`)
    })
  })
})

describe('the webhook', function () {
  it('answers the verification challenge', function () {
    cy.request('/dropbox/webhook?challenge=e2e-challenge').then(response => {
      expect(response.body).to.equal('e2e-challenge')
      expect(response.headers['content-type']).to.contain('text/plain')
      expect(response.headers['x-content-type-options']).to.equal('nosniff')
    })
  })

  it('refuses a notification without a valid signature', function () {
    cy.request({
      method: 'POST',
      url: '/dropbox/webhook',
      body: { list_folder: { accounts: ['dbid:e2e-dropbox-account'] } },
      headers: { 'X-Dropbox-Signature': 'forged' },
      failOnStatusCode: false,
    })
      .its('status')
      .should('equal', 403)
  })

  it('accepts a signed notification', function () {
    mock('POST', '/notify').its('body.status').should('equal', 200)
  })
})

describe('the editor', function () {
  it('shows the folder and the sync state, and syncs the project now', function () {
    newUser('dropbox-editor')
    const name = projectName('Editor')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    cy.get<string>('@projectId').then(projectId => {
      openProject(projectId)
      cy.findByText('Introduction').type('{end}\nSynced now')
      waitForDocumentUpdater(projectId, 'Synced now')
      openRailTab('Integrations')
      cy.findByRole('button', { name: /Dropbox/ }).click()
      cy.contains('[role="dialog"]', 'Sync with Dropbox')
        .should('contain.text', `Apps/Overleaf E2E/${name}`)
        .findByTestId('dropbox-sync-status', { timeout: SYNC_TIMEOUT })
        .should('contain.text', 'Overleaf and Dropbox have processed all updates')
      // the edit is still in the editor's session: syncing sends it
      cy.findByRole('button', { name: 'sync this project now' }).click()
      cy.findByRole('dialog').should(
        'contain.text',
        'A manual sync for this project has been started'
      )
      waitForDropbox(({ files }) =>
        (files[`/${name}/main.tex`] || '').includes('Synced now')
      )
    })
  })

  it('shows the updates of a sync now while they are sent', function () {
    newUser('dropbox-sync-now-status')
    const name = projectName('Sync now')
    createProject(name).as('projectId')
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${name}/main.tex` in files)
    waitForSynced()
    cy.get<string>('@projectId').then(projectId => {
      openProject(projectId)
      // no timed checks: the state can only come from the check after the click
      cy.clock(Date.now(), ['setTimeout', 'clearTimeout'])
      openRailTab('Integrations')
      cy.findByRole('button', { name: /Dropbox/ }).click()
      cy.findByTestId('dropbox-sync-status').should(
        'contain.text',
        'Overleaf and Dropbox have processed all updates'
      )
      // the first upload fails, so the update waits 10s for its retry
      mock('POST', '/fail', { endpoint: 'files/upload', status: 500 })
      cy.findByRole('button', { name: 'sync this project now' }).click()
      // 'Sending updates to Dropbox', or 'Sending and receiving updates' while
      // the poll that Sync now queues is waiting too
      cy.findByTestId('dropbox-sync-status').should('contain.text', 'Sending')
      cy.clock().invoke('restore')
      waitForSynced()
    })
  })

  it('asks to link the account first', function () {
    newUser('dropbox-unlinked')
    createProject(projectName('Unlinked')).then(projectId => {
      openSyncModal(projectId).should(
        'contain.text',
        'Your account is not linked to Dropbox'
      )
    })
  })
})

describe('a Dropbox account that cannot be used', function () {
  it('is unlinked when Dropbox is full', function () {
    newUser('dropbox-full')
    const name = projectName('Full')
    createProject(name).as('projectId')
    mock('POST', '/fail', {
      endpoint: 'files/upload',
      status: 409,
      summary: 'path/insufficient_space/',
    })
    // the first upload already finds Dropbox full
    cy.visit('/user/settings')
    dropboxWidget().findByRole('link', { name: 'Link' }).click()
    cy.location('search').should('contain', 'oauth-complete=dropbox')
    waitForUnlinked()
  })

  it('is unlinked when Dropbox refuses the token', function () {
    newUser('dropbox-refused-token')
    createProject(projectName('RefusedToken'))
    // e.g. the user removed the app in Dropbox
    mock('POST', '/fail', {
      endpoint: 'files/upload',
      status: 401,
      summary: 'invalid_access_token/',
    })
    cy.visit('/user/settings')
    dropboxWidget().findByRole('link', { name: 'Link' }).click()
    cy.location('search').should('contain', 'oauth-complete=dropbox')
    waitForUnlinked()
  })
})

describe('a disabled account', function () {
  it('is unlinked from Dropbox when the admin disables it', function () {
    const email = newUser('dropbox-disabled')
    createProject(projectName('Disabled'))
    linkDropboxAccount()

    login(ADMIN_EMAIL)
    setSuspended(email, true)
    waitForRevoked()

    // Enabled again, the user has to link Dropbox anew
    setSuspended(email, false)
    login(email)
    connectionStatus().should('equal', false)
  })
})

// Last: before the fix, a request that never answers stops the sync of every
// account, and the cases after it would fail too
describe('a Dropbox request that never answers', function () {
  it('keeps syncing other accounts and retries the change once it times out', function () {
    const stuckUser = newUser('dropbox-stuck')
    const stuckAccount = `dbid:${stuckUser.split('@')[0]}`
    linkDropboxAccount()
    waitForSynced()
    mock('POST', '/fail', { endpoint: 'files/create_folder_v2', hang: true })
    const stuck = projectName('Stuck')
    createProject(stuck)

    // while the folder of that project is being made, another account syncs
    newUser('dropbox-alongside')
    const alongside = projectName('Alongside')
    createProject(alongside)
    linkDropboxAccount()
    waitForDropbox(({ files }) => `/${alongside}/main.tex` in files)

    // the hung request gives up after a minute, then the job is retried
    waitForDropbox(({ files }) => `/${stuck}/main.tex` in files, 240, stuckAccount)
  })
})
