import crypto from 'node:crypto'
import UserCreator from '../../../../../app/src/Features/User/UserCreator.mjs'
import UserGetter from '../../../../../app/src/Features/User/UserGetter.mjs'
import { ParallelLoginError } from '../../../../../app/src/Features/Authentication/AuthenticationErrors.mjs'
import SAMLIdentityManager from '../../../../../app/src/Features/User/SAMLIdentityManager.mjs'
import { User } from '../../../../../app/src/models/User.mjs'
import { firstValue } from '../../../utils.mjs'
import { checkSsoAccess } from '../../../providers/index.mjs'
import {
  accountBeforeLogin,
  logLoginChanges,
  logLoginEntry,
} from '../../../auditLog.mjs'

function attr(provider, profile, name) {
  if (!name) return undefined
  const raw = profile?.[name] ?? profile?._json?.[name]
  return firstValue(raw)
}

/**
 * SAML find-or-create for one IdP provider.
 *
 * We search for a SAML user, and if none is found, we search for a user with
 * the given email. If a user is found we update the user to be a SAML user;
 * otherwise we create a new SAML user with the given email (subject to the
 * provider's profile filter and the admin-configured exceptions).
 */
const SAMLAuthenticationManager = {
  /**
   * @returns {Promise<{user: object|null, accessDenied?: {reason, rule}}>}
   */
  async findOrCreateUser(profile, provider, auditLog) {
    const { attrs, behavior } = provider
    const externalUserId = attr(provider, profile, attrs.userId)
    const emailRaw = attr(provider, profile, attrs.email)
    const email =
      typeof emailRaw === 'string' ? emailRaw.toLowerCase() : null
    if (!externalUserId) {
      return { user: null, error: 'no-identity' }
    }
    const firstName = attr(provider, profile, attrs.firstName) || ''
    const lastName = attr(provider, profile, attrs.lastName) || email || ''

    let isAdmin = false
    if (attrs.admin?.field && attrs.admin?.values?.length) {
      const rawAdmin = attr(provider, profile, attrs.admin.field)
      isAdmin = Array.isArray(rawAdmin)
        ? attrs.admin.values.some(v => rawAdmin.includes(v))
        : attrs.admin.values.includes(String(rawAdmin))
    }

    // --- existing account? (SAML identity link, or an account with this email)
    let user = null
    let isExisting = false
    let identityLinked = false
    try {
      user = await SAMLIdentityManager.getUser(
        provider.id,
        externalUserId,
        attrs.userId
      )
      isExisting = Boolean(user)
      identityLinked = Boolean(user)
    } catch {
      user = null
    }
    if (!user && email) {
      user = await User.findOne({ 'email': email }).exec()
      isExisting = Boolean(user)
    }

    // --- link-only sources: never auto-create; unlinked identities must
    // log in another way first and link from the account settings.
    if (!user && provider.behavior.linkOnly) {
      return { user: null, linkOnlyRefused: true }
    }

    // --- profile filter (deny list / allow list + exceptions)
    const access = await checkSsoAccess(provider, profile, email, isExisting)
    if (!access.allowed) {
      return { user: null, accessDenied: { reason: access.reason, rule: access.rule } }
    }

    if (!user) {
      await UserGetter.promises.ensureUniqueEmailAddress(email)
      // Invited-user exception: created as a holding account (see OIDC
      // manager) — no new projects until established.
      user = await UserCreator.promises.createNewUser({
        email: email,
        first_name: firstName,
        last_name: lastName,
        isAdmin: isAdmin,
        holdingAccount: String(access?.reason || '').startsWith('invited-'),
        samlIdentifiers: [{ providerId: provider.id }],
        analyticsId: crypto.randomUUID(),
      })
      await logLoginEntry(user, 'create-account', auditLog)
    }
    if (!identityLinked) {
      // cannot use SAMLIdentityManager.linkAccounts because affiliations service is not there.
      // Upsert THIS provider's identifier: an account found by email may already
      // hold identifiers for other IdPs, and `$set samlIdentifiers.0.*` would
      // corrupt them (multi-IdP deployments).
      const samlIds = Array.isArray(user.samlIdentifiers) ? user.samlIdentifiers : []
      const idx = samlIds.findIndex(s => s && s.providerId === provider.id)
      if (idx >= 0) {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              'emails.0.confirmedAt': Date.now(),
              'emails.0.samlProviderId': provider.id,
              samlIdentifiers: samlIds.map((s, i) =>
                i === idx
                  ? { ...s, externalUserId, userIdAttribute: attrs.userId }
                  : s
              ),
            },
          }
        ).exec()
      } else {
        await User.updateOne(
          { _id: user._id },
          {
            $set: { 'emails.0.confirmedAt': Date.now(), 'emails.0.samlProviderId': provider.id },
            $push: {
              samlIdentifiers: {
                providerId: provider.id,
                externalUserId,
                userIdAttribute: attrs.userId,
              },
            },
          }
        ).exec()
      }
      await logLoginEntry(user, 'link-institution-sso', auditLog, {
        providerId: provider.id,
        externalUserId,
      })
    }

    const before = accountBeforeLogin(user)
    const userDetails = behavior.updateUserDetailsOnLogin
      ? { first_name: firstName, last_name: lastName }
      : {}
    if (attrs.admin?.field && attrs.admin?.values?.length) {
      user.isAdmin = isAdmin
      userDetails.isAdmin = isAdmin
    }
    const result = await User.updateOne(
      { _id: user._id, loginEpoch: user.loginEpoch },
      {
        $inc: { loginEpoch: 1 },
        $set: userDetails,
        $unset: { hashedPassword: '' },
      },
    ).exec()

    if (result.modifiedCount !== 1) {
      throw new ParallelLoginError()
    }
    if (before.hasPassword) {
      await logLoginEntry(user, 'remove-password', auditLog)
    }
    await logLoginChanges(user, before, userDetails, auditLog)
    return { user }
  },
}

export default {
  promises: SAMLAuthenticationManager,
}
