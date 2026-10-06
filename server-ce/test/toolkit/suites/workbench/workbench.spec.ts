import {
  aiMock,
  aiUsage,
  chatRequests,
  currentUserId,
  giveAiConsent,
  messageText,
  queueReplies,
  resetAiUsage,
  setAiFeatures,
  type ChatRequest,
} from '../../../helpers/ai'
import { login } from '../../../helpers/login'
import { dataUrl, openInOverleaf } from '../../../helpers/openInOverleaf'
import { openProject } from '../../../helpers/project'
import { postWithCsrf } from '../../../helpers/request'
import {
  ADMIN_EMAIL,
  ensureAdminExists,
  ensureUserExists,
} from '../../../helpers/users'

// The AI assistant in the editor rail against services/ai-mock, which
// answers as the OpenAI-compatible gateway, Tavily and the documentation's
// MCP endpoint. The mock replays the replies a test queues and records the
// requests, so the tests check both what the user sees and what the model
// was sent.

const user = `workbench-${Date.now()}@example.com`

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

function openNewProject() {
  return openInOverleaf({
    snip_uri: dataUrl('text/plain', main),
    snip_name: 'main.tex',
  }).then(openProject)
}

function editor() {
  return cy.get('.cm-content')
}

function panel() {
  return cy.get('.workbench-panel')
}

// The editor remembers the open rail tab, clicking it again would close it
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

function toolHeader(title: string) {
  return panel().contains('.tool-header', title)
}

function lastUserText(request: ChatRequest) {
  return messageText(request.messages.findLast(m => m.role === 'user')!)
}

