import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import _ from 'lodash'
import crypto from 'crypto'
import Settings from '@overleaf/settings'
import Metrics from '@overleaf/metrics'
import logger from '@overleaf/logger'
import { User } from '../../../../app/src/models/User.mjs'
import { DeletedUser } from '../../../../app/src/models/DeletedUser.mjs'
import { DeletedProject } from '../../../../app/src/models/DeletedProject.mjs'
import { expressify, promiseMapWithLimit } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import EmailHandler from '../../../../app/src/Features/Email/EmailHandler.mjs'
import OneTimeTokenHandler from '../../../../app/src/Features/Security/OneTimeTokenHandler.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import UserUpdater from '../../../../app/src/Features/User/UserUpdater.mjs'
import UserDeleter from '../../../../app/src/Features/User/UserDeleter.mjs'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import OwnershipTransferHandler from '../../../../app/src/Features/Collaborators/OwnershipTransferHandler.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.mjs'
import Errors, { OError } from '../../../../app/src/Features/Errors/Errors.js'
import HaveIBeenPwned from '../../../../app/src/Features/Authentication/HaveIBeenPwned.mjs'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import AuthenticationManager from '../../../../app/src/Features/Authentication/AuthenticationManager.mjs'
import { getTokenUsage, resetTokenUsage } from '../../../workbench/app/src/TokenQuota.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const externalAuth = process.env.EXTERNAL_AUTH ? process.env.EXTERNAL_AUTH.split(/\s+/).filter(m => m && m !== 'none') : []
const availableAuthMethods = ['local', ...externalAuth]

const userIsAdminUpdatedOnLogin = Object.fromEntries(
  availableAuthMethods.map(m => [
    m,
    Boolean(Settings[m]?.attAdmin) && Boolean(Settings[m]?.valAdmin)
  ])
)
const userDetailsUpdatedOnLogin = Object.fromEntries(
  availableAuthMethods.map(m => [
    m,
    Boolean(Settings[m]?.updateUserDetailsOnLogin)
  ])
)

async function _sendActivationEmail(idString) {
  const user = await User.findById(idString, { email: 1, _id: 0 }).lean()
  if (!user) {
    throw new OError('User does not exist, cannot send activation email', { userId: idString })
  }
  const ONE_WEEK = 7 * 24 * 60 * 60 // seconds
  const token = await OneTimeTokenHandler.promises.getNewToken(
    'password',
    { user_id: idString, email: user.email },
    { expiresIn: ONE_WEEK }
  )
  const setNewPasswordUrl = `${Settings.siteUrl}/user/activate?token=${token}&user_id=${idString}`
  await EmailHandler.promises.sendEmail('registered', { to: user.email, setNewPasswordUrl })
    .catch(error => {
      throw new OError('Failed to send activation email', { error: error.message, email: user.email })
    })
  return setNewPasswordUrl
}

function cleanupSession(req) {
  // cleanup redirects at the end of the redirect chain
  delete req.session.postCheckoutRedirect
  delete req.session.postLoginRedirect
  delete req.session.postOnboardingRedirect
}

async function manageUsersPage(req, res, next) {
  cleanupSession(req)

  const userId = SessionManager.getLoggedInUserId(req.session)

  const usersBlobPending = _getUsers().catch(err => {
    logger.err({ err }, 'users listing in background failed')
    return undefined
  })

  const prefetchedUsersBlob = await usersBlobPending
  const activeUsersCount = await _getActiveUsers().catch(err => {
    logger.err({ err }, 'counting active users failed')
    return undefined
  })

  Metrics.inc('user-list-prefetch-users', 1, {
    status: prefetchedUsersBlob ? 'success' : 'error',
  })

  const user = await User.findById(userId, 'ace')
  const userSettings = await UserSettingsHelper.buildUserSettings(req, res, user)

  res.render(Path.resolve(__dirname, '../views/manage-users-react'), {
    title: 'Manage Users',
    userSettings,
    prefetchedUsersBlob,
    availableAuthMethods,
    userDetailsUpdatedOnLogin,
    userIsAdminUpdatedOnLogin,
    activeUsersCount,
  })
}

