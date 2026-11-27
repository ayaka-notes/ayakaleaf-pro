import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
  waitForDocText,
} from '../../../helpers/project'
import { addComment } from '../../../helpers/review'
import { shareProject } from '../../../helpers/sharing'
import { ADMIN_EMAIL, ensureUserExists } from '../../../helpers/users'

const viewer = 'autoformatter-viewer@example.com'

// tex-fmt indents environments, but not the document environment
const messyTex = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\begin{itemize}',
  '\\item First',
  '\\item Second',
  '\\end{itemize}',
  '\\begin{quote}',
  'Quoted text',
  '\\end{quote}',
  '\\end{document}',
  '',
].join('\n')

const formattedTex = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\begin{itemize}',
  '  \\item First',
  '  \\item Second',
  '\\end{itemize}',
  '\\begin{quote}',
  '  Quoted text',
  '\\end{quote}',
  '\\end{document}',
  '',
].join('\n')

const messyBib =
  '@article{doe2020, title={A Title}, author={Doe, Jane}, year={2020}}\n'

const formattedBib = [
  '@article{doe2020,',
  '  title         = {A Title},',
  '  author        = {Doe, Jane},',
  '  year          = {2020}',
  '}',
  '',
].join('\n')

// Creates a project, uploads the file through the file tree's Upload dialog
// and opens it in the editor
function openProjectWithFile(name: string, contents: string) {
  return createProject(projectName('Format')).then(projectId => {
    openProject(projectId)
    showFileTree()
    cy.findByRole('button', { name: 'Upload', exact: true }).click()
    cy.findByRole('dialog')
      .find('.uppy-Dashboard-input')
      .first()
      .selectFile(
        { contents: Cypress.Buffer.from(contents), fileName: name },
        { force: true }
      )
    openFile(name)
    cy.get('.cm-content').should('contain.text', contents.split('\n')[0])
    return cy.wrap(projectId)
  })
}

function showFileTree() {
  cy.findByRole('tab', { name: 'File tree' }).then(tab => {
    if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
  })
}

function openFile(name: string) {
  showFileTree()
  cy.findByRole('treeitem', { name }).click()
}

function formatButton() {
  return cy.findByRole('button', { name: 'Format document' })
}

// The text of the editor line that contains the text
function editorLine(text: string) {
  return cy.contains('.cm-line', text).invoke('text')
}

function expectFormattedTex() {
  editorLine('First').should('equal', '  \\item First')
  editorLine('Quoted text').should('equal', '  Quoted text')
}

before(function () {
  ensureUserExists(viewer)
})

beforeEach(function () {
  login(ADMIN_EMAIL)
})

describe('formatting a .tex file', function () {
  it('formats it from the toolbar button, and the server gets the result', function () {
    openProjectWithFile('chapter.tex', messyTex).then(projectId => {
      formatButton().click()
      expectFormattedTex()
      waitForDocText(projectId, 'chapter.tex', formattedTex)
    })
  })

  it('formats it with Shift+Alt+F', function () {
    openProjectWithFile('chapter.tex', messyTex)
    cy.contains('.cm-line', 'Second').click()
    cy.get('.cm-content').type('{shift}{alt}f')
    expectFormattedTex()
  })

  it('formats it from Format > Format document', function () {
    openProjectWithFile('chapter.tex', messyTex)
    cy.findByRole('button', { name: 'Format', exact: true }).click()
    cy.findByRole('menuitem', { name: /^Format document/ }).click()
    expectFormattedTex()
  })

  it('undoes the formatting in one step', function () {
    openProjectWithFile('chapter.tex', messyTex)
    formatButton().click()
    expectFormattedTex()
    cy.get('.cm-content').type('{ctrl}z')
    editorLine('First').should('equal', '\\item First')
    editorLine('Quoted text').should('equal', 'Quoted text')
  })

  // Only the changed whitespace is replaced, so a comment keeps its text
  // rather than being emptied by a delete of the whole document
  it('keeps comments on the text they were made on', function () {
    openProjectWithFile('chapter.tex', messyTex).then(projectId => {
      addComment(projectId, 'Quoted text', 'About the quote')
      formatButton().click()
      expectFormattedTex()
      waitForDocText(projectId, 'chapter.tex', formattedTex)
      cy.request(`/project/${projectId}/ranges`).then(response => {
        const comments = response.body.flatMap(
          (doc: { ranges: { comments?: { op: object }[] } }) =>
            doc.ranges.comments ?? []
        )
        expect(comments).to.have.length(1)
        expect(comments[0].op).to.include({
          c: 'Quoted text',
          p: formattedTex.indexOf('Quoted text'),
        })
      })
    })
  })
})

describe('formatting a .bib file', function () {
  it('formats it with bibtex-tidy', function () {
    openProjectWithFile('refs.bib', messyBib).then(projectId => {
      formatButton().click()
      editorLine('title').should('equal', '  title         = {A Title},')
      waitForDocText(projectId, 'refs.bib', formattedBib)
    })
  })
})

describe('where formatting is offered', function () {
  it('offers it for .tex files but not for other files', function () {
    openProjectWithFile('notes.txt', 'Some    notes\n')
    formatButton().should('not.exist')
    // The Format menu hides itself when none of its commands apply
    cy.findByRole('button', { name: 'Format', exact: true }).should('not.exist')

    openFile('main.tex')
    cy.get('.cm-content').should('contain.text', 'Introduction')
    formatButton().should('be.visible')
    cy.findByRole('button', { name: 'Format', exact: true }).click()
    cy.findByRole('menuitem', { name: /^Format document/ }).should('be.visible')
  })

  it('does not offer it to read-only collaborators', function () {
    createProject(projectName('Format')).then(projectId => {
      shareProject(projectId, viewer, 'readOnly')
      openProject(projectId)
      formatButton().should('not.exist')
    })
  })
})
