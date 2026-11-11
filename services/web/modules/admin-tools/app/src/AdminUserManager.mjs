import crypto from 'node:crypto'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { promiseMapWithLimit } from '@overleaf/promise-utils'
import { fromZodError } from 'zod-validation-error'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import { z } from '../../../../app/src/infrastructure/Validation.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { DeletedUser } from '../../../../app/src/models/DeletedUser.mjs'
import { DeletedProject } from '../../../../app/src/models/DeletedProject.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import AuthenticationManager from '../../../../app/src/Features/Authentication/AuthenticationManager.mjs'
import HaveIBeenPwned from '../../../../app/src/Features/Authentication/HaveIBeenPwned.mjs'
import OwnershipTransferHandler from '../../../../app/src/Features/Collaborators/OwnershipTransferHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import Errors, { OError } from '../../../../app/src/Features/Errors/Errors.js'
import EmailHelper from '../../../../app/src/Features/Helpers/EmailHelper.mjs'
import { DeletedProjectReasons } from '../../../../app/src/Features/Project/DeletedProjectReasons.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import OneTimeTokenHandler from '../../../../app/src/Features/Security/OneTimeTokenHandler.mjs'
import TagsHandler from '../../../../app/src/Features/Tags/TagsHandler.mjs'
import UserDeleter from '../../../../app/src/Features/User/UserDeleter.mjs'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import UserSessionsManager from '../../../../app/src/Features/User/UserSessionsManager.mjs'
import UserSessionsRedis from '../../../../app/src/Features/User/UserSessionsRedis.mjs'
import UserUpdater from '../../../../app/src/Features/User/UserUpdater.mjs'
import {
  getTokenUsage,
  resetTokenUsage,
} from '../../../workbench/app/src/TokenQuota.mjs'
import { rememberAdminFeatures } from './AdminFeatures.mjs'
import {
  deleteUserEntries,
  logOnAdmin,
  logOnProject,
  logOnUser,
} from './AdminAuditLog.mjs'
import { FailedError, InvalidEmailError, RefusedError } from './AdminErrors.mjs'
import { isObjectId } from './AdminQueryHelper.mjs'
import AdminUserListManager from './AdminUserListManager.mjs'

// What an admin does to an account: creating and activating it, editing it,
// giving its projects away, deleting, restoring and purging it, its sessions
// and its AI usage. The audit log tells which admin did it.

const ONE_WEEK_IN_SECONDS = 7 * 24 * 60 * 60
const MAX_COMPILE_TIMEOUT = 600
// core's User model holds at most this; its settings page checks the same
const nameField = z.string().max(255).optional()
const TRANSFER_TAG_COLOR = '#434AF0'

async function assertUserExists(userId) {
  if (!(await User.exists({ _id: userId }))) {
    throw new Errors.NotFoundError('user not found')
  }
}

// ---- links to set a password ----

// The page is core's user-activate module: an activation is a password reset
// on an account that was given a random password.
function activationUrl(token, userId) {
  return `${Settings.siteUrl}/user/activate?token=${token}&user_id=${userId}`
}

// core's reset page, as its reset email links it
function passwordResetUrl(token, email) {
  return `${Settings.siteUrl}/user/password/set?passwordResetToken=${token}&email=${encodeURIComponent(email)}`
}

// A new link and its email. The admin gets the link either way, to pass it on:
// a site without email settings sends nothing (core only logs it), and a
// failed email must not cost the link.
async function sendPasswordLink(user, template, tokenOptions, urlOf) {
  const token = await OneTimeTokenHandler.promises.getNewToken(
    'password',
    { user_id: user._id.toString(), email: user.email },
    tokenOptions
  )
  const link = urlOf(token)
  if (!Settings.email?.parameters) return { link, emailSent: false }
  try {
    await EmailHandler.promises.sendEmail(template, {
      to: user.email,
      setNewPasswordUrl: link,
    })
    return { link, emailSent: true }
  } catch (err) {
    logger.warn({ err, userId: user._id }, 'failed to email a password link')
    return { link, emailSent: false }
  }
}

