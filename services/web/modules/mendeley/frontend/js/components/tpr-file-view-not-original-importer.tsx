import { useTranslation } from 'react-i18next'
import { useUserContext } from '@/shared/context/user-context'
import type {
  LinkedFile,
  LinkedFileData,
} from '@/features/file-view/types/binary-file'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import { getReferenceProvider, isOriginalImporter } from '../reference-providers'

type TPRFileViewNotOriginalImporterProps = {
  file: LinkedFile<keyof LinkedFileData>
}

/**
 * Says why the refresh button is disabled for everyone but the importer.
 * Registered via overleafModuleImports.tprFileViewNotOriginalImporter.
 */
export function TPRFileViewNotOriginalImporter({
  file,
}: TPRFileViewNotOriginalImporterProps) {
  const { t } = useTranslation()
  const user = useUserContext()
  const features = useInstanceFeatures()

  const provider = getReferenceProvider(file)
  if (!provider || !features[provider.id]) {
    return null
  }

  if (isOriginalImporter(file, user.id)) {
    return null
  }

  return (
    <div className="row">
      <div className="p-3 mb-4">
        {t('only_importer_can_refresh', {
          provider: t(provider.id),
        })}
      </div>
    </div>
  )
}
