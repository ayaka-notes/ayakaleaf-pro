import Path from 'node:path'
import Settings from '@overleaf/settings'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import { DeletedProject } from '../../../../app/src/models/DeletedProject.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import CollaboratorsInviteGetter from '../../../../app/src/Features/Collaborators/CollaboratorsInviteGetter.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import { DeletedProjectReasons } from '../../../../app/src/Features/Project/DeletedProjectReasons.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectEntityRestoreHandler from '../../../../app/src/Features/Project/ProjectEntityRestoreHandler.mjs'
import TokenAccessHandler from '../../../../app/src/Features/TokenAccess/TokenAccessHandler.mjs'
import { logOnAdmin, logOnProject } from './AdminAuditLog.mjs'
import { RefusedError } from './AdminErrors.mjs'
import {
  aggregatePage,
  containing,
  countOptions,
  findPage,
  idMatches,
  parseOrder,
  parsePaging,
  sortBy,
} from './AdminQueryHelper.mjs'
import AdminUserListManager from './AdminUserListManager.mjs'

// The projects of the site and of a user, a project's page, and what an admin
// does to a project. Editing one goes through core's own routes.

const PROJECT_FIELDS = [
  '_id',
  'name',
  'owner_ref',
  'lastUpdated',
  'lastOpened',
  'publicAccesLevel',
  'compiler',
  'imageName',
  'rootDoc_id',
  'rootFolder',
  'archived',
  'trashed',
  'overleaf.history.id',
].join(' ')

const PERSON_FIELDS = 'email first_name last_name'

// ---- the list's query ----

// All is every project that is not deleted (as the user list); the deleted
// ones are in deletedProjects
const STATUSES = ['all', 'active', 'archived', 'trashed', 'deleted']

function parseProjectsQuery(query) {
  const status = STATUSES.includes(query.status) ? query.status : 'all'
  let sort = ['name', 'lastUpdated', 'deletedAt'].includes(query.sort)
    ? query.sort
    : 'lastUpdated'
  if (sort === 'deletedAt' && status !== 'deleted') sort = 'lastUpdated'
  return {
    ...parsePaging(query),
    status,
    sort,
    order: parseOrder(query, sort === 'name' ? 'asc' : 'desc'),
  }
}

// archived and trashed are per user (ProjectHelper.isArchived/isTrashed):
// the lists of user ids that archived or trashed the project. A user's
// projects (scope.ownerId) are filtered for that user; the site's (no
// owner) for each project's own owner
const ownerIn = field => ({
  $in: ['$owner_ref', { $cond: [{ $isArray: `$${field}` }, `$${field}`, []] }],
})

function statusFilters({ ownerId }) {
  if (ownerId) {
    return {
      active: { archived: { $ne: ownerId }, trashed: { $ne: ownerId } },
      archived: { archived: ownerId, trashed: { $ne: ownerId } },
      trashed: { trashed: ownerId },
    }
  }
  return {
    active: {
      $expr: {
        $and: [{ $not: [ownerIn('archived')] }, { $not: [ownerIn('trashed')] }],
      },
    },
    archived: {
      $expr: { $and: [ownerIn('archived'), { $not: [ownerIn('trashed')] }] },
    },
    trashed: { $expr: ownerIn('trashed') },
  }
}

// by name or id; the site's list also by the owner (scope.searchOwnerIds:
// the users whose name or email matched) and by a pasted link or token
// (scope.searchProjectIds: the projects it points to)
function searchFilter(prefix, ownerField, scope, term) {
  if (!term) return []
  const or = [
    { [`${prefix}name`]: containing(term) },
    idMatches(`${prefix}_id`, term),
  ]
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
    ...searchFilter('', 'owner_ref', scope, query.search),
  ]
  const statusFilter = statusFilters(scope)[query.status]
  if (statusFilter && !skipStatus) and.push(statusFilter)
  return and.length ? { $and: and } : {}
}

