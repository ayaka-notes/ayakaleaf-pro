import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  'OVERLEAF_OIDC_UPDATE_USER_DETAILS_ON_LOGIN',
  'OVERLEAF_OIDC_IDENTITY_SERVICE_NAME',
  'OVERLEAF_SAML_ENTRYPOINT',
  'OVERLEAF_SAML_IDP_CERT',
  'OVERLEAF_SAML_EMAIL_FIELD',
  'OVERLEAF_SAML_USER_ID_FIELD',
  'OVERLEAF_SSO_PROVIDERS_FILE',
]

let savedEnv = {}
let tmpDir = null

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssos-test-'))
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = null
  }
})

function setFile(content) {
  const file = path.join(tmpDir, 'ssos.providers.json')
  if (content !== undefined) {
    fs.writeFileSync(file, content, 'utf8')
  }
  process.env.OVERLEAF_SSO_PROVIDERS_FILE = file
  return file
}

async function freshStore() {
  vi.resetModules()
  const mod = await import('../../providers/store.mjs')
  return mod.store
}

describe('provider store', () => {
  it('is empty without env or file', async () => {
    const store = await freshStore()
    expect(store.all()).toHaveLength(0)
  })

  it('derives the legacy OIDC provider from env (id "oidc")', async () => {
    process.env.EXTERNAL_AUTH = 'oidc'
    process.env.OVERLEAF_OIDC_ISSUER = 'https://kc/realms/uni'
    process.env.OVERLEAF_OIDC_AUTHORIZATION_URL = 'https://kc/realms/uni/auth'
    process.env.OVERLEAF_OIDC_TOKEN_URL = 'https://kc/realms/uni/token'
    process.env.OVERLEAF_OIDC_USER_INFO_URL = 'https://kc/realms/uni/userinfo'
    process.env.OVERLEAF_OIDC_CLIENT_ID = 'overleaf'
    process.env.OVERLEAF_OIDC_CLIENT_SECRET = 'secret'
    process.env.OVERLEAF_OIDC_USER_ID_FIELD = 'email'
    process.env.OVERLEAF_OIDC_IS_ADMIN_FIELD = 'admin'
    process.env.OVERLEAF_OIDC_IS_ADMIN_FIELD_VALUE = 'true'
    process.env.OVERLEAF_OIDC_ALLOWED_EMAIL_DOMAINS = 'uni-bremen.de, *.zfn.de'
    process.env.OVERLEAF_OIDC_UPDATE_USER_DETAILS_ON_LOGIN = 'true'
    const store = await freshStore()
    const provider = store.get('oidc')
    expect(provider).toBeTruthy()
    expect(provider.source).toBe('env')
    expect(provider.oidc.issuer).toBe('https://kc/realms/uni')
    expect(provider.attrs.userId).toBe('email')
    expect(provider.attrs.admin).toEqual({ field: 'admin', values: ['true'] })
    expect(provider.behavior.allowedEmailDomains).toEqual(['uni-bremen.de', '*.zfn.de'])
    expect(provider.behavior.updateUserDetailsOnLogin).toBe(true)
  })

  it('derives the legacy SAML IdP from env (id "1")', async () => {
    process.env.EXTERNAL_AUTH = 'saml'
    process.env.OVERLEAF_SAML_ENTRYPOINT = 'https://idp/sso'
    process.env.OVERLEAF_SAML_IDP_CERT = PEM
    process.env.OVERLEAF_SAML_EMAIL_FIELD = 'mail'
    const store = await freshStore()
    const provider = store.get('1')
    expect(provider).toBeTruthy()
    expect(provider.source).toBe('env')
    expect(provider.saml.entryPoint).toBe('https://idp/sso')
    expect(provider.attrs.email).toBe('mail')
    expect(provider.attrs.userId).toBe('nameID')
    expect(provider.saml.idpCert[0]).toContain('BEGIN')
  })

  it('lets file providers win over env providers with the same id', async () => {
    process.env.EXTERNAL_AUTH = 'oidc'
    process.env.OVERLEAF_OIDC_ISSUER = 'https://kc/realms/uni'
    process.env.OVERLEAF_OIDC_CLIENT_ID = 'overleaf'
    setFile(
      JSON.stringify([
        {
          id: 'oidc',
          type: 'oidc',
          name: 'My Keycloak',
          oidc: {
            issuer: 'https://kc2',
            authorizationUrl: 'https://kc2/auth',
            tokenUrl: 'https://kc2/token',
            userInfoUrl: 'https://kc2/userinfo',
            clientId: 'c2',
          },
        },
      ])
    )
    const store = await freshStore()
    expect(store.get('oidc').name).toBe('My Keycloak')
    expect(store.get('oidc').source).toBe('file')
  })

  it('persists file providers on upsert and keeps them across reload', async () => {
    const file = setFile(JSON.stringify([]))
    const store = await freshStore()
    store.upsert({
      id: 'zfn',
      type: 'saml',
      name: 'ZFN Uni Bremen',
      saml: { entryPoint: 'https://zfn/sso', idpCert: PEM },
      filter: {
        allow: [{ field: 'zfnScopedAffiliation', op: 'iOneOf', values: ['zfn.uni-bremen.de'] }],
        allowExistingUsers: false,
      },
    })
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0].id).toBe('zfn')
    // reload from disk
    vi.resetModules()
    const reloaded = (await import('../../providers/store.mjs')).store
    expect(reloaded.get('zfn').name).toBe('ZFN Uni Bremen')
    expect(reloaded.get('zfn').filter.allowExistingUsers).toBe(false)
    expect(reloaded.get('zfn').filter.allow[0].op).toBe('iOneOf')
  })

  it('applies presets in the validate pipeline', async () => {
    setFile(JSON.stringify([]))
    const store = await freshStore()
    const provider = store.upsert({
      id: 'edu',
      type: 'saml',
      name: 'EduGAIN',
      preset: 'edugain',
      saml: { entryPoint: 'https://edugain/sso', idpCert: PEM },
    })
    expect(provider.attrs.userId).toBe('eduPersonPrincipalName')
  })

  it('protects env-derived providers from edit/delete', async () => {
    process.env.EXTERNAL_AUTH = 'saml'
    process.env.OVERLEAF_SAML_ENTRYPOINT = 'https://idp/sso'
    process.env.OVERLEAF_SAML_IDP_CERT = PEM
    setFile(JSON.stringify([]))
    const store = await freshStore()
    expect(() =>
      store.upsert({
        id: '1',
        type: 'saml',
        saml: { entryPoint: 'https://x', idpCert: PEM },
      })
    ).toThrow('environment variables')
    expect(() => store.remove('1')).toThrow('environment variables')
    expect(() => store.setEnabled('1', false)).toThrow('environment variables')
  })

  it('removes file providers', async () => {
    const file = setFile(
      JSON.stringify([
        { id: 'a', type: 'saml', saml: { entryPoint: 'e', idpCert: PEM } },
      ])
    )
    const store = await freshStore()
    expect(store.get('a')).toBeTruthy()
    store.remove('a')
    expect(store.get('a')).toBeNull()
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(onDisk).toHaveLength(0)
  })

  it('keeps env providers when the file is invalid JSON', async () => {
    process.env.EXTERNAL_AUTH = 'oidc'
    process.env.OVERLEAF_OIDC_ISSUER = 'https://kc/realms/uni'
    process.env.OVERLEAF_OIDC_CLIENT_ID = 'overleaf'
    setFile('{not json')
    const store = await freshStore()
    expect(store.get('oidc')).toBeTruthy()
    expect(store.all()).toHaveLength(1)
  })

  it('rejects duplicate provider ids in one file', async () => {
    const file = path.join(tmpDir, 'dup.json')
    fs.writeFileSync(
      file,
      JSON.stringify([
        { id: 'x', type: 'saml', saml: { entryPoint: 'e', idpCert: PEM } },
        { id: 'x', type: 'saml', saml: { entryPoint: 'f', idpCert: PEM } },
      ])
    )
    process.env.OVERLEAF_SSO_PROVIDERS_FILE = file
    const store = await freshStore()
    // invalid file → file providers disabled, store empty
    expect(store.all()).toHaveLength(0)
  })

  it('toggles enabled flag and persists it', async () => {
    setFile(
      JSON.stringify([
        { id: 'a', type: 'saml', saml: { entryPoint: 'e', idpCert: PEM } },
      ])
    )
    const store = await freshStore()
    expect(store.ofType('saml').map(p => p.id)).toEqual(['a'])
    store.setEnabled('a', false)
    expect(store.ofType('saml')).toHaveLength(0)
    expect(store.get('a').enabled).toBe(false)
  })
})
