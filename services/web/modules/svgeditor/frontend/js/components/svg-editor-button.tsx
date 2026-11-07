import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import { BinaryFile } from '@/features/file-view/types/binary-file'
import { isSvgFile } from '../util/svg-editor-utils'
import SvgEditorModal from './svg-editor-modal'

/**
 * "Edit SVG" action, rendered next to the download button in the file view
 * header for `.svg` files (fileViewButtons slot). Opens the full-space SVG
 * editor modal (embedded SVG-Edit); see ../README.md.
 */
export default function SvgEditorButton({ file }: { file: BinaryFile }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!isSvgFile(file.name)) {
    return null
  }

  return (
    <>
      <OLButton onClick={() => setOpen(true)}>
        <MaterialIcon type="edit" className="align-middle" />{' '}
        <span>{t('edit_svg')}</span>
      </OLButton>
      {open && (
        <SvgEditorModal
          key={file._id}
          file={file}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
