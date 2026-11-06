import Path from 'node:path'
import { expressify } from '@overleaf/promise-utils'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import { fetchJson } from '@overleaf/fetch-utils'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import UserSettingsHelper from '../../../../app/src/Features/Project/UserSettingsHelper.mjs'

const REQUEST_TIMEOUT_MS = 10000
const __dirname = Path.dirname(new URL(import.meta.url).pathname)

// Helper function to get all active projects from real-time service
export async function getActiveProjectsFromRealTime() {
  const realTimeUrl = Settings.apis.realTime?.url || 'http://127.0.0.1:3026'
  const url = `${realTimeUrl}/clients`
  const user = Settings.apis.realTime?.user || process.env.WEB_API_USER || 'overleaf'
  const password = Settings.apis.realTime?.pass || process.env.WEB_API_PASSWORD || ''

  logger.debug({ url, user }, 'Fetching active clients from real-time service')

  let clients
  try {
    clients = await fetchJson(url, {
      basicAuth: {
        user,
        password,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    throw new OError('Error getting active clients from real-time', {}, err)
  }
  if (!Array.isArray(clients)) {
    throw new OError('Unexpected response body from real-time service', { body: clients })
  }

  const projectMap = new Map()

  for (const client of clients) {
    let list = projectMap.get(client.project_id)
    if (!list) {
      list = []
      projectMap.set(client.project_id, list)
    }
    list.push(client)
  }

  logger.debug({ projectCount: projectMap.size }, 'Got active projects from real-time')

  const enrichedProjects = await Promise.all(
    [...projectMap.entries()].map(async ([projectId, clients]) => {
      try {
        const project = await ProjectGetter.promises.getProject(projectId, {
          _id: 1,
          name: 1,
        })

        if (!project) {
          throw new OError('Project not found in database', { projectId })
        }

        return {
          id: project._id.toString(),
          name: project.name,
          activeUsers: clients.map(client => ({
            name: `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.email || 'Unknown',
            email: client.email,
          })),
          connectionCount: clients.length,
        }
      } catch (err) {
        throw new OError('Error enriching project data', { projectId }, err)
      }
    })
  )

  return enrichedProjects.filter(Boolean)
}

/**
 * Dedicated /admin/active-projects page (moved out of the classic admin
 * panel tab). The initial list is prefetched server-side so the page is
 * useful immediately; the client re-polls /admin/active-projects/list.
 */
async function activeProjectsPage(req, res, next) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  const user = await User.findById(userId, 'ace')
  const userSettings = await UserSettingsHelper.buildUserSettings(req, res, user)

  // Prefetch the initial list; on failure the client refetches and shows
  // an error state instead of a broken page.
  let activeProjects = []
  try {
    activeProjects = await getActiveProjectsFromRealTime()
  } catch (err) {
    logger.warn({ err }, 'prefetching active projects failed; the client will retry')
  }

  res.render(Path.resolve(__dirname, '../views/active-projects-react'), {
    title: 'Active Projects',
    userSettings,
    activeProjects,
  })
}

/** JSON list endpoint used by the page (POST + CSRF, like other admin JSON). */
async function listActiveProjects(req, res, next) {
  const projects = await getActiveProjectsFromRealTime()
  res.json(projects)
}

export default {
  activeProjectsPage: expressify(activeProjectsPage),
  listActiveProjects: expressify(listActiveProjects),
}
