import { v4 as uuid } from 'uuid'
import { prepareWaitForNextCompileSlot } from './compile'
import { postWithCsrf } from './request'

// Project names go into \title, keep them free of spaces: the PDF text layer
// drops those.
export function projectName(prefix: string) {
  return `${prefix}-${uuid().slice(0, 8)}`
}

export function pdfPreview() {
  return cy.findByRole('region', { name: 'PDF preview' })
}

// Visit the project list only when the current page has no CSRF token.
function visitForCsrfToken() {
  cy.document().then(doc => {
    if (!doc.querySelector('meta[name="ol-csrfToken"]')) cy.visit('/project')
  })
}

// Creates a project over HTTP and returns its id. A blank project's main.tex
// uses the project name as title and has an "Introduction" section.
export function createProject(
  projectName: string,
  template: 'none' | 'example' = 'none'
): Cypress.Chainable<string> {
  visitForCsrfToken()
  return postWithCsrf('/project/new', { projectName, template }).then(
    response => {
      expect(response.status).to.equal(200)
      return response.body.project_id as string
    }
  )
}

export function openProject(projectId: string) {
  cy.visit(`/project/${projectId}`)
  waitForMainDocToLoad()
}

export function waitForMainDocToLoad() {
  cy.log('Wait for main doc to load; it will steal the focus after loading')
  cy.get('.cm-content').should('contain.text', 'Introduction')
}

// Creates a blank project, opens it and waits for the first compile.
export function openNewProject(name = projectName('Project')) {
  const compiler = prepareWaitForNextCompileSlot()
  createProject(name).then(projectId => {
    compiler.waitForCompile(() => openProject(projectId))
  })
  pdfPreview().should('contain.text', name)
  return compiler
}

// Compiles over HTTP like the Recompile button and returns the build id of
// the PDF. The server skips a compile that follows another within a second.
export function compileProject(
  projectId: string,
  attempt = 1
): Cypress.Chainable<string> {
  visitForCsrfToken()
  return postWithCsrf(`/project/${projectId}/compile?auto_compile=false`, {
    check: 'silent',
    draft: false,
    incrementalCompilesEnabled: false,
    stopOnFirstError: false,
  }).then(response => {
    expect(response.status).to.equal(200)
    if (response.body.status === 'too-recently-compiled' && attempt < 5) {
      cy.wait(1_500)
      return compileProject(projectId, attempt + 1)
    }
    expect(response.body.status).to.equal('success')
    const pdf = response.body.outputFiles.find(
      (file: { path: string }) => file.path === 'output.pdf'
    )
    return pdf.build as string
  })
}
