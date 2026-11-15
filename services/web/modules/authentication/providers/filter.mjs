/**
 * SSO profile filter engine.
 *
 * Every SSO source (OIDC provider or SAML IdP) may carry a `filter` that
 * decides which profiles may log in. Rules reference *any* attribute or
 * claim name of the identity profile (e.g. `eduPersonAffiliation`,
 * `eduPersonScopedAffiliation`, `zfnScopedAffiliation`, or a custom claim),
 * so the filter works for any SSO deployment, not only EduGAIN.
 *
 * A rule is: { field, op, value?, values? }
 *   op:
 *     equals     strict match (string equality, or membership if the
 *                profile attribute holds multiple values)
 *     iequals    case-insensitive equals
 *     oneOf      value matches any entry of `values` (strict)
 *     iOneOf     case-insensitive oneOf
 *     startsWith / iStartsWith
 *     endsWith   / iEndsWith
 *     contains   / iContains
 *     regex      `value` is a regular-expression pattern (tested as-is)
 *
 * Semantics:
 *   - `deny`  rules: if any deny rule matches the profile, login is denied.
 *   - `allow` rules: if the allow list is non-empty, at least one allow rule
 *     must match, otherwise login is denied. An empty allow list means
 *     "no positive requirement".
 *   - A missing attribute never matches a rule.
 */

export const FILTER_OPS = [
  'equals',
  'iequals',
  'oneOf',
  'iOneOf',
  'startsWith',
  'iStartsWith',
  'endsWith',
  'iEndsWith',
  'contains',
  'iContains',
  'regex',
]

/** Case-insensitive op names + a few aliases → canonical name (keys are
 * lowercase without underscores). */
const OP_ALIASES = {
  equals: 'equals',
  iequals: 'iequals',
  oneof: 'oneOf',
  ioneof: 'iOneOf',
  startswith: 'startsWith',
  istartswith: 'iStartsWith',
  endswith: 'endsWith',
  iendswith: 'iEndsWith',
  contains: 'contains',
  icontains: 'iContains',
  regex: 'regex',
  regexp: 'regex',
  match: 'regex',
  equalsmany: 'equalsMany',
  iequalsmany: 'iequalsMany',
  startswithmany: 'startsWithMany',
  istartswithmany: 'iStartsWithMany',
  endswithmany: 'endsWithMany',
  iendswithmany: 'iEndsWithMany',
  containsmany: 'containsMany',
  icontainsmany: 'iContainsMany',
}

function fail(path, message) {
  throw new Error(`${path}: ${message}`)
}

/**
 * Normalize a rule from user/admin input. Accepts a bare string (interpreted
 * as `field=value`, i.e. op equals) for convenience.
 */
export function normalizeRule(raw, path) {
  if (typeof raw === 'string') {
    const eq = raw.indexOf('=')
    if (eq === -1) {
      fail(path, 'string rule must be "field=value"')
    }
    raw = { field: raw.slice(0, eq), value: raw.slice(eq + 1) }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(path, 'rule must be an object or a "field=value" string')
  }
  const field = raw.field ?? raw.attribute ?? raw.claim
  if (!field || typeof field !== 'string' || !field.trim()) {
    fail(path, 'rule needs a non-empty "field" (attribute/claim name)')
  }
  const opRaw = String(raw.op ?? 'equals').toLowerCase().replace(/_/g, '')
  let op = OP_ALIASES[opRaw]
  if (!op) {
    fail(path, `unknown op "${raw.op}" (allowed: ${FILTER_OPS.join(', ')})`)
  }
  let { value, values } = raw
  if (value !== undefined && typeof value !== 'string') {
    fail(path, 'rule "value" must be a string')
  }
  if (values !== undefined) {
    if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) {
      fail(path, 'rule "values" must be an array of strings')
    }
  }
  if (op === 'oneOf' || op === 'iOneOf') {
    if (!values?.length && value === undefined) {
      fail(path, `op "${op}" needs a non-empty "values" array`)
    }
    if (value !== undefined && !values) values = [value]
  } else if (values !== undefined && values.length) {
    if (op === 'regex') {
      fail(path, 'op "regex" takes a single "value" pattern, not "values"')
    }
    if (!op.endsWith('Many')) {
      // single-value ops also accept a values array: match any entry
      op = `${op}Many`
    }
  } else if (value === undefined) {
    fail(path, `op "${op}" needs a "value" (or "values") string`)
  }
  // pre-compile regex (NFKC-normalized so confusable homoglyphs cannot
  // slip past deny/allow comparisons, e.g. Cyrillic "а" for Latin "a")
  if (typeof value === 'string') value = value.normalize('NFKC')
  let pattern = null
  if (op === 'regex') {
    try {
      pattern = new RegExp(value)
    } catch (error) {
      fail(path, `invalid regex "${value}": ${error.message}`)
    }
  }
  const rule = { field: field.trim(), op, value, pattern }
  if (values) rule.values = values.map(v => v.trim().normalize('NFKC'))
  return rule
}

