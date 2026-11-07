import { v4 as uuid } from 'uuid'
import { login } from '../../../helpers/login'
import { ensureUserExists } from '../../../helpers/users'
import {
  openNewProject,
  pdfPreview,
  projectName,
} from '../../../helpers/project'
import { stopCompile } from '../../../helpers/compile'
import { waitUntilScrollingFinished } from '../../../helpers/waitUntilScrollingFinished'

// Compiles run in sibling containers of the texlive-basic images configured
// in variables.env. Every test opens its own fresh project.

const PDF_VIEWER = '[data-testid="pdfjs-viewer-inner"]'

function editor() {
  return cy.findByRole('textbox', { name: 'Source Editor editing' })
}

// Types `text` on a new line after \maketitle.
function typeAfterMaketitle(text: string) {
  editor().within(() => {
    cy.findByText('\\maketitle').parent().click()
    cy.findByText('\\maketitle').parent().type(`{end}\n${text}`)
  })
}

// The logs pane opens by itself after some compiles, the button is gone then.
function showLogs() {
  cy.get('body').then($body => {
    if ($body.find('button[aria-label="View logs"]').length > 0) {
      cy.findByRole('button', { name: 'View logs' }).click()
    }
  })
}

function checkRawLogs(pattern: RegExp) {
  showLogs()
  cy.findByLabelText('Raw logs from the LaTeX compiler').within(() => {
    cy.findByRole('button', { name: 'Expand' }).click()
    cy.findByText(pattern)
  })
}

function openCompilerSettings() {
  cy.findByRole('button', { name: 'Settings' }).click()
  cy.findByRole('dialog').findByRole('tab', { name: 'Compiler' }).click()
}

function closeSettings() {
  cy.get('body').type('{esc}')
  cy.findByRole('dialog').should('not.exist')
}

