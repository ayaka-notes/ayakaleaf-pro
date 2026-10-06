import {
  aiMock,
  chatRequests,
  currentUserId,
  giveAiConsent,
  messageText,
  queueReplies,
  setAiFeatures,
  type Reply,
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

// "Suggest fix" on compile errors against services/ai-mock, which answers as
// the OpenAI-compatible gateway. The mock replays the replies a test queues
// and records the prompts, so the tests check both the fix the user sees and
// what the model was told about the error.

const user = `error-assistant-${Date.now()}@example.com`

const main = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  '\\fakeCommand{Hello world.}',
  '\\end{document}',
].join('\n')

const fix: Reply = {
  text: 'The command is not defined, use \\textbf instead.',
  toolCalls: [
    {
      name: 'suggestLineChange',
      args: {
        path: 'main.tex',
        from: { line: 4, content: '\\fakeCommand{Hello world.}' },
        to: { content: '\\textbf{Hello world.}' },
      },
    },
  ],
}

function editor() {
  return cy.get('.cm-content')
}

// Creates the project with the broken main.tex, opens it and waits for the
// compile that opening starts
function openBrokenProject(): Cypress.Chainable<string> {
  const { waitForCompile } = prepareWaitForNextCompileSlot()
  return openInOverleaf({
    snip_uri: dataUrl('text/plain', main),
    snip_name: 'main.tex',
  }).then(projectId => {
    waitForCompile(() => openProject(projectId))
    return cy.wrap(projectId)
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

function errorEntry() {
  showLogs()
  return cy
    .contains('.log-entry', 'Undefined control sequence')
    .should('be.visible')
}

// Waits until the document updater, where the endpoint reads the source,
// has the edits the editor sent
function waitForDocumentUpdater(projectId: string, text: string, attempts = 20) {
  cy.get('[data-file-type="doc"]')
    .first()
    .invoke('attr', 'data-file-id')
    .then(docId =>
      cy.request(`/Project/${projectId}/doc/${docId}/download`)
    )
    .then(({ body }) => {
      if (String(body).includes(text)) return
      expect(attempts, `${text} in the document updater`).to.be.greaterThan(0)
      cy.wait(250)
      waitForDocumentUpdater(projectId, text, attempts - 1)
    })
}

function suggestFix() {
  errorEntry().findByRole('button', { name: 'Suggest fix' }).click()
}

function assistant() {
  return cy.get('.ai-error-assistant')
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

describe('suggesting a fix', function () {
  beforeEach(function () {
    login(user)
  })

  it('tells the model the error and the source, and applies the fix', function () {
    queueReplies(fix)
    openBrokenProject()
    suggestFix()

    assistant().within(() => {
      cy.findByText('The command is not defined, use \\textbf instead.').should(
        'exist'
      )
      cy.findByText('Suggested code').should('exist')
      cy.get('del').should('contain.text', 'fakeCommand')
      cy.get('ins').should('contain.text', 'textbf')
    })

    chatRequests().then(requests => {
      expect(requests).to.have.length(1)
      const [request] = requests
      expect(request.model).to.equal('e2e-model')
      // Only the edit tool, the source is in the prompt
      expect(request.tools).to.deep.equal(['suggestLineChange'])
      expect(messageText(request.messages[0])).to.contain(
        'Fix exactly ONE LaTeX compile error'
      )
      const prompt = messageText(request.messages[1])
      expect(prompt)
        .to.contain('File: ./main.tex')
        .and.contain('Line: 4')
        .and.contain('Undefined control sequence')
        .and.contain('4: \\fakeCommand{Hello world.}')
    })

    assistant().findByRole('button', { name: 'Apply suggestion' }).click()
    editor().should('contain.text', '\\textbf{Hello world.}')
    editor().should('not.contain.text', '\\fakeCommand')
    // Applying a single change recompiles, the error is gone afterwards and
    // the fix stays listed
    cy.findByRole('button', { name: 'Compiling…' }).should('not.exist')
    cy.contains('.log-entry', 'Undefined control sequence').should('not.exist')
    cy.findByText('Last suggested fix').should('exist')
  })

  it('reads the latest edits, not the last saved version', function () {
    queueReplies(fix)
    openBrokenProject().then(projectId => {
      editor().within(() => {
        cy.findByText('\\section').parent().type('{end}\nAn unsaved line.')
      })
      waitForDocumentUpdater(projectId, 'An unsaved line.')
    })
    suggestFix()
    assistant().findByText('Suggested code').should('exist')
    chatRequests().then(([request]) => {
      expect(messageText(request.messages[1])).to.contain(
        '4: An unsaved line.'
      )
    })
  })

  it('cannot apply a fix after its line changed', function () {
    queueReplies(fix)
    openBrokenProject()
    suggestFix()
    assistant().findByText('Suggested code').should('exist')
    editor().within(() => {
      cy.findByText('\\fakeCommand').parent().type('{end} changed')
    })
    // The disabled button sits in a tooltip's wrapper
    assistant().contains('button', 'Apply suggestion').should('be.disabled')
  })

  it('suggests a different fix and takes feedback', function () {
    queueReplies(fix, {
      text: 'Or drop the command.',
      toolCalls: [
        {
          name: 'suggestLineChange',
          args: {
            path: 'main.tex',
            from: { line: 4, content: '\\fakeCommand{Hello world.}' },
            to: { content: 'Hello world.' },
          },
        },
      ],
    })
    openBrokenProject()
    suggestFix()
    assistant().findByText('Suggested code').should('exist')

    assistant().findByRole('button', { name: 'This was helpful' }).click()
    assistant()
      .find('.ai-error-assistant-feedback-positive')
      .should('have.class', 'active')

    assistant().findByRole('button', { name: 'Suggest a different fix' }).click()
    assistant().findByText('Or drop the command.').should('exist')
    chatRequests().should('have.length', 2)
  })

  it('shows the explanation when the model has no fix', function () {
    queueReplies({ text: 'I cannot tell what this command should be.' })
    openBrokenProject()
    suggestFix()
    assistant().within(() => {
      cy.findByText('I cannot tell what this command should be.').should(
        'exist'
      )
      cy.findByText('Suggested code').should('not.exist')
      cy.findByRole('button', { name: 'This was helpful' }).should('exist')
    })
  })

  it('skips a tool call with invalid arguments', function () {
    queueReplies({
      text: 'Here is a broken suggestion.',
      toolCalls: [
        {
          name: 'suggestLineChange',
          args: { path: 'main.tex', from: { line: 4 } },
        },
      ],
    })
    openBrokenProject()
    suggestFix()
    assistant().within(() => {
      cy.findByText('Here is a broken suggestion.').should('exist')
      cy.findByRole('button', { name: 'This was helpful' }).should('exist')
      cy.findByText('Suggested code').should('not.exist')
    })
  })

  it('shows an error when the gateway fails', function () {
    queueReplies({ status: 401 })
    openBrokenProject()
    suggestFix()
    assistant()
      .findByText(
        'Sorry! It looks like that didn’t work this time. Please try again.'
      )
      .should('exist')
  })
})

describe('AI consent', function () {
  const newUser = `error-assistant-consent-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(newUser)
  })

  it('asks before the first fix and then suggests it', function () {
    queueReplies(fix)
    login(newUser)
    openBrokenProject()
    suggestFix()
    cy.findByText('Before you use Error Assist').should('exist')
    chatRequests().should('have.length', 0)

    cy.findByRole('button', { name: 'Accept and continue' }).click()
    assistant().findByText('Suggested code').should('exist')
    chatRequests().should('have.length', 1)
  })
})

describe('the token quota', function () {
  const quotaUser = `error-assistant-quota-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(quotaUser)
    login(quotaUser)
    giveAiConsent()
  })

  it('stops suggesting fixes once the tokens are used up', function () {
    // AI_TOKEN_QUOTA=100000, this reply alone uses 110000
    queueReplies({ ...fix, usage: { prompt: 60_000, completion: 50_000 } })
    login(quotaUser)
    openBrokenProject()
    suggestFix()
    assistant().findByText('Suggested code').should('exist')

    assistant().findByRole('button', { name: 'Suggest a different fix' }).click()
    assistant().findByText('Usage limit reached').should('exist')
    chatRequests().should('have.length', 1)
  })
})

describe('AI turned off for a user', function () {
  const offUser = `error-assistant-off-${Date.now()}@example.com`

  before(function () {
    ensureUserExists(offUser)
    login(offUser)
    giveAiConsent()
    currentUserId().then(userId => {
      login(ADMIN_EMAIL)
      setAiFeatures(userId, false)
    })
  })

  it('hides the button and refuses the request', function () {
    login(offUser)
    openBrokenProject().then(projectId => {
      errorEntry()
      cy.findByRole('button', { name: 'Suggest fix' }).should('not.exist')
      postWithCsrf(`/project/${projectId}/suggest-fix`, {
        logEntry: { file: 'main.tex', line: 4, raw: 'Undefined control sequence' },
      }).then(response => {
        expect(response.status).to.equal(403)
        expect(response.body).to.deep.equal({ error: 'ai_access_denied' })
      })
    })
    chatRequests().should('have.length', 0)
  })
})

describe('the suggest-fix endpoint', function () {
  const stranger = `error-assistant-stranger-${Date.now()}@example.com`
  const logEntry = {
    file: 'main.tex',
    line: 4,
    raw: 'Undefined control sequence',
    level: 'error',
  }

  before(function () {
    ensureUserExists(stranger)
  })

  it('refuses requests without a log entry or for missing files', function () {
    login(user)
    openInOverleaf({
      snip_uri: dataUrl('text/plain', main),
      snip_name: 'main.tex',
    }).then(projectId => {
      cy.visit('/project')
      postWithCsrf(`/project/${projectId}/suggest-fix`, {}).then(response => {
        expect(response.status).to.equal(400)
        expect(response.body).to.deep.equal({ error: 'missing_log_entry' })
      })
      postWithCsrf(`/project/${projectId}/suggest-fix`, {
        logEntry: { ...logEntry, file: undefined },
      }).then(response => {
        expect(response.status).to.equal(400)
        expect(response.body).to.deep.equal({ error: 'missing_file' })
      })
      postWithCsrf(`/project/${projectId}/suggest-fix`, {
        logEntry: { ...logEntry, file: 'missing.tex' },
      }).then(response => {
        expect(response.status).to.equal(404)
        expect(response.body).to.deep.equal({ error: 'file_not_found' })
      })
    })
    chatRequests().should('have.length', 0)
  })

  it('only answers users who can read the project', function () {
    login(user)
    openInOverleaf({
      snip_uri: dataUrl('text/plain', main),
      snip_name: 'main.tex',
    }).then(projectId => {
      login(stranger)
      giveAiConsent()
      postWithCsrf(`/project/${projectId}/suggest-fix`, { logEntry })
        .its('status')
        .should('equal', 403)
    })
    chatRequests().should('have.length', 0)
  })
})
