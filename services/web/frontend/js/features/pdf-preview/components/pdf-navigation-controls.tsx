import { useTranslation } from 'react-i18next'
import OLButtonGroup from '@/shared/components/ol/ol-button-group'
import PDFToolbarButton from './pdf-toolbar-button'

export type PdfNavigationControlsProps = {
  canGoBack: boolean
  canGoForward: boolean
  goBack: () => void
  goForward: () => void
}

// Shared by the full toolbar and its narrow-layout popover.
export default function PdfNavigationControls({
  canGoBack,
  canGoForward,
  goBack,
  goForward,
}: PdfNavigationControlsProps) {
  const { t } = useTranslation()

  return (
    <OLButtonGroup className="pdfjs-toolbar-buttons">
      <PDFToolbarButton
        tooltipId="pdf-controls-back-tooltip"
        icon="arrow_back"
        label={t('pdf_navigation_back', 'Previous reading position')}
        disabled={!canGoBack}
        onClick={goBack}
      />
      <PDFToolbarButton
        tooltipId="pdf-controls-forward-tooltip"
        icon="arrow_forward"
        label={t('pdf_navigation_forward', 'Next reading position')}
        disabled={!canGoForward}
        onClick={goForward}
      />
    </OLButtonGroup>
  )
}
