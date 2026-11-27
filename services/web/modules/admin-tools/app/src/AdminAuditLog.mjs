import { UserAuditLogEntry } from '../../../../app/src/models/UserAuditLogEntry.mjs'
import { ProjectAuditLogEntry } from '../../../../app/src/models/ProjectAuditLogEntry.mjs'
import ProjectAuditLogHandler from '../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs'
import UserAuditLogHandler from '../../../../app/src/Features/User/UserAuditLogHandler.mjs'
import { clampPage, containing, parsePaging } from './AdminQueryHelper.mjs'
import AdminUserListManager from './AdminUserListManager.mjs'

// ---- writing ----

// What an admin does goes on the log of the account or project it happened
// to, with the admin as the initiator.

export function logOnUser(admin, userId, operation, info) {
  return UserAuditLogHandler.promises.addEntry(
    userId,
    operation,
    admin.id,
    admin.ip,
    info
  )
}

export function logOnProject(admin, projectId, operation, info) {
  return ProjectAuditLogHandler.promises.addEntry(
    projectId,
    operation,
    admin.id,
    admin.ip,
    info
  )
}

// What has no log left to go on (a purge deletes it too, a template has none)
// goes on the admin's own log.
export function logOnAdmin(admin, operation, info) {
  return logOnUser(admin, admin.id, operation, info)
}

// Core's cron does this after its own expiry, and skips a record already purged
export function deleteUserEntries(userId) {
  return UserAuditLogEntry.deleteMany({ userId }).exec()
}

// ---- reading ----

function parseEntriesQuery(query) {
  return {
    ...parsePaging(query),
    operation:
      typeof query.operation === 'string' && query.operation !== ''
        ? query.operation
        : 'all',
  }
}

// The header filter counts every operation, so the search applies but not
// the operation picked
function entriesMatch(scope, query, skipOperation) {
  const and = [scope]
  if (query.search) {
    // the table shows change-features as "Change features"
    const operation = containing(query.search.trim().replace(/\s+/g, '-'))
    and.push({
      $or: [{ operation }, { ipAddress: containing(query.search) }],
    })
  }
  if (query.operation !== 'all' && !skipOperation) {
    and.push({ operation: query.operation })
  }
  return { $and: and }
}

// A user's or a project's log: both collections hold the same fields
// (operation, initiatorId, ipAddress, timestamp, info)
async function listEntries(Model, scope, rawQuery) {
  const query = parseEntriesQuery(rawQuery)
  const match = entriesMatch(scope, query)
  const [total, operations] = await Promise.all([
    Model.countDocuments(match),
    Model.aggregate([
      { $match: entriesMatch(scope, query, true) },
      { $group: { _id: '$operation', n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ])
  const page = clampPage(query.page, total, query.pageSize)
  const entries = await Model.find(match)
    .sort({ timestamp: -1, _id: -1 })
    .skip((page - 1) * query.pageSize)
    .limit(query.pageSize)
    .lean()
    .exec()

  // the initiator can be a deleted user too, as in the lists
  const personOf = await AdminUserListManager.ownersOf(
    entries.map(entry => entry.initiatorId)
  )

  return {
    total,
    page,
    query: { ...query, page },
    counts: {
      all: operations.reduce((sum, op) => sum + op.n, 0),
      operations: operations.map(op => ({ operation: op._id, count: op.n })),
    },
    entries: entries.map(entry => ({
      operation: entry.operation,
      timestamp: entry.timestamp,
      initiatorId: entry.initiatorId?.toString(),
      initiatorEmail: personOf(entry.initiatorId).email,
      ipAddress: entry.ipAddress,
      info: entry.info,
    })),
  }
}

export function listUserEntries(userId, query) {
  return listEntries(UserAuditLogEntry, { userId }, query)
}

export function listProjectEntries(projectId, query) {
  return listEntries(ProjectAuditLogEntry, { projectId }, query)
}
