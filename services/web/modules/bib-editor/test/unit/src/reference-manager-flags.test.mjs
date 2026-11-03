/**
 * Gate tests for the reference-manager UI exposure (settings "Reference
 * managers" section + editor Integrations cards): a provider must be hidden
 * whenever its OAuth client id and/or secret is not configured on the site.
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
  it('hides zotero when credentials are missing, even if listed in ENABLED_LINKED_FILE_TYPES', () => {
    const flags = referenceManagerFeatureFlags({
      enabled: ['zotero'],
      zoteroCredentials: false,
      mendeleyCredentials: false,
    })
    expect(flags.zotero).toBe(false)
  })

  it('shows zotero when listed AND configured', () => {
    const flags = referenceManagerFeatureFlags({
      enabled: ['zotero'],
      zoteroCredentials: true,
      mendeleyCredentials: false,
    })
    expect(flags.zotero).toBe(true)
  })

  it('hides zotero when not listed, even with credentials', () => {
    const flags = referenceManagerFeatureFlags({
      enabled: [],
      zoteroCredentials: true,
      mendeleyCredentials: false,
    })
    expect(flags.zotero).toBe(false)
  })

  it('hides mendeley without credentials, even if listed', () => {
    const flags = referenceManagerFeatureFlags({
      enabled: ['mendeley'],
      zoteroCredentials: false,
      mendeleyCredentials: false,
    })
    expect(flags.mendeley).toBe(false)
  })

  it('shows mendeley when its credentials are set (credentials are the switch for it on this deployment)', () => {
    const flags = referenceManagerFeatureFlags({
      enabled: [],
      zoteroCredentials: false,
      mendeleyCredentials: true,
    })
    expect(flags.mendeley).toBe(true)
  })
})
