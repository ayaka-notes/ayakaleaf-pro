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
import { prepareWaitForNextCompileSlot } from '../../../helpers/compile'
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

// The model only sees the bytes, so any will do
const pdf = Cypress.Buffer.from('%PDF-1.4 e2e').toString('base64')

function newProject() {
  return openInOverleaf({
    snip_uri: dataUrl('text/plain', main),
    snip_name: 'main.tex',
  })
}

function openNewProject() {
  return newProject().then(openProject)
}

function editor() {
  return cy.get('.cm-content')
}

function panel() {
  return cy.get('[data-assistant-panel]')
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
    cy.intercept('POST', '/workbench/chat').as('texGpt')
    openAssistant()
    ask('What is LaTeX?')

    // Compressing proxies would hold the stream until it ends
    cy.wait('@texGpt')
      .its('response.headers.cache-control')
      .should('contain', 'no-transform')
    // Rendered as Markdown
    panel().should('contain.text', 'LaTeX is a typesetting system.')
    panel().should('not.contain.text', '**')
    panel().should('contain.text', 'Reasoned for')
    // The context block goes to the model, not into the chat
    panel().should('contain.text', 'What is LaTeX?')
    panel().should('not.contain.text', '<editor-context>')

    chatRequests().then(requests => {
      expect(requests).to.have.length(1)
      const [request] = requests
      expect(request.model).to.equal('e2e-model')
      expect(request.messages[0].role).to.equal('system')
      expect(messageText(request.messages[0])).to.contain(
        'You work inside a collaborative LaTeX editor'
      )
      expect(lastUserText(request))
        .to.contain('What is LaTeX?')
        .and.contain('<editor-context>')
        .and.contain('Open file: main.tex')
      // Documentation and web search are on by default
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

  it('runs a tool in the browser and sends its result back', function () {
    queueReplies(
      {
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
            name: 'propose_edit',
            args: {
              path: 'main.tex',
              startLine: 4,
              endLine: 4,
              oldText: 'Hello world.',
              newText: 'Hello AI world.',
              reason: 'Mention the assistant.',
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
      expect(toolResults(requests[1])).to.contain('Edit applied.')
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
            name: 'propose_edit',
            args: {
              path: 'main.tex',
              startLine: 4,
              endLine: 4,
              oldText: 'Hello world.',
              newText: 'Goodbye world.',
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
        'The user declined this edit.'
      )
    })
  })

  it('refuses an edit whose text is no longer in the document', function () {
    queueReplies(
      {
        toolCalls: [
          {
            name: 'propose_edit',
            args: {
              path: 'main.tex',
              startLine: 4,
              endLine: 4,
              oldText: 'Text that is not there.',
              newText: 'Replacement.',
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
        'The document no longer contains the text this edit replaces, so it was not applied.'
      )
    })
  })

  it('leaves an undecided edit unapplied when the user writes again', function () {
    queueReplies(
      {
        toolCalls: [
          {
            name: 'propose_edit',
            args: {
              path: 'main.tex',
              startLine: 4,
              endLine: 4,
              oldText: 'Hello world.',
              newText: 'Goodbye world.',
            },
          },
        ],
      },
      { text: 'Then I will keep the greeting.' }
    )
    openAssistant()
    ask('Change the greeting')
    panel().findByRole('button', { name: 'Apply' }).should('exist')

    ask('Actually, keep it')
    panel().should('contain.text', 'Then I will keep the greeting.')
    panel().findByRole('button', { name: 'Apply' }).should('not.exist')
    editor().should('contain.text', 'Hello world.')
    // The gateway refuses a tool call that has no result
    chatRequests().then(requests => {
      expect(requests).to.have.length(2)
      expect(toolResults(requests[1])).to.contain(
        'The user wrote again without applying or rejecting this edit'
      )
      expect(lastUserText(requests[1])).to.contain('Actually, keep it')
    })
  })

  it('stops a tool that runs in the browser without carrying on', function () {
    // The compile on opening the project must be over, or the tool refuses
    // to start another
    prepareWaitForNextCompileSlot().waitForCompile(() => cy.reload())
    // Hold the compile so that Stop comes while the tool runs
    cy.intercept(
      { method: 'POST', pathname: /\/project\/[a-fA-F0-9]{24}\/compile$/ },
      req => {
        req.on('response', res => {
          res.setDelay(3000)
        })
      }
    ).as('compile')
    queueReplies(
      { toolCalls: [{ name: 'run_compile', args: {} }] },
      { text: 'This step should not run.' }
    )
    openAssistant()
    ask('Compile it')

    // The browser runs the call while the card shows it waiting
    toolHeader('Compile').should('contain.text', 'Waiting')
    panel().findByRole('button', { name: 'Stop' }).click()
    panel().should('contain.text', 'Stopped by the user.')
    cy.wait('@compile')
    panel().should('not.contain.text', 'This step should not run.')
    chatRequests().should('have.length', 1)

    // The next message goes out with the stopped call answered
    queueReplies({ text: 'Fine.' })
    ask('Never mind')
    panel().should('contain.text', 'Fine.')
    chatRequests().then(requests => {
      expect(requests).to.have.length(2)
      expect(toolResults(requests[1])).to.contain('Stopped by the user.')
    })
  })

  it('tells the model again when another file is open', function () {
    queueReplies(
      { toolCalls: [{ name: 'new_file', args: { path: 'notes.tex' } }] },
      { text: 'Created it.' },
      { text: 'Two.' },
      { text: 'Three.' }
    )
    openAssistant()
    ask('Make a notes file')
    panel().should('contain.text', 'Created it.')
    // new_file opens the document it creates
    cy.get('[role="treeitem"][aria-selected="true"]').should(
      'contain.text',
      'notes.tex'
    )

    ask('Second question')
    panel().should('contain.text', 'Two.')
    ask('Third question')
    panel().should('contain.text', 'Three.')

    chatRequests().then(requests => {
      expect(requests).to.have.length(4)
      expect(lastUserText(requests[0])).to.contain('Open file: main.tex')
      expect(lastUserText(requests[2])).to.contain('Open file: notes.tex')
      expect(lastUserText(requests[3])).not.to.contain('<editor-context>')
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

    toolHeader('Search the web for “e2e news”').should('exist')
    panel().findByRole('button', { name: /1 result/ }).click()
    panel()
      .findByRole('link', { name: /^E2E news/ })
      .should('have.attr', 'href', 'https://news.example.com/e2e')
    panel().should('contain.text', 'The news says the tests passed.')

    aiMock('GET', '/searches')
      .its('body')
      .should('deep.equal', [{ service: 'web', query: 'e2e news' }])
    // The server ran the search and continued in the same request
    chatRequests().then(requests => {
      expect(requests).to.have.length(2)
      // As Markdown, without the sources the chat lists
      expect(toolResults(requests[1]))
        .to.contain(
          '## [E2E news](https://news.example.com/e2e)\n\nThe e2e tests passed today.'
        )
        .and.not.contain('"sources"')
      expect(messageText(requests[1].messages[0])).to.match(
        /Today is \d{4}-\d{2}-\d{2}\./
      )
    })
  })

  it('reads a web page through the linked-url-proxy', function () {
    // About 22k tokens, so that the next turn condenses the page as well
    aiMock('PUT', '/docs-pages', {
      pages: [
        {
          title: 'Sharing a project',
          link: 'https://docs.overleaf.com/sharing',
          content: 'More detail. '.repeat(7000),
        },
      ],
    })
    queueReplies(
      {
        toolCalls: [
          { name: 'web_fetch', args: { url: 'https://news.example.com/e2e' } },
          { name: 'search_docs', args: { query: 'share a project' } },
        ],
      },
      { text: 'The page says the tests passed.' },
      { text: 'Anything else?' }
    )
    openAssistant()
    ask('What does https://news.example.com/e2e say?')

    // A long label stays on one line, cut short
    toolHeader('Read https://news.example.com/e2e')
      .find('[title="Read https://news.example.com/e2e"]')
      .should('have.css', 'white-space', 'nowrap')
      .and('have.css', 'text-overflow', 'ellipsis')
    panel().should('contain.text', 'The page says the tests passed.')
    ask('Thanks')
    panel().should('contain.text', 'Anything else?')

    chatRequests().then(requests => {
      expect(requests).to.have.length(3)
      // The text of the page, without its markup, scripts and styles
      expect(toolResults(requests[1]))
        .to.contain('# E2E news\nURL: https://news.example.com/e2e')
        .and.contain('E2E news\nThe e2e tests passed today.\nFish & chips')
        .and.not.contain('<p>')
        .and.not.contain('e2e-script')
        .and.not.contain('color: red')
      // The next turn leaves the page out
      expect(toolResults(requests[2]))
        .to.contain('The page https://news.example.com/e2e, read in an earlier turn')
        .and.not.contain('The e2e tests passed today.')
    })
  })

  it('does not read pages on the internal network', function () {
    // Two calls, so that the turn stays within AI_MAX_STEPS
    const urls = [
      'http://127.0.0.1:3000/status',
      'http://169.254.169.254/latest/meta-data/',
    ]
    queueReplies(
      { toolCalls: urls.map(url => ({ name: 'web_fetch', args: { url } })) },
      { text: 'Those pages cannot be read.' }
    )
    openAssistant()
    ask('Read these pages')

    panel().should('contain.text', 'Those pages cannot be read.')
    chatRequests().then(requests => {
      // The linked-url-proxy refuses private addresses
      const results = toolResults(requests[1])
      for (const url of urls) {
        expect(results).to.contain(`Could not read ${url} (HTTP 403).`)
      }
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
          { name: 'search_docs', args: { query: 'share a project' } },
        ],
      },
      { text: 'Use the Share button.' }
    )
    openAssistant()
    ask('How do I share a project?')

    toolHeader('Search the help pages for “share a project”').should('exist')
    panel().findByRole('button', { name: /1 result/ }).click()
    panel()
      .findByRole('link', { name: /^Sharing a project/ })
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

  it('stops after the tool calls allowed for one message', function () {
    // AI_MAX_STEPS=3, the fourth call is dropped
    queueReplies({
      toolCalls: [1, 2, 3, 4].map(line => ({
        name: 'get_lines',
        args: { path: 'main.tex', start: line, end: line },
      })),
    })
    openAssistant()
    ask('Read every line')

    toolHeader('Read line 3 of main.tex').should('exist')
    toolHeader('Read line 4 of main.tex').should('not.exist')
    panel().should(
      'contain.text',
      'The assistant used all the steps it may take for one message. Reply to let it carry on.'
    )
    // The follow-up with the results was refused before reaching the model
    chatRequests().should('have.length', 1)

    queueReplies({ text: 'Here is the rest.' })
    ask('Go on')
    panel().should('contain.text', 'Here is the rest.')
  })

  it('renders math in single and double dollars, and prices as text', function () {
    queueReplies({
      text: 'The roots of $ax^2 + bx + c = 0$ are $$x = \\frac{-b}{2a}$$ and it costs $5 and $10.\n\n$$y = mx + c$$',
    })
    openAssistant()
    ask('Solve it')

    // The formulas typeset by KaTeX, the prices left as text, and $$...$$ on
    // a line of its own displayed as a block
    panel().find('.katex').should('have.length', 3)
    panel().find('.katex-display').should('have.length', 1)
    panel().should('contain.text', 'costs $5 and $10.')
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

  it('summarizes the earlier turns once the chat gets long', function () {
    // About 112k tokens at 4 characters a token, over the 100k limit
    const long = `Remember this: ${'word '.repeat(90000)}`
    queueReplies(
      { text: 'Noted.' },
      { text: 'SUMMARY-OF-EARLIER-TURNS' },
      { text: 'Second answer.' },
      { text: 'Third answer.' }
    )
    openAssistant()
    // Typing it would take minutes, so set the value the way a paste does
    panel()
      .findByPlaceholderText('What would you like to do?')
      .then($textarea => {
        const textarea = $textarea[0] as HTMLTextAreaElement
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        )!.set!.call(textarea, long)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
    panel().findByPlaceholderText('What would you like to do?').type('{enter}')
    panel().should('contain.text', 'Noted.')

    ask('Second question')
    panel().should('contain.text', 'Second answer.')
    panel().should(
      'contain.text',
      'The assistant now sees the messages above as a summary.'
    )
    ask('Third question')
    panel().should('contain.text', 'Third answer.')

    chatRequests().then(requests => {
      expect(requests).to.have.length(4)
      const [first, summarize, second, third] = requests
      expect(lastUserText(first)).to.contain('Remember this')
      // The first turn is summarized, without tools
      expect(summarize.tools).to.be.empty
      expect(messageText(summarize.messages[0])).to.contain(
        'You summarize the earlier part'
      )
      expect(messageText(summarize.messages[1]))
        .to.contain('Remember this')
        .and.contain('Noted.')
      // From then on the summary replaces the first turn
      for (const request of [second, third]) {
        expect(messageText(request.messages[0])).to.contain(
          'SUMMARY-OF-EARLIER-TURNS'
        )
        const sent = request.messages.map(messageText).join('\n')
        expect(sent).not.to.contain('Remember this')
        expect(sent).to.contain('Second question')
      }
      expect(lastUserText(third)).to.contain('Third question')
    })
  })

  it('condenses the tool output of earlier turns', function () {
    // About 22k tokens, over the 20k kept as is
    const details = 'More detail. '.repeat(7000)
    aiMock('PUT', '/docs-pages', {
      pages: [
        {
          title: 'Sharing a project',
          link: 'https://docs.overleaf.com/sharing',
          content: `Click Share to invite collaborators. ${details}`,
        },
      ],
    })
    queueReplies(
      {
        toolCalls: [
          { name: 'get_file', args: { path: 'main.tex' } },
          { name: 'search_docs', args: { query: 'share a project' } },
        ],
      },
      { text: 'Use the Share button.' },
      { text: 'Anything else?' }
    )
    openAssistant()
    ask('How do I share a project?')
    panel().should('contain.text', 'Use the Share button.')
    ask('Thanks')
    panel().should('contain.text', 'Anything else?')

    chatRequests().then(requests => {
      expect(requests).to.have.length(3)
      // The turn that read them gets both results in full
      expect(toolResults(requests[1]))
        .to.contain('section{Introduction}')
        .and.contain(details.trim())
      // The next turn keeps the sources and leaves the file out
      const condensed = toolResults(requests[2])
      expect(condensed)
        .to.contain('Title: Sharing a project')
        .and.contain('Link: https://docs.overleaf.com/sharing')
        .and.contain('main.tex, read in an earlier turn')
        .and.not.contain('Click Share')
        .and.not.contain('section{Introduction}')
    })
  })

  describe('when connecting takes over a second', function () {
    afterEach(function () {
      aiMock('POST', '/connect-delay', { ms: 0 })
    })

    it('searches the web through Tavily', function () {
      // fetch-utils' default agent gives up connecting after 1s
      aiMock('POST', '/connect-delay', { ms: 1200 })
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

      panel().should('contain.text', 'The news says the tests passed.')
      chatRequests().then(requests => {
        expect(toolResults(requests[1])).to.contain(
          'The e2e tests passed today.'
        )
      })
    })

    it('searches the documentation through its MCP endpoint', function () {
      // fetch-utils' default agent gives up connecting after 1s
      aiMock('POST', '/connect-delay', { ms: 1200 })
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
            {
              name: 'search_docs',
              args: { query: 'share a project' },
            },
          ],
        },
        { text: 'Use the Share button.' }
      )
      openAssistant()
      ask('How do I share a project?')

      panel().should('contain.text', 'Use the Share button.')
      chatRequests().then(requests => {
        expect(toolResults(requests[1])).to.contain(
          'Click Share to invite collaborators.'
        )
      })
    })
  })
})

// One project for these, so that the suite stays within Open in
// Overleaf's 20 projects a minute
describe('attachments', function () {
  let projectId: string

  before(function () {
    login(user)
    newProject().then(id => {
      projectId = id
    })
  })

  beforeEach(function () {
    login(user)
    openProject(projectId)
  })

  it('sends chats with an image to the image model', function () {
    queueReplies({ text: 'A single pixel.' })
    openAssistant()
    attachFile('pixel.png', png, 'image/png')
    ask('What is in this image?')

    panel().should('contain.text', 'A single pixel.')
    chatRequests().then(([request]) => {
      expect(request.model).to.equal('e2e-vision-model')
      expect(JSON.stringify(request.messages)).to.contain(
        `data:image/png;base64,${png}`
      )
    })
  })

  it('sends chats with a PDF file to the PDF model', function () {
    queueReplies({ text: 'A short paper.' })
    openAssistant()
    attachFile('paper.pdf', pdf, 'application/pdf')
    ask('What is in this paper?')

    panel().should('contain.text', 'A short paper.')
    panel().should('contain.text', 'paper.pdf')
    chatRequests().then(([request]) => {
      expect(request.model).to.equal('e2e-pdf-model')
      // As a Chat Completions file part, not as text or an image
      const user = JSON.stringify(request.messages.findLast(m => m.role === 'user'))
      expect(user)
        .to.contain('"type":"file"')
        .and.contain(`"file_data":"data:application/pdf;base64,${pdf}"`)
    })
  })

  it('says so when the model cannot read the PDF file', function () {
    // Like vLLM: "Unsupported chat content part type: 'file'"
    queueReplies({ status: 400 })
    openAssistant()
    attachFile('paper.pdf', pdf, 'application/pdf')
    ask('What is in this paper?')

    panel().should(
      'contain.text',
      'The AI model cannot read PDF files. Ask your administrator to set AI_PDF_MODEL to a model that can.'
    )
  })

  it('refuses attachments it cannot send', function () {
    openAssistant()
    attachFile(
      'big.pdf',
      Cypress.Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'),
      'application/pdf'
    )
    panel().should('contain.text', 'Files must be smaller than 2 MB.')
    attachFile('notes.txt', Cypress.Buffer.from('notes').toString('base64'), 'text/plain')
    panel().should('contain.text', 'Only images and PDF files can be attached.')
    panel().should('not.contain.text', 'big.pdf')
    panel().should('not.contain.text', 'notes.txt')
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
    postWithCsrf('/workbench/chat', { messages: [] }).then(response => {
      expect(response.status).to.equal(403)
      expect(response.body).to.deep.equal({ error: 'ai_access_denied' })
    })

    openNewProject()
    openAssistant()
    panel().findByRole('region', { name: 'Give AI consent' }).should('not.exist')
    panel().find('[data-chat-input]').should('have.attr', 'inert')
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
    postWithCsrf('/workbench/chat', {
      messages: [message('Hi')],
      enabledTools: [],
    })
      .its('status')
      .should('equal', 200)
    postWithCsrf('/workbench/chat', {
      messages: [message('Hi')],
      enabledTools: ['web_search'],
    })
      .its('status')
      .should('equal', 200)
    chatRequests().then(([withNone, withWeb]) => {
      expect(withNone.tools).to.include('get_lines')
      expect(withNone.tools).not.to.include('web_search')
      expect(withNone.tools).not.to.include('search_docs')
      expect(withNone.tools).not.to.include('web_fetch')
      expect(messageText(withNone.messages[0])).not.to.contain('Today is')
      expect(withWeb.tools).to.include('web_search')
      expect(withWeb.tools).not.to.include('search_docs')
      expect(withWeb.tools).not.to.include('web_fetch')
      expect(messageText(withWeb.messages[0])).to.contain(
        'web_search looks things up'
      )
    })
  })

  it('refuses malformed messages and images from URLs', function () {
    postWithCsrf('/workbench/chat', { messages: 'Hi' }).then(response => {
      expect(response.status).to.equal(400)
      expect(response.body).to.deep.equal({ error: 'invalid_request' })
    })
    // The server would fetch a remote image from its own network
    postWithCsrf('/workbench/chat', {
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
    // PDF files too
    postWithCsrf('/workbench/chat', {
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [
            {
              type: 'file',
              mediaType: 'application/pdf',
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
