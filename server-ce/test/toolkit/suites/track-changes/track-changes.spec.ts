import { v4 as uuid } from 'uuid'
import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
  waitForDocText,
} from '../../../helpers/project'
import { postWithCsrf, requestWithCsrf } from '../../../helpers/request'
import { shareProject, shareProjectByLink } from '../../../helpers/sharing'
import {
  addComment,
  commentEntry,
  editorText,
  openReviewPanel,
  reviewPanel,
  typeInCommentBox,
  waitForComment,
  waitForServer,
} from '../../../helpers/review'
import { ADMIN_EMAIL, ensureUserExists } from '../../../helpers/users'

// track-changes module: editing modes, tracked changes and comments in the
// review panel, and who may do what with them.

const owner = `owner-${uuid()}@example.com`
const reviewer = `reviewer-${uuid()}@example.com`
const viewer = `viewer-${uuid()}@example.com`
const editor = `editor-${uuid()}@example.com`
const linkViewer = `link-viewer-${uuid()}@example.com`
const stranger = `stranger-${uuid()}@example.com`

// Types on a new line after \maketitle
function typeNewLine(text: string) {
  cy.findByText('\\maketitle').parent().type(`{end}\n${text}`)
}

// Types on a new line at the end of the document
function typeAtEnd(text: string) {
  cy.get('.cm-content').type(`{ctrl+end}\n${text}`)
}

function modeButton(mode: 'Editing' | 'Reviewing' | 'Viewing') {
  return cy.findByRole('button', { name: mode })
}

function openModeMenu() {
  cy.get('.review-mode-switcher-toggle-button').click()
}

function modeMenuItem(mode: 'Editing' | 'Reviewing' | 'Viewing') {
  return cy.findByRole('menuitem', { name: new RegExp(`^${mode}`) })
}

function switchMode(mode: 'Editing' | 'Reviewing') {
  openModeMenu()
  modeMenuItem(mode).click()
  modeButton(mode).should('exist')
}

// One selector each, so that should('not.exist') covers the whole query
function changeEntry(kind: 'Added' | 'Deleted', text: string) {
  return reviewPanel().find(
    `.review-panel-entry-change:contains("${kind}:"):contains("${text}")`
  )
}

function waitForChange(projectId: string, text: string) {
  waitForServer(`/project/${projectId}/ranges`, text)
}

// Creates a project as the owner with a reviewer and a viewer and leaves the
// browser logged in as the owner.
function createSharedProject(): Cypress.Chainable<string> {
  login(owner)
  return createProject(projectName('Review')).then(projectId => {
    shareProject(projectId, reviewer, 'review')
    login(owner)
    shareProject(projectId, viewer, 'readOnly')
    login(owner)
    return cy.wrap(projectId)
  })
}

before(function () {
  for (const email of [owner, reviewer, viewer, editor, linkViewer, stranger]) {
    ensureUserExists(email)
  }
})

describe('editing modes', function () {
  let projectId: string

  before(function () {
    createSharedProject().then(id => {
      projectId = id
    })
  })

  it('lets the owner switch to reviewing and keeps the mode after a reload', function () {
    login(owner)
    openProject(projectId)
    modeButton('Editing').should('exist')

    openModeMenu()
    modeMenuItem('Editing').should('not.have.class', 'disabled')
    modeMenuItem('Reviewing').should('not.have.class', 'disabled')
    modeMenuItem('Viewing').should('not.exist')
    modeMenuItem('Reviewing').click()
    modeButton('Reviewing').should('exist')

    openProject(projectId)
    modeButton('Reviewing').should('exist')
    switchMode('Editing')
    openProject(projectId)
    modeButton('Editing').should('exist')
  })

  it('keeps a reviewer in reviewing with editing disabled', function () {
    login(reviewer)
    openProject(projectId)
    modeButton('Reviewing').should('exist')
    openModeMenu()
    modeMenuItem('Editing').should('have.class', 'disabled')
    modeMenuItem('Viewing').should('not.exist')
  })

  it('keeps a viewer in viewing with editing and reviewing disabled', function () {
    login(viewer)
    openProject(projectId)
    modeButton('Viewing').should('exist')
    openModeMenu()
    modeMenuItem('Editing').should('have.class', 'disabled')
    modeMenuItem('Reviewing').should('have.class', 'disabled')
    cy.get('.cm-content').should('have.attr', 'contenteditable', 'false')
  })
})