async function registerNewUser(req, res, next) {
  const { email, isExternal, isAdmin } = req.body
  if (email == null || email === '') {
    return HttpErrorHandler.unprocessableEntity(req, res, 'Email address is empty')
  }
  delete req.body.isExternal
  req.body.password = crypto.randomBytes(32).toString('hex')
  req.body.analyticsId = crypto.randomUUID()

 let user
  try {
    user = await UserRegistrationHandler.promises.registerNewUser(req.body)
  } catch (err) {
    if (err.message == 'EmailAlreadyRegistered') {
      return HttpErrorHandler.conflict(req, res, 'email_already_registered')
    }
    if (err.message === 'InvalidEmailError') {
      return HttpErrorHandler.unprocessableEntity(req, res, 'email_address_is_invalid')
    }
    if (err.message === 'InvalidPasswordError') {
      return HttpErrorHandler.unprocessableEntity(req, res, 'try_again')
    }
    OError.tag(err, 'error user registration', {
      email,
    })
    throw err
  }

  try {
    const reversedHostname = user.email
      .split('@')[1]
      .split('')
      .reverse()
      .join('')
    const update = {
      $set: { isAdmin, emails: [{ email, reversedHostname, confirmedAt: Date.now() }] },
    }
    if (isExternal) {
      update.$unset = { hashedPassword: "" }
    } else {
      await _sendActivationEmail(user._id.toString())
    }
    await User.updateOne({ _id: user._id }, update).exec()
  } catch (err) {
    OError.tag(err, 'error finishing user registration', {
      email: user.email,
    })
    throw err
  }

  const authMethods = isExternal ? [] : ['local']
  const { id, first_name, last_name, signUpDate } = user
  const newUser = { id, email, firstName: first_name, lastName: last_name, isAdmin, signUpDate, inactive: true, deleted: false, authMethods }
  res.json({ user: newUser })
}

async function sendActivationEmail(req, res, next) {
  const { userId } = req.params
  try {
    await _sendActivationEmail(userId)
  } catch (err) {
    logger.warn({ err })
    return HttpErrorHandler.unprocessableEntity(req, res, 'Error sending activation email')
  }
  res.sendStatus(200)
}

async function getUsersJson(req, res) {
  const { filters, page, sort } = req.body
  const usersPage = await _getUsers(filters, sort, page)
  res.json(usersPage)
}


async function activateAccountPage(req, res, next) {
  // An 'activation' is actually just a password reset on an account that
  // was set with a random password originally.
  if (req.query.user_id == null || req.query.token == null) {
    return ErrorController.notFound(req, res)
  }

  if (typeof req.query.user_id !== 'string') {
    return ErrorController.forbidden(req, res)
  }

  const user = await UserGetter.promises.getUser(req.query.user_id, {
    email: 1,
  })

  if (!user) {
    return ErrorController.notFound(req, res)
  }

  req.session.doLoginAfterPasswordReset = true

  res.render(Path.resolve(__dirname, '../views/activate'), {
    title: 'activate_account',
    email: user.email,
    token: req.query.token,
  })
}

async function _getUsers(
  filters = {},
  sort = { by: 'name', order: 'asc' },
  page = { size: 20 }
) {
  const projection = {
    _id: 1,
    email: 1,
    first_name: 1,
    last_name: 1,
    lastActive: 1,
    lastLoggedIn: 1,
    signUpDate: 1,
    loginCount: 1,
    isAdmin: 1,
    hashedPassword: 1,
    samlIdentifiers: 1,
    thirdPartyIdentifiers: 1,
    suspended: 1,
    'features.collaborators': 1,
    'features.compileTimeout': 1,
    'aiFeatures.enabled': 1,
  }
  const projectionDeleted = {};
  for (const key of Object.keys(projection)) {
    projectionDeleted[key] = `$user.${key}`
  }
  projectionDeleted.deletedAt = '$deleterData.deletedAt'

  const activeUsers = await User.find({}, projection)
    .limit(1000)
    .lean()
  
  const deletedUsers = await DeletedUser.aggregate([
    { $match: { user: { $type: 'object' } } },
    { $project: projectionDeleted },
    { $limit: 1000 },
  ])

  const allUsers = [...activeUsers, ...deletedUsers]

  const formattedUsers = _formatUsers(allUsers)
  const filteredUsers = _applyFilters(formattedUsers, filters)
  const users = _sortAndPaginate(filteredUsers, sort, page)

  return {
    totalSize: filteredUsers.length,
    users,
  }
}

// Return active users number
async function _getActiveUsers() {
  // Count users active within the last 12 months.
  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)

  const activeUsersCount = await User.countDocuments({
    lastActive: { $gt: yearAgo },
  }).exec()

  return activeUsersCount || 0
}

