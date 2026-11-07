import { EditorProviders } from '../../helpers/editor-providers'
import PdfPreviewHybridToolbar from '../../../../frontend/js/features/pdf-preview/components/pdf-preview-hybrid-toolbar'
import { testDetachChannel } from '../../helpers/detach-channel'

describe('<PdfPreviewHybridToolbar/>', function () {
  beforeEach(function () {
    window.metaAttributesCache.set('ol-preventCompileOnLoad', true)
    cy.interceptEvents()
  })

  it('shows normal mode', function () {
    cy.mount(
      <EditorProviders>
        <PdfPreviewHybridToolbar />
      </EditorProviders>
    )

    cy.findByRole('button', { name: 'Recompile' }).should('exist')
  })

  describe('orphan mode', function () {
    beforeEach(function () {
      cy.window().then(win => {
        win.metaAttributesCache.set('ol-detachRole', 'detached')
      })
    })

    it('shows connecting message on load', function () {
      cy.mount(
        <EditorProviders>
          <PdfPreviewHybridToolbar />
        </EditorProviders>
      )

      cy.contains('Connecting with the editor')
      cy.findByRole('button', { name: 'Recompile' }).should('not.exist')
      cy.findByRole('button', { name: 'Redirect to editor' }).should(
        'not.exist'
      )
    })

    it('shows compile UI when connected', function () {
      cy.mount(
        <EditorProviders>
          <PdfPreviewHybridToolbar />
        </EditorProviders>
      )

      cy.wrap(null).then(() => {
        testDetachChannel.postMessage({
          role: 'detacher',
          event: 'connected',
        })
      })

      cy.findByRole('button', { name: 'Recompile' }).should('exist')
      cy.contains('Connecting with the editor').should('not.exist')
    })

    it('shows connecting message when disconnected', function () {
      cy.mount(
        <EditorProviders>
          <PdfPreviewHybridToolbar />
        </EditorProviders>
      )

      cy.wrap(null).then(() => {
        testDetachChannel.postMessage({
          role: 'detacher',
          event: 'connected',
        })
      })

      cy.findByRole('button', { name: 'Recompile' }).should('exist')

      cy.wrap(null).then(() => {
        testDetachChannel.postMessage({
          role: 'detacher',
          event: 'closed',
        })
      })

      cy.contains('Connecting with the editor')
      cy.findByRole('button', { name: 'Recompile' }).should('not.exist')
    })

    it('shows redirect button after timeout', function () {
      cy.clock()

      cy.mount(
        <EditorProviders>
          <PdfPreviewHybridToolbar />
        </EditorProviders>
      )

      cy.contains('Connecting with the editor')

      cy.tick(6000)

      cy.findByRole('button', { name: 'Redirect to editor' }).should('exist')
      cy.contains('Connecting with the editor').should('not.exist')
    })

    it('recovers to compile UI when link is restored after timeout', function () {
      cy.clock()

      cy.mount(
        <EditorProviders>
          <PdfPreviewHybridToolbar />
        </EditorProviders>
      )

      cy.tick(6000)
      cy.findByRole('button', { name: 'Redirect to editor' }).should('exist')

      cy.wrap(null).then(() => {
        testDetachChannel.postMessage({
          role: 'detacher',
          event: 'connected',
        })
      })

      cy.findByRole('button', { name: 'Recompile' }).should('exist')
      cy.findByRole('button', { name: 'Redirect to editor' }).should(
        'not.exist'
      )
    })
  })

  describe('detacher role', function () {
    it('never shows orphan UI', function () {
      cy.clock()
      cy.window().then(win => {
        win.metaAttributesCache.set('ol-detachRole', 'detacher')
      })

      cy.mount(
        <EditorProviders>
          <PdfPreviewHybridToolbar />
        </EditorProviders>
      )

      cy.tick(6000)

      cy.findByRole('button', { name: 'Recompile' }).should('exist')
      cy.contains('Connecting with the editor').should('not.exist')
      cy.findByRole('button', { name: 'Redirect to editor' }).should(
        'not.exist'
      )
    })
  })
})