describe('tracked changes', function () {
  let projectId: string

  beforeEach(function () {
    createSharedProject().then(id => {
      projectId = id
    })
  })

  it('tracks insertions and deletions while reviewing and keeps them after a reload', function () {
    openProject(projectId)
    switchMode('Reviewing')
    typeNewLine('Tracked insertion')
    cy.findByText('\\maketitle')
      .parent()
      .type('{end}' + '{backspace}'.repeat(5))

    openReviewPanel()
    changeEntry('Added', 'Tracked insertion').should('be.visible')
    changeEntry('Deleted', 'title').should('be.visible')
    cy.get('.ol-cm-change-i').should('contain.text', 'Tracked insertion')
    cy.get('.ol-cm-change-d').should('exist')

    waitForChange(projectId, 'Tracked insertion')
    openProject(projectId)
    openReviewPanel()
    changeEntry('Added', 'Tracked insertion').should('be.visible')
    changeEntry('Deleted', 'title').should('be.visible')
  })

  it('accepts and rejects changes', function () {
    openProject(projectId)
    switchMode('Reviewing')
    // Apart from each other, adjacent insertions merge into one change
    typeNewLine('Keep this')
    typeAtEnd('Drop this')
    openReviewPanel()

    changeEntry('Added', 'Keep this')
      .findByRole('button', { name: 'Accept change' })
      .click()
    changeEntry('Added', 'Keep this').should('not.exist')
    editorText('Keep this').should('exist')

    changeEntry('Added', 'Drop this')
      .findByRole('button', { name: 'Reject change' })
      .click()
    changeEntry('Added', 'Drop this').should('not.exist')
    cy.get('.cm-content').should('not.contain.text', 'Drop this')
    cy.get('.ol-cm-change-i').should('not.exist')
  })

  it("tracks a reviewer's edits for the owner to accept", function () {
    login(reviewer)
    openProject(projectId)
    modeButton('Reviewing').should('exist')
    typeNewLine('Suggested by the reviewer')
    openReviewPanel()
    changeEntry('Added', 'Suggested by the reviewer').within(() => {
      // A reviewer can withdraw their own suggestion but not accept it
      cy.findByRole('button', { name: 'Accept change' }).should('not.exist')
      cy.findByRole('button', { name: 'Reject change' }).should('exist')
    })
    waitForChange(projectId, 'Suggested by the reviewer')

    login(owner)
    openProject(projectId)
    openReviewPanel()
    changeEntry('Added', 'Suggested by the reviewer')
      .should('contain.text', reviewer.split('@')[0])
      .findByRole('button', { name: 'Accept change' })
      .click()
    changeEntry('Added', 'Suggested by the reviewer').should('not.exist')
    editorText('Suggested by the reviewer').should('exist')
    cy.get('.ol-cm-change-i').should('not.exist')
  })
})

// The review panel names the authors of tracked changes from this route, also
// those who left the project
describe('authors of tracked changes', function () {
  it('lists the author of a change that is not in docstore yet', function () {
    createSharedProject().then(projectId => {
      login(reviewer)
      openProject(projectId)
      typeNewLine('Not saved to docstore')
      // In document-updater only, until something flushes the doc
      waitForDocText(projectId, 'main.tex', 'Not saved to docstore')
      cy.request(`/project/${projectId}/changes/users`)
        .its('body')
        .should((users: { email: string }[]) => {
          expect(users.map(user => user.email)).to.include(reviewer)
        })
    })
  })
})

