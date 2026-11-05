import Settings from '@overleaf/settings'
import AuthenticationController from '../../app/src/Features/Authentication/AuthenticationController.mjs'

/**
 * bib-editor module (self-contained for its OWN surfaces: the ORCID picker
 * backend is vendored under `deps/` and registered here; the Zotero &
 * Mendeley connectors are canonical modules — services/web/modules/zotero
 * and services/web/modules/mendeley — which register their own routes
 * (including the /user/zotero/picker/* & /user/mendeley/picker/* endpoints
 * this module's library-page picker modals call, and seed Settings.zotero /
 * Settings.mendeley from the same ZOTERO_* / MENDELEY_* env vars).
 *
 *  - In-project `.bib` visual editor — registered additively via
 *    `settings.defaults.js` (`sourceEditorExtensions`,
 *    `rootContextProviders`, `visualEditorProviders`) — no change needed here.
 *  - Library (user-scoped reference library, LIBRARY_PLAN.md) — page routes
 *    (`/library`, `/library/trashed`) + REST API (`/library/references*`).
 *  - Import-from-ORCID picker routes (`/orcid-picker/*`, proxied ORCID
 *    public APIs — login-required, SSRF/size/time guarded).
 *  - Import-from-Zotero picker routes (`/user/zotero/picker/*` + the
 *    connect/status/unlink surface). Requires ZOTERO_CLIENT_KEY/SECRET
 *    (env) to be enabled; without them the picker routes answer 403.
 *
 * Gating: ON by default in CE. Disable the library with
 * OVERLEAF_BIB_LIBRARY=false — then neither the routes (this file) nor the
 * nav link (settings.defaults, same env gate) are active.
 */
function boolFromEnv(env) {
  if (env === undefined || env === null) return undefined
  const envLower = String(env).toLowerCase()
  if (envLower === 'true') return true
  if (envLower === 'false') return false
  return undefined
}

if (Settings.bibLibrary === undefined) {
  const retentionRaw = parseInt(
    process.env.OVERLEAF_BIB_LIBRARY_TRASH_RETENTION_DAYS || '30',
    10
  )
  const enabledEnv = boolFromEnv(process.env.OVERLEAF_BIB_LIBRARY)
  Settings.bibLibrary = {
    // default ON in CE
    enabled: enabledEnv === undefined ? true : enabledEnv,
    trashRetentionDays:
      Number.isFinite(retentionRaw) && retentionRaw > 0 ? retentionRaw : 30,
  }
} else if (Settings.bibLibrary.trashRetentionDays === undefined) {
  Settings.bibLibrary.trashRetentionDays = 30
}
if (Settings.bibLibrary.enabled === undefined) {
  Settings.bibLibrary.enabled = true
}


const LibraryRoutes =
  (await import('./app/src/LibraryRoutes.mjs')).default
const OrcidPickerRouter =
  (await import('./deps/orcid-picker/app/src/OrcidPickerRouter.mjs')).default

/** @import { WebModule } from "../../types/web-module" */

/** @type {WebModule} */
const bibEditorModule = {
  dependencies: [],
  router: {
    async apply(webRouter) {
      if (Settings.bibLibrary.enabled) {
        await LibraryRoutes.apply(webRouter)
      }
      // ON by default: adds only login-required GET routes guarded by
      // SSRF/size/time guards (orcid).
      await OrcidPickerRouter.apply(webRouter)

      // Gating surface for the bib-editor/library UI: which reference
      // managers are CONFIGURED on this instance (client id + secret both
      // set). Settings.zotero/Settings.mendeley are seeded by the canonical
      // zotero/mendeley modules at boot (same env vars). The frontend hides
      // the corresponding "Import from …" entries when false, so an
      // unconfigured connector is never offered.
      webRouter.get(
        '/bib/services',
        AuthenticationController.requireLogin(),
        (req, res) => {
          const z = Settings.zotero
          const m = Settings.mendeley
          res.json({
            zotero: !!(
              z && (z.clientKey || z.clientID) && z.clientSecret
            ),
            mendeley: !!(
              m && m.enabled !== false && (m.clientID || m.clientId) && m.clientSecret
            ),
          })
        }
      )
    },
  },
}

export default bibEditorModule
