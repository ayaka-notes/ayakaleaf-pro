import { login } from '../../../helpers/login'
import { dataUrl, openInOverleaf } from '../../../helpers/openInOverleaf'
import { openProject } from '../../../helpers/project'
import { ADMIN_EMAIL, ensureAdminExists } from '../../../helpers/users'

// The reference picker searches the .bib files of the project. It opens with
// Ctrl+Space or the hint shown inside a \cite{} argument.

const bib = [
  '@book{knuth1984,',
  '  author = {Donald E. Knuth},',
  '  title = {The TeXbook},',
  '  year = {1984},',
  '}',
  '@book{lamport1994,',
  '  author = {Leslie Lamport},',
  '  title = {LaTeX: A Document Preparation System},',
  '  year = {1994},',
  '}',
  '@article{einstein1905,',
  '  author = {Albert Einstein},',
  '  title = {On the Electrodynamics of Moving Bodies},',
  '  journal = {Annalen der Physik},',
  '  year = {1905},',
  '}',
].join('\n')

const main = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  '\\bibliographystyle{plain}',
  '\\bibliography{refs}',
  '\\end{document}',
].join('\n')

const modalTitle = 'Search the .bib files in this project'

function createProjectWithBib() {
  return openInOverleaf({
    snip_uri: [
      dataUrl('application/x-tex', main),
      dataUrl('application/x-bibtex', bib),
    ],
    snip_name: ['main.tex', 'refs.bib'],
    main_document: 'main.tex',
  })
}

// Types on a new line after \section{Introduction}. The editor closes the
// brace itself, so the cursor stays inside the cite argument.
function typeOnNewLine(text: string) {
  cy.findByText('\\section').parent().type(`{end}\n${text}`)
}

function editorLine(text: string) {
  return cy.get('.cm-content').should('contain.text', text)
}

function openPickerWithKeyboard() {
  cy.focused().type('{ctrl} ')
}

// The dialog has no accessible name, find it by its title
function picker() {
  return cy.contains('[role="dialog"]', modalTitle)
}

function searchBox() {
  return picker().findByRole('searchbox', { name: modalTitle })
}

function hits() {
  return picker().find('.search-result-hit')
}

function hit(key: string) {
  return hits().contains('.search-result-hit', key)
}

function selectedTags() {
  return picker().find('.selected-key-tag')
}

before(function () {
  ensureAdminExists()
})

describe('reference picker', function () {
  beforeEach(function () {
    login(ADMIN_EMAIL)
    createProjectWithBib().then(openProject)
  })

  it('shows the search hint inside a \\cite{} argument', function () {
    typeOnNewLine('\\cite{{}')
    cy.get('.ol-cm-references-search-hint')
      .should('be.visible')
      .and('contain.text', 'Open advanced reference search')
      .and('contain.text', 'Ctrl Space')
    // Leaving the argument hides it
    cy.focused().type('{end}{rightarrow} outside')
    cy.get('.ol-cm-references-search-hint').should('not.exist')
  })

  it('opens from the hint and lists every entry of the .bib file', function () {
    typeOnNewLine('\\cite{{}')
    cy.get('.ol-cm-references-search-hint')
      .findByRole('button', { name: 'Search' })
      .click()
    picker().should('be.visible')
    searchBox().should('be.focused')
    hits().should('have.length', 3)
    hit('einstein1905')
      .should('contain.text', 'On the Electrodynamics of Moving Bodies')
      .and('contain.text', 'Albert Einstein')
      .and('contain.text', 'Annalen der Physik')
      .and('contain.text', '1905')
  })

  it('searches by key, author, title, journal and year', function () {
    typeOnNewLine('\\cite{{}')
    openPickerWithKeyboard()
    for (const [query, key] of [
      ['knuth1984', 'knuth1984'],
      ['lamport', 'lamport1994'],
      ['electrodynamics', 'einstein1905'],
      ['annalen', 'einstein1905'],
      ['1994', 'lamport1994'],
      // Every word has to match
      ['texbook 1984', 'knuth1984'],
    ]) {
      searchBox().clear().type(query)
      hits().should('have.length', 1)
      hit(key).should('exist')
      hit(key).find('.found-token').should('exist')
    }
    searchBox().clear().type('texbook 1994')
    hits().should('have.length', 0)
  })

  it('inserts the chosen entries into the cite argument', function () {
    typeOnNewLine('\\cite{{}')
    openPickerWithKeyboard()
    hit('knuth1984').click()
    hit('einstein1905').click()
    selectedTags().should('contain.text', 'knuth1984')
    selectedTags().should('contain.text', 'einstein1905')
    // Clicking again deselects
    hit('knuth1984').click()
    selectedTags().should('not.contain.text', 'knuth1984')
    hit('lamport1994').click()
    picker().findByRole('button', { name: 'Insert' }).click()
    picker().should('not.exist')
    editorLine('\\cite{einstein1905, lamport1994}')
  })

  it('adds entries after the keys already in the argument', function () {
    typeOnNewLine('\\cite{{}knuth1984')
    openPickerWithKeyboard()
    hit('lamport1994').click()
    picker().findByRole('button', { name: 'Insert' }).click()
    editorLine('\\cite{knuth1984, lamport1994}')
  })

  it('replaces the selected keys and keeps unknown ones', function () {
    const keys = 'knuth1984, missing2000'
    typeOnNewLine(`\\cite{{}${keys}`)
    // Select the argument; the cursor has to stay inside the braces
    cy.focused().type('{shift+leftarrow}'.repeat(keys.length))
    openPickerWithKeyboard()
    picker().findByRole('button', { name: 'Replace' }).should('exist')
    // Keys the .bib file does not have stay selected
    selectedTags().should('contain.text', 'knuth1984')
    selectedTags().should('contain.text', 'missing2000')
    picker().findByRole('button', { name: 'Remove tag knuth1984' }).click()
    selectedTags().should('not.contain.text', 'knuth1984')
    hit('einstein1905').click()
    picker().findByRole('button', { name: 'Replace' }).click()
    editorLine('\\cite{missing2000, einstein1905}')
  })

  it('is driven by the keyboard', function () {
    typeOnNewLine('\\cite{{}')
    openPickerWithKeyboard()
    searchBox().type('book')
    hits().should('have.length', 1)
    searchBox().clear()
    hits().should('have.length', 3)
    // Down moves into the list, Space toggles, Enter inserts
    searchBox().type('{downarrow}')
    cy.focused().should('have.id', 'reference-picker-item-0')
    cy.focused().type(' ')
    cy.focused().type('{downarrow}')
    cy.focused().should('have.id', 'reference-picker-item-1')
    cy.focused().type(' ')
    selectedTags().find('.badge-tag').should('have.length', 2)
    cy.focused().type('{enter}')
    picker().should('not.exist')
    cy.get('.cm-content')
      .invoke('text')
      .should('match', /\\cite\{\w+, \w+\}/)
  })

  it('changes nothing when cancelled', function () {
    typeOnNewLine('\\cite{{}knuth1984')
    openPickerWithKeyboard()
    hit('lamport1994').click()
    picker().findByRole('button', { name: 'Cancel' }).click()
    picker().should('not.exist')
    editorLine('\\cite{knuth1984}')
    cy.get('.cm-content').should('not.contain.text', 'lamport1994')
  })

  it('opens the usual autocomplete outside a cite argument', function () {
    typeOnNewLine('\\sec')
    openPickerWithKeyboard()
    cy.findByRole('listbox').should('contain.text', '\\section')
    picker().should('not.exist')
  })
})
