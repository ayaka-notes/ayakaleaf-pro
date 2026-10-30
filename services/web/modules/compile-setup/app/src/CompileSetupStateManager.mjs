import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import { CompileSetupState } from '../models/compileSetupState.mjs'

const { normalizeQuery } = Mongo

function getProjectState(projectId) {
  return CompileSetupState.findOne(normalizeQuery({ projectId })).lean()
}

async function markCompleted(projectId, userId) {
  try {
    await CompileSetupState.updateOne(
      normalizeQuery({ projectId }),
      { $set: { completedAt: new Date(), completedBy: userId } },
      { upsert: true }
    )
  } catch (err) {
    // Two collaborators can confirm at the same time; the unique index on
    // projectId makes one of the upserts fail with a duplicate key error.
    if (err?.code !== 11000) {
      throw err
    }
  }
}

function removeProjectState(projectId) {
  return CompileSetupState.deleteMany(normalizeQuery({ projectId }))
}

export default {
  getProjectState,
  markCompleted,
  removeProjectState,
}
