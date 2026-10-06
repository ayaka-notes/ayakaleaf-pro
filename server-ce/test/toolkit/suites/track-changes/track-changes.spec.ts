import { v4 as uuid } from 'uuid'
import { login } from '../../../helpers/login'
import {
  createProject,
  openProject,
  projectName,
} from '../../../helpers/project'
import { requestWithCsrf } from '../../../helpers/request'
import { shareProject, shareProjectByLink } from '../../../helpers/sharing'
import { ensureUserExists } from '../../../helpers/users'

// track-changes module: editing modes, tracked changes and comments in the
// review panel, and who may do what with them.

const owner = `owner-${uuid()}@example.com`
const reviewer = `reviewer-${uuid()}@example.com`
const viewer = `viewer-${uuid()}@example.com`
const editor = `editor-${uuid()}@example.com`
const linkViewer = `link-viewer-${uuid()}@example.com`
const stranger = `stranger-${uuid()}@example.com`

// The element with the text in the editor
function editorText(text: string) {
  return cy.get('.cm-content').findByText(text)
}

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

// Insert > Comment, also there when the toolbar moves its button into overflow
function insertMenuComment() {
  cy.findByRole('button', { name: 'Insert', exact: true }).click()
  return cy.findByRole('menuitem', { name: 'Comment', exact: true })
}

// The rail remembers an open panel across reloads, and the tab toggles it
function openReviewPanel() {
  cy.findByRole('tab', { name: 'Review panel' }).then(tab => {
    if (tab.attr('aria-selected') !== 'true') cy.wrap(tab).click()
  })
  cy.findByRole('tab', { name: 'Review panel' }).should(
    'have.attr',
    'aria-selected',
    'true'
  )
  return reviewPanel()
}

function reviewPanel() {
  return cy.get('.review-panel-container')
}

// One selector each, so that should('not.exist') covers the whole query
function changeEntry(kind: 'Added' | 'Deleted', text: string) {
  return reviewPanel().find(
    `.review-panel-entry-change:contains("${kind}:"):contains("${text}")`
  )
}

function commentEntry(text: string) {
  return reviewPanel().find(`.review-panel-entry-comment:contains("${text}")`)
}

// Comment boxes are small CodeMirror editors inside a shadow root, Enter
// sends them
function typeInCommentBox(box: Cypress.Chainable<JQuery>, text: string) {
  box.shadow().find('.cm-content').type(text)
}

// Selects the line with the text and comments on it through Insert > Comment.
// CodeMirror ignores a synthetic double click, select with the keyboard.
function addComment(projectId: string, word: string, text: string) {
  // force: the floating editing mode switcher can cover the line
  editorText(word)
    .closest('.cm-line')
    .type('{end}{shift+home}', { force: true })
  insertMenuComment().click()
  // Only the box for a new comment has no review-panel-comment-input class
  typeInCommentBox(
    cy.get('.review-panel-add-comment-editor:not(.review-panel-comment-input)'),
    text
  )
  cy.findByRole('button', { name: 'Comment', exact: true }).click()
  commentEntry(text).should('be.visible')
  waitForCommentRange(projectId, text)
}

// Polls one of the module's routes until its JSON mentions the text, so the
// editor has sent the change before the test reloads or switches users.
function waitForServer(url: string, text: string, attempt = 1) {
  cy.request(url).then(response => {
    if (!JSON.stringify(response.body).includes(text) && attempt < 20) {
      cy.wait(500)
      waitForServer(url, text, attempt + 1)
    } else {
      expect(JSON.stringify(response.body)).to.contain(text)
    }
  })
}

function waitForChange(projectId: string, text: string) {
  waitForServer(`/project/${projectId}/ranges`, text)
}

function waitForComment(projectId: string, text: string) {
  waitForServer(`/project/${projectId}/threads`, text)
}

// A new comment is two writes: the message over HTTP and the highlighted
// range over the realtime connection. Waits for both, the range arrives last.
function waitForCommentRange(projectId: string, text: string) {
  waitForComment(projectId, text)
  cy.request(`/project/${projectId}/threads`).then(response => {
    const threadId = Object.keys(response.body).find(id =>
      response.body[id].messages.some(
        (message: { content: string }) => message.content === text
      )
    )
    waitForServer(`/project/${projectId}/ranges`, `"t":"${threadId}"`)
  })
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
