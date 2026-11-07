import { v4 as uuid } from 'uuid'
import { createGitToken } from '../../../../helpers/git'
import { login } from '../../../../helpers/login'
import { createProject, projectName } from '../../../../helpers/project'
import { postWithCsrf } from '../../../../helpers/request'
import { ensureUserExists } from '../../../../helpers/users'

// With rate limits on, MCP compiles share the limit of the compile button:
// 200 per project and user every 10 minutes. Every other tool has its own
// limit, e.g. 30 setting changes per minute.

const owner = `owner-${uuid()}@example.com`

describe('MCP compiles and the compile rate limit', function () {
  let projectId: string
  let token: string

  before(function () {
    ensureUserExists(owner)
    login(owner)
    createProject(projectName('Mcp limit')).then(id => {
      projectId = id
    })
    // leaves the settings page open, with its CSRF token
    createGitToken().then(created => {
      token = created
    })
  })

  it('refuses MCP compiles once the editor used up the limit', function () {
    // All at once: one compiles, the others are too soon after it, yet
    // each takes a point
    cy.get('meta[name="ol-csrfToken"]')
      .invoke('attr', 'content')
      .then(csrfToken =>
        cy.window().then({ timeout: 120_000 }, win =>
          Promise.all(
            Array.from({ length: 200 }, () =>
              win
                .fetch(`/project/${projectId}/compile`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Csrf-Token': csrfToken as string,
                  },
                  body: '{}',
                })
                .then(response => response.status)
            )
          )
        )
      )
      .should('not.include', 429)
    postWithCsrf(`/project/${projectId}/compile`, {})
      .its('status')
      .should('equal', 429)

    callTool('compile').should(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('Rate limit reached')
    })
  })

  it('refuses setting changes past 30 per minute', function () {
    for (let i = 0; i < 30; i++) {
      callTool('update_settings', { compiler: 'pdflatex' }).should(result => {
        expect(result.isError).to.not.equal(true)
      })
    }
    callTool('update_settings', { compiler: 'pdflatex' }).should(result => {
      expect(result.isError).to.equal(true)
      expect(result.content[0].text).to.contain('Rate limit reached')
    })
  })

  function callTool(name: string, args: Record<string, unknown> = {}) {
    return cy
      .request({
        method: 'POST',
        url: `/project/${projectId}/mcp`,
        headers: {
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        },
      })
      .its('body.result')
  }
})
