import {
  aiMock,
  aiUsage,
  currentUserId,
  giveAiConsent,
  messageText,
  queueReplies,
  responsesRequests,
  type ResponsesItem,
} from '../../../../helpers/ai'
import { login } from '../../../../helpers/login'
import { dataUrl, openInOverleaf } from '../../../../helpers/openInOverleaf'
import { openProject } from '../../../../helpers/project'
import {
  ADMIN_EMAIL,
  ensureAdminExists,
  ensureUserExists,
} from '../../../../helpers/users'

// AI_API_MODE=responses: the assistant calls the gateway's OpenAI Responses
// API instead of Chat Completions. services/ai-mock keeps the output items of
// each response, as OpenAI does by default, and refuses references to items
// it does not have and function calls without their output.

const user = `workbench-responses-${Date.now()}@example.com`

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

function openNewProject() {
  return openInOverleaf({
    snip_uri: dataUrl('text/plain', main),
    snip_name: 'main.tex',
  }).then(openProject)
}

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

function toolHeader(title: string) {
  return panel().contains('[data-tool-call]', title)
}

function lastUser(input: ResponsesItem[]) {
  return input.findLast(item => item.role === 'user')!
}

// The results the browser or the server sent back for function calls
function toolResults(input: ResponsesItem[]) {
  return input
    .filter(item => item.type === 'function_call_output')
    .map(item => JSON.stringify(item.output))
    .join('\n')
}

function itemReferences(input: ResponsesItem[]) {
  return input
    .filter(item => item.type === 'item_reference')
    .map(item => item.id!)
}

before(function () {
  ensureAdminExists()
  ensureUserExists(user)
  login(user)
  giveAiConsent()
})

beforeEach(function () {
  aiMock('POST', '/reset')
})

describe('the AI assistant on the Responses API', function () {
  beforeEach(function () {
    login(user)
    openNewProject()
  })

  it('answers with the instance model, the tools and the editor context', function () {
    queueReplies({
      reasoning: 'The user wants a definition.',
      text: '**LaTeX** is a typesetting system.',
    })
    openAssistant()
    ask('What is LaTeX?')

    panel().should('contain.text', 'LaTeX is a typesetting system.')
    panel().should('not.contain.text', '**')
    panel().should('contain.text', 'Reasoned for')

    responsesRequests().then(requests => {
      expect(requests).to.have.length(1)
      const [request] = requests
      expect(request.api).to.equal('responses')
      expect(request.model).to.equal('e2e-model')
      expect(request.input[0].role).to.equal('system')
      expect(messageText(request.input[0])).to.contain(
        'You work inside a collaborative LaTeX editor'
      )
      expect(messageText(lastUser(request.input)))
        .to.contain('What is LaTeX?')
        .and.contain('<editor-context>')
        .and.contain('Open file: main.tex')
      expect(request.tools).to.include.members([
        'get_lines',
        'propose_edit',
        'run_compile',
        'web_search',
        'web_fetch',
        'search_docs',
      ])
    })
  })

  it('runs a tool in the browser and continues from the stored response', function () {
    queueReplies(
      {
        reasoning: 'Read the line first.',
        toolCalls: [
          { name: 'get_lines', args: { path: 'main.tex', start: 4, end: 4 } },
        ],
      },
      { text: 'Line 4 greets the world.' }
    )
    openAssistant()
    ask('What does line 4 say?')

    toolHeader('Read line 4 of main.tex').should('exist')
    panel().should('contain.text', 'Line 4 greets the world.')
    responsesRequests().then(requests => {
      expect(requests).to.have.length(2)
      // The reasoning and the call by their stored ids, the result in full
      const references = itemReferences(requests[1].input)
      expect(references.some(id => id.startsWith('rs_'))).to.equal(true)
      expect(references.some(id => id.startsWith('fc_'))).to.equal(true)
      expect(toolResults(requests[1].input)).to.contain('Hello world.')
    })
  })

  it('runs a search on the server and continues in the same request', function () {
    aiMock('PUT', '/web-results', {
      results: [
        {
          title: 'E2E news',
          url: 'https://news.example.com/e2e',
          content: 'The e2e tests passed today.',
        },
      ],
    })
    queueReplies(
      { toolCalls: [{ name: 'web_search', args: { query: 'e2e news' } }] },
      { text: 'The news says the tests passed.' }
    )
    openAssistant()
    ask('Any news?')

    toolHeader('Search the web for “e2e news”').should('exist')
    panel().should('contain.text', 'The news says the tests passed.')
    aiMock('GET', '/searches')
      .its('body')
      .should('deep.equal', [{ service: 'web', query: 'e2e news' }])
    responsesRequests().then(requests => {
      expect(requests).to.have.length(2)
      expect(toolResults(requests[1].input)).to.contain('E2E news')
    })
  })

  it('carries on the chat after an answer', function () {
    queueReplies(
      { text: 'LaTeX is a typesetting system.' },
      { text: 'It was written by Leslie Lamport.' }
    )
    openAssistant()
    ask('What is LaTeX?')
    panel().should('contain.text', 'LaTeX is a typesetting system.')
    ask('Who wrote it?')
    panel().should('contain.text', 'It was written by Leslie Lamport.')

    responsesRequests().then(requests => {
      expect(requests).to.have.length(2)
      const { input } = requests[1]
      expect(messageText(lastUser(input))).to.contain('Who wrote it?')
      // The earlier answer by its stored id
      expect(
        itemReferences(input).some(id => id.startsWith('msg_'))
      ).to.equal(true)
    })
  })
})

describe('attachments on the Responses API', function () {
  beforeEach(function () {
    login(user)
    openNewProject()
  })

  it('sends an image as an input image to the image model', function () {
    queueReplies({ text: 'A single pixel.' })
    openAssistant()
    attachFile('pixel.png', png, 'image/png')
    ask('What is in this image?')

    panel().should('contain.text', 'A single pixel.')
    responsesRequests().then(([request]) => {
      expect(request.model).to.equal('e2e-vision-model')
      expect(lastUser(request.input).content).to.deep.include({
        type: 'input_image',
        image_url: `data:image/png;base64,${png}`,
      })
    })
  })

  it('sends a PDF file as an input file to the PDF model', function () {
    queueReplies({ text: 'A short paper.' })
    openAssistant()
    attachFile('paper.pdf', pdf, 'application/pdf')
    ask('What is in this paper?')

    panel().should('contain.text', 'A short paper.')
    responsesRequests().then(([request]) => {
      expect(request.model).to.equal('e2e-pdf-model')
      expect(lastUser(request.input).content).to.deep.include({
        type: 'input_file',
        filename: 'paper.pdf',
        file_data: `data:application/pdf;base64,${pdf}`,
      })
    })
  })
})

describe('the token quota on the Responses API', function () {
  const quotaUser = `workbench-responses-quota-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(quotaUser)
    login(quotaUser)
    giveAiConsent()
  })

  it('counts the tokens the response reports', function () {
    let userId: string
    login(quotaUser)
    currentUserId().then(id => {
      userId = id
    })
    openNewProject()
    queueReplies({
      text: 'A short answer.',
      usage: { prompt: 300, completion: 45 },
    })
    openAssistant()
    ask('Hello')
    panel().should('contain.text', 'A short answer.')

    login(ADMIN_EMAIL)
    cy.then(() => {
      aiUsage(userId).should('deep.equal', { used: 345, limit: 100_000 })
    })
  })
})
