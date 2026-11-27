import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * i18n coverage: every translation key used by the drawio module's
 * components must exist in both the English catalog and the extracted
 * translations manifest that feeds the translation tooling.
 */
const webRoot = new URL('../../../../../', import.meta.url)

function readJson(relative) {
  const path = fileURLToPath(new URL(relative, webRoot))
  return JSON.parse(readFileSync(path, 'utf8'))
}

const KEYS = [
  // viewer / new file
  'drawio_title',
  'drawio_status_loading',
  'drawio_status_ready',
  'drawio_saved',
  'drawio_error_boot',
  'drawio_new_file',
  // context menu + toasts
  'convert_to_pdf',
  'convert_to_png',
  'drawio_convert_done',
  'drawio_convert_failed',
  'conversion_error_details',
]

describe('drawio module i18n', () => {
  const en = readJson('locales/en.json')
  const extracted = readJson('frontend/extracted-translations.json')

  it('has every key in the English catalog', () => {
    const missing = KEYS.filter(key => !(key in en))
    expect(missing).toEqual([])
  })

  it('has every key in extracted-translations', () => {
    const missing = KEYS.filter(key => !(key in extracted))
    expect(missing).toEqual([])
  })
})
