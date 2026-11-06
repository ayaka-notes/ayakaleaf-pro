import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ProjectAuditLogHandler from '../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs'
import UserAuditLogHandler from '../../../../app/src/Features/User/UserAuditLogHandler.mjs'

// What an admin does goes on the log of the account or project it happened
// to, with the admin as the initiator.

const adminOf = req => SessionManager.getLoggedInUserId(req.session)

export function logOnUser(req, userId, operation, info) {
  return UserAuditLogHandler.promises.addEntry(
    userId,
    operation,
    adminOf(req),
    req.ip,
    info
  )
}

export function logOnProject(req, projectId, operation, info) {
  return ProjectAuditLogHandler.promises.addEntry(
    projectId,
    operation,
    adminOf(req),
    req.ip,
    info
  )
}

// What has no log left to go on (a purge deletes it too, a template has none)
// goes on the admin's own log.
export function logOnAdmin(req, operation, info) {
  return logOnUser(req, adminOf(req), operation, info)
}

export { adminOf }
