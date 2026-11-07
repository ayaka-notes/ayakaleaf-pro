import { v4 as uuid } from 'uuid'
import { login } from '../../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../../helpers/project'
import { postWithCsrf, requestWithCsrf } from '../../../../helpers/request'
import { addComment } from '../../../../helpers/review'
import { ensureUserExists } from '../../../../helpers/users'

// A signed-out editor through the edit link may delete threads, which needs
// no user. Resolving records one and the review panel offers them no reopen,
// so both are refused instead of failing.

const owner = `owner-${uuid()}@example.com`

before(function () {
  ensureUserExists(owner)
})

describe('a signed-out editor through the edit link', function () {
  let projectId: string
  let docId: string
  const threads: Record<string, string> = {}

  before(function () {
    login(owner)
    createProject(projectName('Anonymous review')).then(id => {
      projectId = id
      openProject(projectId)
      for (const text of ['First thread', 'Second thread', 'Third thread']) {
        addComment(projectId, 'Introduction', text)
      }
      cy.request(`/project/${projectId}/threads`).then(response => {
        for (const [id, thread] of Object.entries<{
          messages: { content: string }[]
        }>(response.body)) {
          threads[thread.messages[0].content] = id
        }
      })
      cy.request(`/project/${projectId}/ranges`).then(response => {
        docId = response.body[0].id
      })
      cy.then(() =>
        postWithCsrf(
          `/project/${projectId}/doc/${docId}/thread/${threads['Second thread']}/resolve`,
          {}
        )
          .its('status')
          .should('equal', 204)
      )
    })
  })

  beforeEach(function () {
    login(owner)
    cy.visit('/project')
    postWithCsrf(`/project/${projectId}/settings/admin`, {
      publicAccessLevel: 'tokenBased',
    })
    cy.request(`/project/${projectId}/tokens`).then(response => {
      const token = response.body.readAndWrite as string
      cy.clearAllCookies()
      cy.visit(`/${token}`)
      postWithCsrf(`/${token}/grant`, { confirmedByUser: true })
        .its('body.redirect')
        .should('equal', `/project/${projectId}`)
    })
  })

  const thread = (text: string) =>
    `/project/${projectId}/doc/${docId}/thread/${threads[text]}`

  it('is refused resolving a thread', function () {
    postWithCsrf(`${thread('First thread')}/resolve`, {})
      .its('status')
      .should('equal', 403)
  })

  it('is refused reopening a resolved thread', function () {
    postWithCsrf(`${thread('Second thread')}/reopen`, {})
      .its('status')
      .should('equal', 403)
  })

  it('deletes a thread', function () {
    requestWithCsrf('DELETE', thread('Third thread'))
      .its('status')
      .should('equal', 204)
    cy.request(`/project/${projectId}/threads`)
      .its('body')
      .should('not.have.property', threads['Third thread'])
  })
})
