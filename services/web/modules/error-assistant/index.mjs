import ErrorAssistantRouter from './app/src/ErrorAssistantRouter.mjs'

// AI Error Assistant backend — the "suggest fix" agent for compile errors.
// Reuses the workbench AI gateway config (Settings.workbenchAi, set from
// AI_BASE_URL / AI_API_KEY / AI_MODEL by the workbench module).
export default {
  router: ErrorAssistantRouter,
}
