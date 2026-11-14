/**
 * Provider JSON templates for the admin UI and the docs.
 *
 * The admin page offers these as starting points for the JSON editor; the
 * `edugain` template follows the eduGAIN attribute profile (GN3-11-012).
 * Admins are expected to fill in the connection settings and the filter.
 */
import { KNOWN_PROVIDERS } from './presets.mjs'

function baseTemplate(type, id, name) {
  const provider = {
    id,
    type,
    name,
    enabled: true,
    attrs: {},
    behavior: {},
    filter: {
      // deny:  [{ field: 'eduPersonAffiliation', op: 'iOneOf', values: ['member'] }],
      // allow: [{ field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@your-institution.de' }],
      allow: [],
      deny: [],
      // exceptions (both default true):
      allowExistingUsers: true, // existing Overleaf accounts may log in even if filtered out
      allowInvited: true,       // invited collaborators may autocreate even if filtered out
    },
  }
  if (type === 'saml') {
    provider.saml = {
      entryPoint: 'https://idp.example.org/sso/saml',
      spIssuer: 'overleaf',
      // IdP signing certificate: inline PEM string, array of PEMs, or file path(s)
      idpCert: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
      // privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
    }
    provider.attrs = {
      userId: 'eduPersonPrincipalName', // attribute holding the unique user id
      email: 'email',
      firstName: 'givenName',
      lastName: 'sn',
      // admin: { field: 'eduPersonAffiliation', values: ['faculty', 'staff'] },
    }
  } else if (type === 'oauth2') {
    provider.oauth2 = {
      authorizeUrl: 'https://idp.example.org/oauth/authorize',
      tokenUrl: 'https://idp.example.org/oauth/token',
      userUrl: 'https://idp.example.org/api/v1/user',
      // emailUrl: 'https://idp.example.org/api/v1/user/emails',
      clientId: 'overleaf',
      clientSecret: 'change-me',
      scope: '',
    }
    provider.attrs = {
      userId: 'login', // field of the user API holding the unique user id
      email: 'email',
      firstName: 'name',
      lastName: '',
    }
    provider.behavior = { verifiedEmailRequired: true } // set false if the source sends verified emails only
  } else {
    provider.oidc = {
      issuer: 'https://oidc.example.org/realms/uni',
      authorizationUrl: 'https://oidc.example.org/realms/uni/protocol/openid-connect/auth',
      tokenUrl: 'https://oidc.example.org/realms/uni/protocol/openid-connect/token',
      userInfoUrl: 'https://oidc.example.org/realms/uni/protocol/openid-connect/userinfo',
      clientId: 'overleaf',
      clientSecret: 'change-me',
      scope: 'openid profile email',
      // logoutUrl: 'https://oidc.example.org/protocol/openid-connect/logout',
    }
    provider.attrs = {
      userId: 'email', // claim holding the unique user id
      email: 'email',
      firstName: 'given_name',
      lastName: 'family_name',
      // admin: { field: 'admin', values: ['true'] },
    }
  }
  return provider
}

/**
 * Build a provider template. `preset` may name an attribute preset
 * (`edugain`) or a known provider (`github`, `google`, `orcid`, …);
 * known providers come with pre-filled connection settings and admin tips.
 * @param {'oidc'|'oauth2'|'saml'} type
 * @param {string} [id]
 * @param {string} [name]
 * @param {string} [preset]
 * @returns {{provider: object, hints: string[]}}
 */
export function providerTemplate(type, id, name, preset) {
  const known = preset ? KNOWN_PROVIDERS[preset] : undefined
  if (known) {
    const providerId = id || preset
    const provider = {
      id: providerId,
      type: known.type,
      name: name || known.label,
      enabled: true,
      preset: preset,
      behavior: { ...(known.defaults.behavior || {}) },
      attrs: { ...(known.defaults.attrs || {}) },
      filter: {
        allow: [],
        deny: [],
        allowExistingUsers: true,
        allowInvited: true,
      },
    }
    if (known.type === 'oidc') provider.oidc = { ...(known.defaults.oidc || {}) }
    if (known.type === 'oauth2') provider.oauth2 = { ...(known.defaults.oauth2 || {}) }
    return { provider, hints: known.hints }
  }
  const provider = baseTemplate(type, id || (type === 'saml' ? 'idp1' : type === 'oauth2' ? 'oauth1' : 'provider1'), name)
  if (preset === 'edugain') {
    provider.preset = 'edugain'
    provider.name = provider.name || (type === 'saml' ? 'EduGAIN (SAML)' : 'EduGAIN (OIDC)')
    if (type === 'saml') {
      provider.attrs = {
        userId: 'eduPersonPrincipalName',
        email: 'email',
        firstName: 'givenName',
        lastName: 'sn',
        admin: { field: 'eduPersonAffiliation', values: ['faculty', 'staff'] },
      }
    } else {
      provider.attrs = {
        userId: 'eduPersonPrincipalName',
        email: 'email',
        firstName: 'givenName',
        lastName: 'sn',
        admin: { field: 'eduPersonAffiliation', values: ['faculty', 'staff'] },
      }
    }
    // example filter for the home institution (edit to your needs)
    provider.filter.allow = [
      type === 'saml'
        ? { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@your-institution.de' }
        : { field: 'eduPersonScopedAffiliation', op: 'iEndsWith', value: '@your-institution.de' },
    ]
  }
  return { provider, hints: [] }
}

export function prettyTemplate(type, id, name, preset) {
  return JSON.stringify(providerTemplate(type, id, name, preset).provider, null, 2)
}
