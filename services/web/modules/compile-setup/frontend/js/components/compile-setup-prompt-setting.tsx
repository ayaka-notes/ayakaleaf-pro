import { useTranslation } from 'react-i18next'

import ToggleSetting from '@/features/ide-settings/components/toggle-setting'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import { COMPILE_SETUP_PROMPT_ENABLED_KEY } from '../compile-setup-prompt'

export default function CompileSetupPromptSetting() {
  const { t } = useTranslation()
  const [promptEnabled, setPromptEnabled] = usePersistedState(
    COMPILE_SETUP_PROMPT_ENABLED_KEY,
    true,
    { listen: true }
  )

  return (
    <ToggleSetting
      id="compileSetupPrompt"
      label={t('ask_for_compile_settings_when_opening_a_project', {
        defaultValue: 'Ask for compile settings when opening a project',
      })}
      description={t(
        'ask_for_compile_settings_when_opening_a_project_description',
        {
          defaultValue:
            'Show the compile settings dialog when opening a project that has not been configured yet.',
        }
      )}
      checked={promptEnabled}
      onChange={setPromptEnabled}
    />
  )
}
