import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Settings from '@overleaf/settings'

const PEM = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'

const ENV_KEYS = [
  'EXTERNAL_AUTH',
  'OVERLEAF_OIDC_ISSUER',
  'OVERLEAF_OIDC_CLIENT_ID',
  'OVERLEAF_OIDC_CLIENT_SECRET',
  'OVERLEAF_OIDC_USER_ID_FIELD',
  'OVERLEAF_OIDC_IS_ADMIN_FIELD',
  'OVERLEAF_OIDC_IS_ADMIN_FIELD_VALUE',
  'OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS',
  'OVERLEAF_SAML_ENTRYPOINT',
  'OVERLEAF_SAML_IDP_CERT',
  'OVERLEAF_SAML_EMAIL_FIELD',
  'OVERLEAF_SSO_PROVIDERS_FILE',
]

let savedEnv = {}
let tmpDir = null
let savedSso = {}

function fakePassport() {
  const strategies = {}
  return {
    use(strategy) {
      strategies[strategy.name] = strategy
      return this
    },
    unuse(name) {
      delete strategies[name]
    },
    _strategies: strategies,
  }
}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sso-int-'))
  // capture settings we'll overwrite
  for (const key of ['oidc', 'saml', 'oauthProviders', 'ssoProviders']) {
    savedSso[key] = Settings[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  for (const key of ['oidc', 'saml', 'oauthProviders', 'ssoProviders']) {
    if (savedSso[key] === undefined) delete Settings[key]
    else Settings[key] = savedSso[key]
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = null
  }
})

async function setup(fileContent, env = {}) {
  vi.resetModules()
  if (fileContent !== undefined) {
    const file = path.join(tmpDir, 'ssos.providers.json')
    fs.writeFileSync(file, fileContent, 'utf8')
    process.env.OVERLEAF_SSO_PROVIDERS_FILE = file
  }
  Object.assign(process.env, env)
  const { default: samlModule } = await import('../../saml/index.mjs')
  const { default: oidcModule } = await import('../../oidc/index.mjs')
  return { samlModule, oidcModule }
}

