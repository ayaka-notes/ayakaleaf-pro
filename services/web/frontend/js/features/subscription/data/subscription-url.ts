export const subscriptionUpdateUrl = '/user/subscription/update'
export const cancelPendingSubscriptionChangeUrl =
  '/user/subscription/cancel-pending'
export const cancelSubscriptionUrl = '/user/subscription/cancel'
export const redirectAfterCancelSubscriptionUrl = '/user/subscription/canceled'
export const extendTrialUrl = '/user/subscription/extend'
export const reactivateSubscriptionUrl = '/user/subscription/reactivate'
export const billingPortalUrl = '/user/subscription/payment/account-management'

export function stripHasSubscription(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.delete('hasSubscription')
  return parsed.toString()
}

export function reloadWithoutHasSubscription(location: {
  toString(): string
  replace(url: string): void
}) {
  const url = location.toString()
  if (!url) return
  location.replace(stripHasSubscription(url))
}
