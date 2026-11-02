/**
 * mendeley dep tests (pure/offline only — no network).
 * Covers the BibTeX serializer and the settings/authorize-URL logic.
 * The live OAuth + /documents flows are verified against api.mendeley.com
 * in the deployed instance (same pattern as the zotero connector).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
