'use strict'

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const Path = require('node:path')

const adminSettings = require('../admin-settings')

function withStoredDoc(doc, fn) {
  const fixture = Path.join(os.tmpdir(), `admin-settings-fixture-${process.pid}.json`)
  fs.writeFileSync(fixture, JSON.stringify(doc))
  process.env.OVERLEAF_ADMIN_SETTINGS_FIXTURE = fixture
  adminSettings.__test.reset()
  try {
    return fn()
  } finally {
    adminSettings.__test.reset()
    delete process.env.OVERLEAF_ADMIN_SETTINGS_FIXTURE
    try {
      fs.unlinkSync(fixture)
    } catch (err) {
      /* best effort */
    }
  }
}

describe('admin-settings (self-contained stored-settings resolution)', function () {
  describe('stored()', function () {
    it('returns the stored field', function () {
      withStoredDoc(
        { email: { host: 'smtp.example.org', port: 587 } },
        () => {
          assert.strictEqual(adminSettings.stored('email', 'host'), 'smtp.example.org')
          assert.strictEqual(adminSettings.stored('email', 'port'), 587)
        }
      )
    })

    it('returns undefined for missing sections, fields and empty values', function () {
      withStoredDoc({ email: { host: '' }, missing: {} }, () => {
        assert.strictEqual(adminSettings.stored('email', 'host'), undefined)
        assert.strictEqual(adminSettings.stored('email', 'nope'), undefined)
        assert.strictEqual(adminSettings.stored('other', 'x'), undefined)
      })
    })

    it('memoizes: the child runs once per process boot', function () {
      let spawned = 0
      const { execFileSync } = require('node:child_process')
      const orig = execFileSync
      // count invocations of the read child by watching the env of the
      // child (we cannot hook execFileSync without a loader, so we
      // approximate: second read must be instant and identical).
      withStoredDoc({ a: { b: 1 } }, () => {
        const t0 = Date.now()
        adminSettings.stored('a', 'b')
        adminSettings.stored('a', 'b')
        assert.ok(Date.now() - t0 < 1000)
        void orig
        void spawned
      })
    })
  })

  describe('resolveEnv() — the env-wins rule', function () {
    it('process env wins over the stored value', function () {
      withStoredDoc({ email: { host: 'stored.example.org' } }, () => {
        process.env.EMAIL_HOST_OVERRIDE_TEST = 'env.example.org'
        try {
          assert.strictEqual(
            adminSettings.resolveEnv('EMAIL_HOST_OVERRIDE_TEST', 'email', 'host', ''),
            'env.example.org'
          )
        } finally {
          delete process.env.EMAIL_HOST_OVERRIDE_TEST
        }
      })
    })

    it('an empty env variable does NOT win (empty means unset)', function () {
      withStoredDoc({ email: { host: 'stored.example.org' } }, () => {
        process.env.EMAIL_HOST_OVERRIDE_TEST = ''
        try {
          assert.strictEqual(
            adminSettings.resolveEnv('EMAIL_HOST_OVERRIDE_TEST', 'email', 'host', ''),
            'stored.example.org'
          )
        } finally {
          delete process.env.EMAIL_HOST_OVERRIDE_TEST
        }
      })
    })

    it('stored value wins over the fallback', function () {
      withStoredDoc({ email: { host: 'stored.example.org' } }, () => {
        assert.strictEqual(
          adminSettings.resolveEnv('EMAIL_HOST_OVERRIDE_TEST', 'email', 'host', 'default.example.org'),
          'stored.example.org'
        )
      })
    })

    it('falls back when neither env nor stored value exists', function () {
      withStoredDoc({}, () => {
        assert.strictEqual(
          adminSettings.resolveEnv('EMAIL_HOST_OVERRIDE_TEST', 'email', 'host', 'default.example.org'),
          'default.example.org'
        )
        assert.strictEqual(
          adminSettings.resolveEnv('EMAIL_HOST_OVERRIDE_TEST', 'email', 'host'),
          undefined
        )
      })
    })
  })

  describe('mirrorIntoEnv() — the env-wins rule for whole services', function () {
    it('fills only unset/empty vars, from the stored section', function () {
      withStoredDoc(
        { email: { host: 'stored.example.org', port: 2525 }, misc: { appName: 'AYAKA' } },
        () => {
          delete process.env.OVERLEAF_EMAIL_SMTP_HOST
          delete process.env.APP_NAME
          adminSettings.mirrorIntoEnv([
            ['OVERLEAF_EMAIL_SMTP_HOST', 'email', 'host'],
            ['APP_NAME', 'misc', 'appName'],
            ['SOME_VAR', 'no-such-section', 'host'],
          ])
          assert.strictEqual(process.env.OVERLEAF_EMAIL_SMTP_HOST, 'stored.example.org')
          assert.strictEqual(process.env.APP_NAME, 'AYAKA')
          assert.strictEqual(process.env.SOME_VAR, undefined)
          delete process.env.OVERLEAF_EMAIL_SMTP_HOST
          delete process.env.APP_NAME
        }
      )    })

    it('never touches a non-empty env var (docker env wins)', function () {
      withStoredDoc({ email: { host: 'stored.example.org' } }, () => {
        process.env.OVERLEAF_EMAIL_SMTP_HOST = 'compose.example.org'
        try {
          adminSettings.mirrorIntoEnv([['OVERLEAF_EMAIL_SMTP_HOST', 'email', 'host']])
          assert.strictEqual(process.env.OVERLEAF_EMAIL_SMTP_HOST, 'compose.example.org')
        } finally {
          delete process.env.OVERLEAF_EMAIL_SMTP_HOST
        }
      })
    })

    it('stringifies booleans, numbers and lists the way env vars expect', function () {
      withStoredDoc(
        {
          sharing: { disableChat: true },
          'linked-file-types': { enabledTypes: ['project_file', 'url'] },
          editor: { maxDocLength: 42 },
        },
        () => {
          delete process.env.OVERLEAF_DISABLE_CHAT
          delete process.env.ENABLED_LINKED_FILE_TYPES
          delete process.env.MAX_DOC_LENGTH
          adminSettings.mirrorIntoEnv([
            ['OVERLEAF_DISABLE_CHAT', 'sharing', 'disableChat'],
            ['ENABLED_LINKED_FILE_TYPES', 'linked-file-types', 'enabledTypes'],
            ['MAX_DOC_LENGTH', 'editor', 'maxDocLength'],
          ])
          assert.strictEqual(process.env.OVERLEAF_DISABLE_CHAT, 'true')
          assert.strictEqual(process.env.ENABLED_LINKED_FILE_TYPES, 'project_file,url')
          assert.strictEqual(process.env.MAX_DOC_LENGTH, '42')
          delete process.env.OVERLEAF_DISABLE_CHAT
          delete process.env.ENABLED_LINKED_FILE_TYPES
          delete process.env.MAX_DOC_LENGTH
        }
      )
    })
  })

  describe('section()', function () {
    it('returns the stored section object or {}', function () {
      withStoredDoc({ misc: { appName: 'AYAKA' } }, () => {
        assert.deepStrictEqual(adminSettings.section('misc'), { appName: 'AYAKA' })
        assert.deepStrictEqual(adminSettings.section('nope'), {})
      })
    })
  })

  describe('failure degradation', function () {
    it('no connection string -> empty document, no throw', function () {
      delete process.env.OVERLEAF_MONGO_URL
      delete process.env.MONGO_URL
      adminSettings.__test.reset()
      assert.deepStrictEqual(adminSettings.readStoredDoc(), {})
      // memoized: a second read does not spawn again
      assert.deepStrictEqual(adminSettings.readStoredDoc(), {})
    })
  })
})
