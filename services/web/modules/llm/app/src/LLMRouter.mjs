import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import LLMChatController from './LLMChatController.mjs'
import LLMSettingsController from './LLMSettingsController.mjs'
import LLMAdminController from './LLMAdminController.mjs'
import LLMComplianceController from './LLMComplianceController.mjs'

export default {
    apply(webRouter) {
        logger.info(
            {
                allowUserSettings: Settings.llm?.allowUserSettings,
                apiUrl: process.env.LLM_API_URL ? '(set)' : '(not set)',
                apiKey: process.env.LLM_API_KEY ? '(set)' : '(not set)',
                modelName: process.env.LLM_MODEL_NAME
            },
            '[LLM] Registering routes'
        )

        // Chat and model endpoints (project-scoped)
        webRouter.post(
            '/project/:Project_id/llm/chat',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.chat
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/chat')

        // overleaf-lab: AI Error Assist — suggested fix per compile log entry.
        webRouter.post(
            '/project/:Project_id/llm/compile-fix',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.compileFix
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/compile-fix')

        webRouter.get(
            '/project/:Project_id/llm/models',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.getModels
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/models')

        // overleaf-lab: per-feature enable flags for the project UI.
        webRouter.get(
            '/project/:Project_id/llm/features',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.getFeatures
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/features')

        // overleaf-lab: source lines around a compile-error line for "Ask AI about this error"
        webRouter.get(
            '/project/:Project_id/llm/source-context',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.getSourceContext
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/source-context')

        // overleaf-lab: effective editable prompts for the project UI.
        webRouter.get(
            '/project/:Project_id/llm/prompts',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.getPrompts
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/prompts')

        // Inline completion endpoint (project-scoped)
        webRouter.post(
            '/project/:Project_id/llm/completion',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.completion
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/completion')

        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/grammar')

        // overleaf-lab: whole-document generators (title/abstract/keywords)
        webRouter.post(
            '/project/:Project_id/llm/generate',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMChatController.generateDocument
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/generate')

        // overleaf-lab: document compliance review endpoints (project-scoped)
        webRouter.get(
            '/project/:Project_id/llm/compliance/rubrics',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMComplianceController.getRubrics
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/compliance/rubrics')

        webRouter.post(
            '/project/:Project_id/llm/compliance/start',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMComplianceController.startReview
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/compliance/start')

        webRouter.get(
            '/project/:Project_id/llm/compliance/status/:jobId',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMComplianceController.statusReview
        )
        logger.debug({}, '[LLM] Route registered: GET /project/:id/llm/compliance/status/:jobId')

        webRouter.post(
            '/project/:Project_id/llm/compliance/cancel/:jobId',
            AuthorizationMiddleware.ensureUserCanReadProject,
            LLMComplianceController.cancelReview
        )
        logger.debug({}, '[LLM] Route registered: POST /project/:id/llm/compliance/cancel/:jobId')

        // overleaf-lab (owner request 2026-08-26): user-scoped shared LLM model
        // selection — the File → "Select LLM Model" modal persists here, on the
        // user profile, and follows the user across projects and browsers.
        webRouter.get(
            '/user/llm/selected-model',
            AuthenticationController.requireLogin(),
            LLMSettingsController.getSelectedModel
        )
        logger.debug({}, '[LLM] Route registered: GET /user/llm/selected-model')

        webRouter.post(
            '/user/llm/selected-model',
            AuthenticationController.requireLogin(),
            LLMSettingsController.saveSelectedModel
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm/selected-model')

        // overleaf-lab (2026-11): per-user editor prefs (inline completion off/on).
        webRouter.get(
            '/user/llm/prefs',
            AuthenticationController.requireLogin(),
            LLMSettingsController.getUserPrefs
        )
        logger.debug({}, '[LLM] Route registered: GET /user/llm/prefs')

        webRouter.post(
            '/user/llm/prefs',
            AuthenticationController.requireLogin(),
            LLMSettingsController.saveUserPrefs
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm/prefs')

        // overleaf-lab (2026-08-27, owner request): user-scoped compliance
        // review rubrics — every user configures their own under
        // /user/llm-settings; the reviewer reads them per user.
        webRouter.get(
            '/user/llm/compliance',
            AuthenticationController.requireLogin(),
            LLMSettingsController.getUserCompliance
        )
        logger.debug({}, '[LLM] Route registered: GET /user/llm/compliance')

        webRouter.post(
            '/user/llm/compliance',
            AuthenticationController.requireLogin(),
            LLMSettingsController.saveUserCompliance
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm/compliance')

        // overleaf-lab: BYO provider rows (user-scoped). Every handler enforces
        // the LLM_ALLOW_USER_SETTINGS gate itself (F1): the router registers them
        // unconditionally, and disabled deployments answer 403, so there is no
        // registration path that skips the gate.
        webRouter.get(
            '/user/llm-providers',
            AuthenticationController.requireLogin(),
            LLMSettingsController.getProvidersJson
        )
        logger.debug({}, '[LLM] Route registered: GET /user/llm-providers')

        webRouter.post(
            '/user/llm-providers',
            AuthenticationController.requireLogin(),
            LLMSettingsController.addProvider
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm-providers')

        // overleaf-lab: /check and /scan MUST be registered before /:id —
        // Express matches in registration order, so ':id' would swallow them
        // (observed: POST /check 404'd as updateProvider with id='check').
        webRouter.post(
            '/user/llm-providers/check',
            AuthenticationController.requireLogin(),
            LLMSettingsController.checkProviderConnection
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm-providers/check')

        webRouter.post(
            '/user/llm-providers/scan',
            AuthenticationController.requireLogin(),
            LLMSettingsController.scanProviderModels
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm-providers/scan')

        webRouter.post(
            '/user/llm-providers/:id',
            AuthenticationController.requireLogin(),
            LLMSettingsController.updateProvider
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm-providers/:id')

        webRouter.post(
            '/user/llm-providers/:id/delete',
            AuthenticationController.requireLogin(),
            LLMSettingsController.deleteProvider
        )
        logger.debug({}, '[LLM] Route registered: POST /user/llm-providers/:id/delete')
        // overleaf-lab (usage meter): per-user token accounting for /user/llm-settings.
        // Registered before any ':' route in this block — 'usage' is a literal,
        // but keep the convention (literal first) so it can never be swallowed.
        webRouter.get(
            '/user/llm-usage',
            AuthenticationController.requireLogin(),
            LLMSettingsController.userUsageSummary
        )
        logger.debug({}, '[LLM] Route registered: GET /user/llm-usage')

        logger.debug({}, '[LLM] Route registered: POST /user/llm-settings/grammar')

        // overleaf-lab: /user/llm-settings is the dedicated BYO settings page
        // (Account menu 'AI Settings' and the Account Settings card link here).
        webRouter.get(
            '/user/llm-settings',
            AuthenticationController.requireLogin(),
            LLMSettingsController.llmSettingsPage
        )
        logger.debug({}, '[LLM] Route registered: GET /user/llm-settings (settings page)')

        if (Settings.llm && Settings.llm.allowUserSettings) {
            logger.debug({}, '[LLM] BYO enabled by deployment config')
        } else {
            logger.debug(
                { allowUserSettings: Settings.llm?.allowUserSettings },
                '[LLM] BYO endpoints registered but gated (LLM_ALLOW_USER_SETTINGS not set -> 403)'
            )
        }

        logger.info({}, '[LLM] All routes registered successfully')

        // Admin routes
        webRouter.get(
            '/admin/llm/settings',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.adminSettingsPage
        )
        logger.debug({}, '[LLM] Route registered: GET /admin/llm/settings')

        webRouter.get(
            '/admin/llm/settings/json',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.getAdminSettings
        )
        logger.debug({}, '[LLM] Route registered: GET /admin/llm/settings/json')

        webRouter.post(
            '/admin/llm/settings',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.saveAdminSettings
        )
        logger.debug({}, '[LLM] Route registered: POST /admin/llm/settings')

        webRouter.post(
            '/admin/llm/settings/check',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.checkAdminLLMConnection
        )
        logger.debug({}, '[LLM] Route registered: POST /admin/llm/settings/check')

        webRouter.post(
            '/admin/llm/models',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.scanAdminModels
        )
        logger.debug({}, '[LLM] Route registered: POST /admin/llm/models')

        // overleaf-lab (usage meter): whole-site token accounting for the admin page.
        webRouter.get(
            '/admin/llm/usage',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.usageSummary
        )
        logger.debug({}, '[LLM] Route registered: GET /admin/llm/usage')
        // overleaf-lab (2026-11-05, TODO-9613994b): per-admin view of ONE user's
        // usage + live model selection, for the admin user account page.
        webRouter.get(
            '/admin/llm/usage/:userId',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMSettingsController.adminUserUsageSummary
        )
        logger.debug({}, '[LLM] Route registered: GET /admin/llm/usage/:userId')

        webRouter.get(
            '/admin/llm/mcp-user/:userId',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.getMcpUserMode
        )
        logger.debug({}, '[LLM] Route registered: GET /admin/llm/mcp-user/:userId')

        webRouter.get(
            '/admin/llm/mcp-tools',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.getMcpTools
        )
        logger.debug({}, '[LLM] Route registered: GET /admin/llm/mcp-tools')

        webRouter.put(
            '/admin/llm/mcp-user/:userId',
            AuthorizationMiddleware.ensureUserIsSiteAdmin,
            LLMAdminController.saveMcpUserMode
        )
        logger.debug({}, '[LLM] Route registered: PUT /admin/llm/mcp-user/:userId')
    }
}
