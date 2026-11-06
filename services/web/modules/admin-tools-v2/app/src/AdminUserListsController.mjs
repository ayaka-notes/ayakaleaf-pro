import _ from 'lodash'
import { expressify } from '@overleaf/promise-utils'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import { DeletedProject } from '../../../../app/src/models/DeletedProject.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { DeletedUser } from '../../../../app/src/models/DeletedUser.mjs'
import { UserAuditLogEntry } from '../../../../app/src/models/UserAuditLogEntry.mjs'
import { ProjectAuditLogEntry } from '../../../../app/src/models/ProjectAuditLogEntry.mjs'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.mjs'
import TokenAccessHandler from '../../../../app/src/Features/TokenAccess/TokenAccessHandler.mjs'
import { Template } from '../../../template-gallery/app/src/models/Template.mjs'
import { cleanHtml } from '../../../template-gallery/app/src/CleanHtml.mjs'

// The paged lists of the user detail page, built like the user list:
// filter, sort and page in Mongo, counts for the header filter

const PAGE_SIZES = [10, 20, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 10
const COLLATION = { locale: 'en', strength: 2 }

function parsePaging(query) {
  const pageSize = parseInt(query.pageSize, 10)
  return {
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    search: typeof query.search === 'string' ? query.search.trim() : '',
  }
}

function clampPage(page, total, pageSize) {
  return Math.min(page, Math.max(Math.ceil(total / pageSize), 1))
}

function countFrom(facet) {
  return facet?.[0]?.n ?? 0
}

// a literal search, as in the user list
function literal(term) {
  return _.escapeRegExp(term)
}

function idMatches(path, term) {
  return {
    $expr: {
      $regexMatch: {
        input: { $toString: `$${path}` },
        regex: literal(term),
        options: 'i',
      },
    },
  }
}

// a user by the name the lists show, "First Last"
function fullNameMatches(term, prefix = '') {
  return {
    $expr: {
      $regexMatch: {
        input: {
          $concat: [
            { $ifNull: [`$${prefix}first_name`, ''] },
            ' ',
            { $ifNull: [`$${prefix}last_name`, ''] },
          ],
        },
        regex: literal(term),
        options: 'i',
      },
    },
  }
}

// the :userId or :projectId of the route, or a 404
function idOr404(req, res, param) {
  const id = req.params[param]
  if (!/^[0-9a-f]{24}$/i.test(id)) {
    ErrorController.notFound(req, res)
    return null
  }
  return new ObjectId(id)
}

const userIdOr404 = (req, res) => idOr404(req, res, 'userId')

// ---- projects the user owns ----

// All is every project of the user that is not deleted (as the user list);
// the deleted ones are in deletedProjects
const PROJECT_STATUSES = ['all', 'active', 'archived', 'trashed', 'deleted']

function parseProjectsQuery(query) {
  const status = PROJECT_STATUSES.includes(query.status) ? query.status : 'all'
  let sort = ['name', 'lastUpdated', 'deletedAt'].includes(query.sort)
    ? query.sort
    : 'lastUpdated'
  if (sort === 'deletedAt' && status !== 'deleted') sort = 'lastUpdated'
  const defaultOrder = sort === 'name' ? 'asc' : 'desc'
  return {
    ...parsePaging(query),
    status,
    sort,
    order: ['asc', 'desc'].includes(query.order) ? query.order : defaultOrder,
  }
}

// archived and trashed are per user (ProjectHelper.isArchived/isTrashed):
// the lists of user ids that archived or trashed the project. A user's
// projects (scope.ownerId) are filtered for that user; the site's (no
// owner) for each project's own owner
const ownerIn = field => ({
  $in: ['$owner_ref', { $cond: [{ $isArray: `$${field}` }, `$${field}`, []] }],
})

function projectStatusFilters(scope) {
  const { ownerId } = scope
  if (ownerId) {
    return {
      active: { archived: { $ne: ownerId }, trashed: { $ne: ownerId } },
      archived: { archived: ownerId, trashed: { $ne: ownerId } },
      trashed: { trashed: ownerId },
    }
  }
  return {
    active: {
      $expr: { $and: [{ $not: [ownerIn('archived')] }, { $not: [ownerIn('trashed')] }] },
    },
    archived: { $expr: { $and: [ownerIn('archived'), { $not: [ownerIn('trashed')] }] } },
    trashed: { $expr: ownerIn('trashed') },
  }
}

// by name or id; the site's list also by the owner (scope.searchOwnerIds:
// the users whose name or email matched) and by a pasted link or token
// (scope.searchProjectIds: the projects it points to)
function projectSearch(prefix, ownerField, scope, term) {
  if (!term) return []
  const regex = { $regex: literal(term), $options: 'i' }
  const or = [{ [`${prefix}name`]: regex }, idMatches(`${prefix}_id`, term)]
  if (scope.searchOwnerIds?.length) {
    or.push({ [ownerField]: { $in: scope.searchOwnerIds } })
  }
  if (scope.searchProjectIds?.length) {
    or.push({ [`${prefix}_id`]: { $in: scope.searchProjectIds } })
  }
  return [{ $or: or }]
}

function projectMatch(scope, query, skipStatus) {
  const and = [
    ...(scope.ownerId ? [{ owner_ref: scope.ownerId }] : []),
    ...projectSearch('', 'owner_ref', scope, query.search),
  ]
  const statusFilter = projectStatusFilters(scope)[query.status]
  if (statusFilter && !skipStatus) and.push(statusFilter)
  return and.length ? { $and: and } : {}
}

function deletedProjectMatch(scope, query) {
  const ownerField = 'deleterData.deletedProjectOwnerId'
  return {
    $and: [
      { project: { $type: 'object' } },
      ...(scope.ownerId ? [{ [ownerField]: scope.ownerId }] : []),
      ...projectSearch('project.', ownerField, scope, query.search),
    ],
  }
}

function projectStatus(project, ownerId) {
  const has = list => Array.isArray(list) && list.some(id => ownerId.equals(id))
  if (has(project.trashed)) return 'trashed'
  if (has(project.archived)) return 'archived'
  return 'active'
}

// the owners of the site's rows, by id: name and email, also of a deleted
// owner (deletedUsers keeps it until it expires)
async function ownersOf(ids) {
  const unique = _.uniqBy(ids.filter(Boolean), id => id.toString())
  const [users, deletedUsers] = await Promise.all([
    User.find({ _id: { $in: unique } }, 'email first_name last_name').lean().exec(),
    DeletedUser.find(
      { 'deleterData.deletedUserId': { $in: unique }, user: { $type: 'object' } },
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
    }
  }
}

async function listProjects(scope, query) {
  const direction = query.order === 'asc' ? 1 : -1
  if (query.status === 'deleted') {
    const match = deletedProjectMatch(scope, query)
    const total = await DeletedProject.countDocuments(match)
    const page = clampPage(query.page, total, query.pageSize)
    const sortKey = {
      name: 'project.name',
      lastUpdated: 'project.lastUpdated',
      deletedAt: 'deleterData.deletedAt',
    }[query.sort]
    const rows = await DeletedProject.aggregate([
      { $match: match },
      { $sort: { [sortKey]: direction, _id: direction } },
      { $skip: (page - 1) * query.pageSize },
      { $limit: query.pageSize },
      {
        $project: {
          id: '$project._id',
          name: '$project.name',
          lastUpdated: '$project.lastUpdated',
          deletedAt: '$deleterData.deletedAt',
          ownerId: '$deleterData.deletedProjectOwnerId',
        },
      },
    ]).collation(COLLATION)
    const owner = scope.ownerId ? null : await ownersOf(rows.map(row => row.ownerId))
    return {
      total,
      page,
      projects: rows.map(row => ({
        id: row.id.toString(),
        name: row.name,
        lastUpdated: row.lastUpdated,
        deletedAt: row.deletedAt,
        status: 'deleted',
        ...(owner && { owner: owner(row.ownerId) }),
      })),
    }
  }

  const match = projectMatch(scope, query)
  const total = await Project.countDocuments(match)
  const page = clampPage(query.page, total, query.pageSize)
  const rows = await Project.find(
    match,
    '_id name lastUpdated archived trashed owner_ref'
  )
    .sort({ [query.sort]: direction, _id: direction })
    .collation(COLLATION)
    .skip((page - 1) * query.pageSize)
    .limit(query.pageSize)
    .lean()
    .exec()
  const owner = scope.ownerId ? null : await ownersOf(rows.map(row => row.owner_ref))
  return {
    total,
    page,
    projects: rows.map(project => ({
      id: project._id.toString(),
      name: project.name,
      lastUpdated: project.lastUpdated,
      status: projectStatus(project, scope.ownerId ?? project.owner_ref),
      ...(owner && { owner: owner(project.owner_ref) }),
    })),
  }
}

async function projectCounts(scope, query) {
  const filters = projectStatusFilters(scope)
  const [[facets], deleted] = await Promise.all([
    Project.aggregate([
      { $match: projectMatch(scope, query, true) },
      {
        $facet: {
          all: [{ $count: 'n' }],
          ...Object.fromEntries(
            Object.entries(filters).map(([key, match]) => [
              key,
              [{ $match: match }, { $count: 'n' }],
            ])
          ),
        },
      },
    ]),
    DeletedProject.countDocuments(deletedProjectMatch(scope, query)),
  ])
  return {
    all: countFrom(facets.all),
    active: countFrom(facets.active),
    archived: countFrom(facets.archived),
    trashed: countFrom(facets.trashed),
    deleted,
  }
}

async function projectsResult(scope, query) {
  const [list, counts] = await Promise.all([
    listProjects(scope, query),
    projectCounts(scope, query),
  ])
  return { ...list, query: { ...query, page: list.page }, counts }
}

async function projectsJson(req, res) {
  const ownerId = userIdOr404(req, res)
  if (!ownerId) return
  const query = parseProjectsQuery(req.query)
  res.set('Cache-Control', 'no-store')
  res.json(await projectsResult({ ownerId }, query))
}

// Every project of the site (/admin/project), as a user's Projects tab; a
// search also matches the owner's name or email
async function allProjectsJson(req, res) {
  const query = parseProjectsQuery(req.query)
  res.set('Cache-Control', 'no-store')
  res.json(await projectsResult(await siteScope(query), query))
}

// the owners whose name or email the search matches (at most 1000: a search
// that broad is narrowed by the name or id part anyway), and the projects a
// pasted link or token points to
async function siteScope(query) {
  if (!query.search) return {}
  const regex = { $regex: literal(query.search), $options: 'i' }
  const [owners, searchProjectIds] = await Promise.all([
    User.find(
      {
        $or: [
          { email: regex },
          { first_name: regex },
          { last_name: regex },
          fullNameMatches(query.search),
        ],
      },
      '_id'
    )
      .limit(1000)
      .lean()
      .exec(),
    linkProjectIds(query.search),
  ])
  return { searchOwnerIds: owners.map(owner => owner._id), searchProjectIds }
}

// the paths of a project's links, as the token routes and the editor take
// them: the view link /read/<token>, the edit link /<token>, the editor's
// /project/<id> and this module's /admin/project/<id>
const LINK_PATH = new RegExp(
  `^/(?:read/(${TokenAccessHandler.READ_ONLY_TOKEN_PATTERN})` +
    `|(${TokenAccessHandler.READ_AND_WRITE_TOKEN_PATTERN})` +
    '|(?:admin/)?project/([0-9a-f]{24}))$'
)

// a link on any host name the site answers to (only its path counts, so
// the #hash the share modal adds goes too), or a bare token
function parseLink(term) {
  let path
  try {
    path = new URL(term).pathname
  } catch {
    return { token: term }
  }
  const [, readOnly, readAndWrite, projectId] = path.match(LINK_PATH) ?? []
  return { token: readOnly ?? readAndWrite, projectId }
}

// a live project as the token routes find it (TokenAccessHandler), a
// deleted one by the token it kept
async function linkProjectIds(term) {
  const { token, projectId } = parseLink(term)
  if (projectId) return [new ObjectId(projectId)]
  const type = TokenAccessHandler.getTokenType(token)
  if (!type) return []
  const field =
    type === TokenAccessHandler.TOKEN_TYPES.READ_ONLY ? 'readOnly' : 'readAndWrite'
  const [project, deleted] = await Promise.all([
    TokenAccessHandler.promises.getProjectByToken(type, token),
    DeletedProject.find({ [`project.tokens.${field}`]: token }, 'project._id')
      .lean()
      .exec(),
  ])
  return [project?._id, ...deleted.map(entry => entry.project._id)].filter(
    Boolean
  )
}

// ---- audit log entries ----

function parseAuditLogQuery(query) {
  return {
    ...parsePaging(query),
    operation:
      typeof query.operation === 'string' && query.operation !== ''
        ? query.operation
        : 'all',
  }
}

// a user's or a project's log: both collections hold the same fields
// (operation, initiatorId, ipAddress, timestamp, info)
function auditLogMatch(scope, query, skipOperation) {
  const and = [scope]
  if (query.search) {
    const regex = { $regex: literal(query.search), $options: 'i' }
    and.push({ $or: [{ operation: regex }, { ipAddress: regex }] })
  }
  if (query.operation !== 'all' && !skipOperation) {
    and.push({ operation: query.operation })
  }
  return { $and: and }
}

async function auditLogList(Model, scope, rawQuery) {
  const query = parseAuditLogQuery(rawQuery)
  const match = auditLogMatch(scope, query)
  const [total, operations] = await Promise.all([
    Model.countDocuments(match),
    Model.aggregate([
      { $match: auditLogMatch(scope, query, true) },
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

  const initiatorIds = _.uniq(
    entries.map(entry => entry.initiatorId?.toString()).filter(Boolean)
  )
  const initiators = await User.find({ _id: { $in: initiatorIds } }, 'email')
    .lean()
    .exec()
  const emails = Object.fromEntries(
    initiators.map(user => [user._id.toString(), user.email])
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
      initiatorEmail: emails[entry.initiatorId?.toString()],
      ipAddress: entry.ipAddress,
      info: entry.info,
    })),
  }
}

async function auditLogJson(req, res) {
  const userId = userIdOr404(req, res)
  if (!userId) return
  res.set('Cache-Control', 'no-store')
  res.json(await auditLogList(UserAuditLogEntry, { userId }, req.query))
}

async function projectAuditLogJson(req, res) {
  const projectId = idOr404(req, res, 'projectId')
  if (!projectId) return
  res.set('Cache-Control', 'no-store')
  res.json(await auditLogList(ProjectAuditLogEntry, { projectId }, req.query))
}

function parseTemplatesQuery(query) {
  const sort = query.sort === 'name' ? 'name' : 'lastUpdated'
  const defaultOrder = sort === 'name' ? 'asc' : 'desc'
  return {
    ...parsePaging(query),
    sort,
    order: ['asc', 'desc'].includes(query.order) ? query.order : defaultOrder,
  }
}

// The templates of the gallery, for the Templates tab of /admin/project. The
// gallery's /api/templates tells no owners and stops at 50 a page.
async function templatesJson(req, res) {
  const query = parseTemplatesQuery(req.query)
  // the gallery's search: the markdown sources, the rendered fields hold HTML
  const regex = { $regex: literal(query.search), $options: 'i' }
  const match = query.search
    ? { $or: [{ name: regex }, { authorMD: regex }, { descriptionMD: regex }] }
    : {}
  const direction = query.order === 'asc' ? 1 : -1
  const total = await Template.countDocuments(match)
  const page = clampPage(query.page, total, query.pageSize)
  const rows = await Template.find(match, '_id name author owner lastUpdated')
    .sort({ [query.sort]: direction, _id: direction })
    .collation(COLLATION)
    .skip((page - 1) * query.pageSize)
    .limit(query.pageSize)
    .lean()
    .exec()
  const owner = await ownersOf(rows.map(row => row.owner))
  res.set('Cache-Control', 'no-store')
  res.json({
    total,
    page,
    query: { ...query, page },
    templates: rows.map(template => ({
      id: template._id.toString(),
      name: template.name,
      author: cleanHtml(template.author, 'plainText'),
      owner: owner(template.owner),
      lastUpdated: template.lastUpdated,
    })),
  })
}

export { fullNameMatches, idOr404, userIdOr404, projectStatus }

export default {
  projectsJson: expressify(projectsJson),
  allProjectsJson: expressify(allProjectsJson),
  templatesJson: expressify(templatesJson),
  auditLogJson: expressify(auditLogJson),
  projectAuditLogJson: expressify(projectAuditLogJson),
}
