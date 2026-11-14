import _ from 'lodash'
import Settings from '@overleaf/settings'
import { User } from '../../../../app/src/models/User.mjs'
import { DeletedUser } from '../../../../app/src/models/DeletedUser.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import UserSessionsManager from '../../../../app/src/Features/User/UserSessionsManager.mjs'
import PersonalAccessTokenManager from '../../../oauth2-server/app/src/OAuthPersonalAccessTokenManager.mjs'
import { GitHubSyncUserCredentials } from '../../../github-sync/app/models/githubSyncUserCredentials.mjs'
import { GitLabSyncUserCredentials } from '../../../gitlab-sync/app/models/gitlabSyncUserCredentials.mjs'
import { GiteaSyncUserCredentials } from '../../../gitea-sync/app/models/giteaSyncUserCredentials.mjs'
import {
  aggregatePage,
  countOptions,
  findPage,
  idMatches,
  matchedSecondaryEmails,
  nameOrEmailMatches,
  PAGE_SIZES,
  parseOrder,
  parsePaging,
  sortBy,
} from './AdminQueryHelper.mjs'

// Reading users: the user list and its filters, the data of a user's page, and
// the owners other lists show.

const STATUSES = [
  'all',
  'active',
  'suspended',
  'never_logged_in',
  'inactive',
  'deleted',
]
const SORT_FIELDS = {
  name: ['last_name', 'first_name', 'email'],
  email: ['email'],
  signUpDate: ['signUpDate'],
  lastLoggedIn: ['lastLoggedIn'],
  lastActive: ['lastActive'],
}
const SORTS = [...Object.keys(SORT_FIELDS), 'deletedAt']
const LIST_FIELDS = [
  '_id',
  'email',
  'first_name',
  'last_name',
  // a row found by a secondary email shows it
  'emails.email',
  'emails.confirmedAt',
  'isAdmin',
  'suspended',
  'signUpDate',
  'lastLoggedIn',
  'lastActive',
  'loginCount',
  'hashedPassword',
  'samlIdentifiers.providerId',
  'thirdPartyIdentifiers.providerId',
]
const PAGE_FIELDS = [
  ...LIST_FIELDS,
  'emails.reconfirmedAt',
  'lastLoginIp',
  'samlIdentifiers.externalUserId',
  'thirdPartyIdentifiers.externalUserId',
  'features',
  'aiFeatures.enabled',
  'refProviders',
  // what DropboxHandler.isLinked checks; that file needs Settings.dropbox,
  // which the dropbox module sets only after this module is loaded
  'dropbox.access_token.uid',
]

function yearAgo() {
  const date = new Date()
  date.setFullYear(date.getFullYear() - 1)
  return date
}

function hasPassword(user) {
  return typeof user.hashedPassword === 'string' && user.hashedPassword !== ''
}

// ---- the list's query ----

function parseUsersQuery(query) {
  const status = STATUSES.includes(query.status) ? query.status : 'all'
  let sort = SORTS.includes(query.sort) ? query.sort : 'signUpDate'
  if (sort === 'deletedAt' && status !== 'deleted') sort = 'signUpDate'
  const defaultOrder = sort === 'name' || sort === 'email' ? 'asc' : 'desc'
  return {
    ...parsePaging(query),
    status,
    auth:
      typeof query.auth === 'string' &&
      /^(all|local|ldap|saml|pending|oidc:.+)$/.test(query.auth)
        ? query.auth
        : 'all',
    // the site admins, or everyone else (CE has no other role)
    role: ['admin', 'user'].includes(query.role) ? query.role : 'all',
    sort,
    order: parseOrder(query, defaultOrder),
  }
}