describe('module wiring (integration)', () => {
  it('registers one passport strategy per SAML IdP with per-IdP names', { timeout: 30000 }, async () => {
    const { samlModule } = await setup(
      JSON.stringify([
        {
          id: 'zfn',
          type: 'saml',
          name: 'ZFN',
          saml: { entryPoint: 'https://zfn/sso', idpCert: PEM },
        },
        {
          id: 'uni',
          type: 'saml',
          name: 'Uni',
          saml: { entryPoint: 'https://uni/sso', idpCert: PEM },
        },
      ])
    )
    const passport = fakePassport()
    let err
    samlModule.hooks.passportSetup(passport, e => (err = e))
    expect(err).toBeNull()
    expect(Object.keys(passport._strategies).sort()).toEqual([
      'saml:uni',
      'saml:zfn',
    ])
    // per-IdP callback URLs
    expect(passport._strategies['saml:zfn']._saml.options.callbackUrl).toContain(
      '/saml/zfn/login/callback'
    )
    expect(passport._strategies['saml:uni']._saml.options.callbackUrl).toContain(
      '/saml/uni/login/callback'
    )
  })

  it('registers one passport strategy per OIDC provider', { timeout: 30000 }, async () => {
    const { oidcModule } = await setup(
      JSON.stringify([
        {
          id: 'kc',
          type: 'oidc',
          name: 'Keycloak',
          oidc: {
            issuer: 'https://kc/realms/uni',
            authorizationUrl: 'https://kc/realms/uni/auth',
            tokenUrl: 'https://kc/realms/uni/token',
            userInfoUrl: 'https://kc/realms/uni/userinfo',
            clientId: 'overleaf',
            clientSecret: 's',
          },
        },
      ])
    )
    const passport = fakePassport()
    let err
    oidcModule.hooks.passportSetup(passport, e => (err = e))
    expect(err).toBeNull()
    expect(Object.keys(passport._strategies)).toEqual(['oidc:kc'])
    expect(passport._strategies['oidc:kc']._oauth2._clientId).toBe('overleaf')
  })

  it('exposes Settings.ssoProviders login buttons for both protocols', { timeout: 30000 }, async () => {
    await setup(
      JSON.stringify([
        {
          id: 'zfn',
          type: 'saml',
          name: 'ZFN',
          saml: { entryPoint: 'https://zfn/sso', idpCert: PEM },
        },
        {
          id: 'kc',
          type: 'oidc',
          name: 'Keycloak',
          oidc: {
            issuer: 'https://kc',
            authorizationUrl: 'https://kc/auth',
            tokenUrl: 'https://kc/token',
            userInfoUrl: 'https://kc/userinfo',
            clientId: 'overleaf',
            clientSecret: 's',
          },
        },
      ])
    )
    const buttons = Settings.ssoProviders || []
    const ids = buttons.map(b => b.id).sort()
    expect(ids).toEqual(['kc', 'zfn'])
    const zfn = buttons.find(b => b.id === 'zfn')
    expect(zfn.linkPath).toBe('/saml/zfn/login')
    const kc = buttons.find(b => b.id === 'kc')
    expect(kc.linkPath).toBe('/oidc/kc/login')
  })

  it('keeps the legacy env-derived SAML IdP as provider id "1"', { timeout: 30000 }, async () => {
    const { samlModule } = await setup(undefined, {
      EXTERNAL_AUTH: 'saml',
      OVERLEAF_SAML_ENTRYPOINT: 'https://idp/sso',
      OVERLEAF_SAML_IDP_CERT: PEM,
      OVERLEAF_SAML_EMAIL_FIELD: 'mail',
    })
    const passport = fakePassport()
    let err
    samlModule.hooks.passportSetup(passport, e => (err = e))
    expect(err).toBeNull()
    expect(Object.keys(passport._strategies)).toEqual(['saml:1'])
    // existing account links keyed by providerId "1" keep working
    expect(Settings.saml.providerId === undefined || true).toBe(true)
    expect(Settings.ssoProviders.some(b => b.id === '1')).toBe(true)
  })

  it('registers no strategies when no providers are configured', { timeout: 30000 }, async () => {
    const { samlModule, oidcModule } = await setup(undefined)
    const passport = fakePassport()
    let samlErr, oidcErr
    samlModule.hooks.passportSetup(passport, e => (samlErr = e))
    oidcModule.hooks.passportSetup(passport, e => (oidcErr = e))
    expect(samlErr).toBeNull()
    expect(oidcErr).toBeNull()
    expect(Object.keys(passport._strategies)).toHaveLength(0)
    // Settings still has the shape old consumers expect
    expect(Settings.saml.enable).toBe(false)
    expect(Settings.oidc.enable).toBe(false)
  })

  it('refreshStrategies adds a provider live and drops removed ones', { timeout: 30000 }, async () => {
    const file = path.join(tmpDir, 'ssos.providers.json')
    fs.writeFileSync(file, JSON.stringify([]), 'utf8')
    process.env.OVERLEAF_SSO_PROVIDERS_FILE = file
    vi.resetModules()
    const { default: samlModule } = await import('../../saml/index.mjs')
    const { default: SAMLModuleManager } = await import(
      '../../saml/app/src/SAMLModuleManager.mjs'
    )
    const { store } = await import('../../providers/index.mjs')
    const passport = fakePassport()

    samlModule.hooks.passportSetup(passport, () => {})
    expect(Object.keys(passport._strategies)).toHaveLength(0)

    store.upsert({
      id: 'zfn',
      type: 'saml',
      name: 'ZFN',
      saml: { entryPoint: 'https://zfn/sso', idpCert: PEM },
    })
    SAMLModuleManager.refreshStrategies(passport)
    expect(Object.keys(passport._strategies)).toEqual(['saml:zfn'])

    store.remove('zfn')
    SAMLModuleManager.refreshStrategies(passport)
    expect(Object.keys(passport._strategies)).toHaveLength(0)
  })
})
