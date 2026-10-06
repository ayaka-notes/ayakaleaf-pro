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

// Zotero against services/tpr-mock. The mock checks the OAuth 1.0a
// signatures, so every successful link also proves the requests are signed
// with the right secrets.

const editor = `zotero-editor-${Date.now()}@example.com`
const viewer = `zotero-viewer-${Date.now()}@example.com`

// Zotero exports attachments and notes as empty entries like these
const attachments = [
  '@misc{noauthor_notitle_nodate,\n}',
  '@misc{noauthor_notitle_nodate-1,\n}',
]

function zoteroKeys() {
  return tprMock('GET', '/zotero/keys').its('body')
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
  resetReferenceManagerLink('zotero')
})

describe('linking a Zotero account', function () {
  it('links through OAuth 1.0a and revokes the key on unlinking', function () {
    cy.visit('/user/settings')
    referenceWidget('zotero').should(
      'contain.text',
      'With the Zotero integration you can import your references'
    )
    linkReferenceManager('zotero')
    // Read-only access to the library and all groups
    tprMock('GET', '/zotero/last-authorize')
      .its('body')
      .should('deep.include', {
        library_access: '1',
        all_groups: 'read',
        write_access: '0',
      })
    zoteroKeys().should('deep.equal', [{ revoked: false }])

    unlinkReferenceManager('zotero')
    zoteroKeys().should('deep.equal', [{ revoked: true }])
  })

  it('keeps the account when unlinking is cancelled', function () {
    linkReferenceManager('zotero')
    referenceWidget('zotero').findByRole('button', { name: 'Unlink' }).click()
    cy.findByRole('dialog').within(() => {
      cy.findByText(
        'Warning: When you unlink your account from this provider you will not be able to import references into your projects.'
      ).should('exist')
      cy.findByRole('button', { name: 'Cancel' }).click()
    })
    cy.findByRole('dialog').should('not.exist')
    referenceWidget('zotero')
      .findByRole('button', { name: 'Unlink' })
      .should('exist')
    zoteroKeys().should('deep.equal', [{ revoked: false }])
  })

  it('links again with a new key after unlinking', function () {
    linkReferenceManager('zotero')
    unlinkReferenceManager('zotero')
    linkReferenceManager('zotero')
    zoteroKeys().should('deep.equal', [{ revoked: true }, { revoked: false }])
  })

  it('unlinks even when Zotero no longer knows the key', function () {
    linkReferenceManager('zotero')
    tprMock('POST', '/zotero/keys/revoke')
    unlinkReferenceManager('zotero')
    cy.reload()
    referenceWidget('zotero')
      .findByRole('button', { name: 'Link to Zotero' })
      .should('exist')
  })

  it('stays unlinked when the user does not authorize the app', function () {
    tprMock('POST', '/zotero/deny-next-authorize')
    cy.visit('/user/settings')
    referenceWidget('zotero')
      .findByRole('button', { name: 'Link to Zotero' })
      .click()
    cy.location('search').should('contain', 'oauth-error=zotero')
    referenceWidget('zotero').within(() => {
      cy.findByText('Sorry, something went wrong').should('exist')
      cy.findByRole('button', { name: 'Link to Zotero' }).should('exist')
    })
    zoteroKeys().should('deep.equal', [])
  })

  it('refuses a callback for a request it did not start', function () {
    cy.request({
      url: '/user/zotero/oauth/callback?oauth_token=forged&oauth_verifier=forged',
      followRedirect: false,
    })
      .its('redirectedToUrl')
      .should('contain', '/user/settings?oauth-error=zotero')
    zoteroKeys().should('deep.equal', [])
  })

  it('offers the import only to linked accounts', function () {
    createProject(projectName('Zotero')).then(openProject)
    cy.findByRole('button', { name: 'New file' }).click()
    cy.findByRole('dialog').within(() => {
      cy.findByRole('button', { name: 'From external URL' }).should('exist')
      cy.findByRole('button', { name: 'From Zotero' }).should('not.exist')
    })
  })
})

