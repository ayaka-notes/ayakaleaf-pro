/**
 * Gate tests for the reference-manager UI exposure (settings "Reference
 * Managers" section, editor Integrations cards, picker menu entries):
 * a provider must be hidden whenever its OAuth client id and/or secret is
 * not configured on the site, and the gate must be consistent with the
 * bib-editor module's /bib/services flag (both = "credentials are the
 * switch").
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@overleaf/settings', () => ({ default: {} }))
vi.mock('../../../../../app/src/infrastructure/Features.mjs', () => ({
  default: { hasFeature: () => false },
}))
vi.mock('../../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
  default: { requireLogin: () => (req, res, next) => next() },
}))
vi.mock('../../../../../modules/workbench/app/src/WorkbenchAiClient.mjs', () => ({
  isConfigured: () => false,
}))

const {
  referenceManagerFeatureFlags,
} = await import(
  '../../../../../modules/instance-features/app/src/InstanceFeaturesRouter.mjs'
)

describe('referenceManagerFeatureFlags (settings/integrations gate)', () => {
  it('hides zotero when either credential is missing', () => {
    const flags = referenceManagerFeatureFlags({
      zoteroCredentials: false,
      mendeleyCredentials: false,
    })
    expect(flags.zotero).toBe(false)
  })

  it('shows zotero when its credentials are set', () => {
    const flags = referenceManagerFeatureFlags({
      zoteroCredentials: true,
      mendeleyCredentials: false,
    })
    expect(flags.zotero).toBe(true)
  })

  it('hides mendeley without credentials', () => {
    const flags = referenceManagerFeatureFlags({
      zoteroCredentials: true,
      mendeleyCredentials: false,
    })
    expect(flags.mendeley).toBe(false)
  })

  it('shows mendeley when its credentials are set', () => {
    const flags = referenceManagerFeatureFlags({
      zoteroCredentials: true,
      mendeleyCredentials: true,
    })
    expect(flags.mendeley).toBe(true)
  })
})
