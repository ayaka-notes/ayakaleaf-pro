import { chatRequests } from '../../../../helpers/ai'
import { login } from '../../../../helpers/login'
import { createProject, openProject, projectName } from '../../../../helpers/project'
import { postWithCsrf } from '../../../../helpers/request'
import { ensureUserExists } from '../../../../helpers/users'

// AI_ENABLED=false with the gateway still configured: the assistant is gone
// from the editor and the chat endpoint refuses everyone.

const user = `workbench-disabled-${Date.now()}@example.com`

before(function () {
  ensureUserExists(user)
})

it('hides the AI assistant and refuses the chat', function () {
  login(user)
  createProject(projectName('NoAI')).then(openProject)
  cy.findByRole('tab', { name: 'File tree' }).should('exist')
  cy.findByRole('tab', { name: 'AI assistant' }).should('not.exist')

  cy.request('/workbench/access')
    .its('body')
    .should('deep.equal', { allowed: false, errorAssistant: false })
  postWithCsrf('/workbench/tex-gpt', {
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
  }).then(response => {
    expect(response.status).to.equal(403)
    expect(response.body).to.deep.equal({ error: 'ai_access_denied' })
  })
  chatRequests().should('have.length', 0)
})
