import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { expressify, promiseMapWithLimit } from '@overleaf/promise-utils'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { DeletedUser } from '../../../../app/src/models/DeletedUser.mjs'
import { DeletedProject } from '../../../../app/src/models/DeletedProject.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import AuthenticationManager from '../../../../app/src/Features/Authentication/AuthenticationManager.mjs'
import HaveIBeenPwned from '../../../../app/src/Features/Authentication/HaveIBeenPwned.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import OwnershipTransferHandler from '../../../../app/src/Features/Collaborators/OwnershipTransferHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import Errors, { OError } from '../../../../app/src/Features/Errors/Errors.js'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import EmailHelper from '../../../../app/src/Features/Helpers/EmailHelper.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import OneTimeTokenHandler from '../../../../app/src/Features/Security/OneTimeTokenHandler.mjs'
import TagsHandler from '../../../../app/src/Features/Tags/TagsHandler.mjs'
import UserDeleter from '../../../../app/src/Features/User/UserDeleter.mjs'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import UserSessionsManager from '../../../../app/src/Features/User/UserSessionsManager.mjs'
import UserUpdater from '../../../../app/src/Features/User/UserUpdater.mjs'
import {
  getTokenUsage,
  resetTokenUsage,
} from '../../../workbench/app/src/TokenQuota.mjs'
import { adminOf, logOnAdmin, logOnUser } from './AdminAuditLog.mjs'
import { userIdOr404 } from './AdminUserListsController.mjs'

// What an admin does to an account: creating and activating it, editing it,
// giving its projects away, deleting, restoring and purging it, and its AI
// usage. The audit log tells which admin did it.

const ONE_WEEK_IN_SECONDS = 7 * 24 * 60 * 60
const MAX_COMPILE_TIMEOUT = 600
const TRANSFER_TAG_COLOR = '#434AF0'

const userIdOf = (req, res) => userIdOr404(req, res)?.toString()

const refuse = (req, res, message) =>
  HttpErrorHandler.unprocessableEntity(req, res, message)

// The page is core's user-activate module: an activation is a password reset
// on an account that was given a random password.
function activationUrl(token, userId) {
  return `${Settings.siteUrl}/user/activate?token=${token}&user_id=${userId}`
}

// ---- creating and activating ----

async function emailActivationLink(userId) {
  const user = await User.findById(userId, { email: 1 }).lean()
  if (!user) {
    throw new OError('User does not exist, cannot send activation email', {
      userId,
    })
  }
  const token = await OneTimeTokenHandler.promises.getNewToken(
    'password',
    { user_id: userId, email: user.email },
    { expiresIn: ONE_WEEK_IN_SECONDS }
  )
  await EmailHandler.promises.sendEmail('registered', {
    to: user.email,
    setNewPasswordUrl: activationUrl(token, userId),
  })
}

async function register(req, res, details) {
  try {
    return await UserRegistrationHandler.promises.registerNewUser(details)
  } catch (err) {
    if (err.message === 'EmailAlreadyRegistered') {
      HttpErrorHandler.conflict(req, res, 'email_already_registered')
    } else if (err.message === 'InvalidEmailError') {
      refuse(req, res, 'email_address_is_invalid')
    } else if (err.message === 'InvalidPasswordError') {
      refuse(req, res, 'try_again')
    } else {
      throw OError.tag(err, 'error user registration', {
        email: details.email,
      })
    }
    return null
  }
}

async function createUser(req, res) {
  const { email, first_name, last_name, isAdmin, isExternal } = req.body
  if (email == null || email === '') {
    return refuse(req, res, 'Email address is empty')
  }

  const user = await register(req, res, {
    email,
    first_name,
    last_name,
    password: crypto.randomBytes(32).toString('hex'),
    analyticsId: crypto.randomUUID(),
  })
  if (!user) return

  const reversedHostname = user.email.split('@')[1].split('').reverse().join('')
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        isAdmin,
        emails: [{ email, reversedHostname, confirmedAt: Date.now() }],
      },
      // an external account logs in through SSO only
      ...(isExternal && { $unset: { hashedPassword: '' } }),
    }
  ).exec()

  // The account exists by now, a failed email must not fail the request: the
  // admin can send it again from the user list
  if (!isExternal) {
    await emailActivationLink(user._id.toString()).catch(err => {
      logger.warn(
        { err, userId: user._id },
        'failed to send activation email to new user'
      )
    })
  }
  await logOnUser(req, user._id, 'create-account', {
    isAdmin: Boolean(isAdmin),
    isExternal: Boolean(isExternal),
  })
  res.json({ user: { id: user._id.toString(), email: user.email } })
}

