import { GitHubSyncProjectStates } from '../models/githubSyncProjectStates.mjs'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
const { normalizeQuery } = Mongo

function getProjectState(projectId, projection = {}) {
  return GitHubSyncProjectStates.findOne(normalizeQuery({ projectId }), projection).lean()
}

function createProjectState(projectId, data) {
  return GitHubSyncProjectStates.create({
    projectId: normalizeQuery(projectId),
    ...data
  })
}

function updateProjectState(projectId, data) {
  return GitHubSyncProjectStates.updateOne(
    normalizeQuery({ projectId }),
    { $set: data },
  )
}

function removeProjectState(projectId) {
  return GitHubSyncProjectStates.deleteMany(normalizeQuery({ projectId }))
}

export default {
  getProjectState,
  createProjectState,
  updateProjectState,
  removeProjectState,
}
