import SystemMessagesPage from '../../js/system-messages/components/system-messages-page'

describe('System messages admin page (#17b/#17c port)', () => {
  beforeEach(function () {
    localStorage.clear()
    cy.intercept('POST', '/admin/messages/list', {
      statusCode: 200,
      body: [
        {
          _id: 'abc123456789abcdef01234567',
          content: 'Existing message',
          placements: [],
        },
      ],
    }).as('listMessages')
    cy.intercept('POST', '/admin/messages', { statusCode: 200 }).as(
      'addMessage'
    )
    cy.intercept(
      { method: 'PATCH', url: /\/admin\/messages\/.+/ },
      { statusCode: 200 }
    ).as('updateMessage')
    cy.intercept(
      { method: 'DELETE', url: /\/admin\/messages\/.+/ },
      { statusCode: 200 }
    ).as('deleteMessage')
    cy.intercept('POST', '/admin/messages/clear', {
      statusCode: 200,
    }).as('clearMessages')
  })

  it('renders the page header and the current messages list', function () {
    cy.mount(<SystemMessagesPage />)

    cy.get('.sm-system-messages').should('exist')
    cy.get('.sm-system-messages-header').contains('System messages')
    cy.findByText('Existing message').should('exist')
    cy.get('.sm-settings-section').should('have.length', 2)
  })

  it('adds a message with the default "All pages" placement', function () {
    cy.mount(<SystemMessagesPage />)
    cy.get('#sm-new-message').type('Maintenance window')
    cy.get('[data-testid=sm-add]').click()

    cy.wait('@addMessage').then(interception => {
      expect(interception.request.body).to.deep.equal({
        content: 'Maintenance window',
        placements: [],
        unremovable: false,
      })
    })
    cy.get('[data-testid=sm-toast]')
      .contains('System message added')
      .should('exist')
  })

  it('adds a message scoped to a single surface', function () {
    cy.mount(<SystemMessagesPage />)
    cy.get('#sm-new-message').type('Editor notice')
    // "All pages" is exclusive: checking a surface deselects it
    cy.get('.sm-placement-chip').contains('Editor (IDE)').click()
    cy.get('[data-testid=sm-add]').click()

    cy.wait('@addMessage').then(interception => {
      expect(interception.request.body).to.deep.equal({
        content: 'Editor notice',
        placements: ['editor'],
        unremovable: false,
      })
    })
  })

  it('updates a message placement', function () {
    cy.mount(<SystemMessagesPage />)
    cy.findByText('Existing message').should('exist')

    const row = cy.get('[data-sm-message-id]').first()
    row.find('.sm-placement-chip').contains('Editor (IDE)').click()

    cy.wait('@updateMessage').then(interception => {
      expect(interception.request.url).to.include('/admin/messages/')
      expect(interception.request.body).to.deep.equal({
        placements: ['editor'],
      })
    })
  })

  it('toggles a message as unremovable (hides the dismiss X)', function () {
    cy.mount(<SystemMessagesPage />)
    const row = cy.get('[data-sm-message-id]').first()
    row.find('[role=switch]').click()

    cy.wait('@updateMessage').then(interception => {
      expect(interception.request.url).to.include('/admin/messages/')
      expect(interception.request.body).to.deep.equal({
        unremovable: true,
      })
    })
  })

  it('deletes a single message', function () {
    cy.mount(<SystemMessagesPage />)
    const row = cy.get('[data-sm-message-id]').first()
    row.find('button[aria-label^=Delete message]').click()

    cy.wait('@deleteMessage').then(interception => {
      expect(interception.request.url).to.include(
        '/admin/messages/abc123456789abcdef01234567'
      )
    })
    cy.get('[data-testid=sm-toast]').contains('Message deleted').should('exist')
  })

  it('clears all messages after confirmation', function () {
    cy.mount(<SystemMessagesPage />)
    const clear = cy.get('[data-testid=sm-clear]')
    // first click arms the confirmation, second click fires the request
    clear.click()
    cy.get('[data-testid=sm-clear-confirm]').should('exist')
    cy.get('[data-testid=sm-clear-confirm]').click()

    cy.wait('@clearMessages')
    cy.get('[data-testid=sm-toast]')
      .contains('All system messages cleared')
      .should('exist')
    cy.get('.sm-empty').contains('No system messages are currently set')
  })
})
