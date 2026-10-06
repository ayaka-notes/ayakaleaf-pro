import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import {
  bibEntry,
  clickRefresh,
  countEntries,
  expectReferencesSearchable,
  importFromProvider,
  linkedFileContent,
  linkReferenceManager,
  openImportFromProvider,
  refreshLinkedFile,
  referenceWidget,
  resetReferenceManagerLink,
  setGroups,
  setLibrary,
  tprMock,
  unlinkReferenceManager,
} from '../../../helpers/referenceManagers'
import { postWithCsrf } from '../../../helpers/request'
import { shareProject } from '../../../helpers/sharing'
import {
  ADMIN_EMAIL,
  ensureAdminExists,
  ensureUserExists,
} from '../../../helpers/users'

// Mendeley against services/tpr-mock: OAuth 2.0 with refresh tokens. The
// mock checks the client credentials and the redirect URI of every token
// request.

const editor = `mendeley-editor-${Date.now()}@example.com`
const viewer = `mendeley-viewer-${Date.now()}@example.com`

function tokenRequests() {
  return tprMock('GET', '/mendeley/tokens').its('body.requests')
}

// Tokens that expire within a minute are refreshed before every request
function issueShortLivedTokens() {
  tprMock('PUT', '/mendeley/expires-in', { seconds: 30 })
}

function expectFileError(message: string) {
  cy.get('.file-view-error').should('contain.text', message)
}

before(function () {
  ensureAdminExists()
  ensureUserExists(editor)
  ensureUserExists(viewer)
})

beforeEach(function () {
  tprMock('POST', '/reset')
  login(ADMIN_EMAIL)
  resetReferenceManagerLink('mendeley')
})

describe('linking a Mendeley account', function () {
  it('links through OAuth 2.0 and unlinks again', function () {
    cy.visit('/user/settings')
    referenceWidget('mendeley').should(
      'contain.text',
      'With the Mendeley integration you can import your references'
    )
    linkReferenceManager('mendeley')
    tprMock('GET', '/mendeley/last-authorize')
      .its('body')
      .then(params => {
        expect(params).to.deep.include({
          client_id: 'e2e-mendeley-client',
          redirect_uri: 'http://sharelatex/user/mendeley/oauth/callback',
          response_type: 'code',
          scope: 'all',
        })
        expect(params.state).to.match(/^[0-9a-f]{32}$/)
      })
    tokenRequests().should('deep.equal', ['authorization_code'])

    unlinkReferenceManager('mendeley')
  })

  it('keeps the account when unlinking is cancelled', function () {
    linkReferenceManager('mendeley')
    referenceWidget('mendeley').findByRole('button', { name: 'Unlink' }).click()
    cy.findByRole('dialog').findByRole('button', { name: 'Cancel' }).click()
    cy.findByRole('dialog').should('not.exist')
    referenceWidget('mendeley')
      .findByRole('button', { name: 'Unlink' })
      .should('exist')
  })

  it('links again after unlinking', function () {
    linkReferenceManager('mendeley')
    unlinkReferenceManager('mendeley')
    linkReferenceManager('mendeley')
    tokenRequests().should('deep.equal', [
      'authorization_code',
      'authorization_code',
    ])
  })

  it('stays unlinked when the user does not authorize the app', function () {
    tprMock('POST', '/mendeley/deny-next-authorize')
    cy.visit('/user/settings')
    referenceWidget('mendeley')
      .findByRole('button', { name: 'Link to Mendeley' })
      .click()
    cy.location('search').should('contain', 'oauth-error=mendeley')
    referenceWidget('mendeley').within(() => {
      cy.findByText('Sorry, something went wrong').should('exist')
      cy.findByRole('button', { name: 'Link to Mendeley' }).should('exist')
    })
    tokenRequests().should('deep.equal', [])
  })

  it('refuses a callback with a state it did not issue', function () {
    cy.visit('/user/settings')
    cy.request({ url: '/user/mendeley/oauth', followRedirect: false })
    cy.request({
      url: '/user/mendeley/oauth/callback?code=anything&state=forged',
      followRedirect: false,
    })
      .its('redirectedToUrl')
      .should('contain', '/user/settings?oauth-error=mendeley')
    tokenRequests().should('deep.equal', [])
  })

  it('offers the import only to linked accounts', function () {
    createProject(projectName('Mendeley')).then(openProject)
    cy.findByRole('button', { name: 'New file' }).click()
    cy.findByRole('dialog').within(() => {
      cy.findByRole('button', { name: 'From external URL' }).should('exist')
      cy.findByRole('button', { name: 'From Mendeley' }).should('not.exist')
    })
  })
})

