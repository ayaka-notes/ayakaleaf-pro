import LoadingSpinner from '@/shared/components/loading-spinner'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

function PdfPreviewHybridToolbarConnectingInner() {
  const { t } = useTranslation()
  return (
    <div className="toolbar-pdf-left">
      <div className="toolbar-pdf-orphan">
        <LoadingSpinner size="sm" loadingText={`${t('tab_connecting')}…`} />
      </div>
    </div>
  )
}

export default memo(PdfPreviewHybridToolbarConnectingInner)
