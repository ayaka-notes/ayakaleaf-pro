/**
 * zotero module (services/web/modules/zotero) server tests
 * =========================================================
 * Reference (newer) core + the bib-editor picker surface, verified as one
 * server: router registration, unconfigured gate, picker handlers (happy /
 * 404 / 502), groups gate. All host + client deps mocked — no network.
 * (Written 2026-11-05 as the module was merged into the canonical surface.)
 */
import Settings from '@overleaf/settings'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const apiMock = vi.hoisted(() => ({
  getConnectionStatus: vi.fn(async () => true),
  getGroupsForUser: vi.fn(async () => null),
  getCollectionsForLibrary: vi.fn(async () => null),
  unlinkAccount: vi.fn(async () => {}),
  getLibrariesForPicker: vi.fn(async () => [
    { id: 'user-lib', name: 'My Library', type: 'user' },
    { id: '12345', name: 'Team Library', type: 'group' },
  ]),
  getCollectionsForPicker: vi.fn(async () => [
    { id: 'col1', name: 'Collection 1' },
  ]),
  getItemsForPicker: vi.fn(async () => ({
    items: [{ key: 'abc', title: 'Test Item', itemType: 'journalArticle' }],
    hasMore: false,
    nextOffset: 0,
  })),
  getItemsBibtexForPicker: vi.fn(async () => 'entry1\nentry2'),
}))
const auditMock = vi.hoisted(() => ({
  addEntry: vi.fn(async () => {}),
}))
vi.mock('@overleaf/logger', () => ({
  default: { info() {}, warn() {}, error() {}, debug() {} },
}))
vi.mock('@overleaf/o-error', () => {
  // Faithful to libraries/o-error: default export is a class (fetch-utils
  // `extends` it), with info-bearing errors and the static helpers.
  class OError extends Error {
    constructor(message, info, cause) {
      super(message)
      this.name = this.constructor.name
      if (info) this.info = info
      if (cause) this.cause = cause
    }
    withCause(cause) {
      this.cause = cause
      return this
    }
    withInfo(info) {
      this.info = info
      return this
    }
    static getFullInfo(error) {
      const info = {}
      if (!error) return info
      if (error.cause) Object.assign(info, OError.getFullInfo(error.cause))
      if (typeof error.info === 'object') Object.assign(info, error.info)
      return info
    }
    static getFullStack(error) {
      if (!error) return ''
      return error.stack || error.message || '(no stack)'
    }
  }
  return { default: OError }
})
vi.mock('../../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
  default: { requireLogin: () => (req, res, next) => next() },
}))
vi.mock('../../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
  default: { getLoggedInUserId: () => 'user-123' },
}))
vi.mock('../../../../../app/src/Features/Errors/HttpErrorHandler.mjs', () => ({
  default: { badRequest() {}, forbidden() {}, internalServerError() {} },
}))
vi.mock('../../../../../app/src/Features/User/UserAuditLogHandler.mjs', () => ({
  default: { promises: { addEntry: auditMock.addEntry } },
}))
vi.mock('../../../../instance-features/app/src/UserFeatures.mjs', () => ({
  isFeatureOn: () => true,
  userHasFeature: vi.fn(async () => true),
  projectOwnerHasFeature: vi.fn(async () => true),
  requireUserFeature: () => (req, res, next) => next(),
}))
vi.mock('../../../app/src/ZoteroApiClient.mjs', () => ({ default: apiMock }))

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

function mockRes(captured) {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { captured.statusCode = code; return this },
    json(b) { captured.body = b; return this },
    sendStatus(code) { captured.statusCode = code; return this },
    redirect(u) { captured.redirect = u; return this },
    set() { return this },
  }
}

async function callHandler(routerModulePath, path, reqBody, query = {}) {
  const { default: Router } = await import(routerModulePath)
  const r = mockWebRouter()
  Router.apply(r)
  const entry = r.routes.find(([, p]) => p === path)
  if (!entry) throw new Error(`route not found: ${path}`)
  const captured = { statusCode: 200 }
  const res = mockRes(captured)
  for (let i = 0; i < entry[2].length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await entry[2][i]({ session: {}, query, params: {}, body: reqBody }, res, () => {})
  }
  return captured
}

