import FixErrorRouter from './app/src/FixErrorRouter.mjs'

// Suggests a fix for one compile error from the log. It uses the AI gateway,
// quota and access settings of workbench (AI_BASE_URL, AI_API_KEY, AI_MODEL).
export default {
  router: FixErrorRouter,
}
