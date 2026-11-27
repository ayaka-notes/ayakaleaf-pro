import {
  aiMock,
  chatRequests,
  giveAiConsent,
  queueReplies,
} from '../../../../helpers/ai'
import { login } from '../../../../helpers/login'
import { dataUrl, openInOverleaf } from '../../../../helpers/openInOverleaf'
import { openProject } from '../../../../helpers/project'
import {
  ensureAdminExists,
  ensureUserExists,
} from '../../../../helpers/users'

// AI_PDF_MODEL unset: a chat with a PDF file goes to AI_MODEL, also when it
// has images, which alone go to AI_IMAGE_MODEL, a model that may not read PDF
// files.

const user = `workbench-without-pdf-model-${Date.now()}@example.com`

const main = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  'Hello world.',
  '\\end{document}',
].join('\n')

// A 1x1 PNG
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// The model only sees the bytes, so any will do
const pdf = Cypress.Buffer.from('%PDF-1.4 e2e').toString('base64')

function panel() {
  return cy.get('[data-assistant-panel]')
}

function openAssistant() {
  cy.findByRole('tab', { name: 'AI assistant' }).then(tab => {
    if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
  })
  return panel().should('be.visible')
}

function ask(text: string) {
  panel()
    .findByPlaceholderText('What would you like to do?')
    .type(`${text}{enter}`)
}

function attachFile(fileName: string, base64: string, mimeType: string) {
  panel()
    .findByLabelText('Attach images or PDF files')
    .selectFile(
      { contents: Cypress.Buffer.from(base64, 'base64'), fileName, mimeType },
      { force: true }
    )
}

// One project for these, so that the suite stays within Open in
// Overleaf's 20 projects a minute
let projectId: string

before(function () {
  ensureAdminExists()
  ensureUserExists(user)
  login(user)
  giveAiConsent()
  openInOverleaf({
    snip_uri: dataUrl('text/plain', main),
    snip_name: 'main.tex',
  }).then(id => {
    projectId = id
  })
})

beforeEach(function () {
  aiMock('POST', '/reset')
  login(user)
  openProject(projectId)
})

it('sends a chat with a PDF file and an image to the chat model', function () {
  queueReplies({ text: 'A paper and a pixel.' })
  openAssistant()
  attachFile('paper.pdf', pdf, 'application/pdf')
  attachFile('pixel.png', png, 'image/png')
  ask('What are these?')

  panel().should('contain.text', 'A paper and a pixel.')
  chatRequests().then(([request]) => {
    expect(request.model).to.equal('e2e-model')
  })
})

it('keeps the chat model for an image after a PDF file', function () {
  queueReplies({ text: 'A short paper.' }, { text: 'A single pixel.' })
  openAssistant()
  attachFile('paper.pdf', pdf, 'application/pdf')
  ask('What is in this paper?')
  panel().should('contain.text', 'A short paper.')
  attachFile('pixel.png', png, 'image/png')
  ask('And in this image?')

  panel().should('contain.text', 'A single pixel.')
  chatRequests().then(requests => {
    expect(requests.map(request => request.model)).to.deep.equal([
      'e2e-model',
      'e2e-model',
    ])
  })
})

it('still sends a chat with only an image to the image model', function () {
  queueReplies({ text: 'A single pixel.' })
  openAssistant()
  attachFile('pixel.png', png, 'image/png')
  ask('What is in this image?')

  panel().should('contain.text', 'A single pixel.')
  chatRequests().then(([request]) => {
    expect(request.model).to.equal('e2e-vision-model')
  })
})
