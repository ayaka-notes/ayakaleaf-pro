import { useTranslation } from 'react-i18next'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import getMeta from '@/utils/meta'
import { defaultSettings } from '@/shared/context/user-settings-context'
import HighlightForm from './highlight-form'

function HighlightContent() {
  const { t } = useTranslation()
  const initialTags = getMeta('ol-highlightTags') ?? defaultSettings.highlight

  return (
    <OLPageContentCard>
      <div className="page-header">
        <h1>{t('highlight')}</h1>
      </div>
      <p className="page-description">{t('highlight_page_description')}</p>
      <HighlightForm initialTags={initialTags} />
    </OLPageContentCard>
  )
}

function HighlightRoot() {
  const { isReady } = useWaitForI18n()

  return (
    <div className="container highlight-page">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          {isReady ? <HighlightContent /> : null}
        </OLCol>
      </OLRow>
    </div>
  )
}

export default HighlightRoot
