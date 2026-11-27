import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// I.5 — i18n sanity guard (guards the P1-6/D-slice fixes at the build level):
// the i18n config uses __var__ interpolation; '{{...}}' renders literally to
// users (the historical raw-string bug). Empty values make i18next fall back
// to the KEY (the 'your_username' placeholder bug).

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '../../../..') // services/web
const enPath = path.join(webRoot, 'locales/en.json')
const extractedPath = path.join(webRoot, 'frontend/extracted-translations.json')

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'))
const extracted = JSON.parse(fs.readFileSync(extractedPath, 'utf8'))

const REQUIRED_KEYS = [
  'failed_to_link_webdav',
  'failed_to_unlink_webdav',
  'failed_to_link_dropbox',
  'failed_to_unlink_dropbox',
  'dropbox_pull_failed',
  'dropbox_push_failed',
]

describe('i18n sanity (en.json / extracted-translations.json)', () => {
  it('no string value contains a literal {{ ... }} interpolation', () => {
    const offenders = Object.entries(en)
      .filter(([, v]) => typeof v === 'string' && v.includes('{{'))
      .map(([k]) => k)
    expect(offenders, `keys using {{}} instead of __var__: ${offenders.join(', ')}`).toEqual([])
  })

  it('provider keys have no empty-string values (empty falls back to the key in the UI)', () => {
    // scoped to module/provider keys — upstream has unrelated fixture keys
    // (e.g. 'any_non_empty_string') that are intentionally empty
    const providerKeys = {
      ...Object.fromEntries(REQUIRED_KEYS.map(k => [k, true])),
      your_username: true,
      webdav_base_url_description: true,
      sync_with_a_github_repository: true,
      serverUrl: true,
    }
    const offenders = Object.keys(providerKeys).filter(k => en[k] === '')
    expect(offenders, `empty provider values: ${offenders.join(', ')}`).toEqual([])
  })

  it('your_username has a real placeholder value', () => {
    expect(typeof en.your_username === 'string' && en.your_username.length > 0).toBe(true)
    expect(en.your_username).not.toBe('your_username')
  })

  it('the six error-path keys exist in en.json with non-empty values', () => {
    for (const k of REQUIRED_KEYS) {
      expect(en[k], `missing/empty en.json key: ${k}`).toBeTruthy()
    }
  })

  it('the six error-path keys are present in extracted-translations.json', () => {
    for (const k of REQUIRED_KEYS) {
      expect(k in extracted, `missing extracted-translations key: ${k}`).toBe(true)
    }
  })
})
