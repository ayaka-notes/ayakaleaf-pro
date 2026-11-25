import './site-settings.test-env.mjs'
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SECTION_ENV_FIELDS,
  SECTION_ORDER,
  SECTION_VALIDATORS,
  SECTION_KNOWN_KEYS,
  SECRET_FIELDS,
  KNOWN_LINKED_FILE_TYPES,
  cleanSectionInput,
  maskSecrets,
  getSection,
  // validators
  validateSandboxedCompilesSection,
  validateConversionsSection,
  validateEmailSection,
  validateEditorSection,
  validateSecuritySection,
  validateSharingSection,
  validateMiscSection,
  validateLinkedFileTypesSection,
  validateGithubSyncSection,
  validateDropboxSection,
  validateGitIntegrationSection,
  validateExternalUrlSection,
  validateTemplatesSection,
  validateSsoSamlSection,
  validateSsoOidcSection,
  validateSsoLdapSection,
  validateServicesSection,
} from '../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import { SECTIONS_META } from '../../../modules/admin-tools/frontend/js/site-settings/sections-meta.ts'

/**
 * SiteSettings — the admin-managed site configuration.
 *
 * Coverage here is deliberately mongo-free: getSection degrades to
 * "no stored document" without a database, which is exactly the
 * env + defaults layer these tests pin down. (Mongo-backed set/reset
 * paths are covered by the acceptance tests.)
 */

describe('SiteSettings sections', () => {
  it('every section has a validator, a known-key allow-list and page metadata', () => {
    for (const name of SECTION_ORDER) {
      expect(SECTION_ENV_FIELDS[name], `env map for ${name}`).toBeDefined()
      expect(SECTION_VALIDATORS[name], `validator for ${name}`).toBeTypeOf('function')
      expect(SECTION_KNOWN_KEYS[name], `known keys for ${name}`).toEqual(
        Object.keys(SECTION_ENV_FIELDS[name])
      )
      expect(SECTIONS_META[name], `page metadata for ${name}`).toBeDefined()
    }
  })

  it('the page metadata fields match the backend section fields exactly', () => {
    for (const [name, meta] of Object.entries(SECTIONS_META)) {
      const backend = Object.keys(SECTION_ENV_FIELDS[name] || {})
      const frontend = meta.fields.map(f => f.key)
      expect(
        frontend.sort(),
        `fields of ${name} (page vs backend)`
      ).toEqual(backend.sort())
    }
  })

  it('every secret field is a text/password field on the page and listed in SECRET_FIELDS', () => {
    for (const [name, fields] of Object.entries(SECRET_FIELDS)) {
      for (const field of fields) {
        const spec = SECTIONS_META[name]?.fields.find(f => f.key === field)
        expect(spec, `page field ${name}.${field}`).toBeDefined()
        // masked server-side; textarea for multi-line material (certs/keys)
        expect(['password', 'textarea']).toContain(spec.type)
      }
    }
  })
})

describe('the service mirror lists (config files)', () => {
  // Parse the mirrorIntoEnv([...]) blocks out of the service config files
  // and check every [env, section, field] triple against the backend map:
  // this is the drift guard between the page, the storage schema and the
  // services' settings scripts.
  const root = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), '../../../..')
  // root = services/ ; the paths below are relative to it… actually keep
  // them relative to the services directory:
  const configFiles = [
    'web/config/settings.defaults.js',
    'clsi/config/settings.defaults.cjs',
    'docstore/config/settings.defaults.cjs',
    'real-time/config/settings.defaults.cjs',
    'filestore/config/settings.defaults.cjs',
    'linked-url-proxy/config/settings.defaults.cjs',
  ]

  function pairsOf(file) {
    const text = fs.readFileSync(Path.join(root, file), 'utf8')
    const block = text.match(/mirrorIntoEnv\(\[([\s\S]*?)\]\)/)
    expect(block, `mirrorIntoEnv block in ${file}`).not.toBeNull()
    const re = /\['([A-Z0-9_]+)',\s*'([a-zA-Z0-9-]+)',\s*'([a-zA-Z0-9]+)'\]/g
    const out = []
    let m
    while ((m = re.exec(block[1])) !== null) out.push(m.slice(1))
    return out
  }

  for (const file of configFiles) {
    it(`${file} mirrors only known section/field pairs with the right env var`, () => {
      const pairs = pairsOf(file)
      expect(pairs.length, `${file} has at least one pair`).toBeGreaterThan(0)
      for (const [envName, section, field] of pairs) {
        expect(SECTION_ENV_FIELDS[section], `${file}: section "${section}"`).toBeDefined()
        // clsi reads its compile host dir under two names; the pair is
        // allowed to mirror one stored field to an alias var
        const known =
          SECTION_ENV_FIELDS[section][field] === envName ||
          (section === 'sandboxed-compiles' && field === 'hostDir' && envName === 'COMPILES_HOST_DIR')
        expect(known, `${file}: ${envName} -> ${section}.${field}`).toBe(true)
      }
    })
  }
})