// Queries on users, or on deleted users (prefix 'user.').
//
// There is no stored login method: LDAP logins unset hashedPassword
// (LDAPAuthenticationManager), SAML sets samlIdentifiers, OIDC (and any other
// OAuth provider) adds thirdPartyIdentifiers. An account with none of them
// that has logged in is an LDAP account; one that never logged in is an
// external account waiting for its first SSO login.
function filters(prefix) {
  const f = name => prefix + name
  const passwordSet = { [f('hashedPassword')]: { $type: 'string', $ne: '' } }
  const hasSaml = { [f('samlIdentifiers.0')]: { $exists: true } }
  const hasThirdParty = { [f('thirdPartyIdentifiers.0')]: { $exists: true } }
  const loggedIn = { [f('loginCount')]: { $gt: 0 } }
  const notSuspended = { [f('suspended')]: { $ne: true } }
  const since = yearAgo()
  // lastActive is only written on opening the editor, so a login counts too
  const usedThisYear = [
    { [f('lastActive')]: { $gte: since } },
    { [f('lastLoggedIn')]: { $gte: since } },
  ]
  return {
    auth: {
      local: passwordSet,
      saml: hasSaml,
      ldap: { $nor: [passwordSet, hasSaml, hasThirdParty], ...loggedIn },
      pending: { $nor: [passwordSet, hasSaml, hasThirdParty, loggedIn] },
      oidc: providerId => ({
        [f('thirdPartyIdentifiers.providerId')]: providerId,
      }),
    },
    // each account has one status, so they add up to All; the same rules as
    // the row's StatusBadge
    status: {
      active: { ...notSuspended, ...loggedIn, $or: usedThisYear },
      suspended: { [f('suspended')]: true },
      never_logged_in: { ...notSuspended, $nor: [loggedIn] },
      inactive: { ...notSuspended, ...loggedIn, $nor: usedThisYear },
    },
    role: {
      admin: { [f('isAdmin')]: true },
      user: { [f('isAdmin')]: { $ne: true } },
    },
    search: term => ({
      $or: [...nameOrEmailMatches(term, prefix), idMatches(f('_id'), term)],
    }),
  }
}

function authFilter(F, auth) {
  return auth.startsWith('oidc:') ? F.auth.oidc(auth.slice(5)) : F.auth[auth]
}

// Every filter of the query, but the one (skip) whose options are being counted
function buildMatch(query, prefix, skip) {
  const F = filters(prefix)
  const and = []
  if (prefix) and.push({ user: { $type: 'object' } })
  if (query.search && skip !== 'search') and.push(F.search(query.search))
  if (query.auth !== 'all' && skip !== 'auth') {
    and.push(authFilter(F, query.auth))
  }
  if (!prefix && F.status[query.status] && skip !== 'status') {
    and.push(F.status[query.status])
  }
  if (query.role !== 'all' && skip !== 'role') and.push(F.role[query.role])
  return and.length ? { $and: and } : {}
}

// ---- login providers ----

async function getProviderIds() {
  const [ids, deletedIds] = await Promise.all([
    User.distinct('thirdPartyIdentifiers.providerId'),
    DeletedUser.distinct('user.thirdPartyIdentifiers.providerId'),
  ])
  return _.uniq(
    [Settings.oidc?.providerId, ...ids, ...deletedIds].filter(Boolean)
  ).sort()
}

function getProviderNames(providerIds) {
  return Object.fromEntries(
    providerIds.map(id => [id, Settings.oauthProviders?.[id]?.name ?? id])
  )
}

// ---- the list ----

// Each group of counts applies every other filter, so a number tells how
// many rows that option would show.
async function getCounts(query, providerIds) {
  const deleted = query.status === 'deleted'
  const Model = deleted ? DeletedUser : User
  const prefix = deleted ? 'user.' : ''
  const F = filters(prefix)

  const [auth, status, deletedCount, roleAll, roleAdmin, users] =
    await Promise.all([
      countOptions(Model, buildMatch(query, prefix, 'auth'), {
        local: F.auth.local,
        ldap: F.auth.ldap,
        saml: F.auth.saml,
        ...Object.fromEntries(
          providerIds.map(id => [`oidc:${id}`, F.auth.oidc(id)])
        ),
        pending: F.auth.pending,
      }),
      countOptions(User, buildMatch(query, '', 'status'), filters('').status),
      DeletedUser.countDocuments(buildMatch(query, 'user.', 'status')),
      Model.countDocuments(buildMatch(query, prefix, 'role')),
      Model.countDocuments(buildMatch({ ...query, role: 'admin' }, prefix)),
      User.estimatedDocumentCount(),
    ])

  return {
    auth,
    status: { ...status, deleted: deletedCount },
    role: { all: roleAll, admin: roleAdmin, user: roleAll - roleAdmin },
    users,
  }
}

function authMethodsOf(user, providerNames = {}) {
  const authMethods = []
  if (hasPassword(user)) authMethods.push({ type: 'local' })
  if (user.samlIdentifiers?.length) authMethods.push({ type: 'saml' })
  for (const { providerId } of user.thirdPartyIdentifiers ?? []) {
    authMethods.push({
      type: 'oidc',
      providerId,
      name: providerNames[providerId] ?? providerId,
    })
  }
  if (authMethods.length === 0) {
    authMethods.push({ type: user.loginCount > 0 ? 'ldap' : 'pending' })
  }
  return authMethods
}

