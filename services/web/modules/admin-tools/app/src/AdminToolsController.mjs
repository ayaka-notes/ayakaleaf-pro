import { expressify } from '@overleaf/promise-utils'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import { fetchJson } from '@overleaf/fetch-utils'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'

const REQUEST_TIMEOUT_MS = 10000

// Helper function to get all active projects from real-time service
async function getActiveProjectsFromRealTime() {
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

async function activeProjects(req, res) {
  try {
    const projects = await getActiveProjectsFromRealTime()
    res.json(projects)
  } catch (err) {
    const info = OError.getFullInfo(err)
    logger.error(OError.getFullStack(err))
    logger.error({ info }, 'Error processing active projects')
    throw err
  }
}

export default {
  activeProjects: expressify(activeProjects),
}
