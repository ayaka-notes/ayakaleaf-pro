import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { userHasLlmLane } from './LlmBridge.mjs'
// overleaf-lab (merge phase 3): the admin feature flags — the chat toggle now
// governs the workbench assistant like every other surface. Read lazily per
// request so a flag change takes effect without a restart (it is a JSON file
// in Settings.llm.adminSettings, read by the llm module per call).
import { getLLMFeatureFlags } from '../../../llm/app/src/LLMAdminController.mjs'

export async function getAiAccess(userId) {
  const denied = { chat: false, errorAssistant: false, textExtract: false }
  if (!userId) return denied

  // Read current permissions so an admin can revoke access to an open session.
  const user = await UserGetter.promises.getUser(userId, { aiFeatures: 1, llmTextExtract: 1 })
  if (!user || user.aiFeatures?.enabled === false) return denied

  // overleaf-lab (2026-11, owner request): per-user text-extraction mode —
  // image/PDF attachments are OCR'd/extracted on the server so text-only
  // lanes can read them. Rides along with the access payload so the client
  // (render_pdf_page) can switch from page images to page text.
  const textExtract = user.llmTextExtract === true

  // overleaf-lab (merge phase 3): one admin switch for chat, every surface.
  try {
    const flags = await getLLMFeatureFlags()
    if (flags && flags.chatEnabled === false) return denied
  } catch {
    // Flag read failed: keep the previous per-user resolution (fail open),
    // matching the llm module's own enforcement style.
  }

  if (Settings.workbenchAi?.enabled) {
    return { chat: true, errorAssistant: true, textExtract, textOnly: false }
  }

  // overleaf-lab (2026-11-05): text-only BYO lanes (e.g. Ollama qwen3:8b)
  // cannot use page IMAGES either — tell the client once (shared 1h cache)
  // so render_pdf_page hands the model page TEXT proactively, instead of
  // failing AFTER the provider rejects the image.
  let textOnly = false
  if (!textExtract) {
    try {
      const lane = await resolveWorkbenchLane(userId)
      if (lane?.baseURL && lane?.model) {
        const caps = await probeLane(lane.baseURL, lane.apiKey, lane.model)
        textOnly = caps?.images === false
      }
    } catch {
      textOnly = false
    }
  }

  // overleaf-lab (2026-11, BYO phase 1): no operator workbench gateway —
  // allow the workbench CHAT when this user can resolve an LLM lane
  // (BYO row or site provider). The admin kill switch (llmDisabledByAdmin)
  // and the BYO gate are enforced inside the shared lane resolver, so one
  // switch still governs every surface. errorAssistant stays operator-gated.
  if (await userHasLlmLane(userId)) {
    return { chat: true, errorAssistant: false, textExtract, textOnly }
  }

  return { ...denied, textOnly }
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