async function _searchUsers(searchTerm) {
  const projection = {
    _id: 1,
    email: 1,
    first_name: 1,
    last_name: 1,
    lastActive: 1,
    lastLoggedIn: 1,
    signUpDate: 1,
    loginCount: 1,
    isAdmin: 1,
    hashedPassword: 1,
    samlIdentifiers: 1,
    thirdPartyIdentifiers: 1,
    suspended: 1,
    'features.collaborators': 1,
    'features.compileTimeout': 1,
    'aiFeatures.enabled': 1,
  }

  const activeUsers = await User.find({
    $or: [
      { email: { $regex: searchTerm, $options: 'i' } },
      { first_name: { $regex: searchTerm, $options: 'i' } },
      { last_name: { $regex: searchTerm, $options: 'i' } },
      { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: searchTerm, options: 'i' } } }
    ]
  }, projection)
  .limit(1000)
  .lean()

  const projectionDeleted = {};
  for (const key of Object.keys(projection)) {
    projectionDeleted[key] = `$user.${key}`
  }
  projectionDeleted.deletedAt = '$deleterData.deletedAt'

  const deletedUsers = await DeletedUser.aggregate([
    { $match: { user: { $type: 'object' }, $or: [
      { 'user.email': { $regex: searchTerm, $options: 'i' } },
      { 'user.first_name': { $regex: searchTerm, $options: 'i' } },
      { 'user.last_name': { $regex: searchTerm, $options: 'i' } },
      { $expr: { $regexMatch: { input: { $toString: '$user._id' }, regex: searchTerm, options: 'i' } } }
    ] } },
    { $project: projectionDeleted },
    { $limit: 1000 },
  ])

  let allUsers = [...activeUsers, ...deletedUsers]
  const formattedUsers = _formatUsers(allUsers)
  
  return {
    totalSize: formattedUsers.length,
    users: formattedUsers,
  }
}

function _formatUsers(users) {
  const formattedUsers = []
  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)

  for (const user of users) {
    formattedUsers.push(
      _formatUserInfo(user, yearAgo)
    )
  }

  return formattedUsers
}

function _applyFilters(users, filters) {
  if (!_hasActiveFilter(filters)) {
    return users
  }
  return users.filter(user => _matchesFilters(user, filters))
}

function _sortAndPaginate(users, sort, page) {
  if (
    (sort.by && !['lastActive', 'signUpDate', 'email', 'name', 'deletedAt'].includes(sort.by)) ||
    (sort.order && !['asc', 'desc'].includes(sort.order))
  ) {
    throw new OError('Invalid sorting criteria', { sort })
  }

  const LAST = '\uffff'
  const sortedUsers =
    sort.by === 'name'
      ? [...users].sort((a, b) =>
          (a.lastName ?? LAST).localeCompare(b.lastName ?? LAST, undefined, { sensitivity: 'base' }) ||
          (a.firstName ?? LAST).localeCompare(b.firstName ?? LAST, undefined, { sensitivity: 'base' }) ||
          (a.email ?? LAST).localeCompare(b.email ?? LAST, undefined, { sensitivity: 'base' })
        )
      : _.orderBy(
          users,
          [u => {
            const key = sort.by || 'signUpDate'
            const value = u[key]
            return typeof value === 'string' ? (value ?? LAST).toLowerCase() : value
          }],
          [sort.order || 'desc']
        )
  return sortedUsers
}

function _formatUserInfo(user, maxDate) {
  let authMethods = []
  if (availableAuthMethods.includes('local') && user.hashedPassword) authMethods.push('local')
  if (availableAuthMethods.includes('saml') && user.samlIdentifiers?.length > 0) authMethods.push('saml')
  if (availableAuthMethods.includes('oidc') && user.thirdPartyIdentifiers?.length > 0) authMethods.push('oidc')
// If none of the above, mark as LDAP
  if (availableAuthMethods.includes('ldap') && authMethods.length === 0 && user.loginCount !== 0) authMethods.push('ldap')

// if not all user's authentications methods update a property on login, allow admin to update that property
  const allowUpdateDetails = authMethods.length === 0 || !authMethods.every(m => userDetailsUpdatedOnLogin[m])
  const allowUpdateIsAdmin = authMethods.length === 0 || !authMethods.every(m => userIsAdminUpdatedOnLogin[m])

  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    isAdmin: user.isAdmin,
    loginCount: user.loginCount,
    signUpDate: user.signUpDate,
    lastActive: user.lastActive,
    lastLoggedIn: user.lastLoggedIn,
    authMethods,
    allowUpdateDetails,
    allowUpdateIsAdmin,
    aiFeatures: { enabled: user.aiFeatures?.enabled !== false },
    features: user.features && {
      collaborators: user.features.collaborators,
      compileTimeout: user.features.compileTimeout,
    },
    ...(user.suspended && { suspended: user.suspended }),
    inactive: !user.lastActive || user.lastActive < maxDate,
    ...(user.deletedAt && { deletedAt: user.deletedAt }),
    deleted: Boolean(user.deletedAt),
  }
}

