/**
 * Union the fresh i18next-scanner output with the committed key seed.
 *
 * Why: `yarn extract-translations` (i18next-scanner) OVERWRITES
 * frontend/extracted-translations.json with only the keys its input globs can
 * scan. This checkout's scanner inputs are a subset of the sources the
 * inherited file was generated from, so a bare run silently DROPS base-app
 * keys (a_new_reference_was_added, about_to_delete_cert, ...) — and
 * webpack's translations-loader then strips those keys from every bundled
 * locale chunk, so the UI renders raw key text.
 *
 * frontend/extracted-translations.seed.json is the committed key set (update
 * it when adding sources). This script is chained onto the scanner in the
 * `extract-translations` package script (see package.json), so builds always
 * produce seed ∪ scanned.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, '../frontend')
const seedPath = path.join(dir, 'extracted-translations.seed.json')
const outFile = path.join(dir, 'extracted-translations.json')

const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
const scanned = JSON.parse(fs.readFileSync(outFile, 'utf8'))

const merged = { ...seed }
let added = 0
for (const [key, value] of Object.entries(scanned)) {
  if (!(key in merged)) {
    merged[key] = value
    added++
  }
}

const sorted = {}
for (const key of Object.keys(merged).sort()) sorted[key] = merged[key]
fs.writeFileSync(outFile, JSON.stringify(sorted, null, 2) + '\n')
console.log(
  `extracted-translations: ${Object.keys(sorted).length} keys ` +
    `(seed ${Object.keys(seed).length}, +${added} from scanner)`
)
