import { useTranslation } from 'react-i18next'
import { memo, useCallback } from 'react'
import { buildUrlWithDetachRole } from '@/shared/utils/url-helper'
import { useLocation } from '@/shared/hooks/use-location'
import OLButton from '@/shared/components/ol/ol-button'

function PdfPreviewHybridToolbarOrphanRefreshInner() {
  const { t } = useTranslation()
  const location = useLocation()

  const redirect = useCallback(() => {
    location.assign(buildUrlWithDetachRole(null).toString())
  }, [location])

  return (
    <div className="toolbar-pdf-left">
      <OLButton
        variant="primary"
        size="sm"
        onClick={redirect}
        className="toolbar-pdf-orphan-btn"
      >
        {t('redirect_to_editor')}
      </OLButton>
    </div>
  )
}

export default memo(PdfPreviewHybridToolbarOrphanRefreshInner)
