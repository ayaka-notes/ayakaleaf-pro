import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import getMeta from '@/utils/meta'
import { useProjectContext } from '@/shared/context/project-context'
import {
  OLDropdownDivider,
  OLDropdownItem,
} from '@/shared/components/ol/ol-dropdown-menu'

import {
  isDrawioFile,
  ConvertTarget,
  convertAndUpload,
} from '../util/drawio-convert'
import {
  showDrawioConversionDone,
  showDrawioConversionError,
} from './drawio-convert-toasts'

export interface DrawioConvertMenuItemProps {
  /** Name of the single selected file (null when not exactly one). */
  fileName: string | null
  /** Blob download URL of the selected file, when resolvable. */
  downloadPath?: string
  /** Id of the folder containing the selected file. */
  parentFolderId: string
  /** True when a name already exists in the target folder. */
  isDuplicate: (name: string) => boolean
}

/**
 * "Convert to PDF" / "Convert to PNG" file-tree context menu items for
 * `.drawio` files (rendered by the core menu via the
 * `fileTreeContextMenuItems` slot). `.drawio` files cannot be
 * `\includegraphics`-ed by pdfLaTeX, so we offer a vector PDF (and a
 * raster PNG) next to the original — created in the same folder as the
 * source file.
 */
export default function DrawioConvertMenuItem({
  fileName,
  downloadPath,
  parentFolderId,
  isDuplicate,
}: DrawioConvertMenuItemProps) {
  const { t } = useTranslation()
  const { projectId } = useProjectContext()
  const [busy, setBusy] = useState<ConvertTarget | null>(null)

  if (!isDrawioFile(fileName || '') || !downloadPath || !projectId) {
    return null
  }

  const run = async (target: ConvertTarget) => {
    if (busy) return
    setBusy(target)
    try {
      const result = await convertAndUpload({
        projectId,
        downloadPath,
        folderId: parentFolderId,
        sourceName: fileName || '',
        target,
        exists: isDuplicate,
        csrfToken: (getMeta('ol-csrfToken') as string) || '',
      })
      if (result.ok) {
        showDrawioConversionDone(result.name)
      } else {
        showDrawioConversionError(result.error)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <OLDropdownDivider />
      <li role="none">
        <OLDropdownItem
          disabled={busy !== null}
          onClick={() => run('pdf')}
        >
          {t('convert_to_pdf')}
        </OLDropdownItem>
      </li>
      <li role="none">
        <OLDropdownItem disabled={busy !== null} onClick={() => run('png')}>
          {t('convert_to_png')}
        </OLDropdownItem>
      </li>
    </>
  )
}
