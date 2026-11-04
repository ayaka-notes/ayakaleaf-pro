import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { userHasLlmLane } from './LlmBridge.mjs'

export async function getAiAccess(userId) {
  const denied = { chat: false, errorAssistant: false }
  if (!userId) return denied

  // Read current permissions so an admin can revoke access to an open session.
  const user = await UserGetter.promises.getUser(userId, { aiFeatures: 1 })
  if (!user || user.aiFeatures?.enabled === false) return denied

  if (Settings.workbenchAi?.enabled) {
    return { chat: true, errorAssistant: true }
  }

  // overleaf-lab (2026-11, BYO phase 1): no operator workbench gateway —
  // allow the workbench CHAT when this user can resolve an LLM lane
  // (BYO row or site provider). The admin kill switch (llmDisabledByAdmin)
  // and the BYO gate are enforced inside the shared lane resolver, so one
  // switch still governs every surface. errorAssistant stays operator-gated.
  if (await userHasLlmLane(userId)) {
    return { chat: true, errorAssistant: false }
  }

  return denied
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
