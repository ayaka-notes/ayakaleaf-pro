import sinon from 'sinon'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import fetchMock from 'fetch-mock'
import { cloneDeep } from 'lodash'
import PreviewSubscriptionChange from '../../../../../../frontend/js/features/subscription/components/preview-subscription-change/root'
import { SubscriptionChangePreview } from '../../../../../../types/subscription/subscription-change-preview'
import { location } from '@/shared/components/location'

const premiumPreview: SubscriptionChangePreview = {
  change: {
    type: 'premium-subscription',
    plan: { code: 'professional-annual', name: 'Overleaf Professional' },
  },
  currency: 'USD',
  paymentMethod: 'Visa **** 1111',
  netTerms: 0,
  nextPlan: { annual: true },
  immediateCharge: {
    subtotal: 100,
    tax: 20,
    total: 120,
    discount: 0,
    lineItems: [],
  },
  nextInvoice: {
    date: '2026-05-01T00:00:00.000Z',
    plan: { name: 'Overleaf Professional', amount: 100 },
    addOns: [],
    subtotal: 100,
    tax: { rate: 0.2, amount: 20 },
    total: 120,
  },
}

describe('<PreviewSubscriptionChange/> upgrade variant', function () {
  beforeEach(function () {
    this.locationWrapperSandbox = sinon.createSandbox()
    this.locationWrapperStub = this.locationWrapperSandbox.stub(location)
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
    this.locationWrapperSandbox.restore()
  })

  it('renders the "Upgrade to Pro" heading for a professional plan', function () {
    window.metaAttributesCache.set(
      'ol-subscriptionChangePreview',
      premiumPreview
    )
    render(<PreviewSubscriptionChange />)

    screen.getByRole('heading', { name: /upgrade to pro/i })
  })

  it('renders the "Upgrade to Standard" heading for a collaborator plan', function () {
    const preview = cloneDeep(premiumPreview)
    preview.change = {
      type: 'premium-subscription',
      plan: { code: 'collaborator-annual', name: 'Overleaf Standard' },
    }
    window.metaAttributesCache.set('ol-subscriptionChangePreview', preview)
    render(<PreviewSubscriptionChange />)

    screen.getByRole('heading', { name: /upgrade to standard/i })
  })

  it('renders the payment summary, due today and future payments sections', function () {
    window.metaAttributesCache.set(
      'ol-subscriptionChangePreview',
      premiumPreview
    )
    render(<PreviewSubscriptionChange />)

    screen.getByRole('heading', { name: /payment summary/i })
    screen.getByRole('heading', { name: /due today/i })
    screen.getByText(/total today/i)
    screen.getByRole('heading', { name: /future payments/i })
  })

  it('redirects to the thank-you page with upgrade=true after a successful payment', async function () {
    fetchMock.post('/user/subscription/update', 200)
    window.metaAttributesCache.set(
      'ol-subscriptionChangePreview',
      premiumPreview
    )
    render(<PreviewSubscriptionChange />)

    fireEvent.click(screen.getByRole('button', { name: /upgrade now/i }))

    await waitFor(() => {
      sinon.assert.calledOnce(this.locationWrapperStub.replace)
    })
    sinon.assert.calledWithMatch(
      this.locationWrapperStub.replace,
      '/user/subscription/thank-you?upgrade=true'
    )
  })
})