describe('comments', function () {
  let projectId: string

  beforeEach(function () {
    createSharedProject().then(id => {
      projectId = id
    })
  })

  it('adds, replies to, edits and deletes a comment', function () {
    openProject(projectId)
    addComment(projectId, 'Introduction', 'First comment')

    typeInCommentBox(
      commentEntry('First comment').find(
        '.review-panel-comment-input:not(.review-panel-comment-edit)'
      ),
      'A reply{enter}'
    )
    commentEntry('First comment').should('contain.text', 'A reply')

    commentEntry('First comment').within(() => {
      cy.findAllByRole('button', { name: 'More options' }).first().click()
    })
    cy.findByRole('menuitem', { name: 'Edit' }).click()
    // While editing, the text sits in the shadow root where :contains cannot
    // see it, find the entry by its reply
    typeInCommentBox(
      commentEntry('A reply').find('.review-panel-comment-edit'),
      '{selectall}{backspace}Edited comment{enter}'
    )
    commentEntry('Edited comment').should('be.visible')

    waitForComment(projectId, 'Edited comment')
    openProject(projectId)
    openReviewPanel()
    commentEntry('Edited comment').should('contain.text', 'A reply')

    commentEntry('Edited comment').within(() => {
      cy.findAllByRole('button', { name: 'More options' }).first().click()
    })
    cy.findByRole('menuitem', { name: 'Delete' }).click()
    cy.findByRole('dialog').findByRole('button', { name: 'Delete' }).click()
    commentEntry('Edited comment').should('not.exist')
  })

  it('resolves and reopens a comment', function () {
    openProject(projectId)
    addComment(projectId, 'Introduction', 'To be resolved')

    commentEntry('To be resolved')
      .findByRole('button', { name: 'Resolve comment' })
      .click()
    commentEntry('To be resolved').should('not.exist')

    cy.findByRole('button', { name: 'Resolved comments' }).click()
    cy.get('.review-panel-resolved-comment:contains("To be resolved")')
      .findByRole('button', { name: 'Re-open' })
      .click()
    commentEntry('To be resolved').should('be.visible')
  })

  it('lets a reviewer comment and the owner see it', function () {
    login(reviewer)
    openProject(projectId)
    addComment(projectId, 'Introduction', 'From the reviewer')

    login(owner)
    openProject(projectId)
    openReviewPanel()
    commentEntry('From the reviewer').should('be.visible')
  })

  it('does not let a viewer comment', function () {
    login(viewer)
    openProject(projectId)
    modeButton('Viewing').should('exist')
    // Neither the Insert menu nor the toolbar offers a comment
    cy.findByRole('button', { name: 'Insert', exact: true }).should('not.exist')
    cy.get('#toolbar-add-comment').should('not.exist')
  })
})

// The Overview tab lists the comments and changes of every doc, also of docs
// that the document-updater has not loaded. It only loads a doc when someone
// opens it, so the docs of a copied project start out in docstore only.
describe('overview', function () {
  it('lists the comments of docs that are not loaded', function () {
    // Only admins can copy a project with its comments
    login(ADMIN_EMAIL)
    createProject(projectName('Overview')).then(sourceId => {
      openProject(sourceId)
      cy.findByRole('tab', { name: 'File tree' }).then(tab => {
        if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
      })
      cy.findByRole('button', { name: 'New file' }).click()
      cy.findByRole('dialog').within(() => {
        cy.findByLabelText(/^File name$/i)
          .clear()
          .type('chapter.tex')
        cy.findByRole('button', { name: 'Create' }).click()
      })
      // The new doc opens in the editor
      cy.get('.cm-content').should('not.contain.text', 'Introduction')
      cy.get('.cm-content').type('Chapter text')
      addComment(sourceId, 'Chapter text', 'Comment in the chapter')

      postWithCsrf(`/project/${sourceId}/clone`, {
        projectName: projectName('Copy'),
        cloneRanges: true,
      }).then(response => {
        const copyId = response.body.project_id

        // The copy opens on main.tex and leaves chapter.tex unloaded
        openProject(copyId)
        cy.request(`/project/${copyId}/threads`).then(threads => {
          const threadId = Object.keys(threads.body).find(
            id =>
              threads.body[id].messages[0].content === 'Comment in the chapter'
          )
          expect(threadId).to.be.a('string')
          cy.request(`/project/${copyId}/ranges`)
            .its('body')
            .then(body => {
              expect(JSON.stringify(body)).to.contain(`"t":"${threadId}"`)
            })
        })

        openReviewPanel()
        cy.findByRole('tab', { name: 'Overview' }).click()
        cy.get('#review-panel-overview')
          .should('contain.text', 'chapter.tex')
          .and('contain.text', 'Comment in the chapter')
      })
    })
  })
})

