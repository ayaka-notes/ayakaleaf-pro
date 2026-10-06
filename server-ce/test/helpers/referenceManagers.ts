import { postWithCsrf } from './request'

// Zotero and Mendeley against services/tpr-mock. The control API sets the
// libraries the mock serves and reads back what Overleaf asked for.

export type Provider = 'zotero' | 'mendeley'

export const providerName: Record<Provider, string> = {
  zotero: 'Zotero',
  mendeley: 'Mendeley',
}

export function tprMock(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: object
) {
  return cy.request({
    method,
    url: `http://tpr-mock:8080/_mock${path}`,
    body,
  })
}

export function bibEntry(key: string, title = `Title of ${key}`) {
  return `@article{${key},\n\ttitle = {${title}},\n\tauthor = {Author, E2E},\n\tyear = {2026}\n}`
}

export function setLibrary(provider: Provider, entries: string[]) {
  tprMock('PUT', `/${provider}/library`, { entries })
}

export function setGroups(
  provider: Provider,
  groups: { id: string; name: string; entries: string[] }[]
) {
  tprMock('PUT', `/${provider}/groups`, { groups })
}

export function referenceWidget(provider: Provider) {
  return cy
    .contains('.settings-widget-container h4', providerName[provider])
    .closest('.settings-widget-container')
}

// The settings page's link button runs the provider's OAuth flow; the mock
// grants access right away and sends the browser back.
export function linkReferenceManager(provider: Provider) {
  cy.visit('/user/settings')
  referenceWidget(provider)
    .findByRole('button', { name: `Link to ${providerName[provider]}` })
    .click()
  cy.location('search').should('contain', `oauth-complete=${provider}`)
  referenceWidget(provider).within(() => {
    cy.findByText('Reference manager linked').should('exist')
    cy.findByRole('button', { name: 'Unlink' }).should('exist')
  })
}

// Unlinks over HTTP, for tests that start from an unlinked account; the
// mock's reset does not touch what Overleaf stored
export function resetReferenceManagerLink(provider: Provider) {
  cy.visit('/project')
  postWithCsrf(`/${provider}/unlink`, {}).its('status').should('equal', 200)
}

export function unlinkReferenceManager(provider: Provider) {
  referenceWidget(provider).findByRole('button', { name: 'Unlink' }).click()
  cy.findByRole('dialog')
    .should('contain.text', `Unlink ${providerName[provider]} Account`)
    .findByRole('button', { name: 'Unlink' })
    .click()
  referenceWidget(provider)
    .findByRole('button', { name: `Link to ${providerName[provider]}` })
    .should('exist')
}

// Opens "From <provider>" in the open project's new file modal
export function openImportFromProvider(provider: Provider) {
  cy.findByRole('button', { name: 'New file' }).click()
  cy.findByRole('dialog')
    .findByRole('button', { name: `From ${providerName[provider]}` })
    .click()
}

export function importFromProvider(
  provider: Provider,
  { name, library }: { name?: string; library?: string } = {}
) {
  openImportFromProvider(provider)
  cy.findByRole('dialog').within(() => {
    if (name)
      cy.findByLabelText(/^File name$/i)
        .clear()
        .type(name)
    if (library) cy.findByLabelText('Library').select(library)
    cy.findByRole('button', { name: 'Create' }).click()
  })
  cy.findByRole('dialog').should('not.exist')
  const fileName = name || `${provider}.bib`
  // Opens the file view with its import details and the refresh button
  cy.findByRole('treeitem', { name: fileName }).click()
  cy.findByText(
    new RegExp(`^Imported from ${providerName[provider]} at`)
  ).should('exist')
  return cy.wrap(fileName)
}

export function clickRefresh() {
  cy.findByRole('button', { name: 'Refresh' }).click()
}

// A successful refresh replaces the file with a new one; waits for it, so
// that its content can be read
export function refreshLinkedFile(name: string) {
  cy.findByRole('treeitem', { name })
    .find('[data-file-id]')
    .invoke('attr', 'data-file-id')
    .then(oldId => {
      clickRefresh()
      cy.findByRole('treeitem', { name })
        .find('[data-file-id]')
        .should('not.have.attr', 'data-file-id', oldId)
    })
}

// A linked file is a binary file; its content comes from the file endpoint
export function linkedFileContent(projectId: string, name: string) {
  return cy
    .findByRole('treeitem', { name })
    .find('[data-file-id]')
    .invoke('attr', 'data-file-id')
    .then(fileId =>
      cy.request(`/project/${projectId}/file/${fileId}`).its('body')
    )
}

export function countEntries(bibtex: string) {
  return (bibtex.match(/^@\w+\{/gm) || []).length
}

// Importing reindexes the references and tells the collaborators to do the
// same; then the reference picker finds the imported entries
export function expectReferencesSearchable(
  provider: Provider,
  key: string,
  title: string
) {
  cy.intercept('POST', '/project/*/references/indexAll').as('broadcast')
  importFromProvider(provider)
  cy.wait('@broadcast')
    .its('request.body.shouldBroadcast')
    .should('equal', true)
  cy.findByRole('treeitem', { name: 'main.tex' }).click()
  cy.findByText('\\section').parent().type('{end}\n\\cite{{}')
  cy.focused().type('{ctrl} ')
  cy.contains('[role="dialog"]', 'Search the .bib files in this project')
    .find('.search-result-hit')
    .should('contain.text', key)
    .and('contain.text', title)
}
