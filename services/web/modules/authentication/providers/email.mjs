/**
 * Login-email resolution for SSO profiles.
 *
 * With `verifiedEmailRequired` (default for `oauth2` sources) only verified
 * emails are considered: an unverified address may not take over an account
 * or open a new one (GitHub sends `primary` + `verified` flags on
 * /user/emails; ORCID sends no email at all).
 */
export function resolveSsoEmail(provider, profile) {
  const emails = Array.isArray(profile?.emails)
    ? profile.emails.filter(e => e && typeof e.value === 'string' && e.value)
    : []
  if (!emails.length) return null
  const requireVerified = Boolean(provider.behavior?.verifiedEmailRequired)
  const pool = requireVerified ? emails.filter(e => e.verified) : emails
  if (!pool.length) return null // no verified email & verification required
  const chosen = pool.find(e => e.primary) || pool[0]
  return chosen.value.toLowerCase()
}
export default { resolveSsoEmail }
