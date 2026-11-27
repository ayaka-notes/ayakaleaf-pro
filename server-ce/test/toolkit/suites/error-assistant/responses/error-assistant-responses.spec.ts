import {
  aiMock,
  giveAiConsent,
  messageText,
  queueReplies,
  responsesRequests,
} from '../../../../helpers/ai'
import { prepareWaitForNextCompileSlot } from '../../../../helpers/compile'
import { login } from '../../../../helpers/login'
import { dataUrl, openInOverleaf } from '../../../../helpers/openInOverleaf'
import { openProject } from '../../../../helpers/project'
import { ensureUserExists } from '../../../../helpers/users'

// AI_API_MODE=responses: "Suggest fix" calls the gateway's OpenAI Responses
// API instead of Chat Completions.

const user = `error-assistant-responses-${Date.now()}@example.com`

const main = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  '\\fakeCommand{Hello world.}',
  '\\end{document}',
].join('\n')

before(function () {
  ensureUserExists(user)
  login(user)
  giveAiConsent()
})

beforeEach(function () {
  aiMock('POST', '/reset')
})

it('tells the model the error and the source, and applies the fix', function () {
  queueReplies({
    text: 'The command is not defined, use \\textbf instead.',
    toolCalls: [
      {
        name: 'propose_fix',
        args: {
          path: 'main.tex',
          startLine: 4,
          oldText: '\\fakeCommand{Hello world.}',
          newText: '\\textbf{Hello world.}',
        },
      },
    ],
  })
  login(user)
  const { waitForCompile } = prepareWaitForNextCompileSlot()
  openInOverleaf({
    snip_uri: dataUrl('text/plain', main),
    snip_name: 'main.tex',
  }).then(projectId => waitForCompile(() => openProject(projectId)))
  // The logs pane opens by itself after some compiles, the button is gone then
  cy.get('body').then($body => {
    if ($body.find('button[aria-label="View logs"]').length > 0) {
      cy.findByRole('button', { name: 'View logs' }).click()
    }
  })
  cy.contains('.log-entry', 'Undefined control sequence')
    .should('be.visible')
    .findByRole('button', { name: 'Suggest fix' })
    .click()

  cy.get('[data-fix-panel]').within(() => {
    cy.findByText('The command is not defined, use \\textbf instead.').should(
      'exist'
    )
    cy.get('del').should('contain.text', 'fakeCommand')
    cy.get('ins').should('contain.text', 'textbf')
  })

  responsesRequests().then(requests => {
    expect(requests).to.have.length(1)
    const [request] = requests
    expect(request.api).to.equal('responses')
    expect(request.model).to.equal('e2e-model')
    expect(request.tools).to.deep.equal(['propose_fix'])
    expect(messageText(request.input[0])).to.contain(
      'propose the smallest edit that removes it'
    )
    expect(messageText(request.input[1]))
      .to.contain('File: main.tex')
      .and.contain('Undefined control sequence')
      .and.contain('4: \\fakeCommand{Hello world.}')
  })

  cy.get('[data-fix-panel]')
    .findByRole('button', { name: 'Apply suggestion' })
    .click()
  cy.get('.cm-content').should('contain.text', '\\textbf{Hello world.}')
})