function sendActivationLink(user) {
  return sendPasswordLink(
    user,
    'registered',
    { expiresIn: ONE_WEEK_IN_SECONDS },
    token => activationUrl(token, user._id.toString())
  )
}

function getPasswordLinkUser(userId) {
  return User.findById(userId, {
    email: 1,
    loginCount: 1,
    suspended: 1,
    hashedPassword: 1,
  }).lean()
}

// ---- creating and activating ----

async function registerUser(details) {
  try {
    return await UserRegistrationHandler.promises.registerNewUser(details)
  } catch (err) {
    if (err.message === 'EmailAlreadyRegistered') {
      throw new Errors.EmailExistsError()
    }
    throw OError.tag(err, 'error user registration', { email: details.email })
  }
}

async function createUser(
  { email, first_name, last_name, isAdmin, isExternal },
  admin
) {
  if (!EmailHelper.parseEmail(email)) {
    throw new InvalidEmailError('invalid email')
  }
  const names = z
    .object({ first_name: nameField, last_name: nameField })
    .safeParse({ first_name, last_name })
  if (!names.success) {
    throw new RefusedError(fromZodError(names.error).message)
  }

  const user = await registerUser({
    email,
    first_name,
    last_name,
    password: crypto.randomBytes(32).toString('hex'),
    analyticsId: crypto.randomUUID(),
  })

  const reversedHostname = user.email.split('@')[1].split('').reverse().join('')
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        isAdmin,
        emails: [
          { email: user.email, reversedHostname, confirmedAt: Date.now() },
        ],
      },
      // an external account logs in through SSO only
      ...(isExternal && { $unset: { hashedPassword: '' } }),
    }
  ).exec()

  // the modal shows the link, as Send activation email does; the admin can
  // send it again from the user list
  const sent = isExternal ? null : await sendActivationLink(user)
  await logOnUser(admin, user._id, 'create-account', {
    isAdmin: Boolean(isAdmin),
    isExternal: Boolean(isExternal),
  })
  return { id: user._id.toString(), email: user.email, ...sent }
}

async function sendActivationEmail(userId, admin) {
  // The list greys it out, refuse a direct request too: the link only works
  // on a local account that never logged in (core's /user/activate sends the
  // others to the login page, and cannot set a password on an SSO account)
  const user = await getPasswordLinkUser(userId)
  if (!user) throw new Errors.NotFoundError('user not found')
  if (user.loginCount > 0 || user.suspended || !user.hashedPassword) {
    throw new RefusedError('This account is not waiting for its activation')
  }
  const sent = await sendActivationLink(user)
  await logOnUser(admin, userId, 'send-activation-email', {
    emailSent: sent.emailSent,
  })
  return sent
}

// A password reset for an account that has logged in, as core's own reset: its
// page, its email, its hour. The admin's own password is changed in place.
async function sendPasswordReset(userId, admin) {
  if (userId === admin.id) {
    throw new RefusedError('You cannot send a reset link to your own account')
  }
  const user = await getPasswordLinkUser(userId)
  if (!user) throw new Errors.NotFoundError('user not found')
  if (!user.loginCount || user.suspended || !user.hashedPassword) {
    throw new RefusedError('This account cannot use a password reset link')
  }
  const sent = await sendPasswordLink(
    user,
    'passwordResetRequested',
    {},
    token => passwordResetUrl(token, user.email)
  )
  await logOnUser(admin, userId, 'send-password-reset-email', {
    emailSent: sent.emailSent,
  })
  return sent
}

// The link of the activation still waiting, if there is one
async function getActivationLink(userId) {
  const token = await db.tokens.findOne({
    use: 'password',
    'data.user_id': userId,
    expiresAt: { $gt: new Date() },
    usedAt: { $exists: false },
    peekCount: { $not: { $gte: OneTimeTokenHandler.MAX_PEEKS } },
  })
  return token && activationUrl(token.token, userId)
}

// ---- editing ----

