import Settings from '@overleaf/settings'
import AuthenticationController from '../../app/src/Features/Authentication/AuthenticationController.mjs'

/**
 * bib-editor module (self-contained: the orcid-picker + zotero-picker
 * backends it needs are vendored under `deps/` and registered here).
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

// -- zotero picker env seeds (no site-settings on this base — ZOTERO_* env
// values are the source of truth; the router gate reads them per request)
// See deps/zotero/app/src (vendored from the zotero module).
{
  // The base tpr-webmodule (zotero connector) may have loaded first and seeded
  // Settings.zotero from ZOTERO_CLIENT_ID. Merge instead of clobber: keep its
  // fields (clientID, callbackURL) and add clientKey so both naming
  // conventions work with whichever credential name the deployment set.
  const base = Settings.zotero || {}
  const siteUrl = Settings.siteUrl.replace(/\/+$/, '') || 'http://localhost'
  Settings.zotero = {
    ...base,
    clientKey: process.env.ZOTERO_CLIENT_KEY || base.clientID,
    clientSecret:
      process.env.ZOTERO_CLIENT_SECRET || base.clientSecret || undefined,
    callbackURL:
      base.callbackURL || `${siteUrl}/user/zotero/oauth/callback`,
  }
}

// -- mendeley picker env seeds (MENDELEY_* env is the source of truth, same
// pattern as zotero above: merged over any site_settings value)
{
  const base = Settings.mendeley || {}
  const siteUrl = Settings.siteUrl.replace(/\/+$/, '') || 'http://localhost'
  Settings.mendeley = {
    ...base,
    clientID:
      base.clientID ||
      base.clientId ||
      process.env.MENDELEY_CLIENT_ID ||
      process.env.MENDELEY_CLIENT_KEY ||
      undefined,
    clientSecret: base.clientSecret || process.env.MENDELEY_CLIENT_SECRET || undefined,
    callbackURL:
      base.callbackURL ||
      process.env.MENDELEY_CALLBACK_URL ||
      `${siteUrl}/user/mendeley/oauth/callback`,
    enabled: base.enabled !== undefined ? base.enabled : true,
  }
}

const LibraryRoutes =
  (await import('./app/src/LibraryRoutes.mjs')).default
const OrcidPickerRouter =
  (await import('./deps/orcid-picker/app/src/OrcidPickerRouter.mjs')).default
const ZoteroRouter =
  (await import('./deps/zotero/app/src/ZoteroRouter.mjs')).default
const MendeleyRouter =
  (await import('./deps/mendeley/app/src/MendeleyRouter.mjs')).default

/** @import { WebModule } from "../../types/web-module" */

/** @type {WebModule} */
const bibEditorModule = {
  dependencies: [],
  router: {
    async apply(webRouter) {
      if (Settings.bibLibrary.enabled) {
        await LibraryRoutes.apply(webRouter)
      }
      // ON by default: adds only login-required GET/DELETE routes guarded by
      // env secrets (zotero/mendeley) or SSRF/size/time guards (orcid).
      await OrcidPickerRouter.apply(webRouter)
      await ZoteroRouter.apply(webRouter)
      await MendeleyRouter.apply(webRouter)

      // Gating surface for the bib-editor/library UI: which reference
      // managers are CONFIGURED on this instance (client id + secret both
      // set). The frontend hides the corresponding "Import from …" entries
      // when false, so an unconfigured connector is never offered.
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