describe('getSection — the env-wins precedence', () => {
  const savedEnv = {}
  const touched = []

  function setEnv(vars) {
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined) savedEnv[k] = undefined
      process.env[k] = v
      touched.push(k)
    }
  }

  function clearEnv(vars) {
    for (const k of vars) {
      if (process.env[k] === undefined) delete process.env[k]
      else process.env[k] = ''
      touched.push(k)
    }
  }

  afterEach(() => {
    for (const k of touched) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    touched.length = 0
  })

  it('env wins over the stored/defaults layer for its fields', async () => {
    setEnv({ OVERLEAF_EMAIL_SMTP_HOST: 'env.smtp.example.org', OVERLEAF_EMAIL_SMTP_PORT: '2525' })
    const { value, envSet } = await getSection('email')
    expect(value.host).toBe('env.smtp.example.org')
    expect(value.port).toBe(2525)
    expect(envSet.host).toBe(true)
    expect(envSet.port).toBe(true)
    // a field without env stays at its default
    expect(envSet.driver).toBeUndefined()
    expect(value.driver).toBe('smtp')
  })

  it('an empty env var does not win (empty means unset)', async () => {
    setEnv({ OVERLEAF_EMAIL_SMTP_HOST: '' })
    const { value, envSet } = await getSection('email')
    expect(envSet.host).toBeUndefined()
    clearEnv(['OVERLEAF_EMAIL_SMTP_HOST'])
  })

  it('defaults stand where neither env nor a stored value exists', async () => {
    clearEnv(['APP_NAME', 'MAX_UPLOAD_SIZE', 'DEFAULT_LATEX_COMPILER'])
    const { value } = await getSection('misc')
    expect(value.appName).toBe('Overleaf (Community Edition)')
    expect(value.maxUploadSizeMb).toBe(50)
    expect(value.defaultLatexCompiler).toBe('pdflatex')
  })

  it('boolean env vars are parsed, lists are split', async () => {
    setEnv({
      OVERLEAF_TEMPLATE_GALLERY: 'true',
      ENABLED_LINKED_FILE_TYPES: 'project_file, project_output_file , url',
    })
    const templates = await getSection('templates')
    expect(templates.value.enabled).toBe(true)
    const linked = await getSection('linked-file-types')
    expect(linked.value.enabledTypes).toEqual([
      'project_file',
      'project_output_file',
      'url',
    ])
  })

  it('secret fields are masked and flagged, never returned in plaintext', async () => {
    const { value, stored } = await getSection('email')
    expect(value.pass).toBe('')
    expect(value.passSet).toBe(false)
    expect(stored.pass).toBe('')
    expect(stored.passSet).toBe(false)
  })
})

describe('input cleaning and secret masking', () => {
  it('cleanSectionInput drops keys outside the allow-list', () => {
    const cleaned = cleanSectionInput('email', {
      host: 'x',
      notAField: 1,
      passSet: true,
    })
    expect(cleaned.host).toBe('x')
    expect(cleaned.notAField).toBeUndefined()
    expect(cleaned.passSet).toBeUndefined()
  })

  it('maskSecrets empties the secret and sets the <field>Set flag', () => {
    const masked = maskSecrets('email', { pass: 'hunter2', host: 'smtp' })
    expect(masked.pass).toBe('')
    expect(masked.passSet).toBe(true)
    expect(masked.host).toBe('smtp')
  })
})

