import { GitLabSyncProjectStates } from '../models/gitlabSyncProjectStates.mjs'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
const { normalizeQuery } = Mongo

function getProjectState(projectId, projection = {}) {
  return GitLabSyncProjectStates.findOne(normalizeQuery({ projectId }), projection).lean()
}

function createProjectState(projectId, data) {
  return GitLabSyncProjectStates.create({
    projectId: normalizeQuery(projectId),
    ...data
  })
}

function updateProjectState(projectId, data) {
  return GitLabSyncProjectStates.updateOne(
    normalizeQuery({ projectId }),
    { $set: data },
  )
}

function removeProjectState(projectId) {
  return GitLabSyncProjectStates.deleteMany(normalizeQuery({ projectId }))
}

export default {
  getProjectState,
  createProjectState,
  updateProjectState,
  removeProjectState,
}
