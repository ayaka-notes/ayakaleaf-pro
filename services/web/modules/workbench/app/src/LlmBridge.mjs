// overleaf-lab (2026-11, BYO → workbench, phase 1 "KING"): the workbench AI
// assistant gains the llm module's provider layer. When the operator has NOT
// configured their own workbench gateway (workbenchAi.* / AI_BASE_URL etc.),
// the per-user lane is resolved exactly like every llm-module surface:
//
//   per-task profile selection (task = 'chat')
//     → user's shared selection (User.llmSelectedModel)
//     → first enabled BYO provider row (SSRF-guarded, keys server-side only)
//     → site provider (admin-configured llm lane)
//
// This reuses the llm module's single choke point (resolveModelLane →
// resolveLane), so ONE admin switch (llmDisabledByAdmin) governs the
// workbench chat exactly like chat/review/completion/error. No new
// persistence, no credential exposure to the browser.
import { resolveModelLane } from '../../../llm/app/src/LLMChatController.mjs'
import { isConfigured } from './WorkbenchAiClient.mjs'

/**
 * Resolve the lane the workbench chat should run against for THIS user.
 * Returns null when nothing resolves (operator gateway unset AND no usable
 * user/site lane) — callers fall back to their existing behavior.
 */
export async function resolveWorkbenchLane(userId) {
  if (!userId) return null
  // The operator's explicit workbench gateway always wins when present;
  // keep the exact legacy behavior for it (pdf/image model overrides etc.).
  if (isConfigured()) return null
  try {
    const r = await resolveModelLane(userId, '', 'chat')
    return {
      baseURL: r.spec?.baseUrl,
      apiKey: r.spec?.apiKey,
      model: r.spec?.model || r.model,
      providerType: r.spec?.providerType,
      lane: r.lane,
    }
  } catch {
    return null
  }
}

/** Cheap "can this user talk to an LLM at all?" predicate (gate checks). */
export async function userHasLlmLane(userId) {
  if (!userId) return false
  if (isConfigured()) return true
  return Boolean(await resolveWorkbenchLane(userId))
}

export default { resolveWorkbenchLane, userHasLlmLane }