// The results the browser or the server sent back for tool calls
function toolResults(request: ChatRequest) {
  return request.messages
    .filter(m => m.role === 'tool')
    .map(messageText)
    .join('\n')
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

describe('the AI assistant', function () {
  beforeEach(function () {
    login(user)
    openNewProject()
  })

  it('answers with the instance model and the editor context', function () {
    queueReplies({
      reasoning: 'The user wants a definition.',
      text: '**LaTeX** is a typesetting system.',
    })
    openAssistant()
    ask('What is LaTeX?')

    // Rendered as Markdown
    panel().should('contain.text', 'LaTeX is a typesetting system.')
    panel().should('not.contain.text', '**')
    panel().should('contain.text', 'Thought for')
    // The context block goes to the model, not into the chat
    panel().should('contain.text', 'What is LaTeX?')
    panel().should('not.contain.text', 'START CONTEXT')

    chatRequests().then(requests => {
      expect(requests).to.have.length(1)
      const [request] = requests
      expect(request.model).to.equal('e2e-model')
      expect(request.messages[0].role).to.equal('system')
      expect(messageText(request.messages[0])).to.contain(
        'You are the Overleaf AI assistant'
      )
      expect(lastUserText(request))
        .to.contain('What is LaTeX?')
        .and.contain('--- START CONTEXT')
        .and.contain('Current path: main.tex')
      // Documentation and web search are on by default
      expect(request.tools).to.include.members([
        'read_lines',
        'replace_lines',
        'compile',
        'web_search',
        'search_documentation',
      ])
    })
  })

  it('runs a tool in the browser and sends its result back', function () {
    queueReplies(
      { toolCalls: [{ name: 'read_lines', args: { fromLine: 4, toLine: 4 } }] },
      { text: 'Line 4 greets the world.' }
    )
    openAssistant()
    ask('What does line 4 say?')

    toolHeader('Read line 4').should('exist')
    panel().should('contain.text', 'Line 4 greets the world.')
    chatRequests().then(requests => {
      expect(requests).to.have.length(2)
      expect(toolResults(requests[1])).to.contain('Hello world.')
    })
  })

  it('applies an edit after approval and undoes it', function () {
    queueReplies(
      {
        toolCalls: [
          {
            name: 'replace_lines',
            args: {
              path: 'main.tex',
              fromLine: 4,
              toLine: 4,
              existingContent: 'Hello world.',
              newContent: 'Hello AI world.',
              rationale: 'Mention the assistant.',
            },
          },
        ],
      },
      { text: 'I changed the greeting.' }
    )
    openAssistant()
    ask('Change the greeting')

    panel().should('contain.text', 'Mention the assistant.')
    // Nothing changes before the user approves
    editor().should('contain.text', 'Hello world.')
    chatRequests().should('have.length', 1)

    panel().findByRole('button', { name: 'Apply' }).click()
    editor().should('contain.text', 'Hello AI world.')
    panel().should('contain.text', 'I changed the greeting.')
    chatRequests().then(requests => {
      expect(requests).to.have.length(2)
      expect(toolResults(requests[1])).to.contain('Change applied')
    })

    panel().findByRole('button', { name: 'Undo' }).click()
    editor().should('contain.text', 'Hello world.')
    editor().should('not.contain.text', 'Hello AI world.')
    panel().findByRole('button', { name: 'Apply' }).click()
    editor().should('contain.text', 'Hello AI world.')
  })

  it('tells the model when the user rejects an edit', function () {
    queueReplies(
      {
        toolCalls: [
          {
            name: 'replace_lines',
            args: {
              path: 'main.tex',
              fromLine: 4,
              toLine: 4,
              existingContent: 'Hello world.',
              newContent: 'Goodbye world.',
            },
          },
        ],
      },
      { text: 'Fine, I left it as it is.' }
    )
    openAssistant()
    ask('Change the greeting')

    panel().findByRole('button', { name: 'Reject' }).click()
    panel().should('contain.text', 'Fine, I left it as it is.')
    editor().should('contain.text', 'Hello world.')
    chatRequests().then(requests => {
      expect(requests).to.have.length(2)
      expect(JSON.stringify(requests[1].messages)).to.contain(
        'The user chose not to accept this edit.'
      )
    })
  })

  it('refuses an edit whose text is no longer in the document', function () {
    queueReplies(
      {
        toolCalls: [
          {
            name: 'replace_lines',
            args: {
              path: 'main.tex',
              fromLine: 4,
              toLine: 4,
              existingContent: 'Text that is not there.',
              newContent: 'Replacement.',
            },
          },
        ],
      },
      { text: 'Sorry, the text had changed.' }
    )
    openAssistant()
    ask('Change the greeting')

    panel().findByRole('button', { name: 'Apply' }).click()
    panel().should('contain.text', 'Sorry, the text had changed.')
    editor().should('not.contain.text', 'Replacement.')
    chatRequests().then(requests => {
      expect(JSON.stringify(requests[1].messages)).to.contain(
        'The current text no longer matches this suggestion.'
      )
    })
  })

  it('searches the web through Tavily', function () {
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

    panel().should('contain.text', 'Searched for "e2e news"')
    panel().findByRole('button', { name: /Used 1 sources/ }).click()
    panel()
      .findByRole('link', { name: 'https://news.example.com/e2e' })
      .should('have.attr', 'href', 'https://news.example.com/e2e')
    panel().should('contain.text', 'The news says the tests passed.')

    aiMock('GET', '/searches')
      .its('body')
      .should('deep.equal', [{ service: 'web', query: 'e2e news' }])
    // The server ran the search and continued in the same request
    chatRequests().then(requests => {
      expect(requests).to.have.length(2)
      expect(toolResults(requests[1])).to.contain('The e2e tests passed today.')
    })
  })

  it('searches the documentation through its MCP endpoint', function () {
    aiMock('PUT', '/docs-pages', {
      pages: [
        {
          title: 'Sharing a project',
          link: 'https://docs.overleaf.com/sharing',
          content: 'Click Share to invite collaborators.',
        },
      ],
    })
    queueReplies(
      {
        toolCalls: [
          { name: 'search_documentation', args: { query: 'share a project' } },
        ],
      },
      { text: 'Use the Share button.' }
    )
    openAssistant()
    ask('How do I share a project?')

    toolHeader('Search Overleaf documentation').should('exist')
    panel().findByRole('button', { name: /Used 1 sources/ }).click()
    panel()
      .findByRole('link', { name: 'Sharing a project' })
      .should('have.attr', 'href', 'https://docs.overleaf.com/sharing')
    panel().should('contain.text', 'Use the Share button.')

    aiMock('GET', '/searches')
      .its('body')
      .should('deep.equal', [{ service: 'docs', query: 'share a project' }])
    chatRequests().then(requests => {
      expect(toolResults(requests[1])).to.contain(
        'Click Share to invite collaborators.'
      )
    })
  })

  it('sends chats with an image to the image model', function () {
    queueReplies({ text: 'A single pixel.' })
    openAssistant()
    panel()
      .findByLabelText('Upload files')
      .selectFile(
        {
          contents: Cypress.Buffer.from(png, 'base64'),
          fileName: 'pixel.png',
          mimeType: 'image/png',
        },
        { force: true }
      )
    ask('What is in this image?')

    panel().should('contain.text', 'A single pixel.')
    chatRequests().then(([request]) => {
      expect(request.model).to.equal('e2e-vision-model')
      expect(JSON.stringify(request.messages)).to.contain(
        `data:image/png;base64,${png}`
      )
    })
  })

  it('stops after the tool calls allowed for one message', function () {
    // AI_MAX_STEPS=3, the fourth call is dropped
    queueReplies({
      toolCalls: [1, 2, 3, 4].map(line => ({
        name: 'read_lines',
        args: { fromLine: line, toLine: line },
      })),
    })
    openAssistant()
    ask('Read every line')

    toolHeader('Read line 3').should('exist')
    toolHeader('Read line 4').should('not.exist')
    panel().should(
      'contain.text',
      'Tool call limit reached for this message. Send another message to continue.'
    )
    // The follow-up with the results was refused before reaching the model
    chatRequests().should('have.length', 1)

    queueReplies({ text: 'Here is the rest.' })
    ask('Go on')
    panel().should('contain.text', 'Here is the rest.')
  })

  it('shows an error when the gateway fails and recovers', function () {
    queueReplies({ status: 401 }, { text: 'Working again.' })
    openAssistant()
    ask('Hello?')

    panel().within(() => {
      cy.findByText('Something’s gone wrong').should('exist')
      cy.findByText('We’ve hit a problem. Try starting a new chat.').should(
        'exist'
      )
    })
    ask('Hello again?')
    panel().should('contain.text', 'Working again.')
  })
})

describe('AI consent', function () {
  const newUser = `workbench-consent-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(newUser)
  })

  it('asks once before the first chat', function () {
    login(newUser)
    openNewProject()
    openAssistant()
    panel()
      .findByRole('region', { name: 'Give AI consent' })
      .findByRole('button', { name: 'Accept and continue' })
      .click()
    panel().findByRole('region', { name: 'Give AI consent' }).should('not.exist')
    panel().should('contain.text', 'Start a chat')

    cy.reload()
    openAssistant()
    panel().should('contain.text', 'Start a chat')
    panel().findByRole('region', { name: 'Give AI consent' }).should('not.exist')
  })
})

describe('the token quota', function () {
  const quotaUser = `workbench-quota-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(quotaUser)
    login(quotaUser)
    giveAiConsent()
  })

  it('blocks chats once the tokens are used up, until an admin resets them', function () {
    let userId: string
    login(quotaUser)
    currentUserId().then(id => {
      userId = id
    })
    openNewProject()
    // AI_TOKEN_QUOTA=100000, this reply alone uses 110000
    queueReplies({
      text: 'A long answer.',
      usage: { prompt: 60_000, completion: 50_000 },
    })
    openAssistant()
    ask('Write a lot')
    panel().should('contain.text', 'A long answer.')

    ask('And more')
    cy.findByText('Usage limit reached').should('exist')
    chatRequests().should('have.length', 1)

    login(ADMIN_EMAIL)
    cy.then(() => {
      aiUsage(userId).should('deep.equal', { used: 110_000, limit: 100_000 })
      resetAiUsage(userId)
      aiUsage(userId).should('deep.equal', { used: 0, limit: 100_000 })
    })

    login(quotaUser)
    openNewProject()
    queueReplies({ text: 'Back again.' })
    openAssistant()
    ask('Hello')
    panel().should('contain.text', 'Back again.')
  })
})

