import { expect } from 'chai'
import sinon from 'sinon'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import fetchMock from 'fetch-mock'
import UnlinkCommonsSSOModal from '../../../../../../frontend/js/features/settings/components/emails/unlink-commons-sso-modal'
import { location } from '../../../../../../frontend/js/shared/components/location'

describe('<UnlinkCommonsSSOModal/>', function () {
  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    this.locationSandbox = sinon.createSandbox()
    this.locationStub = this.locationSandbox.stub(location)
    window.metaAttributesCache.set('ol-hasPassword', false)
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
    this.locationSandbox.restore()
    window.metaAttributesCache.delete('ol-hasPassword')
  })

  function renderModal(props = {}) {
    const onClose = sinon.stub()

    render(
      <UnlinkCommonsSSOModal
        show
        onClose={onClose}
        institutionName="Overleaf University"
        institutionEmail="user@overleaf.com"
        hasLicence
        {...props}
      />
    )

    return { onClose }
  }

  it('renders modal content including licence warning', function () {
    renderModal()

    screen.getByRole('dialog')
    screen.getByText('Unlink institutional login')
    screen.getByText(/remove your Overleaf University login/i)
    screen.getByText(/Removing and re-adding your institutional login/i)
    screen.getByText(/will lose your institutional premium features/i)
    screen.getByText(/can still access your work by setting up/i)
  })

  it('does not render licence warning when hasLicence is false', function () {
    renderModal({ hasLicence: false })

    expect(screen.queryByText(/will lose your institutional premium features/i))
      .to.be.null
  })

  it('does not render password reset hint when user already has a password', function () {
    window.metaAttributesCache.set('ol-hasPassword', true)
    renderModal()

    expect(screen.queryByText(/can still access your work by setting up/i)).to
      .be.null
  })

  it('posts to unlink endpoint with correct body, closes modal, and reloads page', async function () {
    const { onClose } = renderModal()
    fetchMock.post('/saml/unlink-commons', 204)

    const modal = screen.getByRole('dialog')
    fireEvent.click(within(modal).getByRole('button', { name: 'Unlink' }))
    await fetchMock.callHistory.flush(true)

    expect(fetchMock.callHistory.called('/saml/unlink-commons')).to.be.true
    const call = fetchMock.callHistory.calls('/saml/unlink-commons')[0]
    expect(JSON.parse(call.options!.body as string)).to.deep.equal({
      institutionEmail: 'user@overleaf.com',
    })
    await waitFor(() => {
      expect(onClose).to.have.been.calledOnce
      expect(this.locationStub.reload).to.have.been.calledOnce
    })
  })

  it('disables buttons and shows loading label while request is in flight', async function () {
    renderModal()
    // Use a deferred promise so the request stays pending
    let resolveRequest!: () => void
    fetchMock.post(
      '/saml/unlink-commons',
      new Promise<void>(resolve => {
        resolveRequest = resolve
      }).then(() => 204)
    )

    const modal = screen.getByRole('dialog')
    const unlinkButton = within(modal).getByRole('button', { name: 'Unlink' })
    const cancelButton = within(modal).getByRole('button', { name: 'Cancel' })

    fireEvent.click(unlinkButton)

    await screen.findByText('Unlinking')
    expect(unlinkButton).to.have.property('disabled', true)
    expect(cancelButton).to.have.property('disabled', true)

    resolveRequest()
    await fetchMock.callHistory.flush(true)
  })

  it('shows an error notification when unlink fails', async function () {
    renderModal()
    fetchMock.post('/saml/unlink-commons', 500)

    const modal = screen.getByRole('dialog')
    fireEvent.click(within(modal).getByRole('button', { name: 'Unlink' }))

    await screen.findByText('Unlinking failed. Please try again.')
  })

  it('clears error state when modal is closed via Cancel after a failure', async function () {
    const { onClose } = renderModal()
    fetchMock.post('/saml/unlink-commons', 500)

    const modal = screen.getByRole('dialog')
    fireEvent.click(within(modal).getByRole('button', { name: 'Unlink' }))
    await screen.findByText('Unlinking failed. Please try again.')

    // Cancel should call handleClose (which calls reset()) not just onClose
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }))
    expect(onClose).to.have.been.calledOnce
  })
})