describe('validators', () => {
  it('sandboxed compiles', () => {
    expect(validateSandboxedCompilesSection({ enabled: true, images: [{ image: 'a:b' }] }))
      .toEqual([])
    expect(validateSandboxedCompilesSection({ images: [] }).length).toBeGreaterThan(0)
    expect(validateSandboxedCompilesSection({ enabled: 'yes' }).length).toBeGreaterThan(0)
  })

  it('conversions', () => {
    expect(validateConversionsSection({ pandocEnabled: true, conversionTimeoutSeconds: 120 }))
      .toEqual([])
    expect(validateConversionsSection({ conversionTimeoutSeconds: 0 }).length).toBeGreaterThan(0)
  })

  it('email', () => {
    expect(validateEmailSection({ driver: 'smtp', host: 'smtp.example.org' })).toEqual([])
    expect(validateEmailSection({ driver: 'smtp' }).length).toBeGreaterThan(0)
    expect(validateEmailSection({ driver: 'carrier-pigeon' }).length).toBeGreaterThan(0)
  })

  it('editor', () => {
    expect(
      validateEditorSection({
        additionalTextExtensions: ['md'],
        maxDocLength: 1000,
        maxJsonRequestSize: 1024,
        maxUpdateSize: 1024,
        commentMentionDelayMs: 1000,
      })
    ).toEqual([])
    expect(validateEditorSection({ additionalTextExtensions: 'md' }).length).toBeGreaterThan(0)
  })

  it('security', () => {
    expect(validateSecuritySection({ adminOnlyLogin: true, cspEnabled: false })).toEqual([])
    expect(validateSecuritySection({ adminOnlyLogin: 'yes' }).length).toBeGreaterThan(0)
  })

  it('sharing', () => {
    expect(validateSharingSection({ disableChat: true, linkExpiryTimeout: 60000 })).toEqual([])
    expect(validateSharingSection({ linkExpiryTimeout: -1 }).length).toBeGreaterThan(0)
  })

  it('misc', () => {
    expect(validateMiscSection({ appName: 'AYAKA', maxUploadSizeMb: 100 })).toEqual([])
    expect(validateMiscSection({ appName: '' }).length).toBeGreaterThan(0)
    expect(validateMiscSection({ defaultLatexCompiler: 'pdflatex' })).toEqual([])
    expect(validateMiscSection({ defaultLatexCompiler: 'pdflatex; rm -rf' }).length)
      .toBeGreaterThan(0)
  })

  it('linked file types keep the fixed pair', () => {
    expect(
      validateLinkedFileTypesSection({
        enabledTypes: ['project_file', 'project_output_file', 'url'],
      })
    ).toEqual([])
    expect(validateLinkedFileTypesSection({ enabledTypes: ['url'] }).length).toBeGreaterThan(0)
    expect(KNOWN_LINKED_FILE_TYPES).toContain('dropbox')
  })

  it('github sync / dropbox / git integration', () => {
    expect(validateGithubSyncSection({ enabled: false, clientId: '' })).toEqual([])
    expect(validateGithubSyncSection({ enabled: true, clientId: '' }).length).toBeGreaterThan(0)
    expect(validateDropboxSection({ enabled: true, appKey: 'k' })).toEqual([])
    expect(validateDropboxSection({ enabled: true }).length).toBeGreaterThan(0)
    expect(validateGitIntegrationSection({ enabled: true, host: 'git-bridge', port: 8000 }))
      .toEqual([])
  })

  it('external URL, templates, SSO and services sections', () => {
    expect(validateExternalUrlSection({ blockedNetworks: ['10.0.0.0/8'] })).toEqual([])
    expect(validateExternalUrlSection({ blockedNetworks: ['nope'] }).length).toBeGreaterThan(0)
    expect(validateExternalUrlSection({ allowedResourcesRegex: '([' }).length).toBeGreaterThan(0)
    expect(validateTemplatesSection({ enabled: true })).toEqual([])
    expect(validateSsoSamlSection({ issuer: 'https://idp' })).toEqual([])
    expect(validateSsoOidcSection({ clientID: 'abc' })).toEqual([])
    expect(validateSsoLdapSection({ url: 'ldap://ldap' })).toEqual([])
    expect(validateSsoLdapSection({ url: 'http://ldap' }).length).toBeGreaterThan(0)
    expect(validateServicesSection({ v1HistoryUrl: 'https://h' })).toEqual([])
  })
})
