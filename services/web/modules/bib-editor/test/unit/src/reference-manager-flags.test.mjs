/**
 * Gate tests for the reference-manager UI exposure (settings "Reference
 * Managers" section, editor Integrations cards, picker menu entries):
 * a provider must be hidden whenever its OAuth client id and/or secret is
 * not configured on the site, and the gate must be consistent with the
 * bib-editor module's /bib/services flag (both = "credentials are the
 * switch"). Also covers the /system/features handler end-to-end: seeded
 * Settings (env OR pre-seeded site_settings) + the admin's per-user switch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Settings from '@overleaf/settings'

const userMock = vi.hoisted(() => ({
  user: {},
  getUser: vi.fn(async () => userMock.user),
}))

vi.mock('@overleaf/settings', () => ({ default: {} }))
vi.mock('../../../../../app/src/infrastructure/Features.mjs', () => ({
  default: { hasFeature: () => false },
}))
vi.mock('../../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
  default: { requireLogin: () => (req, res, next) => next() },
}))
vi.mock('../../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
  default: { getLoggedInUserId: () => 'user-123' },
}))
vi.mock('../../../../../modules/workbench/app/src/WorkbenchAiClient.mjs', () => ({
  isConfigured: () => false,
}))
// UserGetter drags in the Mongo connection at import time; the handler only
// needs user.features.
vi.mock('../../../../../app/src/Features/User/UserGetter.mjs', () => ({
  default: { promises: { getUser: userMock.getUser } },
}))
vi.mock('../../../../../modules/instance-features/app/src/UserFeatures.mjs', () => ({
  // Same semantics as the real helper (admin-panel switch, off only when
  // explicitly false), without its ProjectGetter/UserGetter import chain.
  isFeatureOn: (user, feature) => user?.features?.[feature] !== false,
  userHasFeature: vi.fn(async () => true),
  projectOwnerHasFeature: vi.fn(async () => true),
  requireUserFeature: () => (req, res, next) => next(),
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

describe('GET /system/features (seeded-Settings gate + per-user switch)', () => {
  const saved = { zotero: Settings.zotero, mendeley: Settings.mendeley }
  beforeEach(() => {
    vi.clearAllMocks()
    userMock.user = {}
  })
  afterEach(() => {
    if (saved.zotero === undefined) delete Settings.zotero
    else Settings.zotero = saved.zotero
    if (saved.mendeley === undefined) delete Settings.mendeley
    else Settings.mendeley = saved.mendeley
  })

  async function getFlags() {
    const { default: Router } = await import(
      '../../../../../modules/instance-features/app/src/InstanceFeaturesRouter.mjs'
    )
    const routes = []
    Router.apply({ get: (p, ...h) => routes.push([p, h]) })
    const entry = routes.find(([p]) => p === '/system/features')
    if (!entry) throw new Error('route not found: /system/features')
    const res = { body: undefined, json(b) { this.body = b } }
    for (const handler of entry[1]) {
      // eslint-disable-next-line no-await-in-loop
      await handler({ session: {} }, res, () => {})
    }
    return res.body
  }

  it('reports both providers on when their Settings are seeded', async () => {
    Settings.zotero = { clientKey: 'k', clientSecret: 's' }
    Settings.mendeley = { clientID: 'c', clientSecret: 's' }
    const flags = await getFlags()
    expect(flags.zotero).toBe(true)
    expect(flags.mendeley).toBe(true)
  })

  it('reports a provider off when its credentials are incomplete', async () => {
    Settings.zotero = { clientKey: 'k' } // no secret
    Settings.mendeley = { clientID: 'c', clientSecret: 's', enabled: false }
    const flags = await getFlags()
    expect(flags.zotero).toBe(false)
    expect(flags.mendeley).toBe(false)
  })

  it('hides a provider the admin turned off for this user', async () => {
    Settings.zotero = { clientKey: 'k', clientSecret: 's' }
    Settings.mendeley = { clientID: 'c', clientSecret: 's' }
    userMock.user = { features: { zotero: false } }
    const flags = await getFlags()
    expect(flags.zotero).toBe(false)
    expect(flags.mendeley).toBe(true)
  })
})
