import { v4 as uuid } from 'uuid'
import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import { ensureUserExists } from '../../../helpers/users'

// Importing Word and Markdown documents as new projects and exporting
// projects as Word, Markdown and HTML. clsi runs each conversion in a
// container of the Pandoc image that services/pandoc builds.

const user = `pandoc-${uuid()}@example.com`

before(function () {
  ensureUserExists(user)
})

beforeEach(function () {
  login(user)
})

// Opens New project > Import > `name` from the project list. Without
// projects the list shows a welcome page instead, so there is one.
function openImport(name: 'Word document' | 'Markdown document') {
  createProject(projectName('List'))
  cy.visit('/project')
  cy.findAllByRole('button', { name: 'New project' }).first().click()
  cy.findByRole('menuitem', { name }).click()
}

// Drops a file into the import dialog, which uploads it right away.
function chooseFile(contents: Cypress.Buffer, fileName: string) {
  cy.findByRole('dialog')
    .find('.uppy-Dashboard-input')
    .first()
    .selectFile({ contents, fileName }, { force: true })
}

// The imported project opens and compiles by itself. Its main.tex starts
// with Pandoc's long preamble, which pushes the body out of the editor's
// rendered lines, so the PDF shows what was imported.
function importedPdf() {
  return cy.findByRole('region', { name: 'PDF preview', timeout: 60_000 })
}

// Exports from the project title menu like a user does and returns the
// archive the browser downloads.
function exportFromEditor(
  label: string,
  type: 'docx' | 'markdown' | 'html'
): Cypress.Chainable<string> {
  cy.intercept('GET', `/project/*/download/conversion/${type}?*`).as('convert')
  cy.findByRole('button', { name: 'Project title options' }).click()
  cy.findByRole('menuitem', { name: label }).click()
  return cy.wait('@convert').then(({ response }) => {
    expect(response?.statusCode).to.equal(200)
    const { downloadUrl } = response?.body
    expect(downloadUrl).to.be.a('string')
    return cy
      .request({ url: downloadUrl, encoding: 'binary' })
      .its('body') as Cypress.Chainable<string>
  })
}

// One file of a downloaded zip archive, as text.
function unzipped(archive: string, fileName: string) {
  const path = `${Cypress.config('downloadsFolder')}/${uuid()}.zip`
  cy.writeFile(path, archive, 'binary')
  return cy.exec(`unzip -p ${path} ${fileName}`).its('stdout')
}

describe('import', function () {
  it('turns a Markdown document into a LaTeX project', function () {
    const name = projectName('Markdown')
    const markdown = `# Section-${name}\n\nSome *emphasised* text.\n`
    openImport('Markdown document')
    cy.findByRole('dialog').should('contain.text', 'Choose Markdown file')
    chooseFile(Cypress.Buffer.from(markdown), `${name}.md`)

    cy.location('search').should('equal', '?converted-from=markdown')
    cy.findByRole('button', { name: 'Project title options' }).should(
      'contain.text',
      name
    )
    importedPdf().should('contain.text', `Section-${name}`)
  })

  it('shows the conversion error for a broken Word document', function () {
    openImport('Word document')
    cy.findByRole('dialog').should('contain.text', 'Choose Word document')
    chooseFile(Cypress.Buffer.from('not a zip archive'), 'broken.docx')

    cy.findByRole('dialog')
      .should('contain.text', 'Your document couldn’t be imported.')
      .and('contain.text', 'Conversion error details')
    cy.location('pathname').should('equal', '/project')
  })
})

describe('export', function () {
  const name = projectName('Export')

  beforeEach(function () {
    createProject(name).then(openProject)
  })

  it('exports a Word document that imports again', function () {
    exportFromEditor('Export as Word document (.docx)', 'docx').then(
      archive => {
        // A .docx is a zip archive itself
        expect(archive.slice(0, 2)).to.equal('PK')
        openImport('Word document')
        chooseFile(Cypress.Buffer.from(archive, 'binary'), `${name}.docx`)
      }
    )

    cy.location('search').should('equal', '?converted-from=docx')
    cy.findByRole('button', { name: 'Project title options' }).should(
      'contain.text',
      name
    )
    importedPdf().should('contain.text', 'Introduction')
  })

  it('exports Markdown', function () {
    exportFromEditor('Export as Markdown (.md)', 'markdown').then(archive =>
      unzipped(archive, 'main.md').should('match', /^#+ Introduction/m)
    )
  })

  it('exports HTML', function () {
    exportFromEditor('Export as HTML (.html)', 'html').then(archive =>
      unzipped(archive, 'main.html').should(
        'match',
        /<h\d[^>]*>Introduction<\/h\d>/
      )
    )
  })
})
