/**
 * LanguageTool settings component — rendered inside the Settings modal
 * (Spelling and Language → LanguageTool section) via the
 * `settingsModalSpellcheckSections` slot.
 *
 * Persistence: all three settings are PROJECT settings — stored on the
 * project document so every collaborator sees the same values:
 *   - languageToolEnabled   (default: true)
 *   - languageToolPicky     (default: true → level=picky is the default)
 *   - languageToolLanguage  (default: 'auto')
 *
 * Changes are saved server-side through the project settings context and
 * synced to other clients over the project socket.  The CodeMirror
 * extension is informed via the `lt:settings-changed` window event so this
 * component does not need to be inside the CodeMirrorViewContext.
 */

import { useState, useEffect, useCallback } from 'react'
import { useProjectSettingsContext } from '@/features/ide-settings/context/project-settings-context'
import { getJSON } from '@/infrastructure/fetch-json'
import DropdownSetting from '@/features/ide-settings/components/dropdown-setting'
import ToggleSetting from '@/features/ide-settings/components/toggle-setting'
import getMeta from '@/utils/meta'

interface LTLanguage {
  name: string
  code: string
  longCode: string
}

export default function LanguageToolSettings() {
  const {
    languageToolEnabled,
    setLanguageToolEnabled,
    languageToolPicky,
    setLanguageToolPicky,
    languageToolLanguage,
    setLanguageToolLanguage,
  } = useProjectSettingsContext()

  // Defaults: enabled + picky (picky level is the recommended default).
  const enabled = languageToolEnabled !== false
  const picky = languageToolPicky !== false
  const language = languageToolLanguage || 'auto'

  const gtAvailable =
    getMeta('ol-ExposedSettings')?.languageToolAvailable === true

  const [languages, setLanguages] = useState<LTLanguage[]>([])
  const [languagesLoading, setLanguagesLoading] = useState(false)

  // ── Load language list when LT is available and grammar check is on ──
  useEffect(() => {
    if (!gtAvailable || !enabled || languages.length > 0) return

    setLanguagesLoading(true)
    getJSON<LTLanguage[]>('/languagetool/languages')
      .then(langs => {
        // Sort alphabetically by display name for usability
        const sorted = [...langs].sort((a, b) => a.name.localeCompare(b.name))
        setLanguages(sorted)
      })
      .catch(() => {})
      .finally(() => setLanguagesLoading(false))
  }, [gtAvailable, enabled, languages.length])

  // ── Notify the CodeMirror extension of the effective settings ─────────
  const notify = useCallback(
    (detail: { enabled: boolean; picky: boolean; language: string }) => {
      window.dispatchEvent(
        new CustomEvent('lt:settings-changed', {
          detail: { ...detail, available: gtAvailable },
        })
      )
    },
    [gtAvailable]
  )

  const handleToggleEnabled = useCallback(
    (newEnabled: boolean) => {
      setLanguageToolEnabled(newEnabled)
      notify({ enabled: newEnabled, picky, language })
    },
    [setLanguageToolEnabled, picky, language, notify]
  )

  const handleTogglePicky = useCallback(
    (newPicky: boolean) => {
      setLanguageToolPicky(newPicky)
      notify({ enabled, picky: newPicky, language })
    },
    [setLanguageToolPicky, enabled, language, notify]
  )

  const handleLanguageChange = useCallback(
    (newLanguage: string) => {
      setLanguageToolLanguage(newLanguage || 'auto')
      notify({ enabled, picky, language: newLanguage || 'auto' })
    },
    [setLanguageToolLanguage, enabled, picky, notify]
  )

  // Don't render anything if LT is not configured on the server
  if (!gtAvailable) return null

  return (
    <>
      <ToggleSetting
        id="languagetool-enabled"
        label="LanguageTool grammar check"
        description="Grammar and style checking powered by LanguageTool"
        checked={enabled}
        onChange={handleToggleEnabled}
      />

      {enabled && (
        <>
          <ToggleSetting
            id="languagetool-picky"
            label="Picky mode"
            description="Picky level catches more (subtle) grammar and style issues; off uses LanguageTool's default level"
            checked={picky}
            onChange={handleTogglePicky}
          />

          <DropdownSetting
            id="languagetool-language"
            label="Language"
            options={[{ value: 'auto', label: 'Auto-detect' }]}
            optgroups={
              languages.length > 0
                ? [
                    {
                      label: 'Languages',
                      options: languages.map(l => ({
                        value: l.longCode,
                        label: l.name,
                      })),
                    },
                  ]
                : []
            }
            onChange={handleLanguageChange}
            value={language}
            width="wide"
            loading={languagesLoading}
          />
        </>
      )}
    </>
  )
}
