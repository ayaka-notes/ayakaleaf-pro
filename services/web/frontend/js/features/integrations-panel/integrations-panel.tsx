import { ElementType } from 'react'
import importOverleafModules from '../../../macros/import-overleaf-module.macro'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'

const wakaTimeEnabled = getMeta('ol-ExposedSettings').wakaTimeEnabled

const allIntegrationPanelComponents = importOverleafModules(
  'integrationPanelComponents'
) as { import: { default: ElementType }; path: string }[]

const integrationPanelComponents = allIntegrationPanelComponents.filter(
  ({ path }) => wakaTimeEnabled || !path.includes('wakatime')
)

export default function IntegrationsPanel() {
  const { t } = useTranslation()

  return (
    <div className="integrations-panel">
      <RailPanelHeader title={t('integrations')} />
      {integrationPanelComponents.map(
        ({ import: { default: Component }, path }) => (
          <Component key={path} />
        )
      )}
    </div>
  )
}
