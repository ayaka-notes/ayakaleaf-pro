import { EventBus } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { PdfNavigationHistory } from '../../../../frontend/js/features/pdf-preview/util/pdf-navigation-history'
import { PdfNavigationLinkService } from '../../../../frontend/js/features/pdf-preview/util/pdf-navigation-link-service'

describe('PDFLinkService navigation history', function () {
  // Use the guarded service with PDF.js's real destination resolver. The viewer
  // double applies XYZ destinations and rejects unsupported destination types.
  function createNavigation() {
    const destinations = {
      citation: [4, { name: 'XYZ' }, 20, 300, null],
      equation: [1, { name: 'XYZ' }, 30, 500, null],
      figure: [2, { name: 'XYZ' }, 40, 400, null],
      contents: [0, { name: 'XYZ' }, 10, 700, null],
    }
    let current = { page: 0, offset: { left: 10, top: 650 } }
    const scrollPageIntoView = cy
      .stub()
      .callsFake(({ pageNumber, destArray }) => {
        if (destArray && destArray[1]?.name !== 'XYZ') return
        current = {
          page: pageNumber - 1,
          offset: { left: destArray?.[2] ?? 0, top: destArray?.[3] ?? 800 },
        }
      })
    const linkService = new PdfNavigationLinkService({
      eventBus: new EventBus(),
    })
    const document = {
      numPages: 5,
      getDestination: async (name: keyof typeof destinations) =>
        destinations[name] ?? null,
      cachedPageNumber: () => null,
      getPageIndex: async () => 0,
    }
    linkService.setDocument(document)
    linkService.setViewer({
      scrollPageIntoView,
      pageLabelToPageNumber: (label: string) => Number(label),
    })
    const history = new PdfNavigationHistory(
      () => current,
      position => {
        current = position
      },
      cy.stub()
    )
    linkService.setHistory(history)
    return {
      linkService,
      history,
      document,
      scrollPageIntoView,
      position: () => current,
    }
  }

  it('records citation, equation, figure and contents destinations', async function () {
    const { linkService, history, position } = createNavigation()
    for (const name of ['citation', 'equation', 'figure', 'contents']) {
      await linkService.goToDestination(name)
    }
    for (const page of [2, 1, 4, 0]) {
      history.back()
      expect(position().page).to.equal(page)
    }
    expect(position().offset).to.deep.equal({ left: 10, top: 650 })
    for (const page of [4, 1, 2, 0]) {
      history.forward()
      expect(position().page).to.equal(page)
    }
  })

  it('ignores invalid named and explicit destinations', async function () {
    const { linkService, history, scrollPageIntoView } = createNavigation()
    cy.stub(console, 'error')
    await linkService.goToDestination('missing')
    await linkService.goToDestination([99, { name: 'XYZ' }, 0, 0, null])
    expect(history.canGoBack).to.equal(false)
    expect(scrollPageIntoView).not.to.have.been.called
  })

  it('supports explicit destinations and clears forward history on a new jump', async function () {
    const { linkService, history, position } = createNavigation()
    await linkService.goToDestination([2, { name: 'XYZ' }, 25, 450, null])
    await linkService.goToDestination('citation')
    history.back()
    await linkService.goToDestination('equation')
    expect(history.canGoForward).to.equal(false)
    history.back()
    expect(position()).to.deep.equal({
      page: 2,
      offset: { left: 25, top: 450 },
    })
  })

  it('handles PDF GoBack and GoForward named actions without browser navigation', async function () {
    const { linkService, position } = createNavigation()
    const initialState = window.history.state
    const initialLength = window.history.length
    await linkService.goToDestination('citation')
    linkService.executeNamedAction('GoBack')
    expect(position().page).to.equal(0)
    linkService.executeNamedAction('GoForward')
    expect(position().page).to.equal(4)
    expect(window.history.state).to.equal(initialState)
    expect(window.history.length).to.equal(initialLength)
  })

  it('does not record a valid page with an unsupported destination type', async function () {
    const { linkService, history } = createNavigation()
    await linkService.goToDestination([
      0,
      { name: 'InvalidType' },
      40,
      500,
      null,
    ])
    expect(history.canGoBack).to.equal(false)
  })

  it('does not record repeated identical destinations', async function () {
    const { linkService, history } = createNavigation()
    for (let i = 0; i < 3; i++) await linkService.goToDestination('citation')
    history.back()
    expect(history.canGoBack).to.equal(false)
  })

  it('preserves Forward after a no-op link or rejected destination', async function () {
    const { linkService, history } = createNavigation()
    await linkService.goToDestination('citation')
    history.back()
    await linkService.goToDestination([0, { name: 'XYZ' }, 10, 650, null])
    await linkService.goToDestination([0, { name: 'InvalidType' }, 0, 0, null])
    expect(history.canGoBack).to.equal(false)
    expect(history.canGoForward).to.equal(true)
  })

  it('records goToPage labels and ignores repeated or invalid pages', function () {
    const { linkService, history, position } = createNavigation()
    cy.stub(console, 'error')
    linkService.goToPage('2')
    linkService.goToPage('2')
    linkService.goToPage(99)
    history.back()
    expect(position().page).to.equal(0)
    expect(history.canGoBack).to.equal(false)
  })

  it('ignores a named destination resolved after replacing the PDF', async function () {
    const { linkService, history, document, scrollPageIntoView } =
      createNavigation()
    let resolve!: (destination: unknown[]) => void
    cy.stub(document, 'getDestination').returns(
      new Promise(done => {
        resolve = done
      })
    )
    const navigation = linkService.goToDestination('citation')
    linkService.setDocument({ numPages: 1 })
    history.reset()
    resolve([0, { name: 'XYZ' }, 40, 350, null])
    await navigation
    expect(scrollPageIntoView).not.to.have.been.called
    expect(history.canGoBack).to.equal(false)
  })

  it('invalidates a pending destination at load start, before replacement finishes', async function () {
    const { linkService, document, scrollPageIntoView } = createNavigation()
    let resolve!: (destination: unknown[]) => void
    cy.stub(document, 'getDestination').returns(
      new Promise(done => {
        resolve = done
      })
    )
    const navigation = linkService.goToDestination('citation')
    linkService.invalidatePendingNavigation()
    resolve([0, { name: 'XYZ' }, 40, 350, null])
    await navigation
    expect(scrollPageIntoView).not.to.have.been.called
  })

  it('ignores page references resolved after replacing the PDF', async function () {
    const { linkService, document, scrollPageIntoView } = createNavigation()
    let resolve!: (page: number) => void
    cy.stub(document, 'getPageIndex').returns(
      new Promise(done => {
        resolve = done
      })
    )
    const navigation = linkService.goToDestination([
      { num: 8, gen: 0 },
      { name: 'XYZ' },
      40,
      350,
      null,
    ])
    // The explicit destination itself is awaited before PDF.js resolves its page.
    await Promise.resolve()
    linkService.setDocument({ numPages: 1 })
    resolve(0)
    await navigation
    expect(scrollPageIntoView).not.to.have.been.called
  })

  it('ignores rejection from a destroyed old PDF but preserves active errors', async function () {
    const { linkService, document } = createNavigation()
    let reject!: (error: Error) => void
    cy.stub(document, 'getDestination').returns(
      new Promise((_, fail) => {
        reject = fail
      })
    )
    const navigation = linkService.goToDestination('citation')
    linkService.setDocument({
      numPages: 1,
      getDestination: () => Promise.reject(new Error('active error')),
    })
    reject(new Error('old document destroyed'))
    await navigation
    try {
      await linkService.goToDestination('citation')
      throw new Error('expected rejection')
    } catch (error) {
      expect((error as Error).message).to.equal('active error')
    }
  })
})
