import { chatRequests } from '../../../../helpers/ai'
import { prepareWaitForNextCompileSlot } from '../../../../helpers/compile'
import { login } from '../../../../helpers/login'
import { dataUrl, openInOverleaf } from '../../../../helpers/openInOverleaf'
import { openProject } from '../../../../helpers/project'
import { postWithCsrf } from '../../../../helpers/request'
import { ensureUserExists } from '../../../../helpers/users'

// AI_ENABLED=false with the gateway still configured: compile errors have no
// Suggest fix button and the endpoint refuses everyone.

const user = `error-assistant-disabled-${Date.now()}@example.com`

const main = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Introduction}',
  '\\fakeCommand{Hello world.}',
  '\\end{document}',
].join('\n')

before(function () {
  ensureUserExists(user)
})

it('offers no fixes for compile errors', function () {
  login(user)
  const { waitForCompile } = prepareWaitForNextCompileSlot()
  openInOverleaf({
    snip_uri: dataUrl('text/plain', main),
    snip_name: 'main.tex',
  }).then(projectId => {
    waitForCompile(() => openProject(projectId))
    cy.get('body').then($body => {
      if ($body.find('button[aria-label="View logs"]').length > 0) {
        cy.findByRole('button', { name: 'View logs' }).click()
      }
    })
    cy.contains('.log-entry', 'Undefined control sequence').should('be.visible')
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
