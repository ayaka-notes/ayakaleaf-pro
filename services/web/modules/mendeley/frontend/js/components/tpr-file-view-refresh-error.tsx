import { useTranslation } from 'react-i18next'
import Notification from '@/shared/components/notification'
import type {
  LinkedFile,
  LinkedFileData,
} from '@/features/file-view/types/binary-file'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import { getReferenceProvider } from '../reference-providers'

type TPRFileViewRefreshErrorProps = {
  file: LinkedFile<keyof LinkedFileData>
  refreshError: string
}

/**
 * Error message shown when refreshing a linked file fails.
 * Reference-manager files get a provider-specific message where we can
 * recognise the failure; any other linked file falls through to the raw error,
 * since core renders only this one component.
 * Registered via overleafModuleImports.tprFileViewRefreshError.
 */
export function TPRFileViewRefreshError({
  file,
  refreshError,
}: TPRFileViewRefreshErrorProps) {
  const { t } = useTranslation()
  const features = useInstanceFeatures()

  const provider = getReferenceProvider(file)

  // Suppress the provider-specific error UI for a reference manager that is
  // turned off; other providers still surface their refresh errors.
  if (provider && !features[provider.id]) {
    return null
  }

  let message = refreshError

  if (provider) {
    if (!refreshError) {
      message =
        provider.id === 'zotero'
          ? t('zotero_reference_loading_error')
          : t('mendeley_reference_loading_error')
    } else if (refreshError?.includes('not linked')) {
      message =
        provider.id === 'zotero'
          ? t('zotero_reference_loading_error_forbidden')
          : t('mendeley_reference_loading_error_forbidden')
    } else if (
      refreshError === 'forbidden' ||
      refreshError?.includes('403') ||
      // Core answers every AccessDeniedError with this text; for a reference
      // manager it means the stored credentials no longer work
      refreshError ===
        t('the_project_that_contains_this_file_is_not_shared_with_you')
    ) {
      message =
        provider.id === 'zotero'
          ? t('zotero_reference_loading_error_forbidden')
          : t('mendeley_reference_loading_error_forbidden')
    } else if (
      refreshError === 'expired' ||
      refreshError?.includes('token expired')
    ) {
      message =
        provider.id === 'zotero'
          ? t('zotero_reference_loading_error_expired')
          : t('mendeley_reference_loading_error_expired')
    }
  }

  return (
    <div className="file-view-error">
      <div className="notification-list">
        <Notification type="error" content={message} />
      </div>
    </div>
  )
}
