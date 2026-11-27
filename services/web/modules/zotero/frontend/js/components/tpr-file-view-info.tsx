import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { formatTime, relativeDate } from '@/features/utils/format-date'
import { LinkedFileIcon } from '@/features/file-view/components/file-view-icons'
import { hasProvider } from '@/features/file-view/types/binary-file'
import type { LinkedFile, LinkedFileData } from '@/features/file-view/types/binary-file'

/**
 * Shows "Imported from Zotero at <date>" in the owner's file view header or
 * "Imported from Zotero at <date> by <owner>" in the collaborator's file view header
 * when viewing a Zotero-linked .bib file.
 * Registered via overleafModuleImports.tprFileViewInfo.
 */

type TPRFileViewInfoProps = {
  file: LinkedFile<keyof LinkedFileData>
}

export function TPRFileViewInfo({ file }: TPRFileViewInfoProps) {
  const { t } = useTranslation()

  if (!hasProvider(file, 'zotero')) return null

  const metadata = file.linkedFileData as LinkedFileData['zotero'] & {
    importer_id?: string
    importer_name?: string
  }
  const importedAt = metadata.importedAt || file.created
  const formattedDate = formatTime(importedAt)
  const relative = relativeDate(importedAt)

  const importerId = metadata.importer_id
  const importerName = metadata.importer_name || 'Unknown'

  return (
    <p>
      <LinkedFileIcon />
      &nbsp;
      {(importerId === getMeta('ol-user_id')) ? (
        t('imported_from_zotero_at_date', {
          formattedDate,
          relativeDate: relative,
        })
      ) : (
        t('imported_from_zotero_at_date_by', {
          formattedDate,
          relativeDate: relative,
          importedByName: importerName,
        })
      )}
    </p>
  )
}
