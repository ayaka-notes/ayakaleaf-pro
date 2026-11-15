import { expect, describe, it } from 'vitest'
import {
  normalizeRule,
  normalizeFilter,
  ruleMatches,
  evaluateFilter,
  FILTER_OPS,
} from '../../providers/index.mjs'

describe('filter engine', () => {
  describe('normalizeRule', () => {
    it('accepts object rules', () => {
      const rule = normalizeRule(
        { field: 'eduPersonAffiliation', op: 'oneOf', values: ['staff'] },
        'f'
      )
      expect(rule).toMatchObject({
        field: 'eduPersonAffiliation',
        op: 'oneOf',
        values: ['staff'],
      })
    })

    it('accepts a "field=value" string shorthand', () => {
      const rule = normalizeRule('zfnScopedAffiliation=zfn.uni-bremen.de', 'f')
      expect(rule.op).toBe('equals')
      expect(rule.value).toBe('zfn.uni-bremen.de')
    })

    it('rejects a bare string without "="', () => {
      expect(() => normalizeRule('justfield', 'f')).toThrow('field=value')
    })

    it('rejects unknown ops', () => {
      expect(() =>
        normalizeRule({ field: 'a', op: 'nope' }, 'f')
      ).toThrow('unknown op')
    })

    it('rejects oneOf without values', () => {
      expect(() =>
        normalizeRule({ field: 'a', op: 'oneOf' }, 'f')
      ).toThrow('non-empty "values"')
    })

    it('rejects invalid regex', () => {
      expect(() =>
        normalizeRule({ field: 'a', op: 'regex', value: '[' }, 'f')
      ).toThrow('invalid regex')
    })

    it('rejects non-string values', () => {
      expect(() =>
        normalizeRule({ field: 'a', op: 'equals', value: 42 }, 'f')
      ).toThrow('"value" must be a string')
    })
  })

  describe('ruleMatches', () => {
    it('normalizes unicode confusables on both sides (deny-rule hardening)', () => {
      // rule written in ASCII; profile carries FULLWIDTH homoglyphs
      // (U+FF45 'e', U+FF4D 'm', U+FF50 'p', U+FF52 'r'...) that look
      // identical in most fonts — NFKC folds them back to ASCII
      const rule = normalizeRule(
        { field: 'email', op: 'iEndsWith', value: '@bad.example' },
        'f'
      )
      expect(ruleMatches(rule, { email: 'user@bad.ex\uFF41mple' })).toBe(true)
      expect(ruleMatches(rule, { email: 'user@\uFF42ad.example' })).toBe(true)
      // a genuinely different (Cyrillic) domain must NOT match
      expect(ruleMatches(rule, { email: 'user@bad.ex\u0435mple' })).toBe(false)
      // and the reverse direction: ligatures in the rule value
      const lig = normalizeRule(
        { field: 'x', op: 'equals', value: 'ﬁle' },
        'f'
      )
      expect(ruleMatches(lig, { x: 'file' })).toBe(true)
      // legit matches are unaffected
      const ok = normalizeRule(
        { field: 'x', op: 'equals', value: 'zfn.uni-bremen.de' },
        'f'
      )
      expect(ruleMatches(ok, { x: 'zfn.uni-bremen.de' })).toBe(true)
    })

    it('matches single-value attributes', () => {
      const rule = normalizeRule(
        { field: 'zfnScopedAffiliation', op: 'equals', value: 'zfn.uni-bremen.de' },
        'f'
      )
      expect(ruleMatches(rule, { zfnScopedAffiliation: 'zfn.uni-bremen.de' })).toBe(true)
      expect(ruleMatches(rule, { zfnScopedAffiliation: 'zfn.other.de' })).toBe(false)
    })

    it('matches any entry of multi-valued attributes (SAML arrays)', () => {
      const rule = normalizeRule(
        { field: 'eduPersonScopedAffiliation', op: 'oneOf', values: ['staff@uni-bremen.de'] },
        'f'
      )
      expect(
        ruleMatches(rule, {
          eduPersonScopedAffiliation: ['student@elsewhere.de', 'staff@uni-bremen.de'],
        })
      ).toBe(true)
      expect(
        ruleMatches(rule, { eduPersonScopedAffiliation: ['student@elsewhere.de'] })
      ).toBe(false)
    })

    it('supports case-insensitive ops', () => {
      const rule = normalizeRule(
        { field: 'eduPersonAffiliation', op: 'iOneOf', values: ['STUDENT'] },
        'f'
      )
      expect(ruleMatches(rule, { eduPersonAffiliation: 'student' })).toBe(true)
      expect(ruleMatches(rule, { eduPersonAffiliation: 'faculty' })).toBe(false)
    })

    it('supports endsWith / iEndsWith', () => {
      const rule = normalizeRule(
        { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@uni-bremen.de' },
        'f'
      )
      expect(
        ruleMatches(rule, { eduPersonScopedAffiliation: 'STUDENT@UNI-BREMEN.DE' })
      ).toBe(true)
      expect(
        ruleMatches(rule, { eduPersonScopedAffiliation: 'student@elsewhere.de' })
      ).toBe(false)
    })

    it('supports containsMany (values array on a single-value op)', () => {
      const rule = normalizeRule(
        { field: 'eduPersonEntitlement', op: 'containsMany', values: ['staff', 'faculty'] },
        'f'
      )
      expect(
        ruleMatches(rule, { eduPersonEntitlement: 'urn:zfn:entitlements:faculty' })
      ).toBe(true)
      expect(
        ruleMatches(rule, { eduPersonEntitlement: 'urn:zfn:entitlements:other' })
      ).toBe(false)
    })

    it('auto-converts "equals" + values array to equalsMany', () => {
      const rule = normalizeRule(
        { field: 'uid', op: 'equals', values: ['u1', 'u2'] },
        'f'
      )
      expect(rule.op).toBe('equalsMany')
      expect(ruleMatches(rule, { uid: 'u2' })).toBe(true)
      expect(ruleMatches(rule, { uid: 'u3' })).toBe(false)
    })

    it('supports regex', () => {
      const rule = normalizeRule(
        { field: 'epn', op: 'regex', value: '^epn-[0-9]+$' },
        'f'
      )
      expect(ruleMatches(rule, { epn: 'epn-123' })).toBe(true)
      expect(ruleMatches(rule, { epn: 'epn-x' })).toBe(false)
    })

    it('supports op aliases (snake_case, match/regexp)', () => {
      expect(normalizeRule({ field: 'a', op: 'i_endswith', value: '.de' }, 'f').op).toBe(
        'iEndsWith'
      )
      expect(normalizeRule({ field: 'a', op: 'regexp', value: '^x' }, 'f').op).toBe(
        'regex'
      )
      expect(normalizeRule({ field: 'a', op: 'match', value: '^x' }, 'f').op).toBe(
        'regex'
      )
    })

    it('never matches missing attributes', () => {
      const rule = normalizeRule({ field: 'missing', op: 'equals', value: 'x' }, 'f')
      expect(ruleMatches(rule, { other: 'x' })).toBe(false)
      expect(ruleMatches(rule, {})).toBe(false)
    })

    it('reads OIDC claims from _json (userinfo fallback)', () => {
      const rule = normalizeRule({ field: 'customClaim', op: 'equals', value: 'yes' }, 'f')
      expect(ruleMatches(rule, { _json: { customClaim: 'yes' } })).toBe(true)
      expect(ruleMatches(rule, { _json: { other: 'yes' } })).toBe(false)
    })

    it('ignores non-string profile values', () => {
      const rule = normalizeRule({ field: 'flag', op: 'equals', value: '1' }, 'f')
      expect(ruleMatches(rule, { flag: 1 })).toBe(false)
    })
  })

  describe('normalizeFilter + evaluateFilter', () => {
    it('denies when a deny rule matches', () => {
      const filter = normalizeFilter({
        deny: [{ field: 'eduPersonAffiliation', op: 'oneOf', values: ['member'] }],
      })
      expect(evaluateFilter(filter, { eduPersonAffiliation: 'member' }).verdict).toBe('deny')
      expect(
        evaluateFilter(filter, { eduPersonAffiliation: 'faculty' }).verdict
      ).toBe('allow')
    })

    it('requires at least one allow rule to match when allow is non-empty', () => {
      const filter = normalizeFilter({
        allow: [
          { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@uni-bremen.de' },
        ],
      })
      expect(
        evaluateFilter(filter, { eduPersonScopedAffiliation: 'student@uni-bremen.de' }).verdict
      ).toBe('allow')
      expect(
        evaluateFilter(filter, { eduPersonScopedAffiliation: 'student@elsewhere.de' }).verdict
      ).toBe('deny')
    })

    it('allows everything when no rules are set', () => {
      const filter = normalizeFilter({})
      expect(evaluateFilter(filter, {}).verdict).toBe('allow')
    })

    it('deny wins over allow', () => {
      const filter = normalizeFilter({
        allow: [{ field: 'eduPersonAffiliation', op: 'oneOf', values: ['faculty', 'member'] }],
        deny: [{ field: 'eduPersonAffiliation', op: 'equals', value: 'member' }],
      })
      expect(evaluateFilter(filter, { eduPersonAffiliation: 'member' }).verdict).toBe('deny')
      expect(
        evaluateFilter(filter, { eduPersonAffiliation: 'faculty' }).verdict
      ).toBe('allow')
    })

    it('keeps the exception flags with defaults true', () => {
      const filter = normalizeFilter({})
      expect(filter.allowExistingUsers).toBe(true)
      expect(filter.allowInvited).toBe(true)
      const strict = normalizeFilter({ allowExistingUsers: false, allowInvited: false })
      expect(strict.allowExistingUsers).toBe(false)
      expect(strict.allowInvited).toBe(false)
    })

    it('exposes all ops', () => {
      expect(FILTER_OPS).toContain('regex')
      expect(FILTER_OPS).toContain('iOneOf')
    })
  })
})
