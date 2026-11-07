import ChangeLayoutButton from '@/features/ide-react/components/toolbar/change-layout-button'
import type { LayoutContextValue } from '@/shared/context/layout-context'
import { EditorProviders } from '../../../../helpers/editor-providers'

const mount = (layoutContext: Partial<LayoutContextValue>) => {
  cy.mount(
    <EditorProviders layoutContext={layoutContext}>
      <ChangeLayoutButton />
    </EditorProviders>
  )
}

describe('<ChangeLayoutButton />', function () {
  beforeEach(function () {
    cy.stub(window, 'open').as('openWindow')
  })

  describe('selecting a layout', function () {
    it('makes Split view active after clicking it', function () {
      mount({ pdfLayout: 'flat', view: 'editor', chatIsOpen: false })
      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'Split view' }).click()

      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'Split view' }).should(
        'have.attr',
        'aria-current',
        'true'
      )
      cy.findByRole('menuitem', { name: 'Editor only' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
      cy.findByRole('menuitem', { name: 'PDF only' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
    })

    it('makes Editor only active after clicking it', function () {
      mount({ pdfLayout: 'sideBySide', view: 'editor', chatIsOpen: false })
      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'Editor only' }).click()

      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'Editor only' }).should(
        'have.attr',
        'aria-current',
        'true'
      )
      cy.findByRole('menuitem', { name: 'Split view' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
      cy.findByRole('menuitem', { name: 'PDF only' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
    })

    it('makes PDF only active after clicking it', function () {
      mount({ pdfLayout: 'sideBySide', view: 'editor', chatIsOpen: false })
      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'PDF only' }).click()

      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'PDF only' }).should(
        'have.attr',
        'aria-current',
        'true'
      )
      cy.findByRole('menuitem', { name: 'Editor only' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
      cy.findByRole('menuitem', { name: 'Split view' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
    })

    it('treats file view the same as editor view', function () {
      // the 'file' view cannot be reached by clicking a layout option, so
      // verify the active state directly from the initial context
      mount({ pdfLayout: 'flat', view: 'file', chatIsOpen: false })
      cy.findByRole('button', { name: 'Layout options' }).click()

      cy.findByRole('menuitem', { name: 'Editor only' }).should(
        'have.attr',
        'aria-current',
        'true'
      )
    })

    it('marks no item as active in history view', function () {
      // the 'history' view is entered via the history toggle (not this menu),
      // so verify the active state directly from the initial context
      mount({ pdfLayout: 'flat', view: 'history', chatIsOpen: false })
      cy.findByRole('button', { name: 'Layout options' }).click()

      cy.findByRole('menuitem', { name: 'Split view' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
      cy.findByRole('menuitem', { name: 'Editor only' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
      cy.findByRole('menuitem', { name: 'PDF only' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
      cy.findByRole('menuitem', { name: 'Open PDF in separate tab' }).should(
        'have.attr',
        'aria-current',
        'false'
      )
    })
  })

  describe('on detach', function () {
    beforeEach(function () {
      mount({ pdfLayout: 'flat', view: 'editor', chatIsOpen: false })
      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'Open PDF in separate tab' }).click()
    })

    it('opens a detached window', function () {
      cy.get('@openWindow').should(
        'have.been.calledWith',
        Cypress.sinon.match(/\/detached/),
        '_blank'
      )
    })

    it('shows processing state while waiting for the detached tab', function () {
      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'Open PDF in separate tab' })
        .findByTestId('ol-spinner')
        .should('exist')
    })
  })

  describe('on layout change while detacher', function () {
    beforeEach(function () {
      window.metaAttributesCache.set('ol-detachRole', 'detacher')
      mount({ pdfLayout: 'flat', view: 'editor', chatIsOpen: false })
      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'Editor only' }).click()
    })

    it('marks the newly selected item as active', function () {
      cy.findByRole('button', { name: 'Layout options' }).click()
      cy.findByRole('menuitem', { name: 'Editor only' }).should(
        'have.attr',
        'aria-current',
        'true'
      )
    })
  })
})