// Every route of the module, called as each kind of member. Restricted users
// (link viewers) and users without access get nothing, not even the ranges.
describe('permissions', function () {
  let projectId: string
  let docId: string
  let ownerThread: string
  let reviewerThread: string

  before(function () {
    createSharedProject().then(id => {
      projectId = id
      shareProject(projectId, editor, 'readAndWrite')
      login(owner)
      shareProjectByLink(projectId, linkViewer, 'readOnly')

      login(owner)
      openProject(projectId)
      addComment(projectId, 'Introduction', 'Owner thread')
      login(reviewer)
      openProject(projectId)
      addComment(projectId, 'Introduction', 'Reviewer thread')

      cy.request(`/project/${projectId}/threads`).then(response => {
        for (const [id, thread] of Object.entries<{
          messages: { content: string }[]
        }>(response.body)) {
          if (thread.messages[0].content === 'Owner thread') ownerThread = id
          if (thread.messages[0].content === 'Reviewer thread')
            reviewerThread = id
        }
      })
      cy.request(`/project/${projectId}/ranges`).then(response => {
        docId = response.body[0].id
      })
    })
  })

  type Method = 'GET' | 'POST' | 'DELETE'

  // The status comes first so that the route helpers below can be spread
  // into path and body
  function expectStatus(
    status: number,
    method: Method,
    path: string,
    body: Record<string, unknown> = {}
  ) {
    const url = `/project/${projectId}${path}`
    const request =
      method === 'GET'
        ? cy.request({ url, failOnStatusCode: false, followRedirect: false })
        : requestWithCsrf(method, url, body)
    request.its('status').should('equal', status)
  }

  function asUser(email: string) {
    login(email)
    // A page with a CSRF token for the POST and DELETE requests
    cy.visit('/user/settings')
  }

  function canRead(status: number) {
    expectStatus(status, 'GET', '/ranges')
    expectStatus(status, 'GET', '/threads')
    expectStatus(status, 'GET', '/changes/users')
  }

  // track_changes with only on_for_guests keeps the members' modes as they are
  const toggle = () => ['/track_changes', { on_for_guests: false }] as const
  const accept = () =>
    [`/doc/${docId}/changes/accept`, { change_ids: [] }] as const
  const reply = (thread: string) =>
    [`/thread/${thread}/messages`, { content: 'Reply' }] as const
  const resolve = (thread: string) => `/doc/${docId}/thread/${thread}/resolve`
  const reopen = (thread: string) => `/doc/${docId}/thread/${thread}/reopen`

  it('lets an editor change modes, accept changes and manage every thread', function () {
    asUser(editor)
    canRead(200)
    expectStatus(204, 'POST', ...toggle())
    expectStatus(204, 'POST', ...accept())
    expectStatus(204, 'POST', ...reply(ownerThread))
    expectStatus(204, 'POST', resolve(reviewerThread))
    expectStatus(204, 'POST', reopen(reviewerThread))
  })

  it('lets a reviewer comment and resolve only their own threads', function () {
    asUser(reviewer)
    canRead(200)
    expectStatus(403, 'POST', ...toggle())
    expectStatus(403, 'POST', ...accept())
    expectStatus(204, 'POST', ...reply(ownerThread))

    expectStatus(403, 'POST', resolve(ownerThread))
    expectStatus(403, 'POST', reopen(ownerThread))
    expectStatus(403, 'DELETE', `/doc/${docId}/thread/${ownerThread}`)
    cy.request(`/project/${projectId}/threads`).then(response => {
      const messageId = response.body[ownerThread].messages[0].id
      expectStatus(
        403,
        'DELETE',
        `/thread/${ownerThread}/messages/${messageId}`
      )
    })

    expectStatus(204, 'POST', resolve(reviewerThread))
    expectStatus(204, 'POST', reopen(reviewerThread))
  })

  it('lets a reviewer delete their own reply but not those of others', function () {
    // Message ids of the owner thread by content
    const messageIds = () =>
      cy.request(`/project/${projectId}/threads`).then(response => {
        const ids: Record<string, string> = {}
        for (const message of response.body[ownerThread].messages) {
          ids[message.content] = message.id
        }
        return ids
      })
    const message = (id: string) => `/thread/${ownerThread}/messages/${id}`

    asUser(editor)
    expectStatus(204, 'POST', `/thread/${ownerThread}/messages`, {
      content: 'Editor reply',
    })
    asUser(reviewer)
    expectStatus(204, 'POST', `/thread/${ownerThread}/messages`, {
      content: 'Reviewer reply',
    })
    messageIds().then(ids => {
      expectStatus(403, 'DELETE', message(ids['Owner thread']))
      expectStatus(403, 'DELETE', message(ids['Editor reply']))
      expectStatus(204, 'DELETE', message(ids['Reviewer reply']))
    })
    messageIds().should(ids => {
      expect(ids).to.include.keys('Owner thread', 'Editor reply')
      expect(ids).not.to.have.any.keys('Reviewer reply')
    })

    // Editors still delete the replies of others
    expectStatus(204, 'POST', `/thread/${ownerThread}/messages`, {
      content: 'Second reviewer reply',
    })
    asUser(editor)
    messageIds().then(ids => {
      expectStatus(204, 'DELETE', message(ids['Second reviewer reply']))
    })
    messageIds().should(ids => {
      expect(ids).not.to.have.any.keys('Second reviewer reply')
    })
  })

  it('lets an invited viewer read the review but change nothing', function () {
    asUser(viewer)
    canRead(200)
    expectStatus(403, 'POST', ...toggle())
    expectStatus(403, 'POST', ...accept())
    expectStatus(403, 'POST', ...reply(ownerThread))
    expectStatus(403, 'POST', resolve(ownerThread))
    expectStatus(403, 'DELETE', `/doc/${docId}/thread/${ownerThread}`)
  })

  for (const { role, email } of [
    { role: 'a viewer through the link', email: () => linkViewer },
    { role: 'a user without access', email: () => stranger },
  ]) {
    it(`gives ${role} nothing`, function () {
      asUser(email())
      canRead(403)
      expectStatus(403, 'POST', ...toggle())
      expectStatus(403, 'POST', ...accept())
      expectStatus(403, 'POST', ...reply(ownerThread))
      expectStatus(403, 'POST', resolve(ownerThread))
      expectStatus(403, 'DELETE', `/doc/${docId}/thread/${ownerThread}`)
    })
  }

  it('lets the owner delete any thread', function () {
    asUser(owner)
    expectStatus(204, 'DELETE', `/doc/${docId}/thread/${reviewerThread}`)
    cy.request(`/project/${projectId}/threads`)
      .its('body')
      .should('not.have.property', reviewerThread)
  })
})