function formatUser(user, providerNames, deletedAt) {
  const authMethods = authMethodsOf(user, providerNames)
  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    isAdmin: Boolean(user.isAdmin),
    suspended: Boolean(user.suspended),
    loginCount: user.loginCount ?? 0,
    signUpDate: user.signUpDate,
    lastLoggedIn: user.lastLoggedIn,
    lastActive: user.lastActive,
    authMethods,
    deleted: Boolean(deletedAt),
    deletedAt,
  }
}

async function listUsers(query, providerNames) {
  if (query.status === 'deleted') {
    const sortKeys =
      query.sort === 'deletedAt'
        ? ['deleterData.deletedAt']
        : SORT_FIELDS[query.sort].map(key => `user.${key}`)
    const { rows, ...list } = await aggregatePage(
      DeletedUser,
      buildMatch(query, 'user.'),
      {
        deletedAt: '$deleterData.deletedAt',
        ...Object.fromEntries(LIST_FIELDS.map(key => [`user.${key}`, 1])),
      },
      sortBy(sortKeys, query.order),
      query
    )
    return {
      ...list,
      users: rows.map(row => ({
        ...formatUser(row.user, providerNames, row.deletedAt),
        matchedEmails: matchedSecondaryEmails(row.user, query.search),
      })),
    }
  }

  const { rows, ...list } = await findPage(
    User,
    buildMatch(query, ''),
    LIST_FIELDS.join(' '),
    sortBy(SORT_FIELDS[query.sort], query.order),
    query
  )
  return {
    ...list,
    users: rows.map(user => ({
      ...formatUser(user, providerNames),
      matchedEmails: matchedSecondaryEmails(user, query.search),
    })),
  }
}

async function getUserList(rawQuery) {
  const query = parseUsersQuery(rawQuery)
  const providerIds = await getProviderIds()
  const providerNames = getProviderNames(providerIds)
  const [list, counts] = await Promise.all([
    listUsers(query, providerNames),
    getCounts(query, providerIds),
  ])
  return {
    ...list,
    query: { ...query, page: list.page },
    counts,
    providers: providerIds.map(id => ({ id, name: providerNames[id] })),
  }
}

async function getUsersPage(rawQuery) {
  const [initialResult, activeUsersCount] = await Promise.all([
    getUserList(rawQuery),
    // active = used the instance in the last 12 months, as on the license tab
    User.countDocuments({ lastActive: { $gt: yearAgo() } }),
  ])
  return {
    initialResult,
    enabledAuth: {
      ldap: Boolean(Settings.ldap?.enable),
      saml: Boolean(Settings.saml?.enable),
      oidc: Boolean(Settings.oidc?.enable),
    },
    pageSizes: PAGE_SIZES,
    activeUsersCount,
  }
}

// ---- a user's page ----

// A login method keeps a property in sync when its settings say so; the
// admin can then not change it
function lockedOnLogin(authMethods) {
  const methods = authMethods.map(m => m.type).filter(t => t !== 'pending')
  const all = test => methods.length > 0 && methods.every(test)
  return {
    details: all(
      m => m !== 'local' && Boolean(Settings[m]?.updateUserDetailsOnLogin)
    ),
    isAdmin: all(
      m =>
        m !== 'local' &&
        Boolean(Settings[m]?.attAdmin) &&
        Boolean(Settings[m]?.valAdmin)
    ),
  }
}

// The same lock for a change that does not come from the account's page
function getLockedOnLogin(user) {
  return lockedOnLogin(authMethodsOf(user))
}

function formatDetails(user, providerNames) {
  const summary = formatUser(user, providerNames)
  return {
    ...summary,
    hasPassword: hasPassword(user),
    lastLoginIp: user.lastLoginIp || undefined,
    emails: (user.emails ?? []).map(email => ({
      email: email.email,
      primary: email.email === user.email,
      confirmed: Boolean(email.reconfirmedAt || email.confirmedAt),
    })),
    identifiers: [
      ...(user.samlIdentifiers ?? []).map(id => ({
        type: 'saml',
        externalUserId: id.externalUserId,
      })),
      ...(user.thirdPartyIdentifiers ?? []).map(id => ({
        type: 'oidc',
        providerId: id.providerId,
        name: providerNames[id.providerId] ?? id.providerId,
        externalUserId: id.externalUserId,
      })),
    ],
    locked: lockedOnLogin(summary.authMethods),
    features: user.features ?? {},
    aiEnabled: user.aiFeatures?.enabled !== false,
  }
}

