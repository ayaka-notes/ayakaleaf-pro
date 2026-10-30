import { useCallback } from 'react'
import { type ProjectSettings } from '../utils/api'
import useSaveProjectSettings from './use-save-project-settings'

type LanguageToolSettingKey =
  | 'languageToolEnabled'
  | 'languageToolPicky'
  | 'languageToolLanguage'

/**
 * Setter for the LanguageTool project settings (enabled / picky / language),
 * following the `useSet*` hook pattern of this directory.
 */
export default function useSetLanguageToolSetting(
  key: LanguageToolSettingKey
) {
  const saveProjectSettings = useSaveProjectSettings()

  return useCallback(
    (newValue: ProjectSettings[LanguageToolSettingKey]) => {
      saveProjectSettings(key, newValue).catch(() => {})
    },
    [key, saveProjectSettings]
  )
}
