import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getSection,
  setSection,
  resetSection,
  SECTION_VALIDATORS,
  SECTION_ORDER,
  SECTION_ENV_FIELDS,
} from '../../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import { adminRoute, sendFresh } from './AdminRequestHelper.mjs'

// The /admin/site-settings page: the admin-managed values that hydrate the
// services' settings at boot (site_settings collection, env wins over
// stored — see app/src/Features/SiteSettings/SiteSettingsManager.mjs).

const __dirname = Path.dirname(fileURLToPath(import.meta.url))
const SITE_SETTINGS_VIEW = Path.resolve(__dirname, '../views/admin-site-settings')

// The page (chrome identical to /admin/user and /admin/project)
async function siteSettingsPage(req, res) {
  res.render(SITE_SETTINGS_VIEW, {
    title: 'admin_panel',
  })
}

// Every section at once: effective value (env wins over stored over
// defaults), which fields the environment currently controls (envSet),
// the stored fields (secrets masked), and the section → field → env-var
// map the page shows next to each field.
async function siteSettingsList(req, res) {
  const sections = {}
  for (const name of SECTION_ORDER) {
    sections[name] = await getSection(name)
  }
  sendFresh(res, {
    order: SECTION_ORDER,
    sections,
    envFields: SECTION_ENV_FIELDS,
  })
}

// Save one section (validated; secrets encrypted, empty secret keeps the
// stored value). Effective where the env var is unset/empty.
async function siteSettingsSave(req, res) {
  const name = req.params.section
  const validator = SECTION_VALIDATORS[name]
  if (!validator) {
    res.status(404).json({ errors: [`unknown section: ${name}`] })
    return
  }
  const body = req.body
  const errors = validator(body)
  if (errors.length) {
    res.status(422).json({ errors })
    return
  }
  await setSection(name, body)
  res.sendStatus(200)
}

// Undo the stored copy of a section: env + defaults stand again.
async function siteSettingsReset(req, res) {
  const name = req.params.section
  if (!SECTION_VALIDATORS[name]) {
    res.status(404).json({ errors: [`unknown section: ${name}`] })
    return
  }
  await resetSection(name)
  res.sendStatus(200)
}

export default {
  page: siteSettingsPage,
  list: adminRoute(siteSettingsList),
  save: adminRoute(siteSettingsSave),
  reset: adminRoute(siteSettingsReset),
}
