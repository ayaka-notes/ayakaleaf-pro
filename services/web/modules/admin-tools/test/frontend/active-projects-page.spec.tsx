import ActiveProjectsPage from '../../js/active-projects/components/active-projects-page'

describe('Active projects admin page', () => {
  beforeEach(function () {
    cy.intercept(
      { method: 'POST', url: '/admin/active-projects/list' },
      {
        statusCode: 200,
        body: [
          {
            id: 'p1',
            name: 'My Paper',
            activeUsers: [
              { name: 'Jane Doe', email: 'jane@example.com' },
              { name: 'John Roe', email: 'john@example.com' },
            ],
            connectionCount: 2,
          },
        ],
      }
    ).as('listActiveProjects')
  })

  it('renders the page header and the active projects section', function () {
    cy.mount(<ActiveProjectsPage />)

    cy.get('.ap-active-projects').should('exist')
    cy.get('.ap-active-projects-header').contains('Active Projects')
    cy.get('.ap-settings-section').should('have.length', 1)
    cy.get('.ap-settings-section-badge').contains('1')
  })

  it('shows the active projects with mailto links', function () {
    cy.mount(<ActiveProjectsPage />)
    cy.wait('@listActiveProjects')

    const row = cy.get('[data-ap-project-id=p1]')
    row.should('exist')
    row.within(() => {
      cy.get('.ap-project-name a')
        .should('have.text', 'My Paper')
        .and('have.attr', 'href', 'mailto:jane@example.com,john@example.com')
      cy.get('.ap-project-users a')
        .first()
        .should('have.attr', 'href', 'mailto:jane@example.com')
    })
  })

  it('shows the empty state when no projects are active', function () {
    cy.intercept(
      { method: 'POST', url: '/admin/active-projects/list' },
      { statusCode: 200, body: [] }
    )
    cy.mount(<ActiveProjectsPage />)
    cy.wait('@listActiveProjects')

    cy.get('.ap-empty').should('exist').contains('No projects are currently being edited')
    cy.get('[data-ap-project-id]').should('not.exist')
  })

  it('shows an error state when the list request fails', function () {
    cy.intercept(
      { method: 'POST', url: '/admin/active-projects/list' },
      { statusCode: 500 }
    )
    cy.mount(<ActiveProjectsPage />)

    cy.get('.ap-status-error').should('exist')
  })

  it('re-fetches when the Refresh button is clicked', function () {
    cy.mount(<ActiveProjectsPage />)
    cy.wait('@listActiveProjects')

    cy.get('[data-testid=ap-refresh]').click()
    cy.wait('@listActiveProjects')
  })
})
