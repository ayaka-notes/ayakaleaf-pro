/**
 * SSO provider presets.
 *
 * A preset pre-fills sensible attribute mappings and (optionally) filter
 * starting points for a well-known SSO ecosystem. Presets are *defaults*:
 * every field the admin specifies themselves wins. Nothing here is
 * EduGAIN-specific — presets are a plain name → defaults map, so any
 * deployment can add its own presets.
 *
 * The built-in `edugain` preset follows the eduGAIN attribute profile
 * (GN3-11-012, https://technical.edugain.org/doc/GN3-11-012%20eduGAIN_attribute_profile.pdf):
 * identity via `eduPersonPrincipalName`, affiliations via
 * `eduPersonAffiliation` / `eduPersonScopedAffiliation`, plus the common
 * `schacHomeOrganization` attribute.
 */

/** Human-readable catalog of well-known SSO attributes, used to help admins
 *  pick field names in the admin UI (datalist) and in the docs. The `values`
 *  array lists the canonical value set when the profile defines one. */
export const ATTRIBUTE_CATALOG = [
  {
    name: 'email',
    description: 'User email address (OIDC standard claim / SAML `email`).',
  },
  {
    name: 'eduPersonPrincipalName',
    description:
      'Unique, never-reused identifier for the user within the home institution; usually `user@institution.domain`. eduGAIN attribute profile, attribute 2.1.',
  },
  {
    name: 'eduPersonAffiliation',
    description:
      'Role(s) of the user at the home institution; multi-valued. eduGAIN attribute profile, attribute 2.4.',
    values: [
      'member',
      'faculty',
      'staff',
      'student',
      'researcher',
      'affiliate',
      'alumni',
      'retiree',
      'other',
    ],
  },
  {
    name: 'eduPersonScopedAffiliation',
    description:
      'eduPersonAffiliation scoped to an institution: `affiliation@scope`, e.g. `student@uni-bremen.de`; multi-valued. eduGAIN attribute profile, attribute 2.6.',
  },
  {
    name: 'eduPersonEntitlement',
    description:
      'URI-based entitlements (groups, roles, rights) granted by the institution; multi-valued. eduGAIN attribute profile, attribute 2.5.',
  },
  {
    name: 'schacHomeOrganization',
    description:
      'Domain of the user home organization, e.g. `uni-bremen.de`. SCHAC profile.',
  },
  {
    name: 'schacHomeOrganizationType',
    description: 'Top-level domain type of the home organization (`.de`, `.org`, …).',
  },
  {
    name: 'uid',
    description: 'Legacy (RFC 2307) unique id within the home institution.',
  },
  {
    name: 'givenName',
    description: 'First name (OIDC `given_name` in OIDC; SAML `givenName`).',
  },
  {
    name: 'sn',
    description: 'Last name (SAML `sn`; OIDC `family_name`).',
  },
  {
    name: 'o',
    description: 'Organization unit(s) / department; multi-valued (LDAP `o`).',
  },
  {
    name: 'displayName',
    description: 'Human-readable display name.',
  },
]

const EDUGAIN_VALUES = {
  faculty: 'faculty',
  staff: 'staff',
  member: 'member',
}

const PRESETS = {
  edugain: {
    name: 'EduGAIN (GN3-11-012 attribute profile)',
    description:
      'eduGAIN SAML federation attribute profile: identity from ' +
      'eduPersonPrincipalName, roles from eduPersonAffiliation / ' +
      'eduPersonScopedAffiliation. Filters start empty — add allow/deny ' +
      'rules (e.g. on eduPersonScopedAffiliation) to restrict access to ' +
      'your institution(s).',
    saml: {
      attrs: {
        userId: 'eduPersonPrincipalName',
        email: 'email',
        firstName: 'givenName',
        lastName: 'sn',
        admin: { field: 'eduPersonAffiliation', values: ['faculty', 'staff'] },
      },
    },
    oidc: {
      attrs: {
        // Many OIDC gateways (Keycloak, …) expose eduGAIN as custom claims;
        // email is the safe default identity claim.
        userId: 'eduPersonPrincipalName',
        email: 'email',
        firstName: 'givenName',
        lastName: 'sn',
        admin: { field: 'eduPersonAffiliation', values: ['faculty', 'staff'] },
      },
    },
    filter: {
      // No filter by default: the preset is a starting point, and the exact
      // institution scope (e.g. `zfnScopedAffiliation = zfn.uni-bremen.de`)
      // is admin-defined.
      allow: [],
      deny: [],
    },
  },
}

export function listPresets() {
  return Object.entries(PRESETS).map(([id, preset]) => ({
    id,
    name: preset.name,
    description: preset.description,
  }))
}

/**
 * Apply a preset to a raw provider object.
 * Fields already present in the provider (deep) win over preset defaults.
 * @param {string} presetName
 * @param {'oidc'|'saml'} type
 * @param {object} provider raw provider config (without id/type)
 * @returns {object} merged provider config
 */
export function applyPreset(presetName, type, provider) {
  if (!presetName) return provider
  const preset = PRESETS[presetName]
  if (!preset) {
    throw new Error(
      `unknown preset "${presetName}" (available: ${Object.keys(PRESETS).join(', ')})`
    )
  }
  const defaults = preset[type] || {}
  const out = { ...provider }
  // attrs: preset first, provider overrides key-by-key
  const presetAttrs = { ...(defaults.attrs || {}) }
  if (provider.attrs) {
    const attrs = { ...presetAttrs }
    for (const [key, value] of Object.entries(provider.attrs)) {
      if (value === undefined) continue
      if (key === 'admin' && value && presetAttrs.admin) {
        attrs.admin = { ...presetAttrs.admin, ...value }
      } else {
        attrs[key] = value
      }
    }
    out.attrs = attrs
  } else {
    out.attrs = presetAttrs
  }
  // filter: preset defaults first, provider rules appended/overridden
  if (preset.filter && (preset.filter.allow?.length || preset.filter.deny?.length)) {
    out.filter = {
      ...(out.filter || {}),
      allow: [
        ...(preset.filter.allow || []),
        ...((out.filter || {}).allow || []),
      ],
      deny: [
        ...(preset.filter.deny || []),
        ...((out.filter || {}).deny || []),
      ],
    }
  }
  return out
}

export { EDUGAIN_VALUES }
