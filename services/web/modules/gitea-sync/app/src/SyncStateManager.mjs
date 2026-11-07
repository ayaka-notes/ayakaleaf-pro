import { GiteaSyncProjectStates } from '../models/giteaSyncProjectStates.mjs'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
const { normalizeQuery } = Mongo

function getProjectState(projectId, projection = {}) {
  return GiteaSyncProjectStates.findOne(normalizeQuery({ projectId }), projection).lean()
}

function createProjectState(projectId, data) {
  return GiteaSyncProjectStates.create({
    projectId: normalizeQuery(projectId),
    ...data
  })
}

function updateProjectState(projectId, data) {
  return GiteaSyncProjectStates.updateOne(
    normalizeQuery({ projectId }),
    { $set: data },
  )
}

function removeProjectState(projectId) {
  return GiteaSyncProjectStates.deleteMany(normalizeQuery({ projectId }))
}

export default {
  getProjectState,
  createProjectState,
  updateProjectState,
  removeProjectState,
}
