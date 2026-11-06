import logger from '@overleaf/logger'
import SessionManager from '../../app/src/Features/Authentication/SessionManager.mjs'
import UserAuditLogHandler from '../../app/src/Features/User/UserAuditLogHandler.mjs'
import { User } from '../../app/src/models/User.mjs'

// What an SSO login does to an account goes on its audit log: nobody but the
// IdP asked for it, so the account itself is the initiator. A log that cannot
// be written must not stop the login, as for core's failed-password-match.
export async function logLoginEntry(user, operation, auditLog, info) {
  try {
    await UserAuditLogHandler.promises.addEntry(
      user._id,
      operation,
      user._id,
      auditLog.ipAddress,
      { ...auditLog.info, ...info }
    )
  } catch (err) {
    logger.error({ err, userId: user._id, operation }, 'failed to log an SSO login')
  }
}

// What the login may change, read before it does
export function accountBeforeLogin(user) {
  return {
    isAdmin: Boolean(user.isAdmin),
    firstName: user.first_name,
    lastName: user.last_name,
    hasPassword: Boolean(user.hashedPassword),
  }
}

// The details a login wrote: the admin flag and the name, when the settings
// let the IdP keep them in sync
export async function logLoginChanges(user, before, details, auditLog) {
  if (details.isAdmin != null && details.isAdmin !== before.isAdmin) {
    await logLoginEntry(user, 'change-admin-access', auditLog, {
      isAdmin: details.isAdmin,
    })
  }
  // the IdP may send only one of them
  const firstNameChanged =
    details.first_name != null && details.first_name !== before.firstName
  const lastNameChanged =
    details.last_name != null && details.last_name !== before.lastName
  if (firstNameChanged || lastNameChanged) {
    await logLoginEntry(user, 'change-name', auditLog, {
      firstName: details.first_name,
      lastName: details.last_name,
    })
  }
}

// As core's doLogout, which is private
export function logLogout(req) {
  const user = SessionManager.getSessionUser(req.session)
  if (user != null) {
    UserAuditLogHandler.addEntryInBackground(
      user._id,
      'logout',
      user._id,
      req.ip,
      {}
    )
  }
}

// A wrong password, as for a local account. The form may hold a username, which
// says nothing about the account without a successful bind: only an email can
// be logged.
export async function logFailedLdapLogin(req) {
  const { login } = req.body
  if (typeof login !== 'string') return
  try {
    const user = await User.findOne(
      { email: login.trim().toLowerCase() },
      { _id: 1 }
    ).lean()
    if (user) {
      await logLoginEntry(user, 'failed-password-match', {
        ipAddress: req.ip,
        info: { method: 'LDAP password login' },
      })
    }
  } catch (err) {
    logger.error({ err }, 'failed to log a failed LDAP login')
  }
}
