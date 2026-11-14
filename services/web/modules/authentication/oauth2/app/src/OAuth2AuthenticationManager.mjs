import crypto from 'node:crypto'
import UserCreator from '../../../../../app/src/Features/User/UserCreator.mjs'
import UserGetter from '../../../../../app/src/Features/User/UserGetter.mjs'
import ThirdPartyIdentityManager from '../../../../../app/src/Features/User/ThirdPartyIdentityManager.mjs'
import { ParallelLoginError } from '../../../../../app/src/Features/Authentication/AuthenticationErrors.mjs'
import { User } from '../../../../../app/src/models/User.mjs'
import { checkSsoAccess, resolveSsoEmail } from '../../../providers/index.mjs'
import {
  accountBeforeLogin,
  logLoginChanges,
  logLoginEntry,
} from '../../../auditLog.mjs'

/**
 * Pick the login email from the passport email list (see providers/email.mjs).
 */
const resolveEmail = (provider, profile) => resolveSsoEmail(provider, profile)

const OAuth2AuthenticationManager = {
  /**
   * @param {object} profile passport profile (id, displayName, emails, _json)
   * @param {object} provider normalized oauth2 provider
   * @returns {Promise<{user: object|null, accessDenied?: object, linkOnlyRefused?: boolean, error?: string}>}
   */
  async findOrCreateUser(profile, provider, auditLog) {
    const userId = String(profile.id)
    const email = resolveEmail(provider, profile)
    const firstName =
      profile._json?.first_name || profile._json?.firstName || ''
    const lastName =
      profile._json?.last_name || profile._json?.lastName || ''

    // --- existing account? (identity link only — see the OIDC manager for
    // why a link-only source must not match by email)
    let user = null
    let isExisting = false
    try {
      user = await ThirdPartyIdentityManager.promises.login(provider.id, userId, null)
      isExisting = true
    } catch {
      // not linked yet; keep looking
    }
    if (!user && email && !provider.behavior.linkOnly) {
      user = await User.findOne({ email: email }).exec()
      isExisting = Boolean(user)
    }

    // --- link-only sources (e.g. ORCID via OIDC style flows): never
    // auto-create; unlinked identities must log in another way first and
    // link the account from the settings page.
    if (!user && provider.behavior.linkOnly) {
      return { user: null, linkOnlyRefused: true }
    }

    // --- profile filter (deny list / allow list + exceptions)
    const access = await checkSsoAccess(provider, profile, email, isExisting)
    if (!access.allowed) {
      return { user: null, accessDenied: { reason: access.reason, rule: access.rule } }
    }

    if (!user) {
      // --- new account (JIT)
      if (!email) {
        return {
          user: null,
          error: 'no-identity',
        }
      }
      const allowedDomains = provider.behavior.allowedEmailDomains
      if (
        allowedDomains &&
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
      user = await UserCreator.promises.createNewUser({
        email: email,
        first_name: firstName,
        last_name: lastName,
        holdingAccount: false,
        analyticsId: crypto.randomUUID(),
      })
      await logLoginEntry(user, 'create-account', auditLog)
    }

    // --- link the SSO identity to the account (re-linking over an
    // existing link of this provider is the current behaviour)
    auditLog.initiatorId = user._id
    await ThirdPartyIdentityManager.promises.link(user._id, provider.id, userId, null, auditLog)
    if (email) {
      await User.updateOne(
        { _id: user._id, 'emails.email': email },
        { $set: { 'emails.$.confirmedAt': Date.now() } } // email of external user is confirmed
      ).exec()
    }
    const before = accountBeforeLogin(user)
    const userDetails = provider.behavior.updateUserDetailsOnLogin
      ? { first_name: firstName, last_name: lastName }
      : {}
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
    const id = String(profile.id)
    await ThirdPartyIdentityManager.promises.link(userId, provider.id, id, null, auditLog)
  },
}
export default {
  promises: OAuth2AuthenticationManager,
}
