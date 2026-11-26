/*
 * Custom webpack loader for i18next locale JSON files.
 *
 * It extracts translations used in the frontend (based on the list of keys in
 * extracted-locales.json), and merges them with the fallback language (English)
 *
 * This means that we only load minimal translations data used in the frontend.
 *
 * The strings this fork adds live in locales_patches/. The release workflows
 * merge them into locales/ before building the images, but a plain
 * `docker build` does not, and the committed extracted-translations.json does
 * not list the new keys either. Both leave the admin panel rendering raw keys
 * such as `items_per_page_x` instead of the label. So merge the patches here,
 * at bundle time, and always keep their keys.
 */

const fs = require('fs').promises
const Path = require('path')

const SOURCE_PATH = Path.join(__dirname, '../locales')
const PATCHES_PATH = Path.join(SOURCE_PATH, 'locales_patches')
const EXTRACTED_TRANSLATIONS_PATH = Path.join(
  __dirname,
  'extracted-translations.json'
)

module.exports = function translationsLoader() {
  // Mark the loader as asynchronous, and get the done callback function
  const callback = this.async()

  // Mark the extracted keys file and English translations as a "dependency", so
  // that it gets watched for changes in dev
  this.addDependency(EXTRACTED_TRANSLATIONS_PATH)
  this.addDependency(`${SOURCE_PATH}/en.json`)
  this.addDependency(PATCHES_PATH)

  const [, locale] = this.resourcePath.match(/(\w{2}(-\w{2})?)\.json$/)

  run(locale)
    .then(translations => {
      callback(null, JSON.stringify(translations))
    })
    .catch(err => callback(err))
}

async function run(locale) {
  const json = await fs.readFile(EXTRACTED_TRANSLATIONS_PATH)
  const extractedKeys = Object.keys(JSON.parse(json))

  // Keys added by this fork are bundled even when the extracted list - which is
  // generated on the upstream branch and committed - does not know them yet
  const patches = await getPatchParts(locale)
  const keys = [...new Set([...extractedKeys, ...Object.keys(patches.added)])]

  const fallbackTranslations = await extract('en', keys)
  return extract(locale, keys, fallbackTranslations)
}

async function extract(locale, keys, fallbackTranslations = null) {
  const allTranslations = await getAllTranslations(locale)
  const extractedTranslations = extractByKeys(keys, allTranslations)

  return Object.assign({}, fallbackTranslations, extractedTranslations)
}

async function getAllTranslations(locale) {
  const content = await fs.readFile(Path.join(SOURCE_PATH, `${locale}.json`))
  const patches = await getPatchParts(locale)
  return Object.assign(JSON.parse(content), patches.version, patches.added)
}

// The same order as develop/bin/i18n and the image workflows: the highest
// versioned patch replaces whole files, then added/ wins key by key
async function getPatchParts(locale) {
  const parts = { version: {}, added: {} }
  const entries = await fs
    .readdir(PATCHES_PATH, { withFileTypes: true })
    .catch(() => [])

  const versions = entries
    .filter(entry => entry.isDirectory() && /^v\d/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

  for (const version of versions) {
    Object.assign(
      parts.version,
      await readJson(Path.join(PATCHES_PATH, version, `${locale}.json`), {})
    )
  }
  parts.added = await readJson(
    Path.join(PATCHES_PATH, 'added', `${locale}.json`),
    {}
  )

  return parts
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file))
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fallback
    }
    throw err
  }
}

function extractByKeys(keys, translations) {
  return keys.reduce((acc, key) => {
    const foundString = translations[key]
    if (foundString) {
      acc[key] = foundString
    }
    return acc
  }, {})
}
