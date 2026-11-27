import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import type {
  LinkedFile,
  LinkedFileData,
} from '@/features/file-view/types/binary-file'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import { useUserContext } from '@/shared/context/user-context'
import { getReferenceProvider, isOriginalImporter } from '../reference-providers'

type TPRFileViewRefreshButtonProps = {
  file: LinkedFile<keyof LinkedFileData>
  refreshFile: (isTPR: boolean | null) => void
  refreshing: boolean
}

/**
 * Refresh button for the file view.
 * For reference-manager files it flags the refresh as TPR so references are
 * re-indexed; any other linked file (url, project_file, …) keeps the plain
 * behaviour, since core renders only this one component.
 * Registered via overleafModuleImports.tprFileViewRefreshButton.
 */
export function TPRFileViewRefreshButton({
  file,
  refreshFile,
  refreshing,
}: TPRFileViewRefreshButtonProps) {
  const { t } = useTranslation()
  const features = useInstanceFeatures()
  const user = useUserContext()

  const provider = getReferenceProvider(file)

  // Hide the button only for a reference manager that is turned off; other
  // providers still get their button.
  if (provider && !features[provider.id]) {
    return null
  }

  const disabled = provider ? !isOriginalImporter(file, user.id) : false

  return (
    <OLButton
      variant="primary"
      onClick={() => refreshFile(provider ? true : null)}
      disabled={refreshing || disabled}
      isLoading={refreshing}
      loadingLabel={t('refreshing')}
    >
      {t('refresh')}
    </OLButton>
  )
}