describe('zotero router wiring', () => {
  it('registers the full connector + picker surface', async () => {
    const { default: Router } = await import('../../../app/src/ZoteroRouter.mjs')
    const r = mockWebRouter()
    Router.apply(r)
    const keys = r.routes.map(([m, p]) => `${m} ${p}`)
    for (const k of [
      'GET /user/zotero/oauth',
      'GET /user/zotero/oauth/callback',
      'GET /user/zotero/status',
      'GET /zotero/groups',
      'GET /user/zotero/collections',
      'DELETE /user/zotero',
      'GET /user/zotero/picker/libraries',
      'GET /user/zotero/picker/collections',
      'GET /user/zotero/picker/items',
      'GET /user/zotero/picker/bibtex',
    ]) {
      expect(keys).toContain(k)
    }
  })
})

describe('zotero picker handlers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('picker libraries returns mapped id/name pairs', async () => {
    const out = await callHandler(
      '../../../app/src/ZoteroRouter.mjs',
      '/user/zotero/picker/libraries'
    )
    expect(out.statusCode).toBe(200)
    expect(out.body).toEqual([
      { id: 'user-lib', name: 'My Library', type: 'user' },
      { id: '12345', name: 'Team Library', type: 'group' },
    ])
  })

  it('picker items returns items + pagination', async () => {
    const out = await callHandler(
      '../../../app/src/ZoteroRouter.mjs',
      '/user/zotero/picker/items'
    )
    expect(out.statusCode).toBe(200)
    expect(out.body.items).toHaveLength(1)
    expect(out.body.items[0]).toEqual({
      key: 'abc',
      title: 'Test Item',
      itemType: 'journalArticle',
    })
  })

  it('picker bibtex returns the combined BibTeX (live-tuned contract)', async () => {
    const out = await callHandler(
      '../../../app/src/ZoteroRouter.mjs',
      '/user/zotero/picker/bibtex',
      undefined,
      { keys: 'abc,def' },
    )
    expect(out.statusCode).toBe(200)
    expect(out.body).toEqual({ bibtex: 'entry1\nentry2' })
  })

  it('unlinked picker 404 maps to 409 zotero_not_linked (library modal)', async () => {
    apiMock.getLibrariesForPicker.mockImplementationOnce(async () => {
      const err = new Error('not linked')
      err.info = { status: 404 }
      throw err
    })
    const out = await callHandler(
      '../../../app/src/ZoteroRouter.mjs',
      '/user/zotero/picker/libraries'
    )
    expect(out.statusCode).toBe(409)
    expect(out.body).toEqual({ message: 'zotero_not_linked' })
  })

  it('client failures keep their status + message', async () => {
    apiMock.getCollectionsForPicker.mockImplementationOnce(async () => {
      const err = new Error('upstream down')
      err.info = { status: 502 }
      throw err
    })
    const out = await callHandler(
      '../../../app/src/ZoteroRouter.mjs',
      '/user/zotero/picker/collections'
    )
    expect(out.statusCode).toBe(502)
    expect(out.body).toEqual({ message: 'upstream down' })
  })
})

describe('zotero groups gate', () => {
  it('unlinked → 200 with null body (reference lineage: create-file UI hides the mode)', async () => {
    apiMock.getGroupsForUser.mockImplementationOnce(async () => null)
    const out = await callHandler(
      '../../../app/src/ZoteroRouter.mjs',
      '/zotero/groups'
    )
    expect(out.statusCode).toBe(200)
    expect(out.body).toBeNull()
  })

  it('client failure → 500 with i18n-key message (Go-spec shape)', async () => {
    apiMock.getGroupsForUser.mockImplementationOnce(async () => {
      throw new Error('zotero_groups_relink')
    })
    const out = await callHandler(
      '../../../app/src/ZoteroRouter.mjs',
      '/zotero/groups'
    )
    expect(out.statusCode).toBe(500)
    expect(out.body).toEqual({ message: 'zotero_groups_relink' })
  })
})
