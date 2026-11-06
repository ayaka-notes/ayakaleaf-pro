import NotificationsAdminPage from '../../js/notifications-admin/components/notifications-admin-page'

describe('Notifications admin page', () => {
  const sampleState = {
    dispatch: {
      apiUrl: 'http://apprise:8001',
      dryRun: false,
      baseDelayMs: 120000,
    },
    recipients: [
      { id: 'user-1', email: 'jane@example.com', notificationUrl: null },
      {
        id: 'user-2',
        email: 'john@example.com',
        notificationUrl: 'tg://bot-token/chat-id',
      },
    ],
    queue: {
      pending: 2,
      processing: 1,
      dead: 3,
      recent: [
        {
          opts: { projectName: 'My Paper' },
          project_id: 'p1',
          processing: false,
        },
        {
          opts: { projectName: 'Thesis' },
          project_id: 'p2',
          dead: true,
        },
      ],
    },
  }

  beforeEach(function () {
    cy.intercept('GET', '/assets*/**').as('assets')
    // meta provides the initial state
    cy.intercept(
      { method: 'POST', url: '/admin/notifications/state' },
      { statusCode: 200, body: sampleState }
    ).as('state')
    cy.intercept(
      { method: 'POST', url: '/admin/notifications/dry-run' },
      { statusCode: 200, body: { dryRun: true } }
    ).as('dryRun')
    cy.intercept(
      { method: 'POST', url: '/admin/notifications/user-url' },
      req => {
        cy.wrap(null).then(() => {
          cy.intercept(
            { method: 'POST', url: '/admin/notifications/test' },
            { statusCode: 200, body: { message: 'Test notification sent.' } }
          )
        })
        cy.reply({ statusCode: 200, body: { notificationUrl: req.body.notificationUrl } })
      }
    ).as('userUrl')
  })

  it('renders the three numbered sections', function () {
    cy.mount(<NotificationsAdminPage />)

    cy.get('.na-header').contains('Notifications')
    cy.get('.na-section').should('have.length', 3)
    cy.get('.na-badge').first().contains('1')
    cy.get('.na-badge').last().contains('3')
    cy.get('.na-header-desc').should('exist')
  })

  it('lists recipients with their channel URLs', function () {
    cy.mount(<NotificationsAdminPage />)

    cy.get('[data-recipient-id=user-1]').should('contain.text', 'jane@example.com')
    cy.get('[data-recipient-id=user-2]')
      .find('[data-testid=na-recipient-url-user-2]')
      .should('have.value', 'tg://bot-token/chat-id')
  })

  it('shows the queue counts and recent items', function () {
    cy.mount(<NotificationsAdminPage />)

    cy.get('.na-section-desc').contains('Pending 2')
    cy.get('.na-recent-row').should('have.length', 2)
    cy.get('.na-recent-row').first().contains('My Paper')
    cy.get('.na-recent-status').eq(1).contains('dead')
  })

  it('toggles dry run through the endpoint', function () {
    cy.mount(<NotificationsAdminPage />)

    cy.get('.na-toggle').should('have.attr', 'aria-checked', 'false')
    cy.get('.na-toggle').click()
    cy.wait('@dryRun')
    cy.get('.na-toggle').should('have.attr', 'aria-checked', 'true')
  })
})
