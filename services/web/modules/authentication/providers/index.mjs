/**
 * SSO providers package: multi-source SSO (OIDC + SAML) configuration,
 * profile filters and presets.
 *
 *   store    – registry + JSON-file persistence + legacy env derivation
 *   schema   – normalization/validation of provider configs
 *   filter   – profile filter engine (allow/deny rules on any attribute)
 *   presets  – EduGAIN preset + attribute catalog
 *   access   – login access decision (filter + existing/invited exceptions)
 *   invites  – pending project/team invite lookup
 */

export { default as store, providersFile } from './store.mjs'

/** Collect per-provider login buttons on Settings for the login/register
 *  pages (one button per SSO source). */
export function registerSsoProviders(settings, type, providers) {
  // Replace the entries for this type (keep other types) so that providers
  // removed via the admin UI disappear from the login/register buttons
  // instead of lingering from an earlier registration.
  const existing = Array.isArray(settings.ssoProviders) ? settings.ssoProviders : []
  settings.ssoProviders = [
    ...existing.filter(provider => provider.type !== type),
    ...providers.map(provider => ({
      type,
      id: provider.id,
      name: provider.name,
      linkPath: `/${type}/${encodeURIComponent(provider.id)}/login`,
    })),
  ]
}
export { normalizeProvider, normalizeProviders, readCertMaterial } from './schema.mjs'
export {
  FILTER_OPS,
  normalizeRule,
  normalizeFilter,
  ruleMatches,
  evaluateFilter,
} from './filter.mjs'
export {
  ATTRIBUTE_CATALOG,
  listPresets,
  applyPreset,
} from './presets.mjs'
export { checkSsoAccess, SSOAccessDeniedError } from './access.mjs'
export { hasPendingInvite } from './invites.mjs'
export { providerTemplate, prettyTemplate } from './templates.mjs'
export { setPassport, getPassport } from './passport.mjs'
