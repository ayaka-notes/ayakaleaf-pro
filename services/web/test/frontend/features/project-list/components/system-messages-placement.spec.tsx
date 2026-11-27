import SystemMessages from '@/shared/components/system-messages'

describe('<SystemMessages /> placement visibility (#17b port)', () => {
  beforeEach(function () {
    localStorage.clear()
    cy.intercept('GET', '/system/messages', {
      statusCode: 200,
      body: [
        { _id: 'legacy-1', content: 'Legacy message' },
        { _id: 'protected', content: 'SITE IS CLOSED' },
        { _id: 'editor-1', content: 'Editor only', placements: ['editor'] },
        { _id: 'hub-1', content: 'Workspace only', placements: ['hub'] },
        { _id: 'auth-1', content: 'Auth only', placements: ['auth'] },
        {
          _id: 'unremovable-1',
          content: 'Emergency maintenance',
          unremovable: true,
        },
      ],
    }).as('getMessages')
  })

  it('shows legacy and hub messages, hides editor/auth-only ones on a hub surface', function () {
    cy.mount(<SystemMessages />)

    // the cypress component-test URL is a non-editor, non-auth page → 'hub'
    cy.findByText('Legacy message').should('exist')
    cy.findByText('SITE IS CLOSED').should('exist')
    cy.findByText('Workspace only').should('exist')

    cy.get('body')
      .invoke('text')
      .should('not.contain.text', 'Editor only')
      .should('not.contain.text', 'Auth only')
  })

  it('renders and closes dismissable system message', function () {
    cy.mount(<SystemMessages />)

    cy.findByText('Legacy message').should('exist')
    const closeBtn = cy.get('li.system-message').first().find('button.close')
    closeBtn.click()

    cy.get('body')
      .invoke('text')
      .should('not.contain.text', 'Legacy message')

    const dismissed = localStorage.getItem('systemMessage.hide.legacy-1')
    expect(dismissed).to.equal('true')
  })

  it('hides the dismiss X for unremovable messages (#17d)', function () {
    cy.mount(<SystemMessages />)

    const row = cy
      .findByText('Emergency maintenance')
      .closest('li.system-message')
    row.should('exist')
    row.within(() => {
      cy.get('button.close').should('not.exist')
    })
  })

  it('ignores a previously saved dismiss state for unremovable messages (#17d)', function () {
    localStorage.setItem('systemMessage.hide.unremovable-1', 'true')
    localStorage.setItem('systemMessage.hide.legacy-1', 'true')
    cy.mount(<SystemMessages />)

    // a dismissable message with saved hidden state stays hidden...
    cy.get('body')
      .invoke('text')
      .should('not.contain.text', 'Legacy message')
      // ...but an unremovable one is force-shown
    cy.findByText('Emergency maintenance').should('exist')
  })
})
