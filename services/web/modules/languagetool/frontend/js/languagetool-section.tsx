/**
 * LanguageTool settings section hook — registers the LanguageTool settings in
 * the Settings modal (Spelling and Language tab) through the
 * `settingsModalSpellcheckSections` slot.
 *
 * Signature required by the slot consumer: a default-exported function that
 * returns a SettingsSection (or null).
 *
 * Returns null (hiding the section AND its label) when the LanguageTool
 * service is not enabled — i.e. the overleaf container was started without
 * `LANGUAGE_TOOL_ENABLED=true` — so that Settings → Spelling and Language
 * shows no empty "LanguageTool" entry for disabled deployments.
 * (The `settingsModalSpellcheckSections` registration in
 * config/settings.defaults.js is also gated on the same env flag, so the
 * component is simply absent from the bundle for such deployments.)
 */

import type { SettingsSection } from '@/features/ide-settings/context/types'
import getMeta from '@/utils/meta'
import LanguageToolSettings from './components/languagetool-settings'

export default function languageToolSection(): SettingsSection | null {
  const available =
    getMeta('ol-ExposedSettings')?.languageToolAvailable === true
  if (!available) return null

  return {
    key: 'languagetool',
    title: 'LanguageTool',
    settings: [
      {
        key: 'languagetool-settings',
        component: <LanguageToolSettings />,
      },
    ],
  }
}
