import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'

export async function getAiAccess(userId) {
  const denied = { chat: false, errorAssistant: false }
  if (!userId || !Settings.workbenchAi?.enabled) return denied

  // Read current permissions so an admin can revoke access to an open session.
  const user = await UserGetter.promises.getUser(userId, { aiFeatures: 1 })
  if (!user || user.aiFeatures?.enabled === false) return denied

  return { chat: true, errorAssistant: true }
}

function requireAccess(feature) {
  return expressify(async (req, res, next) => {
    const access = await getAiAccess(SessionManager.getLoggedInUserId(req.session))
    if (!access[feature]) {
      return res.status(403).json({ error: 'ai_access_denied' })
    }
    next()
  })
}

export const requireAiAccess = requireAccess('chat')
export const requireErrorAssistantAccess = requireAccess('errorAssistant')

export default { requireAiAccess, requireErrorAssistantAccess }