describe('importing from Zotero', function () {
  let projectId: string

  beforeEach(function () {
    linkReferenceManager('zotero')
    createProject(projectName('Zotero')).then(id => {
      projectId = id
      openProject(id)
    })
  })

  it('imports My Library from every page, without the empty entries', function () {
    // More than one page of 100 items
    const entries = Array.from({ length: 150 }, (_, i) =>
      bibEntry(`mine${i + 1}`)
    )
    setLibrary('zotero', [...entries, ...attachments])
    importFromProvider('zotero').then(name => {
      expect(name).to.equal('zotero.bib')
      linkedFileContent(projectId, name).then(bibtex => {
        expect(countEntries(bibtex)).to.equal(150)
        expect(bibtex).to.contain('@article{mine1,')
        expect(bibtex).to.contain('@article{mine150,')
        expect(bibtex).not.to.contain('noauthor_notitle_nodate')
      })
    })
  })

  it('lists the groups and imports one of them', function () {
    setLibrary('zotero', [bibEntry('mine')])
    setGroups('zotero', [
      { id: '424242', name: 'E2E Group', entries: [bibEntry('ours')] },
      { id: '434343', name: 'Other Group', entries: [bibEntry('theirs')] },
    ])
    openImportFromProvider('zotero')
    cy.findByLabelText('Library')
      .find('option')
      .then(options => [...options].map(o => o.textContent))
      .should('deep.equal', ['My Library', 'E2E Group', 'Other Group'])
    cy.findByRole('dialog').findByRole('button', { name: 'Cancel' }).click()

    importFromProvider('zotero', {
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

  it('imports an empty library', function () {
    importFromProvider('zotero').then(name => {
      linkedFileContent(projectId, name).should('equal', '')
    })
  })

  it('refreshes the file with the current library', function () {
    setLibrary('zotero', [bibEntry('before')])
    importFromProvider('zotero').then(name => {
      setLibrary('zotero', [bibEntry('after')])
      refreshLinkedFile(name)
      linkedFileContent(projectId, name).should(bibtex => {
        expect(bibtex).to.contain('@article{after,')
        expect(bibtex).not.to.contain('@article{before,')
      })
    })
  })

  it('makes the references searchable for everyone in the project', function () {
    setLibrary('zotero', [bibEntry('knuth1984', 'The TeXbook')])
    expectReferencesSearchable('zotero', 'knuth1984', 'The TeXbook')
  })

  it('only lets the importer refresh the file', function () {
    setLibrary('zotero', [bibEntry('shared')])
    importFromProvider('zotero').then(name => {
      shareProject(projectId, editor, 'readAndWrite')
      linkReferenceManager('zotero')
      openProject(projectId)
      cy.findByRole('treeitem', { name }).click()
      cy.findByText(
        'Only the person who originally imported this Zotero file can refresh it.'
      ).should('exist')
      cy.findByRole('button', { name: 'Refresh' }).should('be.disabled')
      // Not through the API either
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
    setLibrary('zotero', [bibEntry('viewed')])
    importFromProvider('zotero').then(name => {
      shareProject(projectId, viewer, 'readOnly')
      openProject(projectId)
      cy.findByRole('treeitem', { name }).click()
      cy.findByText(/^Imported from Zotero at/).should('exist')
      cy.findByRole('button', { name: 'Refresh' }).should('not.exist')
    })
  })

  it('asks to relink once the key was revoked on Zotero', function () {
    setLibrary('zotero', [bibEntry('revoked')])
    importFromProvider('zotero').then(() => {
      tprMock('POST', '/zotero/keys/revoke')
      clickRefresh()
      expectFileError(
        'Could not load references from Zotero, please re-link your account and try again'
      )
      openImportFromProvider('zotero')
      cy.findByRole('dialog').should(
        'contain.text',
        'There was an error accessing your Zotero data.'
      )
    })
  })

  it('asks to relink after the account was unlinked', function () {
    setLibrary('zotero', [bibEntry('unlinked')])
    importFromProvider('zotero').then(name => {
      resetReferenceManagerLink('zotero')
      openProject(projectId)
      cy.findByRole('treeitem', { name }).click()
      clickRefresh()
      expectFileError(
        'Could not load references from Zotero, please re-link your account and try again'
      )
    })
  })

  it('reports errors of the Zotero API', function () {
    setLibrary('zotero', [bibEntry('flaky')])
    importFromProvider('zotero').then(name => {
      tprMock('POST', '/zotero/fail-next', { status: 500 })
      clickRefresh()
      cy.get('.file-view-error').should('be.visible')
      // The file keeps its last content
      linkedFileContent(projectId, name).should('contain', '@article{flaky,')

      tprMock('POST', '/zotero/fail-next', { status: 500 })
      openImportFromProvider('zotero')
      cy.findByRole('dialog').should(
        'contain.text',
        'There was an error loading groups from Zotero'
      )
    })
  })
})