describe('AI turned off for a user', function () {
  const offUser = `workbench-off-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(offUser)
    login(offUser)
    giveAiConsent()
    currentUserId().then(userId => {
      login(ADMIN_EMAIL)
      setAiFeatures(userId, false)
    })
  })

  it('refuses the chat and disables the prompt', function () {
    login(offUser)
    cy.request('/workbench/access')
      .its('body')
      .should('deep.equal', { allowed: false, errorAssistant: false })
    cy.visit('/project')
    postWithCsrf('/workbench/tex-gpt', { messages: [] }).then(response => {
      expect(response.status).to.equal(403)
      expect(response.body).to.deep.equal({ error: 'ai_access_denied' })
    })

    openNewProject()
    openAssistant()
    panel().findByRole('region', { name: 'Give AI consent' }).should('not.exist')
    panel().find('.conversation-footer').should('have.attr', 'inert')
    chatRequests().should('have.length', 0)
  })

  it('gives the chat back when the admin turns AI on again', function () {
    login(offUser)
    currentUserId().then(userId => {
      login(ADMIN_EMAIL)
      setAiFeatures(userId, true)
    })
    login(offUser)
    cy.request('/workbench/access')
      .its('body')
      .should('deep.equal', { allowed: true, errorAssistant: true })
    openNewProject()
    queueReplies({ text: 'Hello again.' })
    openAssistant()
    ask('Hello')
    panel().should('contain.text', 'Hello again.')
  })
})

describe('the chat endpoint', function () {
  const message = (text: string) => ({
    id: 'm1',
    role: 'user',
    parts: [{ type: 'text', text }],
  })

  beforeEach(function () {
    login(user)
    cy.visit('/project')
  })

  it('declares only the search tools the user turned on', function () {
    queueReplies({ text: 'One.' }, { text: 'Two.' })
    postWithCsrf('/workbench/tex-gpt', {
      messages: [message('Hi')],
      enabledTools: [],
    })
      .its('status')
      .should('equal', 200)
    postWithCsrf('/workbench/tex-gpt', {
      messages: [message('Hi')],
      enabledTools: ['web_search'],
    })
      .its('status')
      .should('equal', 200)
    chatRequests().then(([withNone, withWeb]) => {
      expect(withNone.tools).to.include('read_lines')
      expect(withNone.tools).not.to.include('web_search')
      expect(withNone.tools).not.to.include('search_documentation')
      expect(withWeb.tools).to.include('web_search')
      expect(withWeb.tools).not.to.include('search_documentation')
      expect(messageText(withWeb.messages[0])).to.contain('web_search tool')
    })
  })

  it('refuses malformed messages and images from URLs', function () {
    postWithCsrf('/workbench/tex-gpt', { messages: 'Hi' }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body).to.deep.equal({ error: 'invalid_request' })
    })
    // The server would fetch a remote image from its own network
    postWithCsrf('/workbench/tex-gpt', {
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [
            {
              type: 'file',
              mediaType: 'image/png',
              url: 'http://ai-mock:8080/_mock/requests',
            },
          ],
        },
      ],
    }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body).to.deep.equal({ error: 'invalid_attachments' })
    })
    chatRequests().should('have.length', 0)
  })
})

describe('signed out', function () {
  it('requires a login', function () {
    cy.request({ url: '/workbench/access', followRedirect: false }).then(
      response => {
        expect(response.status).to.equal(302)
        expect(response.redirectedToUrl).to.contain('/login')
      }
    )
  })
})
