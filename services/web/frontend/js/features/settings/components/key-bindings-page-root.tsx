import { useTranslation } from 'react-i18next'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import KeyBindingsCard from './key-bindings-card'

/**
 * Standalone user settings page for key bindings (`/user/keybind`).
 *
 * Wraps the shared KeyBindingsCard (mode selector + "Customize key bindings…"
 * manager) in the standard account-page layout. The card provides its own
 * UserSettingsProvider, reads the `ol-userSettings` meta, and persists changes
 * through the standard `saveUserSettings()` endpoint.
 */
function KeybindingsPageRoot() {
  const { isReady } = useWaitForI18n()
  const { t } = useTranslation()
  return (
    <div className="container">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          {isReady ? (
            <OLPageContentCard>
              <div className="page-header">
                <h1>{t('keybindings')}</h1>
              </div>
              <KeyBindingsCard />
            </OLPageContentCard>
          ) : null}
        </OLCol>
      </OLRow>
    </div>
  )
}

export default KeybindingsPageRoot
