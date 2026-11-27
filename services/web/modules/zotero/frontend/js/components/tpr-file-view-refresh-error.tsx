import { useTranslation } from 'react-i18next'
import Notification from '@/shared/components/notification'
import type { LinkedFile, LinkedFileData } from '@/features/file-view/types/binary-file'
import { hasProvider } from '@/features/file-view/types/binary-file'

/**
 * Zotero-specific error messages when refreshing a linked file fails.
 * Registered via overleafModuleImports.tprFileViewRefreshError.
 */

type TPRFileViewRefreshErrorProps = {
  file: LinkedFile<keyof LinkedFileData>
  refreshError: string
}

export function TPRFileViewRefreshError({
  file,
  refreshError,
}: TPRFileViewRefreshErrorProps) {
  const { t } = useTranslation()

  let message = refreshError

  if (hasProvider(file, 'zotero')) {
    if (!refreshError) {
      message = t('zotero_reference_loading_error')
    } else if (refreshError?.includes('not linked')) {
      message = t('zotero_reference_loading_error_not_linked')
    } else if (refreshError === 'forbidden' || refreshError?.includes('403')) {
      message = t('zotero_reference_loading_error_forbidden')
    } else if (refreshError === 'expired' || refreshError?.includes('token expired')) {
      message = t('zotero_reference_loading_error_expired')
    }
  }

  return (
    <div className="file-view-error">
      <Notification type="error" content={message} />
    </div>
  )
}
