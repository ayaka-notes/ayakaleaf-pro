import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * i18n sanity (REDESIGN_PLAN.md §5/§6):
 *  - every literal t('...') / phrase('...') call in the module sources
 *    exists in BOTH services/web/locales/en.json AND
 *    services/web/frontend/extracted-translations.json
 *  - the interpolated values use __var__ (never {{}}) — the app's i18n
 *    interpolator is configured with prefix/suffix "__".
 *
 * Run from the module dir (its own node_modules/vitest); resolves the two
 * shared JSONs relative to the repo root (3 levels up: services/web).
 */
const here = path.dirname(fileURLToPath(import.meta.url))
// here = <module>/test/unit/src  →  module dir is three levels up
const moduleDir = path.resolve(here, '../../..')
const frontendJs = path.join(moduleDir, 'frontend/js')
// services/web is two levels up from the module dir
const webDir = path.resolve(moduleDir, '../..')

// Match single- and double-quoted literals (an unescaped opposite-kind quote
// is legal inside the other kind — the string we ship contains exactly that).
const T_CALL = /(?:\bt|bibtex\.t|phrase)\(\s*(?:'((?:[^'\\]|\\.)*)'\s*|"((?:[^"\\]|\\.)*)"\s*)/g
// plural(t, count, 'singular_key', 'plural_key'): the keys ride as extra
// string args that the t() pattern above never sees (2026-11-02 regression —
// one_reference / many_references shipped untranslated).
const PLURAL_CALL = /\bplural\(([^;{]{0,220}?)\)/g
const STR_LIT = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g

function moduleSources(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name
    const p = path.join(dir, name)
    if (name === 'node_modules' || name === 'test') continue
    if (entry.isDirectory()) moduleSources(p, out)
    else if(/\.(tsx?|jsx?)$/.test(name)) out.push(p)
  }
  return out
}

describe('i18n (module literals vs shared JSON)', () => {
  const sources = []
  // module's own frontend + the frontend JS of every vendored dep
  // (modules/bib-editor/deps/<dep>/frontend/js) — the pickers live there.
  moduleSources(frontendJs, sources)
  const depsDir = path.join(moduleDir, 'deps')
  if (fs.existsSync(depsDir)) {
    for (const dep of fs.readdirSync(depsDir)) {
      const depJs = path.join(depsDir, dep, 'frontend', 'js')
      if (fs.existsSync(depJs)) moduleSources(depJs, sources)
    }
  }
  const literals = new Set()
  for (const src of sources) {
    const text = fs.readFileSync(src, 'utf8')
    let m
    T_CALL.lastIndex = 0
    while ((m = T_CALL.exec(text)) !== null) {
      literals.add(m[1] ?? m[2])
    }
    PLURAL_CALL.lastIndex = 0
    while ((m = PLURAL_CALL.exec(text)) !== null) {
      const args = m[1]
      STR_LIT.lastIndex = 0
      let lit
      while ((lit = STR_LIT.exec(args)) !== null) {
        literals.add(lit[0].slice(1, -1).replace(/\\(.)/g, '$1'))
      }
    }
    // helper-key mappings (e.g. bib-form-helper.ts) feed t(key); their
    // return literals must exist in the locales too.
    if (src.includes('bib-form-helper')) {
      for (const m2 of text.matchAll(/return\s*'(?:[^'\\]|\\.)*'|return\s*"(?:[^"\\]|\\.)*"/g)) {
        const key = m2[0].replace(/^return\s*/, '').slice(1, -1).replace(/\\(.)/g, '$1')
        literals.add(key)
      }
    }
  }

  it('scanned the module sources', () => {
    expect(sources.length).toBeGreaterThan(3)
    expect(literals.size).toBeGreaterThan(10)
  })

  const enPath = path.join(webDir, 'locales/en.json')
  const extractedPath = path.join(webDir, 'frontend/extracted-translations.json')
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'))
  const extracted = JSON.parse(fs.readFileSync(extractedPath, 'utf8'))

  it('every module t() literal exists in locales/en.json', () => {
    const missing = [...literals].filter(k => !(k in en))
    expect(missing, 'missing in en.json').toEqual([])
  })

  it('every module t() literal exists in frontend/extracted-translations.json', () => {
    const missing = [...literals].filter(k => !(k in extracted))
    expect(missing, 'missing in extracted').toEqual([])
  })

  it('no en.json value for a module key contains the {{}} interpolation tokens', () => {
    const bad = [...literals]
      .filter(k => k in en)
      .filter(k => /\{\{/.test(en[k]))
    expect(bad).toEqual([])
  })

  it('uses __var__ style (never {{var}}) for module interpolation keys', () => {
    const interp = [...literals].filter(k => /__[a-zA-Z]+__/.test(k))
    for (const k of interp) {
      const v = en[k]
      expect(typeof v).toBe('string')
      expect(v).toMatch(/__[a-zA-Z]+__/)
      expect(v).not.toMatch(/\{\{\s*[a-zA-Z]+\s*\}\}/)
    }
    expect(interp.length).toBeGreaterThan(0)
  })
})