async function getIntegrations(user) {
  const userId = user._id
  const [tokens, github, gitlab, gitea] = await Promise.all([
    // tokens keep user_id as a string (the session's user id)
    PersonalAccessTokenManager.listTokens(userId.toString()),
    GitHubSyncUserCredentials.exists({ userId }),
    GitLabSyncUserCredentials.exists({ userId }),
    GiteaSyncUserCredentials.exists({ userId }),
  ])
  return {
    gitTokens: tokens.map(token => ({
      id: token._id.toString(),
      prefix: token.accessTokenPartial,
      createdAt: token.createdAt,
      expiresAt: token.accessTokenExpiresAt,
      lastUsedAt: token.lastUsedAt,
    })),
    linked: {
      github: Boolean(github),
      gitlab: Boolean(gitlab),
      gitea: Boolean(gitea),
      dropbox: Boolean(user.dropbox?.access_token?.uid),
      zotero: Boolean(user.refProviders?.zotero),
      mendeley: Boolean(user.refProviders?.mendeley),
    },
  }
}

async function getUserPage(userId) {
  const providerNames = getProviderNames(await getProviderIds())

  const user = await User.findById(userId, PAGE_FIELDS.join(' ')).lean().exec()
  if (user) {
    const [integrations, sessions] = await Promise.all([
      getIntegrations(user),
      UserSessionsManager.promises.getAllUserSessions(user, []),
    ])
    return { user: formatDetails(user, providerNames), integrations, sessions }
  }

  // a deleted user keeps its document in deletedUsers until it expires
  const deletedUser = await DeletedUser.findOne({
    'deleterData.deletedUserId': userId,
    user: { $type: 'object' },
  })
    .lean()
    .exec()
  if (!deletedUser) throw new Errors.NotFoundError('user not found')
  const { deleterData } = deletedUser
  const deleter =
    deleterData.deleterId &&
    (await User.findById(deleterData.deleterId, 'email').lean().exec())
  return {
    user: {
      ...formatDetails(deletedUser.user, providerNames),
      deleted: true,
      deletedAt: deleterData.deletedAt,
    },
    deleter: {
      id: deleterData.deleterId?.toString(),
      email: deleter?.email,
      ipAddress: deleterData.deleterIpAddress,
    },
  }
}

// ---- for the other lists ----

// The owners of a list's rows, by id: name and email, also of a deleted owner
// (deletedUsers keeps it until it expires), and the secondary emails of a
// list's search that found an owner (getUserIdsMatching reads only users)
async function ownersOf(ids, search) {
  const unique = _.uniqBy(ids.filter(Boolean), id => id.toString())
  const [users, deletedUsers] = await Promise.all([
    User.find(
      { _id: { $in: unique } },
      'email first_name last_name emails.email emails.confirmedAt'
    )
      .lean()
      .exec(),
    DeletedUser.find(
      {
        'deleterData.deletedUserId': { $in: unique },
        user: { $type: 'object' },
      },
      'deleterData.deletedUserId user.email user.first_name user.last_name'
    )
      .lean()
      .exec(),
  ])
  const owners = new Map()
  for (const { deleterData, user } of deletedUsers) {
    owners.set(deleterData.deletedUserId.toString(), { ...user, deleted: true })
  }
  for (const user of users) owners.set(user._id.toString(), user)
  return id => {
    const owner = id && owners.get(id.toString())
    return {
      id: id?.toString(),
      email: owner?.email,
      name: [owner?.first_name, owner?.last_name].filter(Boolean).join(' '),
      deleted: Boolean(owner?.deleted),
      matchedEmails: owner ? matchedSecondaryEmails(owner, search) : [],
    }
  }
}

// The users a search matches by name or email, at most 1000: a search that
// broad is narrowed by the rest of what the list searches anyway
async function getUserIdsMatching(term) {
  const users = await User.find({ $or: nameOrEmailMatches(term) }, '_id')
    .limit(1000)
    .lean()
    .exec()
  return users.map(user => user._id)
}

export default {
  getUserList,
  getUsersPage,
  getUserPage,
  ownersOf,
  getUserIdsMatching,
  getLockedOnLogin,
}
