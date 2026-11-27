import { GlobalToastGeneratorEntry } from '@/features/ide-react/components/global-toasts'
import { useTranslation } from 'react-i18next'

const TikzExportCreatedToast = ({ fileName }: { fileName?: string }) => {
  const { t } = useTranslation()
  return fileName ? (
    <span>{t('tikz_export_created', { fileName })}</span>
  ) : (
    <span>{t('tikz_export_created_fallback')}</span>
  )
}

const TikzExportFailedToast = ({ detail }: { detail?: string }) => {
  const { t } = useTranslation()
  return detail ? (
    <span>{t('tikz_export_failed', { detail })}</span>
  ) : (
    <span>{t('tikz_export_failed_fallback')}</span>
  )
}

const generators: GlobalToastGeneratorEntry[] = [
  {
    key: 'tikz:export-created',
    generator: ({ fileName }) => ({
      content: <TikzExportCreatedToast fileName={fileName} />,
      type: 'success',
      autoHide: true,
      delay: 6000,
      isDismissible: true,
    }),
  },
  {
    key: 'tikz:export-failed',
    generator: ({ detail }) => ({
      content: <TikzExportFailedToast detail={detail} />,
      type: 'error',
      autoHide: true,
      delay: 8000,
      isDismissible: true,
    }),
  },
]

export default generators