describe('importing from Mendeley', function () {
  let projectId: string

  function linkAndOpenProject() {
    linkReferenceManager('mendeley')
    createProject(projectName('Mendeley')).then(id => {
      projectId = id
      openProject(id)
    })
  }

  it('imports the library from every page', function () {
    linkAndOpenProject()
    // More than one page of 100 documents
    setLibrary(
      'mendeley',
      Array.from({ length: 150 }, (_, i) => bibEntry(`doc${i + 1}`))
    )
    importFromProvider('mendeley').then(name => {
      expect(name).to.equal('mendeley.bib')
      linkedFileContent(projectId, name).then(bibtex => {
        expect(countEntries(bibtex)).to.equal(150)
        expect(bibtex).to.contain('@article{doc1,')
        expect(bibtex).to.contain('@article{doc150,')
      })
    })
  })

  it('lists the groups and imports one of them', function () {
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('mine')])
    setGroups('mendeley', [
      { id: 'grp-1', name: 'E2E Group', entries: [bibEntry('ours')] },
      { id: 'grp-2', name: 'Other Group', entries: [bibEntry('theirs')] },
    ])
    openImportFromProvider('mendeley')
    cy.findByLabelText('Library')
      .find('option')
      .then(options => [...options].map(o => o.textContent))
      .should('deep.equal', ['My Library', 'E2E Group', 'Other Group'])
    cy.findByRole('dialog').findByRole('button', { name: 'Cancel' }).click()

    importFromProvider('mendeley', {
      name: 'group.bib',
      library: 'E2E Group',
    }).then(name => {
      linkedFileContent(projectId, name).then(bibtex => {
        expect(bibtex).to.contain('@article{ours,')
        expect(bibtex).not.to.contain('@article{mine,')
        expect(bibtex).not.to.contain('@article{theirs,')
      })
    })
  })

  it('refreshes the file with the current library', function () {
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('before')])
    importFromProvider('mendeley').then(name => {
      setLibrary('mendeley', [bibEntry('after')])
      refreshLinkedFile(name)
      linkedFileContent(projectId, name).should(bibtex => {
        expect(bibtex).to.contain('@article{after,')
        expect(bibtex).not.to.contain('@article{before,')
      })
    })
  })

  it('makes the references searchable for everyone in the project', function () {
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('lamport1994', 'LaTeX')])
    expectReferencesSearchable('mendeley', 'lamport1994', 'LaTeX')
  })

  it('refreshes an expiring access token before using it', function () {
    issueShortLivedTokens()
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('fresh')])
    importFromProvider('mendeley').then(name => {
      linkedFileContent(projectId, name).should('contain', '@article{fresh,')
    })
    // Loading the groups and importing each refreshed the token
    tokenRequests().then(requests => {
      expect(requests[0]).to.equal('authorization_code')
      expect(requests.slice(1)).to.have.length.greaterThan(0)
      expect(requests.slice(1).every(r => r === 'refresh_token')).to.equal(true)
    })
  })

  it('asks to relink once the refresh token was revoked', function () {
    issueShortLivedTokens()
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('expiring')])
    importFromProvider('mendeley').then(() => {
      tprMock('POST', '/mendeley/tokens/revoke')
      clickRefresh()
      expectFileError(
        'Could not load references from Mendeley, please re-link your account and try again'
      )
      openImportFromProvider('mendeley')
      cy.findByRole('dialog').should(
        'contain.text',
        'There was an error accessing your Mendeley data.'
      )
    })
  })

  it('asks to relink once the access token was revoked', function () {
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('revoked')])
    importFromProvider('mendeley').then(() => {
      tprMock('POST', '/mendeley/tokens/revoke')
      clickRefresh()
      expectFileError(
        'Could not load references from Mendeley, please re-link your account and try again'
      )
    })
  })

  it('asks to relink after the account was unlinked', function () {
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('unlinked')])
    importFromProvider('mendeley').then(name => {
      resetReferenceManagerLink('mendeley')
      openProject(projectId)
      cy.findByRole('treeitem', { name }).click()
      clickRefresh()
      expectFileError(
        'Could not load references from Mendeley, please re-link your account and try again'
      )
    })
  })

  it('only lets the importer refresh the file', function () {
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('shared')])
    importFromProvider('mendeley').then(name => {
      shareProject(projectId, editor, 'readAndWrite')
      linkReferenceManager('mendeley')
      openProject(projectId)
      cy.findByRole('treeitem', { name }).click()
      cy.findByText(
        'Only the person who originally imported this Mendeley file can refresh it.'
      ).should('exist')
      cy.findByRole('button', { name: 'Refresh' }).should('be.disabled')
      cy.findByRole('treeitem', { name })
        .find('[data-file-id]')
        .invoke('attr', 'data-file-id')
        .then(fileId => {
          postWithCsrf(
            `/project/${projectId}/linked_file/${fileId}/refresh`,
            {}
          ).then(response => {
            expect(response.status).to.equal(400)
            expect(response.body).to.equal(
              'You are not the user who originally imported this file'
            )
          })
        })
    })
  })

  it('does not let a viewer refresh the file', function () {
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('viewed')])
    importFromProvider('mendeley').then(name => {
      shareProject(projectId, viewer, 'readOnly')
      openProject(projectId)
      cy.findByRole('treeitem', { name }).click()
      cy.findByText(/^Imported from Mendeley at/).should('exist')
      cy.findByRole('button', { name: 'Refresh' }).should('not.exist')
    })
  })

  it('reports errors of the Mendeley API', function () {
    linkAndOpenProject()
    setLibrary('mendeley', [bibEntry('flaky')])
    importFromProvider('mendeley').then(name => {
      tprMock('POST', '/mendeley/fail-next', { status: 500 })
      clickRefresh()
      cy.get('.file-view-error').should('be.visible')
      // The file keeps its last content
      linkedFileContent(projectId, name).should('contain', '@article{flaky,')

      tprMock('POST', '/mendeley/fail-next', { status: 500 })
      openImportFromProvider('mendeley')
      cy.findByRole('dialog').should(
        'contain.text',
        'There was an error loading groups from Mendeley'
      )
    })
  })
})