async function sendActivationEmail(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return
  try {
    await emailActivationLink(userId)
  } catch (err) {
    logger.warn({ err, userId }, 'failed to send activation email')
    return refuse(req, res, 'Error sending activation email')
  }
  await logOnUser(req, userId, 'send-activation-email')
  res.sendStatus(200)
}

// The link of the activation still waiting, if there is one
async function activationLink(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return
  const token = await db.tokens.findOne({
    use: 'password',
    'data.user_id': userId,
    expiresAt: { $gt: new Date() },
    usedAt: { $exists: false },
    peekCount: { $not: { $gte: OneTimeTokenHandler.MAX_PEEKS } },
  })
  res.json({ activationLink: token && activationUrl(token.token, userId) })
}

// ---- editing ----

// Why the request cannot be applied at all, before anything changes
function updateProblem(updates, isOwnAccount) {
  const { suspended, isAdmin, aiFeatures, features } = updates
  if (isOwnAccount && (suspended === true || isAdmin === false)) {
    return 'You cannot disable your own account or remove your own admin rights'
  }
  if (
    'aiFeatures' in updates &&
    (typeof aiFeatures?.enabled !== 'boolean' ||
      Object.keys(aiFeatures).some(key => key !== 'enabled'))
  ) {
    return 'invalid_ai_features'
  }
  if (features && typeof features === 'object') {
    const { collaborators, compileTimeout } = features
    if (
      'collaborators' in features &&
      (!Number.isInteger(collaborators) || collaborators < -1)
    ) {
      return 'invalid_collaborators'
    }
    if (
      'compileTimeout' in features &&
      (!Number.isInteger(compileTimeout) ||
        compileTimeout <= 0 ||
        compileTimeout > MAX_COMPILE_TIMEOUT)
    ) {
      return 'invalid_compile_timeout'
    }
  }
  return null
}

async function passwordProblem(user, password) {
  // an account without a local password logs in through SSO only
  if (!user.hashedPassword) {
    return 'This account logs in through SSO and cannot have a password'
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long'
  }
  const isReused = await HaveIBeenPwned.promises
    .checkPasswordForReuse(password)
    .catch(err => {
      logger.warn({ err }, 'Failed to check password against HaveIBeenPwned')
      return false
    })
  return isReused
    ? 'Password is too common, please choose a different one'
    : null
}

// Changes the email, or answers why not: true when the request has an answer
async function changeEmailOrAnswer(req, res, userId, newEmail, actorId) {
  if (!EmailHelper.parseEmail(newEmail)) {
    refuse(req, res, req.i18n.translate('email_address_is_invalid'))
    return true
  }
  try {
    await UserUpdater.promises.changeEmailAddress(userId, newEmail, {
      initiatorId: actorId,
      ipAddress: req.ip,
    })
  } catch (err) {
    if (err instanceof Errors.EmailExistsError) {
      const message = req.i18n.translate('email_already_registered')
      HttpErrorHandler.conflict(req, res, message)
    } else {
      HttpErrorHandler.legacyInternal(
        req,
        res,
        req.i18n.translate('problem_changing_email_address'),
        OError.tag(err, 'problem changing email address', { userId, newEmail })
      )
    }
    return true
  }
  return false
}

// The document changes of the plain fields
function fieldChanges(user, fields) {
  const changes = {}
  for (const [key, value] of Object.entries(fields)) {
    const newValue = typeof value === 'string' ? value.trim() : value
    // disabling goes through core below, which also ends the sessions
    if (newValue === user[key] || (key === 'suspended' && newValue === true)) {
      continue
    }
    changes[key] = newValue
  }
  return changes
}

async function disableUser(req, userId, actorId) {
  await UserUpdater.promises.suspendUser(userId, {
    initiatorId: actorId,
    ip: req.ip,
  })
  // Close the editors the user has open, as when removed from a project
  const projects = await ProjectGetter.promises.findAllUsersProjects(
    userId,
    '_id'
  )
  for (const project of Object.values(projects).flat()) {
    EditorRealTimeController.emitToRoom(
      project._id,
      'userRemovedFromProject',
      userId
    )
  }
}

// One entry per kind of change; core logs the new email and disabling itself
async function logChanges(req, userId, requestedFeatures, changes) {
  const {
    hashedPassword,
    first_name: firstName,
    last_name: lastName,
    isAdmin,
    features,
    aiFeatures,
    suspended,
    ...others
  } = changes
  if (hashedPassword) await logOnUser(req, userId, 'update-password')
  if (firstName != null || lastName != null) {
    await logOnUser(req, userId, 'change-name', { firstName, lastName })
  }
  if (isAdmin != null) {
    await logOnUser(req, userId, 'change-admin-access', { isAdmin })
  }
  if (features) {
    await logOnUser(req, userId, 'change-features', requestedFeatures)
  }
  if (aiFeatures) {
    await logOnUser(req, userId, 'change-ai-features', aiFeatures)
  }
  if (suspended === false) {
    await logOnUser(req, userId, 'account-reactivation')
  }
  if (Object.keys(others).length > 0) {
    await logOnUser(req, userId, 'update-user', {
      fields: Object.keys(others),
    })
  }
}

