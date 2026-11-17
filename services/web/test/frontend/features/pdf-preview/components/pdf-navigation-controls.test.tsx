import { expect } from 'chai'
import sinon from 'sinon'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import PdfNavigationControls from '@/features/pdf-preview/components/pdf-navigation-controls'
import PdfViewerControlsMenuButton from '@/features/pdf-preview/components/pdf-viewer-controls-menu-button'

describe('<PdfNavigationControls/>', function () {
  afterEach(cleanup)

  it('disables unavailable actions and invokes enabled actions', function () {
    const goBack = sinon.spy()
    const goForward = sinon.spy()
    const props = { canGoBack: false, canGoForward: false, goBack, goForward }
    const { rerender } = render(<PdfNavigationControls {...props} />)
    const back = screen.getByRole('button', {
      name: 'Previous reading position',
    }) as HTMLButtonElement
    const forward = screen.getByRole('button', {
      name: 'Next reading position',
    }) as HTMLButtonElement
    expect(back.disabled).to.equal(true)
    expect(forward.disabled).to.equal(true)
    fireEvent.click(back)
    fireEvent.click(forward)
    expect(goBack).not.to.have.been.called
    expect(goForward).not.to.have.been.called

    rerender(<PdfNavigationControls {...props} canGoBack />)
    expect(back.disabled).to.equal(false)
    fireEvent.click(back)
    expect(goBack).to.have.been.calledOnce

    rerender(<PdfNavigationControls {...props} canGoForward />)
    expect(back.disabled).to.equal(true)
    expect(forward.disabled).to.equal(false)
    fireEvent.click(forward)
    expect(goForward).to.have.been.calledOnce
  })

  it('makes navigation available in the narrow toolbar menu', async function () {
    const goBack = sinon.spy()
    render(
      <PdfViewerControlsMenuButton
        navigation={{
          canGoBack: true,
          canGoForward: false,
          goBack,
          goForward: sinon.spy(),
        }}
        setZoom={() => {}}
        setPage={() => {}}
        page={1}
        totalPages={3}
        pdfContainer={document.body}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => {
      const back = screen.getByRole('button', {
        name: 'Previous reading position',
      }) as HTMLButtonElement
      expect(back.disabled).to.equal(false)
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Previous reading position' })
    )
    expect(goBack).to.have.been.calledOnce
  })
})
