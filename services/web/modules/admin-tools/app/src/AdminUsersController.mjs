import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import _ from 'lodash'
import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import { User } from '../../../../app/src/models/User.mjs'
import { DeletedUser } from '../../../../app/src/models/DeletedUser.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { fullNameMatches } from './AdminUserListsController.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const PAGE_SIZES = [10, 20, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 10
const STATUSES = ['all', 'active', 'suspended', 'never_logged_in', 'inactive', 'deleted']
const SORTS = ['name', 'email', 'signUpDate', 'lastLoggedIn', 'lastActive', 'deletedAt']
const SORT_FIELDS = {
  name: ['last_name', 'first_name', 'email'],
  email: ['email'],
  signUpDate: ['signUpDate'],
  lastLoggedIn: ['lastLoggedIn'],
  lastActive: ['lastActive'],
}
const COLLATION = { locale: 'en', strength: 2 }
const PROJECTION = [
  '_id',
  'email',
  'first_name',
  'last_name',
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

function parseQuery(query) {
  const pageSize = parseInt(query.pageSize, 10)
  const status = STATUSES.includes(query.status) ? query.status : 'all'
  let sort = SORTS.includes(query.sort) ? query.sort : 'signUpDate'
  if (sort === 'deletedAt' && status !== 'deleted') sort = 'signUpDate'
  const defaultOrder = sort === 'name' || sort === 'email' ? 'asc' : 'desc'
  return {
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    status,
    auth:
      typeof query.auth === 'string' &&
      /^(all|local|ldap|saml|pending|oidc:.+)$/.test(query.auth)
        ? query.auth
        : 'all',
    // the site admins, or everyone else (CE has no other role)
    role: ['admin', 'user'].includes(query.role) ? query.role : 'all',
    search: typeof query.search === 'string' ? query.search.trim() : '',
    sort,
    order: ['asc', 'desc'].includes(query.order) ? query.order : defaultOrder,
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
  const hasPassword = { [f('hashedPassword')]: { $type: 'string', $ne: '' } }
  const hasSaml = { [f('samlIdentifiers.0')]: { $exists: true } }
  const hasThirdParty = { [f('thirdPartyIdentifiers.0')]: { $exists: true } }
  const loggedIn = { [f('loginCount')]: { $gt: 0 } }
  const notSuspended = { [f('suspended')]: { $ne: true } }
  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  // lastActive is only written on opening the editor, so a login counts too
  const usedThisYear = [
    { [f('lastActive')]: { $gte: yearAgo } },
    { [f('lastLoggedIn')]: { $gte: yearAgo } },
  ]
  return {
    auth: {
      local: hasPassword,
      saml: hasSaml,
      ldap: { $nor: [hasPassword, hasSaml, hasThirdParty], ...loggedIn },
      pending: { $nor: [hasPassword, hasSaml, hasThirdParty, loggedIn] },
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
    search(term) {
      // a literal search, as in the template gallery
      const regex = { $regex: _.escapeRegExp(term), $options: 'i' }
      return {
        $or: [
          { [f('email')]: regex },
          { [f('first_name')]: regex },
          { [f('last_name')]: regex },
          fullNameMatches(term, prefix),
          {
            $expr: {
              $regexMatch: {
                input: { $toString: '$' + f('_id') },
                regex: _.escapeRegExp(term),
                options: 'i',
              },
            },
          },
        ],
      }
    },
  }
}

function authFilter(F, auth) {
  return auth.startsWith('oidc:') ? F.auth.oidc(auth.slice(5)) : F.auth[auth]
}

function buildMatch(query, prefix, skip) {
  const F = filters(prefix)
  const and = []
  if (prefix) and.push({ user: { $type: 'object' } })
  if (query.search && skip !== 'search') and.push(F.search(query.search))
  if (query.auth !== 'all' && skip !== 'auth') and.push(authFilter(F, query.auth))
  if (!prefix && F.status[query.status] && skip !== 'status') {
    and.push(F.status[query.status])
  }
  if (query.role !== 'all' && skip !== 'role') and.push(F.role[query.role])
  return and.length ? { $and: and } : {}
}

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

function countFrom(facet) {
  return facet?.[0]?.n ?? 0
}

// Each group of counts applies every other filter, so a number tells how
// many rows that option would show.
async function getCounts(query, providerIds) {
  const deleted = query.status === 'deleted'
  const Model = deleted ? DeletedUser : User
  const prefix = deleted ? 'user.' : ''
  const F = filters(prefix)

  const authOptions = [
    ['local', F.auth.local],
    ['ldap', F.auth.ldap],
    ['saml', F.auth.saml],
    ...providerIds.map(id => [`oidc:${id}`, F.auth.oidc(id)]),
    ['pending', F.auth.pending],
  ]
  const [authFacets] = await Model.aggregate([
    { $match: buildMatch(query, prefix, 'auth') },
    {
      $facet: {
        all: [{ $count: 'n' }],
        // facet names cannot hold the dots a provider id may have
        ...Object.fromEntries(
          authOptions.map(([, match], i) => [
            `a${i}`,
            [{ $match: match }, { $count: 'n' }],
          ])
        ),
      },
    },
  ])
  const auth = { all: countFrom(authFacets.all) }
  authOptions.forEach(([key], i) => {
    auth[key] = countFrom(authFacets[`a${i}`])
  })

  const statusFilters = filters('').status
  const [[statusFacets], deletedCount, roleAll, roleAdmin, users] =
    await Promise.all([
    User.aggregate([
      { $match: buildMatch(query, '', 'status') },
      {
        $facet: {
          all: [{ $count: 'n' }],
          ...Object.fromEntries(
            Object.entries(statusFilters).map(([key, match]) => [
              key,
              [{ $match: match }, { $count: 'n' }],
            ])
          ),
        },
      },
    ]),
    DeletedUser.countDocuments(buildMatch(query, 'user.', 'status')),
    Model.countDocuments(buildMatch(query, prefix, 'role')),
    Model.countDocuments(buildMatch({ ...query, role: 'admin' }, prefix)),
    User.estimatedDocumentCount(),
  ])
  const status = { deleted: deletedCount }
  for (const key of ['all', ...Object.keys(statusFilters)]) {
    status[key] = countFrom(statusFacets[key])
  }

  return {
    auth,
    status,
    role: { all: roleAll, admin: roleAdmin, user: roleAll - roleAdmin },
    users,
  }
}

function formatUser(user, providerNames, deletedAt) {
  const authMethods = []
  if (typeof user.hashedPassword === 'string' && user.hashedPassword !== '') {
    authMethods.push({ type: 'local' })
  }
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
  const direction = query.order === 'asc' ? 1 : -1
  const offset = page => (page - 1) * query.pageSize

  if (query.status === 'deleted') {
    const match = buildMatch(query, 'user.')
    const total = await DeletedUser.countDocuments(match)
    const page = clampPage(query.page, total, query.pageSize)
    const sort =
      query.sort === 'deletedAt'
        ? { 'deleterData.deletedAt': direction }
        : Object.fromEntries(
            SORT_FIELDS[query.sort].map(key => [`user.${key}`, direction])
          )
    const rows = await DeletedUser.aggregate([
      { $match: match },
      { $sort: { ...sort, _id: direction } },
      { $skip: offset(page) },
      { $limit: query.pageSize },
      {
        $project: {
          deletedAt: '$deleterData.deletedAt',
          ...Object.fromEntries(PROJECTION.map(key => [`user.${key}`, 1])),
        },
      },
    ]).collation(COLLATION)
    return {
      total,
      page,
      users: rows.map(row => formatUser(row.user, providerNames, row.deletedAt)),
    }
  }

  const match = buildMatch(query, '')
  const total = await User.countDocuments(match)
  const page = clampPage(query.page, total, query.pageSize)
  const sort = Object.fromEntries(
    SORT_FIELDS[query.sort].map(key => [key, direction])
  )
  const rows = await User.find(match, PROJECTION.join(' '))
    .sort({ ...sort, _id: direction })
    .collation(COLLATION)
    .skip(offset(page))
    .limit(query.pageSize)
    .lean()
    .exec()
  return {
    total,
    page,
    users: rows.map(user => formatUser(user, providerNames)),
  }
}

function clampPage(page, total, pageSize) {
  return Math.min(page, Math.max(Math.ceil(total / pageSize), 1))
}

async function getUsersResult(query) {
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

async function usersPage(req, res) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  // active = used the instance in the last 12 months, as on the license tab
  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  const [initialResult, activeUsersCount] = await Promise.all([
    getUsersResult(parseQuery(req.query)),
    User.countDocuments({ lastActive: { $gt: yearAgo } }),
  ])

  res.render(Path.resolve(__dirname, '../views/admin-users'), {
    title: 'user_management',
    initialResult,
    adminUsersOptions: {
      sessionUserId: userId,
      enabledAuth: {
        ldap: Boolean(Settings.ldap?.enable),
        saml: Boolean(Settings.saml?.enable),
        oidc: Boolean(Settings.oidc?.enable),
      },
      pageSizes: PAGE_SIZES,
      activeUsersCount,
    },
  })
}

async function usersJson(req, res) {
  res.set('Cache-Control', 'no-store')
  res.json(await getUsersResult(parseQuery(req.query)))
}

export { formatUser, getProviderIds, getProviderNames }

export default {
  usersPage: expressify(usersPage),
  usersJson: expressify(usersJson),
}