function _matchesFilters(user, filters) {
  if (filters.search?.length) {
    const searchTerm = filters.search.toLowerCase()
    const email = (user.email ?? '').toLowerCase()
    const firstName = (user.firstName ?? '').toLowerCase()
    const ID = (user.id ?? '').toLowerCase()
    const lastName = (user.lastName ?? '').toLowerCase()
    if (
      !email.includes(searchTerm) &&
      !firstName.includes(searchTerm) &&
      !lastName.includes(searchTerm) &&
      !ID.includes(searchTerm)
    ) {
      return false
    }
  }
  // Deleted users only match the 'deleted' filter
  if (user.deleted) return Boolean(filters.deleted)
  if (filters.all) return true
  if (filters.admin) return user.isAdmin
  if (filters.inactive && !user.inactive) return false
  if (filters.suspended && !user.suspended) return false
  for (const method of availableAuthMethods) {
    if (filters[method] && !user.authMethods.includes(method)) {
      return false
    }
  }
  return true
}

function _hasActiveFilter(filters) {
  return Boolean(
    filters.deleted ||
    filters.all ||
    filters.admin ||
    filters.inactive ||
    filters.suspended ||
    filters.local ||
    filters.saml ||
    filters.oidc ||
    filters.ldap ||
    filters.search?.length
  )
}

async function deleteUser(req, res, next) {
  const deleterUserId = SessionManager.getLoggedInUserId(req.session)
  const { userId } = req.params
  const { sendEmail, toUserId } = req.body

  logger.debug({ deleterUserId, userId }, 'admin is trying to delete user account')

  if (toUserId) {
    try {
      await OwnershipTransferHandler.promises.transferAllProjectsToUser({
        fromUserId: userId,
        toUserId,
        ipAddress: '0.0.0.0',
      })
    } catch (err) {
      logger.warn({ userId, toUserId }, err.message)
      const message = 'Failed to transfer projects ownership'
      return HttpErrorHandler.unprocessableEntity(req, res, message)
    }
  }

  try {
    await UserDeleter.promises.deleteUser(userId, {
      deleterUser: { '_id': deleterUserId },
      ipAddress: req.ip,
      skipEmail: !sendEmail,
    })
  } catch (err) {
    logger.warn({ deleterUser, userId }, err.message)
    if (toUserId) {
      try { // failed to delete user, try to transfer all projects back
        await OwnershipTransferHandler.promises.transferAllProjectsToUser({
          toUserId,
          fromUserId: userId,
          ipAddress: '0.0.0.0',
        })
      } catch (e) {
        logger.warn({ toUserId, userId }, 'Failed to transfer the projects ownership back: ' + e.message)
      }
    }
    const message = 'Something went wrong. Does the account still exist?'
    return HttpErrorHandler.unprocessableEntity(req, res, message)
  }

  const deletedUser = await DeletedUser.findOne(
    { 'user._id': userId }, { 'deleterData.deletedAt': 1 }
  ).lean()

  res.json({ deletedAt: deletedUser.deleterData.deletedAt })
}

async function purgeDeletedUser(req, res, next) {
  const deleterUserId = SessionManager.getLoggedInUserId(req.session)
  const userId = req.params.userId

  logger.debug({ deleterUserId, userId }, 'admin is trying to purge deleted user account')
  try {
    UserDeleter.promises.expireDeletedUser(userId)
  } catch (err) {
    logger.warn({ restorerId, userId }, err.message)
    const message = 'Something went wrong. The user is already deleted?'
    return HttpErrorHandler.unprocessableEntity(req, res, message)
  }
  res.sendStatus(200)
}

