/**
 * SSO access decision: combines the provider's profile filter with the two
 * admin-configurable exceptions:
 *
 *   - `filter.allowExistingUsers` (default true): a user who already has an
 *     Overleaf account (matched by SSO identity or by email) may log in even
 *     if the filter denies their profile.
 *   - `filter.allowInvited` (default true): a user whose email has a pending
 *     project/team invitation may autocreate an account even if the filter
 *     denies their profile.
 */

import { evaluateFilter } from './filter.mjs'
import { hasPendingInvite } from './invites.mjs'

export class SSOAccessDeniedError extends Error {
  constructor(provider, rule) {
    super('SSO login not allowed for this profile')
    this.name = 'SSOAccessDeniedError'
    this.provider = provider.id
    this.rule = rule
  }
}

/**
 * Decide whether this profile may log in on this provider.
 *
 * @param {object} provider normalized provider (needs id + filter)
 * @param {object} profile  the SSO profile (claims / attributes)
 * @param {string} email    the resolved email (for the invite lookup)
 * @param {boolean} [isExistingUser] true if an account already matches this
 *        SSO identity or email
 * @returns {{allowed: boolean, reason: string, rule: object|null}}
 */
export async function checkSsoAccess(provider, profile, email, isExistingUser) {
  const filter = provider.filter || { allow: [], deny: [] }
  const verdict = evaluateFilter(filter, profile)
  if (verdict.verdict === 'allow') {
    return { allowed: true, reason: 'filter-pass', rule: verdict.rule }
  }
  if (isExistingUser && filter.allowExistingUsers !== false) {
    return { allowed: true, reason: 'existing-user', rule: verdict.rule }
  }
  if (filter.allowInvited !== false && email) {
    const { invited, via } = await hasPendingInvite(email)
    if (invited) {
      return { allowed: true, reason: `invited-${via}`, rule: verdict.rule }
    }
  }
  return { allowed: false, reason: 'filter-denied', rule: verdict.rule }
}

export default { checkSsoAccess, SSOAccessDeniedError }
