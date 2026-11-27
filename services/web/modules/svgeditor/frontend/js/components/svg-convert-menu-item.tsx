import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import getMeta from '@/utils/meta'
import { useProjectContext } from '@/shared/context/project-context'
import {
  OLDropdownDivider,
  OLDropdownItem,
} from '@/shared/components/ol/ol-dropdown-menu'

import { isSvgFile } from '../util/svg-editor-utils'
import { ConvertTarget, convertAndUpload } from '../util/svg-convert'
import {
  showSvgConversionDone,
  showSvgConversionError,
} from './svg-convert-toasts'

export interface SvgConvertMenuItemProps {
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
 * `.svg` files (rendered by the core menu via the
 * `fileTreeContextMenuItems` slot). Plain SVG cannot be `\includegraphics`-ed
 * by pdfLaTeX, so we offer a vector PDF (and a raster PNG) next to the
 * original — created in the same folder as the source file.
 */
export default function SvgConvertMenuItem({
  fileName,
  downloadPath,
  parentFolderId,
  isDuplicate,
}: SvgConvertMenuItemProps) {
  const { t } = useTranslation()
  const { projectId } = useProjectContext()
  const [busy, setBusy] = useState<ConvertTarget | null>(null)

  if (!isSvgFile(fileName || '') || !downloadPath || !projectId) {
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
        showSvgConversionDone(result.name)
      } else {
        showSvgConversionError(result.error)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <OLDropdownDivider />
      <li role="none">
        <OLDropdownItem disabled={busy !== null} onClick={() => run('pdf')}>
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