async function restoreDeletedUser(req, res, next) {
  const restorerId = SessionManager.getLoggedInUserId(req.session)
  const userId = req.params.userId

  logger.debug({ restorerId, userId }, 'admin is trying to restore deleted user')

  let userData
  try {
    const deletedEntry = await DeletedUser.findOne( { "user._id": userId }).lean()
    userData = deletedEntry?.user
    if (!userData) {
      const message = 'Something went wrong. The user is purged?'
      return HttpErrorHandler.unprocessableEntity(req, res, message)
    }

    const exists = await User.findOne({ email: userData.email }, { _id: 1 }).lean()
    if (exists) {
      const message = req.i18n.translate('email_already_registered')
      return HttpErrorHandler.conflict(req, res, message)
    }

    userData.suspended = false
    // users deleted before the analyticsId back-fill migration have no analyticsId
    userData.analyticsId ??= userData._id.toString()
    await User.create(userData)
    await DeletedUser.deleteOne({ "user._id": userId })

  } catch (err) {
    const message = req.i18n.translate('generic_something_went_wrong')
    return HttpErrorHandler.legacyInternal(
      req, res, message,
      OError.tag(err, 'problem restoring deleted user', {
        userId,
      })
    )
  }

  try {
    const projects = await DeletedProject.find({ "project.owner_ref": userId }).exec()
    logger.info(
      { userId, projectCount: projects.length },
      'found user projects to restore'
    )
    await promiseMapWithLimit(5, projects, project =>
      ProjectDeleter.promises.undeleteProject(project.deleterData.deletedProjectId, { suffix: "" }))
  } catch (err) {
    logger.info({ userId }, err.message)
  }

  return res.json({
    restoredId: userData._id.toString(),
    email: userData.email,
  })
}

async function updateUser(req, res, next) {
  const userId = req.params.userId
  const actorUserId = SessionManager.getLoggedInUserId(req.session)
  req.logger.addFields({ actorUserId })
  const { body } = req

  const updatesInput = { ...body }
  if (
    'aiFeatures' in updatesInput &&
    (typeof updatesInput.aiFeatures?.enabled !== 'boolean' ||
      Object.keys(updatesInput.aiFeatures).some(key => key !== 'enabled'))
  ) {
    return HttpErrorHandler.unprocessableEntity(req, res, 'invalid_ai_features')
  }
  if ('firstName' in updatesInput) {
    updatesInput.first_name = updatesInput.firstName
    delete updatesInput.firstName
  }
  if ('lastName' in updatesInput) {
    updatesInput.last_name = updatesInput.lastName
    delete updatesInput.lastName
  }

  const projection = Object.fromEntries(Object.keys(updatesInput).map(k => [k, 1]))
  const user = await User.findById(userId, projection).exec()

  if (!user) {
    throw new OError('problem updating user settings', { userId })
  }

  let emailIsUpdated = false
  const newEmail = updatesInput.email?.trim().toLowerCase()
  if (newEmail != null && newEmail !== user.email) { // email is updated
    if (newEmail.indexOf('@') === -1) {
      const message = req.i18n.translate('email_address_is_invalid')
      return HttpErrorHandler.unprocessableEntity(req, res, message)
    }
    const auditLog = { initiatorId: actorUserId, ipAddress: req.ip }

    try {
      await UserUpdater.promises.changeEmailAddress(userId, newEmail, auditLog)
      emailIsUpdated = true
    } catch (err) {
      if (err instanceof Errors.EmailExistsError) {
        const message = req.i18n.translate('email_already_registered')
        return HttpErrorHandler.conflict(req, res, message)
      } else {
        const message = req.i18n.translate('problem_changing_email_address')
        return HttpErrorHandler.legacyInternal(
          req, res, message,
          OError.tag(err, 'problem changing email address', {
            userId,
            newEmail,
          })
        )
      }
    }
    if (userId == actorUserId) {
      SessionManager.setInSessionUser(req.session, { email: newEmail })
    }
  }

  const update = {}

  for (let [key, value] of Object.entries(updatesInput)) {
    if (key === 'email') continue
    // Update features if needed
    if (key === 'features' && value && typeof value === 'object') {
      const features = updatesInput.features
      if (features && typeof features === 'object') {
        if ('collaborators' in features && (!Number.isInteger(features.collaborators) || features.collaborators < -1)) {
          return HttpErrorHandler.unprocessableEntity(req, res, 'invalid_collaborators')
        }
        if ('compileTimeout' in features && (!Number.isInteger(features.compileTimeout) || features.compileTimeout <= 0)) {
          return HttpErrorHandler.unprocessableEntity(req, res, 'invalid_compile_timeout')
        }
      }
      update.features = {
        ...(user.features ?? {}),
        ...value,
      }
      continue
    }
    // Update password if needed
    if (key === 'password') {
      // ignore empty password updates
      if (value == null || value === '') {
        continue
      }
      // validate password
      if (typeof value !== 'string' || value.length < 8) {
        return HttpErrorHandler.unprocessableEntity(req, res, 'Password must be at least 8 characters long')
      }
      let isPasswordReused
      try {
        isPasswordReused = await HaveIBeenPwned.promises.checkPasswordForReuse(value)
      } catch (err) {
        logger.warn({ err }, 'Failed to check password against HaveIBeenPwned')
      }
      if (isPasswordReused) {
        return HttpErrorHandler.unprocessableEntity(req, res, 'Password is too common, please choose a different one')
      }
      const hashedPassword = await AuthenticationManager.promises.hashPassword(value)
      update.hashedPassword = hashedPassword
      continue
    }

    const newValue = typeof value === 'string' ? value.trim() : value
    if (newValue === user[key]) continue

    update[key] = newValue
  }

  Object.assign(user, update)
  try {
    await user.save()
  } catch {
    throw new OError('problem updating user settings', { userId })
  }

  if (userId == actorUserId) {
    const sessionUpdate = {}
    if (update.first_name != null) sessionUpdate.first_name = update.first_name
    if (update.last_name != null) sessionUpdate.last_name = update.last_name
    SessionManager.setInSessionUser(req.session, sessionUpdate)
  }

  if (emailIsUpdated) update.email = newEmail

  if (update.first_name != null) {
    update.firstName = update.first_name
    delete update.first_name
  }
  if (update.last_name != null) {
    update.lastName = update.last_name
    delete update.last_name
  }

  // delete password from response for security reasons
  if (update.password) {
    delete update.password
  }
  if (update.hashedPassword) {
    delete update.hashedPassword
  }
  return res.json(update)
}