async function updateUser(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return
  const actorId = adminOf(req)
  req.logger.addFields({ actorUserId: actorId })
  const isOwnAccount = userId === actorId

  const { firstName, lastName, ...updates } = req.body
  if ('firstName' in req.body) updates.first_name = firstName
  if ('lastName' in req.body) updates.last_name = lastName

  const problem = updateProblem(updates, isOwnAccount)
  if (problem) return refuse(req, res, problem)

  const { email, password, features, ...fields } = updates
  const user = await User.findById(userId, {
    ...Object.fromEntries(Object.keys(updates).map(key => [key, 1])),
    ...(password != null && { hashedPassword: 1 }),
  }).exec()
  if (!user) return ErrorController.notFound(req, res)

  const changes = fieldChanges(user, fields)
  if (features && typeof features === 'object') {
    changes.features = { ...(user.features ?? {}), ...features }
  }
  // an empty password field leaves the password as it is
  if (password != null && password !== '') {
    const refusal = await passwordProblem(user, password)
    if (refusal) return refuse(req, res, refusal)
    changes.hashedPassword =
      await AuthenticationManager.promises.hashPassword(password)
  }

  const newEmail = email?.trim().toLowerCase()
  const emailChanges = newEmail != null && newEmail !== user.email
  if (emailChanges) {
    const answered = await changeEmailOrAnswer(
      req,
      res,
      userId,
      newEmail,
      actorId
    )
    if (answered) return
  }

  const disabling = fields.suspended === true && user.suspended !== true
  Object.assign(user, changes)
  await user.save().catch(err => {
    throw OError.tag(err, 'problem updating user settings', { userId })
  })
  if (disabling) await disableUser(req, userId, actorId)
  await logChanges(req, userId, features, changes)

  // a new password ends what the old one opened, as when the user changes it
  if (changes.hashedPassword) {
    await UserSessionsManager.promises.removeSessionsFromRedis(
      { _id: userId },
      isOwnAccount ? req.sessionID : undefined
    )
    await OneTimeTokenHandler.promises.expireAllTokensForUser(
      userId,
      'password'
    )
  }

  if (isOwnAccount) {
    SessionManager.setInSessionUser(req.session, {
      ...(emailChanges && { email: newEmail }),
      ...(changes.first_name != null && { first_name: changes.first_name }),
      ...(changes.last_name != null && { last_name: changes.last_name }),
    })
  }

  // the fields that changed, under the names the panel uses
  const { hashedPassword, first_name, last_name, ...answer } = changes
  res.json({
    ...answer,
    ...(first_name != null && { firstName: first_name }),
    ...(last_name != null && { lastName: last_name }),
    ...(emailChanges && { email: newEmail }),
    ...(disabling && { suspended: true }),
  })
}

// ---- giving the projects away ----

// Core's transferAllProjectsToUser (a tag "transferred-from-<email>" for the
// new owner, no emails), which does not tell who did it to each project's log
async function transferAllProjects(req, fromUserId, toUserId) {
  const [fromUser, toUser] = await Promise.all([
    User.findById(fromUserId, { email: 1 }).lean(),
    User.exists({ _id: toUserId }),
  ])
  if (!fromUser || !toUser || fromUserId === toUserId) {
    throw new OError('invalid transfer of projects', { fromUserId, toUserId })
  }
  const projects = await Project.find(
    { owner_ref: fromUserId },
    { _id: 1 }
  ).lean()
  const tag = await TagsHandler.promises.createTag(
    toUserId,
    `transferred-from-${fromUser.email}`,
    TRANSFER_TAG_COLOR,
    { truncate: true }
  )
  await TagsHandler.promises.addProjectsToTag(
    toUserId,
    tag._id,
    projects.map(project => project._id)
  )
  await promiseMapWithLimit(5, projects, project =>
    OwnershipTransferHandler.promises.transferOwnership(project._id, toUserId, {
      allowTransferToNonCollaborators: true,
      skipEmails: true,
      ipAddress: req.ip,
      sessionUserId: adminOf(req),
    })
  )
  await logOnUser(req, fromUserId, 'transfer-projects', {
    toUserId,
    projectCount: projects.length,
  })
  return projects.length
}

// every project the user owns to another user, without deleting the user
async function transferProjects(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return
  const { toUserId } = req.body
  if (
    typeof toUserId !== 'string' ||
    !/^[0-9a-f]{24}$/i.test(toUserId) ||
    userId === toUserId.toLowerCase()
  ) {
    return refuse(req, res, 'invalid toUserId')
  }
  const [from, to] = await Promise.all([
    User.exists({ _id: userId }),
    User.exists({ _id: toUserId }),
  ])
  if (!from || !to) return ErrorController.notFound(req, res)
  res.json({ projectCount: await transferAllProjects(req, userId, toUserId) })
}

