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

/**
 * Well-known identity sources, Forgejo-style: each entry pre-fills the
 * connection settings (URLs, default scope, attribute mapping) for one
 * provider and ships the admin-facing tips (registration steps, required
 * callback URL, scopes, Enterprise variants). The admin form offers them as
 * a "known provider" pick above the blank per-type templates; every value
 * stays editable, so self-hosted/Enterprise deployments only override the
 * relevant URLs.
 */
export const KNOWN_PROVIDERS = {
  github: {
    label: 'GitHub',
    type: 'oauth2',
    defaults: {
      behavior: { verifiedEmailRequired: true },
      oauth2: {
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userUrl: 'https://api.github.com/user',
        emailUrl: 'https://api.github.com/user/emails',
        clientId: 'change-me (OAuth App client ID)',
        clientSecret: 'change-me',
        scope: 'user:email',
        apiAcceptHeader: 'application/vnd.github+json',
      },
      attrs: {
        userId: 'login',
        email: 'email',
        firstName: 'name',
        lastName: '',
      },
    },
    hints: [
      'Register an OAuth App at https://github.com/settings/developers (or https://github.com/settings/applications/new).',
      'Callback URL: https://<your-server>/oauth2/github/login/callback',
      'Scope: user:email — we read the verified primary email from /user/emails and refuse login without one.',
      'GitHub Enterprise: keep the same shape with your GHE base URL, e.g. authorizeUrl https://ghe.example.com/login/oauth/authorize, tokenUrl https://ghe.example.com/login/oauth/access_token, userUrl https://api.ghe.example.com/user, emailUrl https://api.ghe.example.com/user/emails.',
    ],
  },
  gitlab: {
    label: 'GitLab',
    type: 'oauth2',
    defaults: {
      behavior: { verifiedEmailRequired: false },
      oauth2: {
        authorizeUrl: 'https://gitlab.com/oauth/authorize',
        tokenUrl: 'https://gitlab.com/oauth/token',
        userUrl: 'https://gitlab.com/api/v4/user',
        emailUrl: '',
        clientId: 'change-me (application ID)',
        clientSecret: 'change-me',
        scope: 'read_user email',
      },
      attrs: {
        userId: 'username',
        email: 'email',
        firstName: 'name',
        lastName: '',
      },
    },
    hints: [
      'Register an application at https://gitlab.com/-/profile/applications.',
      'Callback URL: https://<your-server>/oauth2/gitlab/login/callback',
      'Scopes: read_user email.',
      'Self-managed GitLab: use the instance base URL for all three endpoints.',
    ],
  },
  gitea: {
    label: 'Gitea / Forgejo',
    type: 'oauth2',
    defaults: {
      behavior: { verifiedEmailRequired: false },
      oauth2: {
        authorizeUrl: 'https://code.example.org/login/oauth/authorize',
        tokenUrl: 'https://code.example.org/login/oauth/access_token',
        userUrl: 'https://code.example.org/api/v1/user',
        emailUrl: '',
        clientId: 'change-me',
        clientSecret: 'change-me',
        scope: 'read:user',
      },
      attrs: {
        userId: 'login',
        email: 'email',
        firstName: 'name',
        lastName: '',
      },
    },
    hints: [
      'Create an application in the Gitea/Forgejo admin panel → Applications (OAuth2).',
      'Callback URL: https://<your-server>/oauth2/gitea/login/callback',
      'Scope: read:user. Replace the example base URL with your instance.',
    ],
  },
  google: {
    label: 'Google',
    type: 'oidc',
    defaults: {
      behavior: { verifiedEmailRequired: true },
      oidc: {
        issuer: 'https://accounts.google.com',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        clientId: 'change-me.apps.googleusercontent.com',
        clientSecret: 'change-me',
        scope: 'openid email profile',
        hideWhenNotLinked: true,
      },
      attrs: {
        userId: 'email',
        email: 'email',
        firstName: 'given_name',
        lastName: 'family_name',
      },
    },
    hints: [
      'Create an OAuth client (Web application) in the Google API console (https://console.cloud.google.com/apis/credentials).',
      'Authorized redirect URIs: https://<your-server>/oauth2/google/login/callback and https://<your-server>/oidc/google/login/callback',
      'Google sends a verified email; account creation is from that email only (domain-restrict it with allowedEmailDomains if you want).',
    ],
  },
  orcid: {
    label: 'ORCID (link-only, no auto-create)',
    type: 'oidc',
    defaults: {
      behavior: { linkOnly: true, verifiedEmailRequired: false },
      oidc: {
        issuer: 'https://orcid.org',
        authorizationUrl: 'https://orcid.org/oauth/authorize',
        tokenUrl: 'https://orcid.org/oauth/token',
        // ORCID v3.0 API record endpoint: {client_id} must be replaced with
        // your ORCID client id.
        userInfoUrl: 'https://api.orcid.org/v3.0/<client_id>/record',
        clientId: 'APP-XXXX',
        clientSecret: 'change-me',
        scope: 'openid',
      },
      attrs: {
        userId: 'sub',
        email: 'email',
        firstName: 'given_name',
        lastName: 'family_name',
      },
    },
    hints: [
      'Register a Research Information Application at https://orcid.org/register to get your client id/secret.',
      'Replace <client_id> in the userInfoUrl with your ORCID client id and register the redirect URI https://<your-server>/oidc/orcid/login/callback.',
      'ORCID sends no email: this source is link-only. Unlinked ORCID iDs are refused at login with a hint; users log in another way first and link their ORCID iD from Account settings.',
    ],
  },
  openidconnect: {
    label: 'OpenID Connect (generic)',
    type: 'oidc',
    defaults: {
      behavior: { verifiedEmailRequired: false },
      oidc: {
        issuer: 'https://oidc.example.org/realms/uni',
        authorizationUrl: 'https://oidc.example.org/realms/uni/protocol/openid-connect/auth',
        tokenUrl: 'https://oidc.example.org/realms/uni/protocol/openid-connect/token',
        userInfoUrl: 'https://oidc.example.org/realms/uni/protocol/openid-connect/userinfo',
        clientId: 'overleaf',
        clientSecret: 'change-me',
        scope: 'openid profile email',
      },
      attrs: {
        userId: 'sub',
        email: 'email',
        firstName: 'given_name',
        lastName: 'family_name',
      },
    },
    hints: [
      'Use the IdP discovery document (<server>/.well-known/openid-configuration) to fill in the endpoint URLs.',
      'Callback URL: https://<your-server>/oidc/<id>/login/callback',
    ],
  },
}
export function listKnownProviders() {
  return Object.entries(KNOWN_PROVIDERS).map(([id, provider]) => ({
    id,
    label: provider.label,
    type: provider.type,
    hints: provider.hints,
  }))
}
export function knownProvider(name) {
  return KNOWN_PROVIDERS[name] || null
}

export { EDUGAIN_VALUES }