describe('sandboxed compiles', function () {
  const user = `user-${uuid()}@example.com`

  before(function () {
    ensureUserExists(user)
  })

  beforeEach(function () {
    login(user)
  })

  it('compiles a new project to a PDF with TeX Live 2026', function () {
    const name = projectName('Sandboxed')
    openNewProject(name)
    pdfPreview().should('contain.text', name)
    pdfPreview().findByText('Introduction')
    checkRawLogs(/This is pdfTeX, Version .+ \(TeX Live 2026\) /)
  })

  it('offers the configured TeX Live images and switches between them', function () {
    const { recompile } = openNewProject()

    openCompilerSettings()
    cy.findByRole('dialog').within(() => {
      cy.findByRole('combobox', { name: 'TeX Live version' }).within(() => {
        cy.findAllByRole('option').should('have.length', 2)
        cy.findByRole('option', { name: 'TeX Live 2026' }).should(
          'be.selected'
        )
        cy.findByRole('option', { name: 'TeX Live 2025' })
      })
      cy.findByRole('combobox', { name: 'TeX Live version' }).select(
        'TeX Live 2025'
      )
    })
    closeSettings()

    recompile()
    checkRawLogs(/This is pdfTeX, Version .+ \(TeX Live 2025\) /)
  })

  it('compiles with XeLaTeX and fontspec', function () {
    const name = projectName('XeLaTeX')
    const { recompile } = openNewProject(name)

    // CodeMirror splits the line into tokens, match the whole line.
    editor().within(() => {
      cy.contains('.cm-line', '\\documentclass')
        .click()
        .type('{end}\n\\usepackage{{}fontspec}')
    })

    openCompilerSettings()
    cy.findByRole('dialog').within(() => {
      cy.findByRole('option', { name: 'pdfLaTeX' }).should('be.selected')
      cy.findByRole('combobox', { name: 'Compiler' }).select('XeLaTeX')
    })
    closeSettings()

    recompile()
    pdfPreview().should('contain.text', name)
    checkRawLogs(/This is XeTeX/)
  })

  it('shows LaTeX errors and recompiles after they are fixed', function () {
    const { recompile } = openNewProject()

    typeAfterMaketitle('\\fakeCommand{}\n\\section{{}Error Section}')
    recompile()
    showLogs()
    cy.findAllByText(/Undefined control sequence/).should('exist')

    cy.log('Fix the error')
    editor().within(() => {
      cy.findByText('\\fakeCommand').parent().click()
      cy.findByText('\\fakeCommand')
        .parent()
        .type('{end}' + '{backspace}'.repeat('\\fakeCommand{}'.length))
    })
    editor().should('not.contain.text', '\\fakeCommand')
    recompile()
    showLogs()
    cy.findByText(/Undefined control sequence/).should('not.exist')
  })

  it('stops a running compile and compiles again afterwards', function () {
    const { recompile, waitForCompileRateLimitCoolOff } = openNewProject()

    // An infinite loop keeps the compile running until it is stopped.
    typeAfterMaketitle(
      'First page\\clearpage' +
        '\nSecond page' +
        '\\def\\loop{{}\\let\\next\\loop\\next}\\loop'
    )
    waitForCompileRateLimitCoolOff()
    // Start the compile by hand, waiting for it would never finish.
    cy.findByRole('button', { name: 'Recompile' }).click()
    cy.findByRole('button', { name: 'Compiling…' }).should('exist')
    stopCompile({ delay: 1000 })
    pdfPreview().invoke('text').should('match', /Compilation cancelled/)

    cy.log('Disable the loop, the next compile must not be blocked')
    editor().within(() => {
      cy.findByText('\\def').parent().click()
      cy.findByText('\\def').parent().type('{home}disabled loop% ')
    })
    recompile()
    pdfPreview()
      .should('contain.text', 'disabled loop')
      .should('not.contain.text', 'A previous compile is still running')
  })

  describe('SyncTeX', function () {
    let name: string

    beforeEach(function () {
      name = projectName('SyncTeX')
      const { recompile } = openNewProject(name)
      typeAfterMaketitle(
        '\\pagebreak\n\\section{{}Section A}\n\\pagebreak\n\\section{{}Section B}\n\\pagebreak'
      )
      recompile()
      pdfPreview().should('contain.text', name)
    })

    it('jumps from the PDF to the code', function () {
      cy.log('double click on the title in the PDF')
      pdfPreview().findByText(name).dblclick()
      cy.get('.cm-activeLine').should('have.text', '\\maketitle')

      cy.log('double click on Section A in the PDF')
      pdfPreview().findByText('Section A').dblclick()
      cy.get('.cm-activeLine').should('have.text', '\\section{Section A}')

      cy.log('scroll to Section B and use the sync button')
      cy.findByTestId('pdfjs-viewer-inner')
        .should('have.prop', 'scrollTop')
        .as('start')
      pdfPreview().findByText('Section B').scrollIntoView()
      cy.get('@start').then((start: any) => {
        waitUntilScrollingFinished(PDF_VIEWER, start)
      })
      // The sync button changes with the PDF position, give it time to settle.
      cy.wait(1000)
      cy.findByRole('button', {
        name: 'Go to PDF location in code (Tip: double click on the PDF for best results)',
      }).click()
      cy.get('.cm-activeLine').should('have.text', '\\section{Section B}')
    })

    // Every sync runs synctex in a sibling container, which can take a while.
    // Expects the @syncCode intercept from the test.
    function goToCodeLocationInPdf() {
      cy.findByRole('button', { name: 'Go to code location in PDF' }).click()
      cy.wait('@syncCode', { timeout: 60_000 })
    }

    it('jumps from the code to the PDF', function () {
      cy.intercept('GET', '/project/*/sync/code?*').as('syncCode')
      cy.findByRole('button', { name: 'PDF zoom level' }).click()
      cy.findByRole('menuitem', { name: '400%' }).click()
      cy.findByTestId('pdfjs-viewer-inner').scrollTo('top')
      waitUntilScrollingFinished(PDF_VIEWER, -1).as('start')

      cy.log('go to the title')
      editor().within(() => {
        cy.findByText('\\maketitle').parent().click()
      })
      goToCodeLocationInPdf()
      cy.get('@start').then((start: any) => {
        waitUntilScrollingFinished(PDF_VIEWER, start)
          .as('title')
          .should('be.greaterThan', start)
      })

      cy.log('go to Section A')
      editor().within(() => cy.findByText('Section A').click())
      goToCodeLocationInPdf()
      cy.get('@title').then((title: any) => {
        waitUntilScrollingFinished(PDF_VIEWER, title)
          .as('sectionA')
          .should('be.greaterThan', title)
      })

      cy.log('go to Section B')
      editor().within(() => cy.findByText('Section B').click())
      goToCodeLocationInPdf()
      cy.get('@sectionA').then((sectionA: any) => {
        waitUntilScrollingFinished(PDF_VIEWER, sectionA).should(
          'be.greaterThan',
          sectionA
        )
      })
    })
  })
})
