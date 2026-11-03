/**
 * mendeley dep tests (pure/offline only — no network).
 * Covers the BibTeX serializer and the settings/authorize-URL logic.
 * The live OAuth + /documents flows are verified against api.mendeley.com
 * in the deployed instance (same pattern as the zotero connector).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Settings from '@overleaf/settings'
import { serializeMendeleyDocument } from '../../../app/src/MendeleyBibtexSerializer.mjs'

describe('serializeMendeleyDocument', () => {
  it('returns "" for null/void input', () => {
    expect(serializeMendeleyDocument(null)).toBe('')
    expect(serializeMendeleyDocument(undefined)).toBe('')
    expect(serializeMendeleyDocument('nope')).toBe('')
  })

  it('serializes a journal article with journal fields', () => {
    const out = serializeMendeleyDocument({
      id: '1137042a-8c30-3cd6-a7f6-7d5f1f6c450d',
      type: 'journal',
      title: 'MetaFormer Is Actually What You Need for Vision',
      authors: [{ name: 'Wong, Eugene' }, { name: 'Xie, Enze' }],
      year: '2021',
      journal: {
        name: 'Advances in Neural Information Processing Systems',
        volume: '34',
        issue: '1',
        firstPage: '715',
        lastPage: '726',
      },
      doi: '10.5555/56948',
    })
    expect(out).toContain('@article{mend_1137042a8c303cd6a7f67d5f,')
    expect(out).toContain('title = {MetaFormer Is Actually What You Need for Vision}')
    expect(out).toContain('author = {Wong, Eugene}')
    expect(out).toContain('year = {2021}')
    expect(out).toContain('journal = {Advances in Neural Information Processing Systems}')
    expect(out).toContain('volume = {34}')
    expect(out).toContain('number = {1}')  // BibTeX's field name for journal issues
    expect(out).toContain('pages = {715--726}')
    expect(out).toContain('doi = {10.5555/56948}')
    expect(out).not.toContain('@misc')
  })

  it('serializes a book with publisher', () => {
    const out = serializeMendeleyDocument({
      id: 'abc123',
      type: 'book',
      title: 'The Pragmatic Programmer',
      authors: ['Hunt, Andrew', 'Thomas, David'],
      year: '1999',
      publisher: 'Addison-Wesley',
    })
    expect(out).toContain('@book{mend_abc123,')
    expect(out).toContain('publisher = {Addison-Wesley}')
    expect(out).toContain('author = {Hunt, Andrew}')
  })

  it('serializes a thesis with school', () => {
    const out = serializeMendeleyDocument({
      id: 't1',
      type: 'dissertation',
      title: 'Deep Spike Networks',
      authors: [{ name: 'Doe, Jane' }],
      year: '2019',
      thesisInstitution: 'Bielefeld University',
    })
    expect(out).toContain('@phdthesis{mend_t1,')
    expect(out).toContain('school = {Bielefeld University}')
  })

  it('falls back to @misc for unknown/missing types', () => {
    const out = serializeMendeleyDocument({
      id: 'z9',
      type: 'weird_thing',
      title: 'Some page',
      year: '2020',
    })
    expect(out).toContain('@misc{mend_z9,')
  })

  it('keeps firstPage-only and lastPage-only page shapes sane', () => {
    const onlyFirst = serializeMendeleyDocument({
      id: 'p1',
      type: 'journal',
      title: 'X',
      year: '1',
      journal: { name: 'J', firstPage: '12' },
    })
    expect(onlyFirst).toContain('pages = {12}')
    const both = serializeMendeleyDocument({
      id: 'p2',
      type: 'journal',
      title: 'X',
      year: '1',
      journal: { name: 'J', firstPage: '12', lastPage: '12' },
    })
    expect(both).toContain('pages = {12}')
  })
})

describe('mendeley settings gate (client id AND secret required)', () => {
  let mod
  let prev
  beforeEach(async () => {
    prev = Settings.mendeley
    mod = await import('../../../app/src/MendeleySettings.mjs')
  })
  afterEach(() => {
    if (prev === undefined) delete Settings.mendeley
    else Settings.mendeley = prev
  })

  it('configured only with clientID + clientSecret', () => {
    Settings.mendeley = { clientID: 'x', clientSecret: 'y' }
    expect(mod.isMendeleyConfigured()).toBe(true)
    Settings.mendeley = { clientID: 'x' }
    expect(mod.isMendeleyConfigured()).toBe(false)
    Settings.mendeley = { clientSecret: 'y' }
    expect(mod.isMendeleyConfigured()).toBe(false)
    Settings.mendeley = {}
    expect(mod.isMendeleyConfigured()).toBe(false)
  })

  it('accepts the clientId (camelCase) alias too', () => {
    Settings.mendeley = { clientId: 'x', clientSecret: 'y' }
    expect(mod.isMendeleyConfigured()).toBe(true)
  })

  it('explicitly disabled wins', () => {
    Settings.mendeley = { clientID: 'x', clientSecret: 'y', enabled: false }
    expect(mod.isMendeleyConfigured()).toBe(false)
  })

  it('assertMendeleyConfigured throws 403 when unconfigured', () => {
    Settings.mendeley = { clientID: 'x' }
    expect(() => mod.assertMendeleyConfigured()).toThrow()
    Settings.mendeley = { clientID: 'x', clientSecret: 'y' }
    expect(() => mod.assertMendeleyConfigured()).not.toThrow()
  })

  it('authorize URL carries client_id, code, scope=all, state', () => {
    Settings.mendeley = {
      clientID: 'id123',
      clientSecret: 's',
      callbackURL: 'https://example.org/user/mendeley/oauth/callback',
    }
    const url = new URL(mod.getMendeleyAuthorizeUrl('st8'))
    expect(url.origin + url.pathname).toBe('https://api.mendeley.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('id123')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('all')
    expect(url.searchParams.get('state')).toBe('st8')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://example.org/user/mendeley/oauth/callback',
    )
  })
})

// ---------------------------------------------------------------------------
// Router wiring + OAuth callback behavior (all deps mocked, no network)
// ---------------------------------------------------------------------------
const apiMock = vi.hoisted(() => ({
  assertMendeleyConfigured: vi.fn(),
  getMendeleyAuthorizeUrl: (state) =>
    `https://api.mendeley.com/oauth/authorize?client_id=c1&state=${state}`,
  exchangeMendeleyCode: vi.fn(async () => ({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 })),
  storeMendeleyCredentials: vi.fn(async () => {}),
}))
vi.mock('@overleaf/logger', () => ({
  default: { info() {}, warn() {}, error() {}, debug() {} },
}))
vi.mock('@overleaf/o-error', () => ({
  default: {
    getFullStack: (e) => String(e),
    getFullInfo: (e) => ({ status: e && e.status }),
  },
}))
vi.mock('../../../../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
  default: { requireLogin: () => (req, res, next) => next() },
}))
vi.mock('../../../../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
  default: { getLoggedInUserId: () => 'user-123' },
}))
vi.mock('../../../../../../../app/src/Features/Errors/HttpErrorHandler.mjs', () => ({
  default: { badRequest() {}, forbidden() {} },
}))
vi.mock('../../../app/src/MendeleyApiClient.mjs', () => apiMock)

describe('mendeley router + oauth callback', () => {
  const savedMendeley = Settings.mendeley
  beforeEach(() => {
    vi.clearAllMocks()
    Settings.mendeley = { clientID: 'c1', clientSecret: 's1' }
  })
  afterEach(() => {
    if (savedMendeley === undefined) delete Settings.mendeley
    else Settings.mendeley = savedMendeley
  })

  function mockWebRouter() {
    const routes = []
    return {
      routes,
      get: (p, ...h) => routes.push(['GET', p, h]),
      post: (p, ...h) => routes.push(['POST', p, h]),
      put: (p, ...h) => routes.push(['PUT', p, h]),
      delete: (p, ...h) => routes.push(['DELETE', p, h]),
    }
  }

  async function callHandler(path, req, res) {
    const { default: Router } = await import('../../../app/src/MendeleyRouter.mjs')
    const r = mockWebRouter()
    Router.apply(r)
    const entry = r.routes.find(([, p]) => p === path)
    if (!entry) throw new Error(`route not found: ${path}`)
    for (let i = 0; i < entry[2].length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await entry[2][i](req, res, () => {})
    }
  }

  it('registers status, both unlink aliases, oauth + callback and picker routes', async () => {
    const { default: Router } = await import('../../../app/src/MendeleyRouter.mjs')
    const r = mockWebRouter()
    Router.apply(r)
    const keys = r.routes.map(([m, p]) => `${m} ${p}`)
    expect(keys).toContain('GET /user/mendeley/status')
    expect(keys).toContain('DELETE /user/mendeley')
    // base settings widget (tpr-webmodule mendeley-widget.tsx) POSTs here
    expect(keys).toContain('POST /mendeley/unlink')
    expect(keys).toContain('GET /user/mendeley/oauth')
    expect(keys).toContain('GET /user/mendeley/oauth/callback')
    expect(keys).toContain('GET /user/mendeley/picker/libraries')
    expect(keys).toContain('GET /user/mendeley/picker/documents')
    expect(keys).toContain('GET /user/mendeley/picker/bibtex')
  })

  it('oauth (full-page) stores state + returnTo taken from the page referer', async () => {
    const req = {
      session: {},
      query: {},
      headers: { referer: 'https://ps.example/library' },
    }
    const res = { redirectTo: null, redirect(u) { this.redirectTo = u } }
    await callHandler('/user/mendeley/oauth', req, res)
    expect(res.redirectTo).toContain('api.mendeley.com/oauth/authorize')
    expect(req.session.mendeleyOAuth.isPopup).toBe(false)
    expect(req.session.mendeleyOAuth.returnTo).toBe('https://ps.example/library')
  })

  it('oauth (popup) does not adopt a returnTo', async () => {
    const req = {
      session: {},
      query: { popup: '1' },
      headers: { referer: 'https://ps.example/library' },
    }
    const res = { redirectTo: null, redirect(u) { this.redirectTo = u } }
    await callHandler('/user/mendeley/oauth', req, res)
    expect(req.session.mendeleyOAuth.isPopup).toBe(true)
    expect(req.session.mendeleyOAuth.returnTo).toBe('')
  })

  it('callback success from a non-settings page lands back on that page', async () => {
    const req = {
      session: {
        mendeleyOAuth: {
          state: 's1',
          isPopup: false,
          returnTo: 'https://ps.example/library',
        },
      },
      query: { code: 'c1', state: 's1' },
      headers: {},
    }
    const res = {
      getHeader: () => 'base',
      setHeader() {},
      html: null,
      send(h) { this.html = h },
    }
    await callHandler('/user/mendeley/oauth/callback', req, res)
    expect(apiMock.storeMendeleyCredentials).toHaveBeenCalledWith(
      'user-123',
      expect.anything(),
    )
    expect(res.html).toContain("location.href = 'https://ps.example/library'")
    expect(res.html).toContain("BroadcastChannel('mendeley')")
  })

  it('callback success from settings lands on settings with the oauth-complete flag', async () => {
    const req = {
      session: {
        mendeleyOAuth: {
          state: 's1',
          isPopup: false,
          returnTo: 'https://ps.example/user/settings',
        },
      },
      query: { code: 'c1', state: 's1' },
      headers: {},
    }
    const res = {
      getHeader: () => 'base',
      setHeader() {},
      html: null,
      send(h) { this.html = h },
    }
    await callHandler('/user/mendeley/oauth/callback', req, res)
    expect(res.html).toContain(
      "location.href = '/user/settings?oauth-complete=mendeley#references'",
    )
  })

  it('callback popup success closes the window (picker refreshes via channel)', async () => {
    const req = {
      session: {
        mendeleyOAuth: { state: 's1', isPopup: true, returnTo: '' },
      },
      query: { code: 'c1', state: 's1' },
      headers: {},
    }
    const res = {
      getHeader: () => 'base',
      setHeader() {},
      html: null,
      send(h) { this.html = h },
    }
    await callHandler('/user/mendeley/oauth/callback', req, res)
    expect(res.html).toContain('window.close()')
  })

  it('callback with invalid state redirects to the settings error notice', async () => {
    const req = { session: {}, query: { code: 'c1', state: 'x' }, headers: {} }
    const res = { redirectTo: null, redirect(u) { this.redirectTo = u } }
    await callHandler('/user/mendeley/oauth/callback', req, res)
    expect(res.redirectTo).toBe('/user/settings?oauth-error=mendeley#references')
    expect(apiMock.storeMendeleyCredentials).not.toHaveBeenCalled()
  })

  it('callback with a failed token exchange redirects to the settings error notice', async () => {
    apiMock.exchangeMendeleyCode.mockRejectedValueOnce(new Error('boom'))
    const req = {
      session: { mendeleyOAuth: { state: 's1', isPopup: false, returnTo: '' } },
      query: { code: 'c1', state: 's1' },
      headers: {},
    }
    const res = { redirectTo: null, redirect(u) { this.redirectTo = u } }
    await callHandler('/user/mendeley/oauth/callback', req, res)
    expect(res.redirectTo).toBe('/user/settings?oauth-error=mendeley#references')
    expect(apiMock.storeMendeleyCredentials).not.toHaveBeenCalled()
  })
})
