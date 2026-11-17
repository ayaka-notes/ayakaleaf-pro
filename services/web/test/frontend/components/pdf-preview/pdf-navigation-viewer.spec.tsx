import { EditorProviders } from '../../helpers/editor-providers'
import { createNavigationPdf } from '../../helpers/pdf-navigation-fixture'
import PdfJsViewer from '../../../../frontend/js/features/pdf-preview/components/pdf-js-viewer'
import PDFJSWrapper from '../../../../frontend/js/features/pdf-preview/util/pdf-js-wrapper'
import { PdfPreviewProvider } from '../../../../frontend/js/features/pdf-preview/components/pdf-preview-provider'
import { PDFFile } from '../../../../types/compile'
import { mockScope } from './scope'

describe('PDF navigation in the rendered viewer', function () {
  const back = () =>
    cy.findByRole('button', { name: 'Previous reading position' })
  const forward = () =>
    cy.findByRole('button', { name: 'Next reading position' })

  beforeEach(function () {
    cy.interceptEvents()
    cy.interceptCompile()
    const pdf = createNavigationPdf()
    cy.intercept('GET', '/build/123/output.pdf*', {
      headers: { 'content-type': 'application/pdf' },
      body: pdf,
    })
    cy.spy(PDFJSWrapper.prototype, 'loadDocument').as('loadDocument')
    const url = '/build/123/output.pdf?clsiserverid=foo'
    const pdfFile: PDFFile = {
      path: 'output.pdf',
      url,
      type: 'pdf',
      build: '123',
      downloadURL: url,
      clsiCacheShard: '',
      contentId: 'navigation',
      editorId: 'test',
      pdfDownloadUrl: url,
      pdfUrl: url,
      size: pdf.length,
      ranges: [],
    }
    cy.mount(
      <EditorProviders scope={mockScope()}>
        <PdfPreviewProvider>
          <div id="toolbar-pdf-controls" style={{ width: 600 }} />
          <div className="pdf-viewer" style={{ width: 700, height: 500 }}>
            <PdfJsViewer url={url} pdfFile={pdfFile} />
          </div>
        </PdfPreviewProvider>
      </EditorProviders>
    )
    cy.waitForCompile()
    cy.contains('Navigation history')
    back().should('be.disabled')
    forward().should('be.disabled')
  })

  // Read the real instance via a method spy, without adding a production test API.
  function withWrapper(
    callback: (wrapper: PDFJSWrapper) => void | Promise<unknown>
  ) {
    cy.get('@loadDocument').then(spy => {
      return callback((spy as unknown as sinon.SinonSpy).thisValues[0])
    })
  }

  function clickLink(index: number) {
    cy.get('.page[data-page-number="1"] .linkAnnotation a')
      .eq(index)
      .click({ scrollBehavior: false })
  }

  it('returns to the original coordinates after a citation and forwards again', function () {
    let departure: PDFJSWrapper['currentPosition']
    withWrapper(wrapper => {
      departure = wrapper.currentPosition
    })
    clickLink(0)
    back().should('be.enabled').click()
    forward().should('be.enabled')
    withWrapper(wrapper => {
      expect(wrapper.currentPosition.page).to.equal(departure.page)
      expect(wrapper.currentPosition.offset.top).to.be.closeTo(
        departure.offset.top,
        2
      )
    })
    forward().click()
    withWrapper(wrapper => {
      expect(wrapper.viewer.currentPageNumber).to.equal(3)
    })
  })

  it('supports equation, figure and contents links and branches after Back', function () {
    clickLink(1)
    back().click()
    clickLink(2)
    forward().should('be.disabled')
    back().click()
    clickLink(3)
    back().should('be.enabled')
  })

  it('preserves zoom and excludes ordinary scrolling from history', function () {
    clickLink(0)
    let scale: number
    withWrapper(wrapper => {
      wrapper.viewer.currentScaleValue = '1.5'
      scale = wrapper.viewer.currentScale
      wrapper.container.scrollTop += 50
    })
    back().click()
    withWrapper(wrapper => {
      expect(wrapper.viewer.currentScale).to.equal(scale)
    })
    back().should('be.disabled')
  })

  it('clears old coordinates when a recompiled PDF has fewer pages', function () {
    clickLink(0)
    cy.intercept('GET', '/recompiled.pdf', {
      headers: { 'content-type': 'application/pdf' },
      body: createNavigationPdf(1),
    })
    withWrapper(wrapper => {
      return wrapper.loadDocument({
        url: '/recompiled.pdf',
        pdfFile: { size: 0 } as PDFFile,
        abortController: new AbortController(),
        handleFetchError: error => {
          throw error
        },
      })
    })
    back().should('be.disabled')
    forward().should('be.disabled')
  })

  it('rejects an unsupported destination type without adding history', function () {
    cy.stub(console, 'error')
    withWrapper(async wrapper => {
      await wrapper.viewer.linkService.goToDestination([
        0,
        { name: 'InvalidType' },
        40,
        500,
        null,
      ])
      expect(wrapper.navigationHistory.canGoBack).to.equal(false)
    })
    back().should('be.disabled')
  })

  it('does not add departures for repeated links to the current position', function () {
    withWrapper(async wrapper => {
      await wrapper.viewer.pagesPromise
      const destination = [1, { name: 'XYZ' }, 40, 500, null]
      await wrapper.viewer.linkService.goToDestination(destination)
      await wrapper.viewer.linkService.goToDestination(destination)
      await wrapper.viewer.linkService.goToDestination(destination)
      wrapper.navigationHistory.back()
      expect(wrapper.navigationHistory.canGoBack).to.equal(false)
    })
    back().should('be.disabled')
  })

  for (const width of [320, 400, 600]) {
    it(`keeps navigation and existing controls usable at ${width}px`, function () {
      cy.get('#toolbar-pdf-controls').invoke('css', 'width', `${width}px`)
      if (width === 320) {
        cy.get('.pdfjs-viewer-controls-small').should('exist')
        cy.get('.pdfjs-toolbar-popover-button').click()
      } else {
        cy.get('.pdfjs-viewer-controls-small').should('not.exist')
      }
      back().should('be.disabled')
      forward().should('be.disabled')
      cy.findByRole('button', { name: /^Next page$/ }).should('be.enabled')
      cy.findByRole('button', { name: /^Zoom in$/ }).should('be.enabled')
      if (width === 320) cy.get('.pdfjs-toolbar-popover-button').click()
      clickLink(0)
      if (width === 320) cy.get('.pdfjs-toolbar-popover-button').click()
      back().should('be.enabled').click()
      forward().should('be.enabled').click()
      back().should('be.enabled')
    })
  }
})