async function _getActivationLink(userId) {
  try {
    const tokenDoc = await db.tokens.findOne({
      use: 'password',
      'data.user_id': userId,
      expiresAt: { $gt: new Date() },
      usedAt: { $exists: false },
      peekCount: { $not: { $gte: OneTimeTokenHandler.MAX_PEEKS } },
    })
    if (!tokenDoc) {
      return null
    }
    return `${Settings.siteUrl}/user/activate?token=${tokenDoc.token}&user_id=${userId}`
  } catch (err) {
    logger.warn({ userId }, 'Failed to get activation link' + err.message)
    return null
  }
}

async function getAdditionalUserInfo(req, res, next) {
  const { userId } = req.params
  const activationLink = await _getActivationLink(userId)
  res.json({ activationLink })
}

async function resetAiUsage(req, res) {
  const { userId } = req.params
  if (!(await User.exists({ _id: userId }))) {
    return HttpErrorHandler.notFound(req, res)
  }
  await resetTokenUsage(userId)
  res.json(await getTokenUsage(userId))
}

async function getAiUsage(req, res) {
  const { userId } = req.params
  if (!(await User.exists({ _id: userId }))) {
    return HttpErrorHandler.notFound(req, res)
  }
  res.set('Cache-Control', 'no-store')
  res.json(await getTokenUsage(userId))
}

async function getUsersJsonBySearch(req, res) {
  const { search } = req.body
  if (typeof search !== 'string' || search.trim() === '') {
    return HttpErrorHandler.unprocessableEntity(req, res, 'Search term is empty')
  }

  const usersPage = await _searchUsers(search.trim())
  res.json(usersPage)
}


export default {
  manageUsersPage: expressify(manageUsersPage),
  getUsersJson: expressify(getUsersJson),
  getUsersJsonBySearch: expressify(getUsersJsonBySearch),
  getAdditionalUserInfo: expressify(getAdditionalUserInfo),
  resetAiUsage: expressify(resetAiUsage),
  getAiUsage: expressify(getAiUsage),
  registerNewUser: expressify(registerNewUser),
  activateAccountPage: expressify(activateAccountPage),
  sendActivationEmail: expressify(sendActivationEmail),
  deleteUser: expressify(deleteUser),
  restoreDeletedUser: expressify(restoreDeletedUser),
  purgeDeletedUser: expressify(purgeDeletedUser),
  updateUser: expressify(updateUser),
}
