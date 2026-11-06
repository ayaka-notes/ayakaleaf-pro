import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import Settings from '@overleaf/settings'
import { listProjectEntries } from './AdminAuditLog.mjs'
import AdminProjectManager from './AdminProjectManager.mjs'
import {
  adminOf,
  adminRoute,
  idParam,
  sendFresh,
} from './AdminRequestHelper.mjs'
import AdminTemplateManager from './AdminTemplateManager.mjs'

// The /admin/project routes: every project of the site, a project's page, and
// the templates of the gallery, which share the list's page.

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const PROJECTS_VIEW = Path.resolve(__dirname, '../views/admin-projects')
const PROJECT_VIEW = Path.resolve(__dirname, '../views/admin-project')

// ---- the list of every project, and the templates ----

// Its rows come from /admin/projects/list, and the Templates tab shows while
// the template gallery is on (it sets Settings.templates)
async function projectsPage(req, res) {
  res.render(PROJECTS_VIEW, {
    title: 'user_management',
    adminUsersOptions: {
      sessionUserId: adminOf(req).id,
      templatesEnabled: Boolean(Settings.templates),
    },
  })
}

async function projectsJson(req, res) {
  sendFresh(res, await AdminProjectManager.getSiteProjectList(req.query))
}

async function templatesJson(req, res) {
  sendFresh(res, await AdminTemplateManager.getTemplateList(req.query))
}

async function deleteTemplate(req, res) {
  await AdminTemplateManager.deleteTemplate(
    idParam(req, 'templateId'),
    adminOf(req)
  )
  res.sendStatus(200)
}

// ---- a project's page ----

async function projectPage(req, res) {
  const adminProject = await AdminProjectManager.getProjectPage(
    idParam(req, 'projectId')
  )
  res.render(PROJECT_VIEW, {
    title: 'user_management',
    adminProject: { ...adminProject, sessionUserId: adminOf(req).id },
  })
}

async function auditLogJson(req, res) {
  sendFresh(res, await listProjectEntries(idParam(req, 'projectId'), req.query))
}

async function restoreDeletedDoc(req, res) {
  res.json(
    await AdminProjectManager.restoreDeletedDoc(
      idParam(req, 'projectId'),
      req.params.docId,
      adminOf(req)
    )
  )
}

async function deleteProject(req, res) {
  await AdminProjectManager.deleteProject(
    idParam(req, 'projectId'),
    adminOf(req)
  )
  res.sendStatus(200)
}

async function undeleteProject(req, res) {
  res.json(
    await AdminProjectManager.undeleteProject(
      idParam(req, 'projectId'),
      req.body.userId,
      adminOf(req)
    )
  )
}

async function purgeDeletedProject(req, res) {
  await AdminProjectManager.purgeDeletedProject(
    idParam(req, 'projectId'),
    adminOf(req)
  )
  res.sendStatus(200)
}

export default {
  projectsPage: adminRoute(projectsPage),
  projectsJson: adminRoute(projectsJson),
  templatesJson: adminRoute(templatesJson),
  deleteTemplate: adminRoute(deleteTemplate),
  projectPage: adminRoute(projectPage),
  auditLogJson: adminRoute(auditLogJson),
  restoreDeletedDoc: adminRoute(restoreDeletedDoc),
  deleteProject: adminRoute(deleteProject),
  undeleteProject: adminRoute(undeleteProject),
  purgeDeletedProject: adminRoute(purgeDeletedProject),
}