function deletedProjectMatch(scope, query) {
  const ownerField = 'deleterData.deletedProjectOwnerId'
  return {
    $and: [
      { project: { $type: 'object' } },
      ...(scope.ownerId ? [{ [ownerField]: scope.ownerId }] : []),
      ...searchFilter('project.', ownerField, scope, query.search),
    ],
  }
}

function projectStatus(project, ownerId) {
  const has = list => Array.isArray(list) && list.some(id => ownerId.equals(id))
  if (has(project.trashed)) return 'trashed'
  if (has(project.archived)) return 'archived'
  return 'active'
}

// ---- searching the site by link ----

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
    type === TokenAccessHandler.TOKEN_TYPES.READ_ONLY
      ? 'readOnly'
      : 'readAndWrite'
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

async function siteScope(query) {
  if (!query.search) return {}
  const [searchOwnerIds, searchProjectIds] = await Promise.all([
    AdminUserListManager.getUserIdsMatching(query.search),
    linkProjectIds(query.search),
  ])
  return { searchOwnerIds, searchProjectIds }
}

// ---- the lists ----

async function listDeletedProjects(scope, query) {
  const sortKey = {
    name: 'project.name',
    lastUpdated: 'project.lastUpdated',
    deletedAt: 'deleterData.deletedAt',
  }[query.sort]
  const { rows, ...list } = await aggregatePage(
    DeletedProject,
    deletedProjectMatch(scope, query),
    {
      id: '$project._id',
      name: '$project.name',
      lastUpdated: '$project.lastUpdated',
      deletedAt: '$deleterData.deletedAt',
      ownerId: '$deleterData.deletedProjectOwnerId',
    },
    sortBy([sortKey], query.order),
    query
  )
  const owner = scope.ownerId
    ? null
    : await AdminUserListManager.ownersOf(
        rows.map(row => row.ownerId),
        query.search
      )
  return {
    ...list,
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

async function listProjects(scope, query) {
  if (query.status === 'deleted') return listDeletedProjects(scope, query)

  const { rows, ...list } = await findPage(
    Project,
    projectMatch(scope, query),
    '_id name lastUpdated archived trashed owner_ref',
    sortBy([query.sort], query.order),
    query
  )
  const owner = scope.ownerId
    ? null
    : await AdminUserListManager.ownersOf(
        rows.map(row => row.owner_ref),
        query.search
      )
  return {
    ...list,
    projects: rows.map(project => ({
      id: project._id.toString(),
      name: project.name,
      lastUpdated: project.lastUpdated,
      status: projectStatus(project, scope.ownerId ?? project.owner_ref),
      ...(owner && { owner: owner(project.owner_ref) }),
    })),
  }
}

async function getProjectList(scope, query) {
  const [list, counts, deleted] = await Promise.all([
    listProjects(scope, query),
    countOptions(
      Project,
      projectMatch(scope, query, true),
      statusFilters(scope)
    ),
    DeletedProject.countDocuments(deletedProjectMatch(scope, query)),
  ])
  return {
    ...list,
    query: { ...query, page: list.page },
    counts: { ...counts, deleted },
  }
}

function getUserProjectList(ownerId, rawQuery) {
  return getProjectList({ ownerId }, parseProjectsQuery(rawQuery))
}

// Every project of the site (/admin/project), as a user's Projects tab; a
// search also matches the owner's name or email
async function getSiteProjectList(rawQuery) {
  const query = parseProjectsQuery(rawQuery)
  return getProjectList(await siteScope(query), query)
}

// ---- a project's page ----

function formatPerson(user) {
  return (
    user && {
      id: user._id.toString(),
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    }
  )
}

// A project stores its image with the image root, the site's list and the
// editor use the bare name (ProjectEditorHandler)
function bareImageName(imageName) {
  return imageName != null ? Path.basename(imageName) : undefined
}

// The image the project compiles with, by the name the editor's menu shows
function texLiveVersion(imageName) {
  if (!imageName) return null
  const image = (Settings.allowedImageNames || []).find(
    image => image.imageName === imageName
  )
  return image?.imageDesc ?? imageName
}

// The overview of a project (live or deleted): what both pages show
function overview(project) {
  const { docs, files, folders } =
    ProjectEntityHandler.getAllEntitiesFromProject(project)
  const rootDoc =
    project.rootDoc_id &&
    docs.find(({ doc }) => doc._id.equals(project.rootDoc_id))
  return {
    id: project._id.toString(),
    name: project.name,
    // the project document has no creation date of its own
    createdAt: project._id.getTimestamp(),
    lastUpdated: project.lastUpdated,
    lastOpened: project.lastOpened,
    linkSharing: project.publicAccesLevel === 'tokenBased',
    compiler: project.compiler,
    imageName: bareImageName(project.imageName),
    texLiveVersion: texLiveVersion(bareImageName(project.imageName)),
    mainDocument: rootDoc?.path,
    rootDocId: project.rootDoc_id?.toString(),
    historyId: project.overleaf?.history?.id?.toString(),
    // the file tree, sorted by path; the root folder itself is left out
    entries: [
      ...folders
        .filter(({ path }) => path !== '/')
        .map(({ path }) => ({ path, type: 'folder' })),
      ...docs.map(({ path, doc }) => ({
        path,
        type: 'doc',
        id: doc._id.toString(),
      })),
      ...files.map(({ path, file }) => ({
        path,
        type: 'file',
        createdAt: file.created,
      })),
    ].sort((a, b) => a.path.localeCompare(b.path)),
  }
}

// members as core lists them (owner, invited, link sharing), with their
// names, then the invites nobody accepted yet
async function getMembers(projectId) {
  const [entries, invites] = await Promise.all([
    CollaboratorsGetter.promises.getMemberIdsWithPrivilegeLevels(projectId),
    CollaboratorsInviteGetter.promises.getAllInvites(projectId),
  ])
  const users = await User.find(
    { _id: { $in: entries.map(entry => entry.id) } },
    PERSON_FIELDS
  )
    .lean()
    .exec()
  const byId = new Map(users.map(user => [user._id.toString(), user]))
  return {
    members: entries.map(entry => ({
      ...formatPerson(byId.get(entry.id)),
      id: entry.id,
      privilegeLevel: entry.privilegeLevel,
      source: entry.source,
    })),
    invites: invites.map(invite => ({
      id: invite._id.toString(),
      email: invite.email,
      privilegeLevel: invite.privileges,
    })),
  }
}

async function getProjectPage(projectId) {
  const project = await Project.findById(projectId, PROJECT_FIELDS)
    .lean()
    .exec()
  if (project) {
    const historyId = project.overleaf?.history?.id
    const [owner, people, deletedDocs, [blobStats]] = await Promise.all([
      User.findById(project.owner_ref, PERSON_FIELDS).lean().exec(),
      getMembers(projectId),
      DocstoreManager.promises.getAllDeletedDocs(projectId),
      historyId ? HistoryManager.promises.getProjectBlobStats([historyId]) : [],
    ])
    return {
      project: {
        ...overview(project),
        status: projectStatus(project, project.owner_ref),
        size: blobStats?.totalBytes,
      },
      owner: formatPerson(owner),
      ...people,
      // the editor's TeX Live menu, for the overview's edit form
      imageNames: (Settings.allowedImageNames || []).map(
        ({ imageName, imageDesc }) => ({ imageName, imageDesc })
      ),
      deletedDocs: deletedDocs.map(doc => ({
        id: doc._id.toString(),
        name: doc.name,
        deletedAt: doc.deletedAt,
      })),
    }
  }

  // a deleted project keeps its document in deletedProjects until it
  // expires; the list does not show expired ones (project: null) either
  const deletedProject = await DeletedProject.findOne({
    'deleterData.deletedProjectId': projectId,
    project: { $type: 'object' },
  })
    .lean()
    .exec()
  if (!deletedProject) throw new Errors.NotFoundError('project not found')
  const { deleterData } = deletedProject
  // the owner and the deleter can be deleted users too, as in the list
  const personOf = await AdminUserListManager.ownersOf([
    deleterData.deletedProjectOwnerId,
    deleterData.deleterId,
  ])
  const owner = personOf(deleterData.deletedProjectOwnerId)
  const deleter = personOf(deleterData.deleterId)
  return {
    project: {
      ...overview(deletedProject.project),
      status: 'deleted',
      deletedAt: deleterData.deletedAt,
    },
    // ownersOf gives the full name
    owner: owner.email && {
      id: owner.id,
      email: owner.email,
      firstName: owner.name,
    },
    ownerId: deleterData.deletedProjectOwnerId?.toString(),
    deleter: {
      id: deleterData.deleterId?.toString(),
      email: deleter?.email,
      ipAddress: deleterData.deleterIpAddress,
    },
  }
}

// ---- what an admin does to a project ----

// core's restore of a deleted doc (the original admin page's Deleted Docs
// tab): a new doc with the old content, named "<name>-<timestamp>.tex"
async function restoreDeletedDoc(projectId, docId, admin) {
  if (!(await Project.exists({ _id: projectId }))) {
    throw new Errors.NotFoundError('project not found')
  }
  const deletedDocs =
    await DocstoreManager.promises.getAllDeletedDocs(projectId)
  const deletedDoc = deletedDocs.find(doc => doc._id.toString() === docId)
  if (!deletedDoc) throw new Errors.NotFoundError('deleted doc not found')
  const doc = await ProjectEntityRestoreHandler.promises.restoreDeletedDoc(
    projectId,
    docId,
    deletedDoc.name,
    admin.id
  )
  await logOnProject(admin, projectId, 'restore-deleted-doc', {
    docId,
    name: deletedDoc.name,
    restoredAs: doc.name,
  })
  return { id: doc._id.toString(), name: doc.name }
}

// As core's delete, which logs this only in managed groups
async function deleteProject(projectId, admin) {
  await ProjectDeleter.promises.deleteProject(projectId, {
    deleterUser: { _id: admin.id },
    ipAddress: admin.ip,
    deletedReason: DeletedProjectReasons.USER,
  })
  await logOnProject(admin, projectId, 'project-deleted')
}

// A deleted project back to its owner, out of their trash too. The restored
// name can have a suffix: another project may have taken it meanwhile.
async function undeleteProject(projectId, admin) {
  const deleted = await DeletedProject.findOne(
    { 'deleterData.deletedProjectId': projectId },
    { 'deleterData.deletedProjectOwnerId': 1 }
  ).lean()
  if (!deleted) throw new Errors.NotFoundError('deleted project not found')
  const ownerId = deleted.deleterData.deletedProjectOwnerId
  // core would bring it back owned by nobody
  if (!(await User.exists({ _id: ownerId }))) {
    throw new RefusedError(
      'The owner of this project is deleted: restore the owner first'
    )
  }
  await ProjectDeleter.promises.undeleteProject(projectId, { userId: ownerId })
  await ProjectDeleter.promises.untrashProject(projectId, ownerId)
  const { name } = await Project.findById(projectId, { name: 1 }).lean()
  await logOnProject(admin, projectId, 'project-restored')
  return { name }
}

async function purgeDeletedProject(projectId, admin) {
  const deleted = await DeletedProject.findOne(
    { 'deleterData.deletedProjectId': projectId },
    { 'project.name': 1 }
  ).lean()
  // a stale page: somebody restored it meanwhile, nothing to purge or to log
  if (!deleted) throw new Errors.NotFoundError('deleted project not found')
  await ProjectDeleter.promises.expireDeletedProject(projectId)
  await logOnAdmin(admin, 'purge-deleted-project', {
    projectId,
    name: deleted?.project?.name,
  })
}

export default {
  getUserProjectList,
  getSiteProjectList,
  getProjectPage,
  restoreDeletedDoc,
  deleteProject,
  undeleteProject,
  purgeDeletedProject,
}
