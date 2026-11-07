// The review panel of the track-changes module: adding comments through the
// editor, and waiting until the server has them.

// The element with the text in the editor
export function editorText(text: string) {
  return cy.get('.cm-content').findByText(text)
}

// Insert > Comment, also there when the toolbar moves its button into overflow
function insertMenuComment() {
  cy.findByRole('button', { name: 'Insert', exact: true }).click()
  return cy.findByRole('menuitem', { name: 'Comment', exact: true })
}

// The rail remembers an open panel across reloads, and the tab toggles it
export function openReviewPanel() {
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

export function reviewPanel() {
  return cy.get('.review-panel-container')
}

export function commentEntry(text: string) {
  return reviewPanel().find(`.review-panel-entry-comment:contains("${text}")`)
}

// Comment boxes are small CodeMirror editors inside a shadow root, Enter
// sends them
export function typeInCommentBox(
  box: Cypress.Chainable<JQuery>,
  text: string
) {
  box.shadow().find('.cm-content').type(text)
}

// Selects the line with the text and comments on it through Insert > Comment.
// CodeMirror ignores a synthetic double click, select with the keyboard.
export function addComment(projectId: string, word: string, text: string) {
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
export function waitForServer(url: string, text: string, attempt = 1) {
  cy.request(url).then(response => {
    if (!JSON.stringify(response.body).includes(text) && attempt < 20) {
      cy.wait(500)
      waitForServer(url, text, attempt + 1)
    } else {
      expect(JSON.stringify(response.body)).to.contain(text)
    }
  })
}

export function waitForComment(projectId: string, text: string) {
  waitForServer(`/project/${projectId}/threads`, text)
}

// A new comment is two writes: the message over HTTP and the highlighted
// range over the realtime connection. Waits for both, the range arrives last.
export function waitForCommentRange(projectId: string, text: string) {
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