/** Read one attribute value from a profile; supports OIDC claim objects
 *  (including nested `_json` userinfo claims) and SAML attribute objects. */
function readProfileValue(profile, field) {
  if (profile == null || typeof profile !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(profile, field)) {
    return profile[field]
  }
  // OIDC: non-standard claims often arrive in the raw userinfo JSON
  if (profile._json && Object.prototype.hasOwnProperty.call(profile._json, field)) {
    return profile._json[field]
  }
  return undefined
}

/** True if the rule matches the profile. Multi-valued attributes (arrays)
 *  match if any entry matches; single values match directly. */
export function ruleMatches(rule, profile) {
  const rawValue = readProfileValue(profile, rule.field)
  if (rawValue === undefined || rawValue === null) return false
  const candidates = Array.isArray(rawValue) ? rawValue : [rawValue]

  const matchOne = candidate => {
    if (typeof candidate !== 'string') return false
    const c = candidate.normalize('NFKC')
    const ci = c.toLowerCase()
    switch (rule.op) {
      case 'equals':
        return c === rule.value
      case 'iequals':
        return ci === rule.value.toLowerCase()
      case 'oneOf':
        return rule.values.includes(c)
      case 'iOneOf': {
        const lower = c.toLowerCase()
        return rule.values.some(v => v.toLowerCase() === lower)
      }
      case 'startsWith':
        return c.startsWith(rule.value)
      case 'iStartsWith':
        return ci.startsWith(rule.value.toLowerCase())
      case 'endsWith':
        return c.endsWith(rule.value)
      case 'iEndsWith':
        return ci.endsWith(rule.value.toLowerCase())
      case 'contains':
        return c.includes(rule.value)
      case 'iContains':
        return ci.includes(rule.value.toLowerCase())
      case 'regex':
        return rule.pattern.test(c)
      // "Many" variants (values array used for a single-value op)
      case 'equalsMany':
        return rule.values.includes(c)
      case 'iequalsMany':
        return rule.values.some(v => v.toLowerCase() === ci)
      case 'startsWithMany':
        return rule.values.some(v => c.startsWith(v))
      case 'iStartsWithMany':
        return rule.values.some(v => c.toLowerCase().startsWith(v.toLowerCase()))
      case 'endsWithMany':
        return rule.values.some(v => c.endsWith(v))
      case 'iEndsWithMany':
        return rule.values.some(
          v => c.toLowerCase().endsWith(v.toLowerCase())
        )
      case 'containsMany':
        return rule.values.some(v => c.includes(v))
      case 'iContainsMany':
        return rule.values.some(
          v => c.toLowerCase().includes(v.toLowerCase())
        )
      default:
        return false
    }
  }

  return candidates.some(candidate => matchOne(candidate))
}

/**
 * Normalize the whole filter block of a provider.
 * Returns { allow, deny, allowExistingUsers, allowInvited } with
 * allow/deny as arrays of normalized rules.
 */
export function normalizeFilter(filter) {
  if (filter === undefined || filter === null) {
    filter = {}
  }
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    throw new Error('provider filter must be an object')
  }
  const list = (rules, path) =>
    (rules ?? []).map((rule, i) => normalizeRule(rule, `${path}[${i}]`))
  const allow = list(filter.allow, 'filter.allow')
  const deny = list(filter.deny, 'filter.deny')
  const allowExistingUsers =
    filter.allowExistingUsers === undefined ? true : Boolean(filter.allowExistingUsers)
  const allowInvited =
    filter.allowInvited === undefined ? true : Boolean(filter.allowInvited)
  return { allow, deny, allowExistingUsers, allowInvited }
}

/**
 * Evaluate a normalized filter against a profile.
 * @returns {{verdict: 'allow'|'deny', rule: object|null}}
 *   rule is the offending rule (deny hit, or the whole filter when the allow
 *   list matched nothing).
 */
export function evaluateFilter(filter, profile) {
  const { allow, deny } = filter
  for (const rule of deny) {
    if (ruleMatches(rule, profile)) {
      return { verdict: 'deny', rule }
    }
  }
  if (allow.length > 0) {
    const hit = allow.find(rule => ruleMatches(rule, profile)) ?? null
    if (!hit) {
      return { verdict: 'deny', rule: { field: '(none matched)', allow: true } }
    }
    return { verdict: 'allow', rule: hit }
  }
  return { verdict: 'allow', rule: null }
}