// What the panel's forms send, and nothing else: the rest of the user document
// is not for them. assertUpdateAllowed has the limits of the numbers
const featureSwitch = z.boolean().optional()
const updateSchema = z.strictObject({
  email: z.string().optional(),
  firstName: nameField,
  lastName: nameField,
  password: z.string().optional(),
  isAdmin: z.boolean().optional(),
  suspended: z.boolean().optional(),
  features: z
    .strictObject({
      collaborators: z.number().optional(),
      compileTimeout: z.number().optional(),
      trackChanges: featureSwitch,
      versioning: featureSwitch,
      symbolPalette: featureSwitch,
      gitBridge: featureSwitch,
      dropbox: featureSwitch,
      github: featureSwitch,
      zotero: featureSwitch,
      mendeley: featureSwitch,
    })
    .optional(),
  aiFeatures: z.strictObject({ enabled: z.boolean() }).optional(),
})

// What an admin cannot change on their own account
const OWN_ACCOUNT_LOCKED = ['suspended', 'isAdmin', 'features', 'aiFeatures']

// Refuses what cannot be applied at all, before anything changes
function assertUpdateAllowed(updates, isOwnAccount) {
  const { features } = updates
  if (isOwnAccount && OWN_ACCOUNT_LOCKED.some(key => key in updates)) {
    throw new RefusedError(
      'You cannot change the access or the features of your own account'
    )
  }
  if (features) {
    const { collaborators, compileTimeout } = features
    // Core reads a limit of 0 as no limit set, which falls back to the default
    if (
      'collaborators' in features &&
      (!Number.isInteger(collaborators) ||
        collaborators < -1 ||
        collaborators === 0)
    ) {
      throw new RefusedError('invalid_collaborators')
    }
    if (
      'compileTimeout' in features &&
      (!Number.isInteger(compileTimeout) ||
        compileTimeout <= 0 ||
        compileTimeout > MAX_COMPILE_TIMEOUT)
    ) {
      throw new RefusedError('invalid_compile_timeout')
    }
  }
}

// A login method keeps these up to date when its settings say so. The account's
// page greys them out; bulk actions and direct requests end up here
function assertNotLockedOnLogin(user, updates) {
  const locked = AdminUserListManager.getLockedOnLogin(user)
  if (
    (locked.isAdmin && 'isAdmin' in updates) ||
    (locked.details && ('first_name' in updates || 'last_name' in updates))
  ) {
    throw new RefusedError(
      'The SSO login of this account keeps this up to date'
    )
  }
}

async function assertPasswordAllowed(user, password) {
  // an account without a local password logs in through SSO only
  if (!user.hashedPassword) {
    throw new RefusedError(
      'This account logs in through SSO and cannot have a password'
    )
  }
  // the rules of core's own password change, with the site's settings
  const invalid = AuthenticationManager.validatePassword(password, user.email)
  if (invalid) throw new RefusedError(invalid.message)
  const isReused = await HaveIBeenPwned.promises
    .checkPasswordForReuse(password)
    .catch(err => {
      logger.warn({ err }, 'Failed to check password against HaveIBeenPwned')
      return false
    })
  if (isReused) {
    throw new RefusedError(
      'Password is too common, please choose a different one'
    )
  }
}

async function changeEmail(userId, newEmail, admin) {
  if (!EmailHelper.parseEmail(newEmail)) {
    throw new InvalidEmailError('invalid email')
  }
  try {
    await UserUpdater.promises.changeEmailAddress(userId, newEmail, {
      initiatorId: admin.id,
      ipAddress: admin.ip,
    })
  } catch (err) {
    if (err instanceof Errors.EmailExistsError) throw err
    throw new FailedError(
      'problem_changing_email_address',
      OError.tag(err, 'problem changing email address', { userId, newEmail })
    )
  }
}

// Frees an address a user kept as a secondary email, e.g. one that stops
// someone's first SSO login. Core logs it with the admin as the initiator.
async function removeEmail(userId, email, admin) {
  // a deleted user: from the copy that a restore brings back, so that it can
  // come back without an email another account uses now
  if (!(await User.exists({ _id: userId }))) {
    const { modifiedCount } = await DeletedUser.updateOne(
      { 'user._id': userId, 'user.email': { $ne: email } },
      { $pull: { 'user.emails': { email } } }
    )
    if (modifiedCount === 0) throw new Errors.NotFoundError('email not found')
    return await logOnUser(admin, userId, 'remove-email', {
      removedEmail: email,
    })
  }
  await UserUpdater.promises.removeEmailAddress(userId, email, {
    initiatorId: admin.id,
    ipAddress: admin.ip,
  })
}

