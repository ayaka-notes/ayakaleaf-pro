import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import _ from 'lodash'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { listUserEntries } from './AdminAuditLog.mjs'
import AdminProjectManager from './AdminProjectManager.mjs'
import {
  adminOf,
  adminRoute,
  idParam,
  sendFresh,
} from './AdminRequestHelper.mjs'
import AdminUserListManager from './AdminUserListManager.mjs'
import AdminUserManager from './AdminUserManager.mjs'

// The /admin/user routes: the user list and a user's page.

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const USERS_VIEW = Path.resolve(__dirname, '../views/admin-users')
const USER_VIEW = Path.resolve(__dirname, '../views/admin-user')

// the id as the session keeps it, to tell the admin's own account
const userIdOf = req => idParam(req, 'userId').toString()

// ---- the user list ----

async function usersPage(req, res) {
  const { initialResult, ...options } = await AdminUserListManager.getUsersPage(
    req.query
  )
  res.render(USERS_VIEW, {
    title: 'user_management',
    initialResult,
    adminUsersOptions: { sessionUserId: adminOf(req).id, ...options },
  })
}

async function usersJson(req, res) {
  sendFresh(res, await AdminUserListManager.getUserList(req.query))
}

async function createUser(req, res) {
  const user = await AdminUserManager.createUser(req.body, adminOf(req))
  res.json({ user })
}

// ---- a user's page ----

async function userPage(req, res) {
  const adminUser = await AdminUserListManager.getUserPage(
    idParam(req, 'userId')
  )
  const sessionUserId = adminOf(req).id
  res.render(USER_VIEW, {
    title: 'user_management',
    adminUser: { ...adminUser, sessionUserId },
    adminUsersOptions: { sessionUserId },
  })
}

async function projectsJson(req, res) {
  const list = await AdminProjectManager.getUserProjectList(
    idParam(req, 'userId'),
    req.query
  )
  sendFresh(res, list)
}

async function auditLogJson(req, res) {
  sendFresh(res, await listUserEntries(idParam(req, 'userId'), req.query))
}

async function clearSessions(req, res) {
  const sessions = await AdminUserManager.clearSessions(
    userIdOf(req),
    adminOf(req)
  )
  res.json({ sessions })
}

async function aiUsage(req, res) {
  sendFresh(res, await AdminUserManager.getAiUsage(userIdOf(req)))
}

async function resetAiUsage(req, res) {
  res.json(await AdminUserManager.resetAiUsage(userIdOf(req), adminOf(req)))
}

// ---- what happens to an account ----

async function activationLink(req, res) {
  const link = await AdminUserManager.getActivationLink(userIdOf(req))
  res.json({ activationLink: link })
}

async function sendActivationEmail(req, res) {
  res.json(
    await AdminUserManager.sendActivationEmail(userIdOf(req), adminOf(req))
  )
}

async function sendPasswordReset(req, res) {
  res.json(
    await AdminUserManager.sendPasswordReset(userIdOf(req), adminOf(req))
  )
}

async function updateUser(req, res) {
  const userId = userIdOf(req)
  const admin = adminOf(req)
  req.logger.addFields({ actorUserId: admin.id })

  const changed = await AdminUserManager.updateUser(userId, req.body, admin)

  // the session keeps a copy of the own email and name, as on the settings page
  if (userId === admin.id) {
    const { email, firstName, lastName } = changed
    SessionManager.setInSessionUser(
      req.session,
      _.omitBy(
        { email, first_name: firstName, last_name: lastName },
        _.isUndefined
      )
    )
  }
  res.json(changed)
}

async function removeEmail(req, res) {
  await AdminUserManager.removeEmail(
    userIdOf(req),
    req.body.email,
    adminOf(req)
  )
  res.sendStatus(204)
}

async function transferProjects(req, res) {
  const projectCount = await AdminUserManager.transferProjects(
    userIdOf(req),
    req.body.toUserId,
    adminOf(req)
  )
  res.json({ projectCount })
}

async function deleteUser(req, res) {
  const deletedAt = await AdminUserManager.deleteUser(
    userIdOf(req),
    req.body,
    adminOf(req)
  )
  res.json({ deletedAt })
}

async function restoreDeletedUser(req, res) {
  res.json(
    await AdminUserManager.restoreDeletedUser(userIdOf(req), adminOf(req))
  )
}

async function purgeDeletedUser(req, res) {
  await AdminUserManager.purgeDeletedUser(userIdOf(req), adminOf(req))
  res.sendStatus(200)
}

export default {
  usersPage: adminRoute(usersPage),
  usersJson: adminRoute(usersJson),
  createUser: adminRoute(createUser),
  userPage: adminRoute(userPage),
  projectsJson: adminRoute(projectsJson),
  auditLogJson: adminRoute(auditLogJson),
  clearSessions: adminRoute(clearSessions),
  aiUsage: adminRoute(aiUsage),
  resetAiUsage: adminRoute(resetAiUsage),
  activationLink: adminRoute(activationLink),
  sendActivationEmail: adminRoute(sendActivationEmail),
  sendPasswordReset: adminRoute(sendPasswordReset),
  updateUser: adminRoute(updateUser),
  removeEmail: adminRoute(removeEmail),
  transferProjects: adminRoute(transferProjects),
  deleteUser: adminRoute(deleteUser),
  restoreDeletedUser: adminRoute(restoreDeletedUser),
  purgeDeletedUser: adminRoute(purgeDeletedUser),
}
