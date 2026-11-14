import crypto from 'node:crypto'
import UserCreator from '../../../../../app/src/Features/User/UserCreator.mjs'
import UserGetter from '../../../../../app/src/Features/User/UserGetter.mjs'
import ThirdPartyIdentityManager from '../../../../../app/src/Features/User/ThirdPartyIdentityManager.mjs'
import { ParallelLoginError } from '../../../../../app/src/Features/Authentication/AuthenticationErrors.mjs'
import { User } from '../../../../../app/src/models/User.mjs'
import { checkSsoAccess } from '../../../providers/index.mjs'
import {
  accountBeforeLogin,
  logLoginChanges,
  logLoginEntry,
} from '../../../auditLog.mjs'

/** Email from the profile: passport-standard `emails` array first, then the
 *  provider-configured claim (e.g. `email`, `mail`, `eduPersonPrincipalName`). */
export function profileEmail(provider, profile) {
  const fromEmails = profile?.emails?.[0]?.value
  if (typeof fromEmails === 'string' && fromEmails) {
    return fromEmails.toLowerCase()
  }
  const claim =
    profile?.[provider.attrs.email] ?? profile?._json?.[provider.attrs.email]
  const value = Array.isArray(claim) ? claim[0] : claim
  return typeof value === 'string' ? value.toLowerCase() : null
}

/** The provider-specific external user id from the profile. */
export function profileUserId(provider, profile) {
  if (provider.attrs.userId === 'email') {
    return profileEmail(provider, profile)
  }
  const raw =
    profile?.[provider.attrs.userId] ?? profile?._json?.[provider.attrs.userId]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value ? value : null
}

function profileString(provider, profile, attr) {
  if (!attr) return ''
  const raw = profile?.[attr] ?? profile?._json?.[attr]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : ''
}

/** Admin determination from the provider's admin field + values. */
export function profileIsAdmin(provider, profile) {
  const admin = provider.attrs.admin
  if (!admin?.field || !admin?.values?.length) return false
  const raw = profile?.[admin.field] ?? profile?._json?.[admin.field]
  if (raw === undefined || raw === null) return false
  if (Array.isArray(raw)) return admin.values.some(v => raw.includes(v))
  if (typeof raw === 'string') return admin.values.includes(raw)
  if (typeof raw === 'boolean') return raw && admin.values.includes(String(raw))
  return false
}

const OIDCAuthenticationManager = {
  /**
   * @param {object} profile raw SSO profile (claims)
   * @param {object} provider normalized OIDC provider
   * @returns {Promise<{user: object|null, accessDenied?: {reason, rule}}>}
   */
  async findOrCreateUser(profile, provider, auditLog) {
    const email = profileEmail(provider, profile)
    const oidcUserId = profileUserId(provider, profile)
    if (!oidcUserId) {
      return { user: null, error: 'no-identity' }
    }
    const firstName =
      profile.name?.givenName || profileString(provider, profile, provider.attrs.firstName)
    const lastName =
      profile.name?.familyName || profileString(provider, profile, provider.attrs.lastName)
    const isAdmin = profileIsAdmin(provider, profile)

    // --- existing account? (identity link only — a link-only source must
    // not match accounts by email: the iD owner and the email owner need
    // not be the same person, so only an explicit link may grant access)
    let user = null
    let isExisting = false
    try {
      user = await ThirdPartyIdentityManager.promises.login(
        provider.id,
        oidcUserId,
        null
      )
      isExisting = true
    } catch {
      // not linked yet; keep looking
    }
    if (!user && email && !provider.behavior.linkOnly) {
      user = await User.findOne({ 'email': email }).exec()
      isExisting = Boolean(user)
    }

    // --- link-only sources (e.g. ORCID): never auto-create; unlinked
    // identities must log in another way first and link the account from
    // the settings page (the controller answers with the
    // `register_intercept_sso` message).
    if (!user && provider.behavior.linkOnly) {
      return { user: null, linkOnlyRefused: true }
    }

    // --- profile filter (deny list / allow list + exceptions)
    const access = await checkSsoAccess(provider, profile, email, isExisting)
    if (!access.allowed) {
      return { user: null, accessDenied: { reason: access.reason, rule: access.rule } }
    }

    if (!user) {
      // --- new account (JIT): needs an email identity
      if (!email) {
        return { user: null, error: 'no-identity' }
      }
      // additionally gated by allowedEmailDomains
      const allowedDomains = provider.behavior.allowedEmailDomains
      if (
        allowedDomains &&
        email &&
        !allowedDomains.some(pattern => {
          const domain = email.split('@')[1]
          if (pattern.startsWith('*.')) {
            const base = pattern.slice(2)
            return domain.endsWith(`.${base}`)
          }
          return domain === pattern
        })
      ) {
        return { user: null, accessDenied: { reason: 'email-domain' } }
      }
      await UserGetter.promises.ensureUniqueEmailAddress(email)
      // Invited-user exception: the account is auto-created but marked as a
      // holding account — it may use the invited projects, but (per the
      // `sso.invitedUsersCanCreateProjects` setting) may not create new
      // ones until an administrator establishes it.
      user = await UserCreator.promises.createNewUser({
        email: email,
        first_name: firstName,
        last_name: lastName,
        isAdmin: isAdmin,
        holdingAccount: String(access?.reason || '').startsWith('invited-'),
        analyticsId: crypto.randomUUID(),
      })
      await logLoginEntry(user, 'create-account', auditLog)
    }

    // --- link the SSO identity to the account (re-linking over an
    // existing link of this provider is the current behaviour)
    auditLog.initiatorId = user._id
    await ThirdPartyIdentityManager.promises.link(
      user._id,
      provider.id,
      oidcUserId,
      null,
      auditLog
    )
    await User.updateOne(
      { _id: user._id },
      { $set: { 'emails.0.confirmedAt': Date.now() } } // email of external user is confirmed
    ).exec()

    const before = accountBeforeLogin(user)
    const userDetails = provider.behavior.updateUserDetailsOnLogin
      ? { first_name: firstName, last_name: lastName }
      : {}
    if (provider.attrs.admin?.field && provider.attrs.admin?.values?.length) {
      user.isAdmin = isAdmin
      userDetails.isAdmin = isAdmin
    }
    const result = await User.updateOne(
      { _id: user._id, loginEpoch: user.loginEpoch },
      { $inc: { loginEpoch: 1 }, $set: userDetails },
      {}
    ).exec()

    if (result.modifiedCount !== 1) {
      throw new ParallelLoginError()
    }
    await logLoginChanges(user, before, userDetails, auditLog)
    return { user }
  },

  async linkAccount(userId, profile, provider, auditLog) {
    const oidcUserId = profileUserId(provider, profile)
    if (!oidcUserId) {
      throw new Error('no identity in SSO profile to link')
    }
    await ThirdPartyIdentityManager.promises.link(
      userId,
      provider.id,
      oidcUserId,
      null,
      auditLog
    )
  },
}

export default {
  promises: OIDCAuthenticationManager,
}
