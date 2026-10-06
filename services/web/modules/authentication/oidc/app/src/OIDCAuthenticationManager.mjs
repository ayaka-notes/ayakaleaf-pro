import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import UserCreator from '../../../../../app/src/Features/User/UserCreator.mjs'
import ThirdPartyIdentityManager from '../../../../../app/src/Features/User/ThirdPartyIdentityManager.mjs'
import { ParallelLoginError } from '../../../../../app/src/Features/Authentication/AuthenticationErrors.mjs'
import { User } from '../../../../../app/src/models/User.mjs'

const OIDCAuthenticationManager = {
  async findOrCreateUser(profile, auditLog) {
    const {
      attUserId,
      attAdmin,
      valAdmin,
      updateUserDetailsOnLogin,
      providerId,
    } = Settings.oidc
    const email = profile.emails[0].value
    const oidcUserId = (attUserId === 'email') ? email : profile[attUserId]
    const firstName = profile.name?.givenName || ""
    const lastName  = profile.name?.familyName || ""
    let isAdmin = false
    if (attAdmin && valAdmin) {
      if (attAdmin === 'email') {
        isAdmin = (email === valAdmin)
      } else {
        const adminClaim = profile[attAdmin] ?? profile._json?.[attAdmin]
        isAdmin = Array.isArray(adminClaim)
          ? adminClaim.includes(valAdmin)
          : adminClaim === valAdmin
      }
    }
    const oidcUserData = null // Possibly it can be used later
    let user
    try {
      user = await ThirdPartyIdentityManager.promises.login(providerId, oidcUserId, oidcUserData)
    } catch {
// A user with the specified OIDC ID and provider ID is not found. Search for a user with the given email.
// If no user exists with this email, create a new user and link the OIDC account to it (provided this is allowed by allowedOIDCEmailDomains).
// If a user exists but no account from the specified OIDC provider is linked to this user, link the OIDC account to this user.
// If an account from the specified provider is already linked to this user, unlink it, and link the OIDC account to this user.
// (Is it safe? Concider: If an account from the specified provider is already linked to this user, throw an error)
      user = await User.findOne({ 'email': email }).exec()
      if (!user) {
        const allowedDomains = Settings.oidc.allowedOIDCEmailDomains
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
          return null
        }
        user = await UserCreator.promises.createNewUser(
          {
            email: email,
            first_name: firstName,
            last_name: lastName,
            isAdmin: isAdmin,
            holdingAccount: false,
            analyticsId: crypto.randomUUID(),
          }
        )
      }
//    const alreadyLinked = user.thirdPartyIdentifiers.some(item => item.providerId === providerId)
//    if (!alreadyLinked) {
        auditLog.initiatorId = user._id
        await ThirdPartyIdentityManager.promises.link(user._id, providerId, oidcUserId, oidcUserData, auditLog)
        await User.updateOne(
          { _id: user._id },
          { $set : {
             'emails.0.confirmedAt': Date.now(), //email of external user is confirmed
            },
          }
        ).exec()
//    } else {
//      throw new Error(`Overleaf user ${user.email} is already linked to another ${providerId} user`)
//    }
    }

    let userDetails = updateUserDetailsOnLogin ? { first_name : firstName, last_name: lastName } : {}
    if (attAdmin && valAdmin) {
      user.isAdmin = isAdmin
      userDetails.isAdmin = isAdmin
    }
    const result = await User.updateOne(
      { _id: user._id, loginEpoch: user.loginEpoch }, { $inc: { loginEpoch: 1 }, $set: userDetails },
      {}
    ).exec()

    if (result.modifiedCount !== 1) {
      throw new ParallelLoginError()
    }
    return user
  },
  async linkAccount(userId, profile, auditLog) {
    const {
      attUserId,
      providerId,
    } = Settings.oidc
    const oidcUserId = (attUserId === 'email') ? profile.emails[0].value : profile[attUserId]
    const oidcUserData = null // Possibly it can be used later
    await ThirdPartyIdentityManager.promises.link(userId, providerId, oidcUserId, oidcUserData, auditLog)
  },
}

export default {
  promises: OIDCAuthenticationManager,
}
