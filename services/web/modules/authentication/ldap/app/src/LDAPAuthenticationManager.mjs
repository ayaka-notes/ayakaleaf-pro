import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import UserCreator from '../../../../../app/src/Features/User/UserCreator.mjs'
import UserGetter from '../../../../../app/src/Features/User/UserGetter.mjs'
import { ParallelLoginError } from '../../../../../app/src/Features/Authentication/AuthenticationErrors.mjs'
import { User } from '../../../../../app/src/models/User.mjs'
import { splitFullName, firstValue } from '../../../utils.mjs'
import {
  accountBeforeLogin,
  logLoginChanges,
  logLoginEntry,
} from '../../../auditLog.mjs'

const LDAPAuthenticationManager = {
  async findOrCreateUser(profile, auditLog) {
    //user is already authenticated in LDAP
    const {
      attEmail,
      attFirstName,
      attLastName,
      attName,
      attAdmin,
      valAdmin,
      updateUserDetailsOnLogin,
    } = Settings.ldap

    const email = Array.isArray(profile[attEmail])
                    ? profile[attEmail][0].toLowerCase()
                    : profile[attEmail].toLowerCase()
    let nameParts = ["",""]
    if ((!attFirstName || !attLastName) && attName) {
      nameParts = splitFullName(firstValue(profile[attName]) || "")
    }
    const firstName = attFirstName ? (firstValue(profile[attFirstName]) || "") : nameParts[0]
    let   lastName  = attLastName  ? (firstValue(profile[attLastName])  || "") : nameParts[1]
    if (!firstName && !lastName) lastName = email
    let isAdmin = false
    if( attAdmin && valAdmin ) {
      isAdmin = Array.isArray(profile[attAdmin]) ? profile[attAdmin].includes(valAdmin) :
                                                   profile[attAdmin] === valAdmin
    }
    let user = await User.findOne({ 'email': email }).exec()

    if( !user ) {
      await UserGetter.promises.ensureUniqueEmailAddress(email)
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
      await User.updateOne(
        { _id: user._id },
        { $set : { 'emails.0.confirmedAt' : Date.now() } }
      ).exec() //email of ldap user is confirmed
      await logLoginEntry(user, 'create-account', auditLog)
    }
    const before = accountBeforeLogin(user)
    let userDetails = updateUserDetailsOnLogin ? { first_name : firstName, last_name: lastName } : {}
    if( attAdmin && valAdmin ) {
      user.isAdmin = isAdmin
      userDetails.isAdmin = isAdmin
    }
    const result = await User.updateOne(
      { _id: user._id, loginEpoch: user.loginEpoch },
      {
        $inc: { loginEpoch: 1 },
        $set: userDetails,
        $unset: { hashedPassword: "" },
      }
    ).exec()
    if (result.modifiedCount !== 1) {
      throw new ParallelLoginError()
    }
    if (before.hasPassword) {
      await logLoginEntry(user, 'remove-password', auditLog)
    }
    await logLoginChanges(user, before, userDetails, auditLog)
    return user
  },
}

export default {
  promises: LDAPAuthenticationManager,
}