// The document changes of the plain fields
function fieldChanges(user, fields) {
  const changes = {}
  for (const [key, value] of Object.entries(fields)) {
    const newValue = typeof value === 'string' ? value.trim() : value
    // disabling goes through core below, which also ends the sessions; only
    // a disabled account can be enabled (a never disabled one has no field)
    const unchanged =
      key === 'suspended'
        ? !(user.suspended && newValue === false)
        : newValue === user[key]
    if (unchanged) continue
    changes[key] = newValue
  }
  return changes
}

async function disableUser(userId, admin) {
  await UserUpdater.promises.suspendUser(userId, {
    initiatorId: admin.id,
    ip: admin.ip,
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
async function logChanges(admin, userId, requestedFeatures, changes) {
  const {
    hashedPassword,
    first_name: firstName,
    last_name: lastName,
    isAdmin,
    features,
    aiFeatures,
    suspended,
  } = changes
  if (hashedPassword) await logOnUser(admin, userId, 'update-password')
  if (firstName != null || lastName != null) {
    await logOnUser(admin, userId, 'change-name', { firstName, lastName })
  }
  if (isAdmin != null) {
    await logOnUser(admin, userId, 'change-admin-access', { isAdmin })
  }
  if (features) {
    await logOnUser(admin, userId, 'change-features', requestedFeatures)
  }
  if (aiFeatures) {
    await logOnUser(admin, userId, 'change-ai-features', aiFeatures)
  }
  if (suspended === false) {
    await logOnUser(admin, userId, 'account-reactivation')
  }
}

// A session keeps the isAdmin it logged in with, which core reads for the Admin
// menu and a few checks, and core only edits the session of the current request
async function setAdminInSessions(userId, isAdmin) {
  const rclient = UserSessionsRedis.client()
  const sessionKeys = await rclient.smembers(
    UserSessionsRedis.sessionSetKey({ _id: userId })
  )
  for (const key of sessionKeys) {
    const value = await rclient.get(key)
    if (!value) continue
    const session = JSON.parse(value)
    const sessionUser = session.passport?.user ?? session.user
    sessionUser.isAdmin = isAdmin
    await rclient.set(key, JSON.stringify(session), 'KEEPTTL', 'XX')
  }
}

// Applies what the panel's edit forms send, and returns the fields that
// changed under the names the panel uses
async function updateUser(userId, body, admin) {
  const isOwnAccount = userId === admin.id

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    throw new RefusedError(fromZodError(parsed.error).message)
  }

  const { firstName, lastName, ...updates } = body
  if ('firstName' in body) updates.first_name = firstName
  if ('lastName' in body) updates.last_name = lastName

  assertUpdateAllowed(updates, isOwnAccount)

  const { email, password, features, ...fields } = updates
  const user = await User.findById(userId, {
    ...Object.fromEntries(Object.keys(updates).map(key => [key, 1])),
    // for the password rules
    email: 1,
    // the login methods
    hashedPassword: 1,
    samlIdentifiers: 1,
    thirdPartyIdentifiers: 1,
    loginCount: 1,
  }).exec()
  if (!user) throw new Errors.NotFoundError('user not found')
  assertNotLockedOnLogin(user, updates)

  const changes = fieldChanges(user, fields)
  if (features) {
    changes.features = { ...(user.features ?? {}), ...features }
  }
  // an empty password field leaves the password as it is
  if (password != null && password !== '') {
    await assertPasswordAllowed(user, password)
    changes.hashedPassword =
      await AuthenticationManager.promises.hashPassword(password)
  }

  const newEmail = email?.trim().toLowerCase()
  const emailChanges = newEmail != null && newEmail !== user.email
  if (emailChanges) await changeEmail(userId, newEmail, admin)

  const disabling = fields.suspended === true && user.suspended !== true
  Object.assign(user, changes)
  await user.save().catch(err => {
    throw OError.tag(err, 'problem updating user settings', { userId })
  })
  if (disabling) await disableUser(userId, admin)
  if (changes.features) await rememberAdminFeatures(userId, features)

  // a new password ends what the old one opened, as when the user changes it.
  // Before the log: a failed entry must not leave them open
  if (changes.hashedPassword) {
    await UserSessionsManager.promises.removeSessionsFromRedis(
      { _id: userId },
      isOwnAccount ? admin.sessionId : undefined
    )
    await OneTimeTokenHandler.promises.expireAllTokensForUser(
      userId,
      'password'
    )
  }
  if (changes.isAdmin != null) {
    await setAdminInSessions(userId, changes.isAdmin)
  }
  await logChanges(admin, userId, features, changes)

  const { hashedPassword, first_name, last_name, ...changed } = changes
  return {
    ...changed,
    ...(first_name != null && { firstName: first_name }),
    ...(last_name != null && { lastName: last_name }),
    ...(emailChanges && { email: newEmail }),
    ...(disabling && { suspended: true }),
  }
}

// ---- sessions ----

// Same steps as core's own UserController.clearSessions, with the admin as
// initiator; the admin's current session is kept when it is their own page
async function clearSessions(userId, admin) {
  const user = await User.findById(userId, '_id').lean().exec()
  if (!user) throw new Errors.NotFoundError('user not found')
  const sessions = await UserSessionsManager.promises.getAllUserSessions(user, [
    admin.sessionId,
  ])
  await logOnUser(admin, user._id, 'clear-sessions', { sessions })
  await UserSessionsManager.promises.removeSessionsFromRedis(
    user,
    admin.sessionId
  )
  return UserSessionsManager.promises.getAllUserSessions(user, [])
}

// ---- giving the projects away ----

// a new owner can log in: the picker offers no disabled account either
const activeUser = userId => ({ _id: userId, suspended: { $ne: true } })

// Core's transferAllProjectsToUser (a tag "transferred-from-<email>" for the
// new owner, no emails), which does not tell who did it to each project's log
async function transferAllProjects(fromUserId, toUserId, admin) {
  const [fromUser, toUser] = await Promise.all([
    User.findById(fromUserId, { email: 1 }).lean(),
    User.exists(activeUser(toUserId)),
  ])
  if (!fromUser || !toUser || fromUserId === toUserId) {
    throw new OError('invalid transfer of projects', { fromUserId, toUserId })
  }
  const projects = await Project.find(
    { owner_ref: fromUserId },
    { _id: 1 }
  ).lean()
  // no tag on the new owner for a user with nothing to give
  if (projects.length > 0) {
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
  }
  await promiseMapWithLimit(5, projects, project =>
    OwnershipTransferHandler.promises.transferOwnership(project._id, toUserId, {
      allowTransferToNonCollaborators: true,
      skipEmails: true,
      ipAddress: admin.ip,
      sessionUserId: admin.id,
    })
  )
  await logOnUser(admin, fromUserId, 'transfer-projects', {
    toUserId,
    projectCount: projects.length,
  })
  return projects.length
}

// every project the user owns to another user, without deleting the user
async function transferProjects(userId, toUserId, admin) {
  // The list greys it out on the own account, refuse a direct request too
  if (userId === admin.id) {
    throw new RefusedError('You cannot give away all your own projects')
  }
  if (!isObjectId(toUserId) || userId === toUserId.toLowerCase()) {
    throw new RefusedError('invalid toUserId')
  }
  const [from, to] = await Promise.all([
    User.exists({ _id: userId }),
    User.exists(activeUser(toUserId)),
  ])
  if (!from || !to) throw new Errors.NotFoundError('user not found')
  return transferAllProjects(userId, toUserId, admin)
}

// ---- deleting, restoring and purging ----

async function deleteUser(userId, { sendEmail, toUserId }, admin) {
  // The list greys Delete out on the own account, refuse a direct request too
  if (userId === admin.id) {
    throw new RefusedError('You cannot delete your own account')
  }

  if (toUserId) {
    try {
      await transferAllProjects(userId, toUserId, admin)
    } catch (err) {
      logger.warn({ err, userId, toUserId }, 'failed to transfer the projects')
      throw new RefusedError('Failed to transfer projects ownership')
    }
  }

  try {
    await UserDeleter.promises.deleteUser(userId, {
      deleterUser: { _id: admin.id },
      ipAddress: admin.ip,
      skipEmail: !sendEmail,
      // a failed email must not stop the deletion halfway: by then the user's
      // projects are already deleted
      force: true,
    })
  } catch (err) {
    logger.warn(
      { err, deleterId: admin.id, userId },
      'failed to delete the user'
    )
    throw new RefusedError(
      'Something went wrong. Does the account still exist?'
    )
  }

  const deletedUser = await DeletedUser.findOne(
    { 'user._id': userId },
    { 'deleterData.deletedAt': 1 }
  ).lean()
  return deletedUser.deleterData.deletedAt
}

async function purgeDeletedUser(userId, admin) {
  const deleted = await DeletedUser.findOne(
    { 'user._id': userId },
    { 'user.email': 1 }
  ).lean()
  // a stale page: somebody restored it meanwhile. Core's expiry would run the
  // modules' cleanup on the live account before it fails
  if (!deleted) throw new Errors.NotFoundError('deleted user not found')
  try {
    await UserDeleter.promises.expireDeletedUser(userId)
  } catch (err) {
    logger.warn({ err, userId }, 'failed to purge the deleted user')
    throw new RefusedError('Something went wrong. The user is already deleted?')
  }
  await deleteUserEntries(userId)
  await logOnAdmin(admin, 'purge-deleted-user', {
    userId,
    email: deleted?.user?.email,
  })
}

async function restoreDeletedUser(userId, admin) {
  const deleted = await DeletedUser.findOne({ 'user._id': userId }).lean()
  const userData = deleted?.user
  if (!userData) {
    throw new RefusedError('Something went wrong. The user is purged?')
  }
  // every email comes back, and another account may use one by now, even as a
  // secondary email
  const emails = userData.emails.map(({ email }) => email)
  const used = await User.distinct('emails.email', {
    'emails.email': { $in: emails },
  })
  const taken = emails.filter(email => used.includes(email))
  if (taken.length > 0) {
    throw new RefusedError(
      `Another account already uses ${taken.join(', ')}: remove it from one of the two accounts first`
    )
  }

  try {
    await User.create({
      ...userData,
      // users deleted before the analyticsId back-fill migration have none
      analyticsId: userData.analyticsId ?? userData._id.toString(),
    })
    await DeletedUser.deleteOne({ 'user._id': userId })
  } catch (err) {
    throw new FailedError(
      'generic_something_went_wrong',
      OError.tag(err, 'problem restoring deleted user', { userId })
    )
  }

  // the account is back; a project that cannot return must not undo that.
  // Only what went with the account: a project the user deleted stays deleted
  // (records from before core's reasons have none)
  try {
    const projects = await DeletedProject.find({
      'project.owner_ref': userId,
      'deleterData.deletedReason': {
        $in: [DeletedProjectReasons.ACCOUNT_DELETION, null],
      },
    }).exec()
    await promiseMapWithLimit(5, projects, async project => {
      const projectId = project.deleterData.deletedProjectId
      await ProjectDeleter.promises.undeleteProject(projectId)
      await logOnProject(admin, projectId, 'project-restored')
    })
  } catch (err) {
    logger.warn({ err, userId }, 'failed to restore the projects of the user')
  }

  await logOnUser(admin, userId, 'restore-account')
  return { restoredId: userData._id.toString(), email: userData.email }
}

// ---- AI usage ----

async function getAiUsage(userId) {
  await assertUserExists(userId)
  return getTokenUsage(userId)
}

async function resetAiUsage(userId, admin) {
  // The tab greys it out on the own account, refuse a direct request too
  if (userId === admin.id) {
    throw new RefusedError('You cannot reset the AI usage of your own account')
  }
  await assertUserExists(userId)
  await resetTokenUsage(userId)
  await logOnUser(admin, userId, 'reset-ai-usage')
  return getTokenUsage(userId)
}

export default {
  createUser,
  sendActivationEmail,
  sendPasswordReset,
  getActivationLink,
  updateUser,
  clearSessions,
  transferProjects,
  deleteUser,
  purgeDeletedUser,
  restoreDeletedUser,
  getAiUsage,
  resetAiUsage,
  removeEmail,
}
