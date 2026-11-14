// Prepare the locales inside the image build, the same way CI does on the host
// before building:
//   1. the highest-versioned locales_patches/v*/ directory replaces the locale files
//   2. locales_patches/added/*.json then win per key (recursive merge, like jq `.[0] * .[1]`)
//
// Done in Node (no jq needed) right before `yarn run extract-translations`, so that
// `docker build` / `make all` work on a pristine checkout without touching the host
// working tree.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// In a repo checkout this file sits in server-ce/, in the image it is copied
// to /overleaf next to services/, so try both layouts (and the working dir).
const locales = [
  join(here, '..', 'services/web/locales'),
  join(here, 'services/web/locales'),
  join(process.cwd(), 'services/web/locales'),
].find((dir) => existsSync(dir))
if (!locales) {
  console.error('could not locate services/web/locales')
  process.exit(1)
}
const patches = join(locales, 'locales_patches')

// 1. Replace the locale files with the highest-versioned patch directory
const versions = existsSync(patches)
  ? readdirSync(patches).filter((name) => {
      const dir = join(patches, name)
      return /^v\d/.test(name) && existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.json'))
    })
  : []
versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
const versionDir = versions.at(-1)
if (versionDir) {
  console.log(`Applying locale patch: ${join('locales_patches', versionDir)}`)
  for (const file of readdirSync(join(patches, versionDir))) {
    if (file.endsWith('.json')) cpSync(join(patches, versionDir, file), join(locales, file))
  }
} else {
  console.log('No locale patch directory found; skipping')
}

// 2. Merge the added translations over the patched locales
const merge = (base, extra) => {
  for (const [key, value] of Object.entries(extra)) {
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
    ) {
      merge(base[key], value)
    } else {
      base[key] = value
    }
  }
  return base
}

const addedDir = join(patches, 'added')
if (existsSync(addedDir)) {
  for (const file of readdirSync(addedDir)) {
    if (!file.endsWith('.json') || file === 'added-translations.json') continue
    const target = join(locales, file)
    if (!existsSync(target)) continue
    const merged = merge(JSON.parse(readFileSync(target, 'utf8')), JSON.parse(readFileSync(join(addedDir, file), 'utf8')))
    writeFileSync(target, JSON.stringify(merged, null, 2) + '\n')
    console.log(`Merged added translations into ${file}`)
  }
}
