import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import { Project } from '../../../../app/src/models/Project.mjs'
import { DeletedProject } from '../../../../app/src/models/DeletedProject.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectEntityRestoreHandler from '../../../../app/src/Features/Project/ProjectEntityRestoreHandler.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import CollaboratorsInviteGetter from '../../../../app/src/Features/Collaborators/CollaboratorsInviteGetter.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import { DeletedProjectReasons } from '../../../../app/src/Features/Project/DeletedProjectReasons.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import { Template } from '../../../template-gallery/app/src/models/Template.mjs'
import TemplateGalleryManager from '../../../template-gallery/app/src/TemplateGalleryManager.mjs'
import { logOnAdmin, logOnProject } from './AdminAuditLog.mjs'
import { idOr404, projectStatus } from './AdminUserListsController.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

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

const USER_FIELDS = 'email first_name last_name'

const formatUser = user =>
  user && {
    id: user._id.toString(),
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
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
async function members(projectId) {
  const [entries, invites] = await Promise.all([
    CollaboratorsGetter.promises.getMemberIdsWithPrivilegeLevels(projectId),
    CollaboratorsInviteGetter.promises.getAllInvites(projectId),
  ])
  const users = await User.find(
    { _id: { $in: entries.map(entry => entry.id) } },
    USER_FIELDS
  )
    .lean()
    .exec()
  const byId = new Map(users.map(user => [user._id.toString(), user]))
  return {
    members: entries.map(entry => ({
      ...formatUser(byId.get(entry.id)),
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

async function projectPage(req, res) {
  const projectId = idOr404(req, res, 'projectId')
  if (!projectId) return
  const sessionUserId = SessionManager.getLoggedInUserId(req.session)

  const project = await Project.findById(projectId, PROJECT_FIELDS)
    .lean()
    .exec()
  if (project) {
    const historyId = project.overleaf?.history?.id
    const [owner, people, deletedDocs, [blobStats]] = await Promise.all([
      User.findById(project.owner_ref, USER_FIELDS).lean().exec(),
      members(projectId),
      DocstoreManager.promises.getAllDeletedDocs(projectId),
      HistoryManager.promises.getProjectBlobStats([historyId]),
    ])
    return res.render(Path.resolve(__dirname, '../views/admin-project'), {
      title: 'user_management',
      adminProject: {
        project: {
          ...overview(project),
          status: projectStatus(project, project.owner_ref),
          size: blobStats?.totalBytes,
        },
        owner: formatUser(owner),
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
        sessionUserId,
      },
    })
  }

  // a deleted project keeps its document in deletedProjects until it
  // expires; the list does not show expired ones (project: null) either
  const deletedProject = await DeletedProject.findOne({
    'deleterData.deletedProjectId': projectId,
    project: { $type: 'object' },
  })
    .lean()
    .exec()
  if (!deletedProject) {
    return ErrorController.notFound(req, res)
  }
  const { deleterData } = deletedProject
  const [owner, deleter] = await Promise.all([
    User.findById(deleterData.deletedProjectOwnerId, USER_FIELDS).lean().exec(),
    deleterData.deleterId &&
      User.findById(deleterData.deleterId, USER_FIELDS).lean().exec(),
  ])
  res.render(Path.resolve(__dirname, '../views/admin-project'), {
    title: 'user_management',
    adminProject: {
      project: {
        ...overview(deletedProject.project),
        status: 'deleted',
        deletedAt: deleterData.deletedAt,
      },
      owner: formatUser(owner),
      ownerId: deleterData.deletedProjectOwnerId?.toString(),
      deleter: {
        id: deleterData.deleterId?.toString(),
        email: deleter?.email,
        ipAddress: deleterData.deleterIpAddress,
      },
      sessionUserId,
    },
  })
}

// core's restore of a deleted doc (the original admin page's Deleted Docs
// tab): a new doc with the old content, named "<name>-<timestamp>.tex"
async function restoreDeletedDoc(req, res) {
  const projectId = idOr404(req, res, 'projectId')
  if (!projectId) return
  const { docId } = req.params
  const deletedDocs = await DocstoreManager.promises.getAllDeletedDocs(projectId)
  const deletedDoc = deletedDocs.find(doc => doc._id.toString() === docId)
  if (!deletedDoc) {
    return ErrorController.notFound(req, res)
  }
  const doc = await ProjectEntityRestoreHandler.promises.restoreDeletedDoc(
    projectId,
    docId,
    deletedDoc.name,
    SessionManager.getLoggedInUserId(req.session)
  )
  await logOnProject(req, projectId, 'restore-deleted-doc', {
    docId,
    name: deletedDoc.name,
    restoredAs: doc.name,
  })
  res.json({ id: doc._id.toString(), name: doc.name })
}

// The list of every project, its rows from /admin/projects/list, and the
// Templates tab while the template gallery is on (it sets Settings.templates)
async function projectsPage(req, res) {
  res.render(Path.resolve(__dirname, '../views/admin-projects'), {
    title: 'user_management',
    adminUsersOptions: {
      sessionUserId: SessionManager.getLoggedInUserId(req.session),
      templatesEnabled: Boolean(Settings.templates),
    },
  })
}

// As core's delete, which logs this only in managed groups
async function deleteProject(req, res) {
  const projectId = idOr404(req, res, 'projectId')
  if (!projectId) return
  await ProjectDeleter.promises.deleteProject(projectId, {
    deleterUser: SessionManager.getSessionUser(req.session),
    ipAddress: req.ip,
    deletedReason: DeletedProjectReasons.USER,
  })
  await logOnProject(req, projectId, 'project-deleted')
  res.sendStatus(200)
}

// A deleted project back to its owner, out of their trash too. The restored
// name can have a suffix: another project may have taken it meanwhile.
async function undeleteProject(req, res) {
  const projectId = idOr404(req, res, 'projectId')
  if (!projectId) return
  const { userId } = req.body
  await ProjectDeleter.promises.undeleteProject(projectId, { userId })
  await ProjectDeleter.promises.untrashProject(projectId, userId)
  const { name } = await Project.findById(projectId, { name: 1 }).lean()
  await logOnProject(req, projectId, 'project-restored')
  res.json({ name })
}

async function purgeDeletedProject(req, res) {
  const projectId = idOr404(req, res, 'projectId')
  if (!projectId) return
  const deleted = await DeletedProject.findOne(
    { 'deleterData.deletedProjectId': projectId },
    { 'project.name': 1 }
  ).lean()
  await ProjectDeleter.promises.expireDeletedProject(projectId)
  await logOnAdmin(req, 'purge-deleted-project', {
    projectId,
    name: deleted?.project?.name,
  })
  res.sendStatus(200)
}

// The gallery's delete, with its version looked up
async function deleteTemplate(req, res) {
  const templateId = idOr404(req, res, 'templateId')
  if (!templateId) return
  const template = await Template.findById(templateId, {
    name: 1,
    version: 1,
  }).lean()
  if (!template) return ErrorController.notFound(req, res)
  await TemplateGalleryManager.deleteTemplate({
    templateId: templateId.toString(),
    version: template.version,
  })
  await logOnAdmin(req, 'delete-template', {
    templateId,
    name: template.name,
  })
  res.sendStatus(200)
}

export default {
  projectsPage: expressify(projectsPage),
  projectPage: expressify(projectPage),
  restoreDeletedDoc: expressify(restoreDeletedDoc),
  deleteProject: expressify(deleteProject),
  undeleteProject: expressify(undeleteProject),
  purgeDeletedProject: expressify(purgeDeletedProject),
  deleteTemplate: expressify(deleteTemplate),
}
