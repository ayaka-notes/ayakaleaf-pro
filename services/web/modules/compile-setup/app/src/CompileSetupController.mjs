import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import CompileSetupStateManager from './CompileSetupStateManager.mjs'

async function getStatus(req, res) {
  const { Project_id: projectId } = req.params
  const state = await CompileSetupStateManager.getProjectState(projectId)
  res.json({ completed: state != null })
}

async function markCompleted(req, res) {
  const { Project_id: projectId } = req.params
  const user = SessionManager.getSessionUser(req.session)
  await CompileSetupStateManager.markCompleted(projectId, user?._id)
  res.sendStatus(204)
}

export default {
  getStatus,
  markCompleted,
}
