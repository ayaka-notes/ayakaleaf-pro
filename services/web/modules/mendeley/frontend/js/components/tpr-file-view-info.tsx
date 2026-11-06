import { useTranslation } from 'react-i18next'
import { formatTime, relativeDate } from '@/features/utils/format-date'
import { LinkedFileIcon } from '@/features/file-view/components/file-view-icons'
import type {
  LinkedFile,
  LinkedFileData,
} from '@/features/file-view/types/binary-file'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import { getReferenceProvider } from '../reference-providers'

type TPRFileViewInfoProps = {
  file: LinkedFile<keyof LinkedFileData>
}

/**
 * Shows "Imported from <provider> at <date>" in the file view header when
 * viewing a file linked from a reference manager.
 * Registered via overleafModuleImports.tprFileViewInfo.
 */
export function TPRFileViewInfo({ file }: TPRFileViewInfoProps) {
  const { t } = useTranslation()
  const features = useInstanceFeatures()

  const provider = getReferenceProvider(file)
  if (!provider || !features[provider.id]) {
    return null
  }

  const importedAt =
    (file.linkedFileData as any)?.importedAt || file.created
  const formattedDate = formatTime(importedAt)
  const relative = relativeDate(importedAt)

  return (
    <p>
      <LinkedFileIcon />
      &nbsp;
      {provider.id === 'zotero'
        ? t('imported_from_zotero_at_date', {
            formattedDate,
            relativeDate: relative,
          })
        : t('imported_from_mendeley_at_date', {
            formattedDate,
            relativeDate: relative,
          })}
    </p>
  )
}