// ---- deleting, restoring and purging ----

async function deleteUser(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return
  const deleterId = adminOf(req)
  const { sendEmail, toUserId } = req.body

  // The list greys Delete out on the own account, refuse a direct request too
  if (userId === deleterId) {
    return refuse(req, res, 'You cannot delete your own account')
  }

  if (toUserId) {
    try {
      await transferAllProjects(req, userId, toUserId)
    } catch (err) {
      logger.warn({ err, userId, toUserId }, 'failed to transfer the projects')
      return refuse(req, res, 'Failed to transfer projects ownership')
    }
  }

  try {
    await UserDeleter.promises.deleteUser(userId, {
      deleterUser: { _id: deleterId },
      ipAddress: req.ip,
      skipEmail: !sendEmail,
      // a failed email must not stop the deletion halfway: by then the user's
      // projects are already deleted
      force: true,
    })
  } catch (err) {
    logger.warn({ err, deleterId, userId }, 'failed to delete the user')
    return refuse(
      req,
      res,
      'Something went wrong. Does the account still exist?'
    )
  }

  const deletedUser = await DeletedUser.findOne(
    { 'user._id': userId },
    { 'deleterData.deletedAt': 1 }
  ).lean()
  res.json({ deletedAt: deletedUser.deleterData.deletedAt })
}

async function purgeDeletedUser(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return
  const deleted = await DeletedUser.findOne(
    { 'user._id': userId },
    { 'user.email': 1 }
  ).lean()
  try {
    await UserDeleter.promises.expireDeletedUser(userId)
  } catch (err) {
    logger.warn({ err, userId }, 'failed to purge the deleted user')
    return refuse(
      req,
      res,
      'Something went wrong. The user is already deleted?'
    )
  }
  await logOnAdmin(req, 'purge-deleted-user', {
    userId,
    email: deleted?.user?.email,
  })
  res.sendStatus(200)
}

async function restoreDeletedUser(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return

  const deleted = await DeletedUser.findOne({ 'user._id': userId }).lean()
  const userData = deleted?.user
  if (!userData) {
    return refuse(req, res, 'Something went wrong. The user is purged?')
  }
  if (await User.exists({ email: userData.email })) {
    const message = req.i18n.translate('email_already_registered')
    return HttpErrorHandler.conflict(req, res, message)
  }

  try {
    await User.create({
      ...userData,
      suspended: false,
      // users deleted before the analyticsId back-fill migration have none
      analyticsId: userData.analyticsId ?? userData._id.toString(),
    })
    await DeletedUser.deleteOne({ 'user._id': userId })
  } catch (err) {
    return HttpErrorHandler.legacyInternal(
      req,
      res,
      req.i18n.translate('generic_something_went_wrong'),
      OError.tag(err, 'problem restoring deleted user', { userId })
    )
  }

  // the account is back; a project that cannot return must not undo that
  try {
    const projects = await DeletedProject.find({
      'project.owner_ref': userId,
    }).exec()
    await promiseMapWithLimit(5, projects, project =>
      ProjectDeleter.promises.undeleteProject(
        project.deleterData.deletedProjectId,
        { suffix: '' }
      )
    )
  } catch (err) {
    logger.warn({ err, userId }, 'failed to restore the projects of the user')
  }

  await logOnUser(req, userId, 'restore-account')
  res.json({ restoredId: userData._id.toString(), email: userData.email })
}

// ---- AI usage ----

async function aiUsage(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return
  if (!(await User.exists({ _id: userId }))) {
    return ErrorController.notFound(req, res)
  }
  res.set('Cache-Control', 'no-store')
  res.json(await getTokenUsage(userId))
}

async function resetAiUsage(req, res) {
  const userId = userIdOf(req, res)
  if (!userId) return
  if (!(await User.exists({ _id: userId }))) {
    return ErrorController.notFound(req, res)
  }
  await resetTokenUsage(userId)
  await logOnUser(req, userId, 'reset-ai-usage')
  res.json(await getTokenUsage(userId))
}

export default {
  createUser: expressify(createUser),
  sendActivationEmail: expressify(sendActivationEmail),
  activationLink: expressify(activationLink),
  updateUser: expressify(updateUser),
  transferProjects: expressify(transferProjects),
  deleteUser: expressify(deleteUser),
  purgeDeletedUser: expressify(purgeDeletedUser),
  restoreDeletedUser: expressify(restoreDeletedUser),
  aiUsage: expressify(aiUsage),
  resetAiUsage: expressify(resetAiUsage),
}
