import { useCallback } from 'react'
import { ElementType, ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import * as eventTracking from '../../../../infrastructure/event-tracking'
import { useProjectContext } from '@/shared/context/project-context'

import {
  OLDropdownDivider,
  OLDropdownItem,
} from '@/shared/components/ol/ol-dropdown-menu'
import { useFileTreeActionable } from '../../contexts/file-tree-actionable'
import useIsNetworkStalled from '@/features/ide-react/hooks/use-is-network-stalled'
import importOverleafModules from '../../../../../macros/import-overleaf-module.macro'

// Context menu items contributed by modules (e.g. the SVG -> PDF/PNG
// conversion actions of the svgeditor module). Each component returns null
// unless the currently selected file is one it handles.
const fileTreeContextMenuItems = importOverleafModules(
  'fileTreeContextMenuItems'
) as { import: { default: ComponentType<any> }; path: string }[]

function FileTreeItemMenuItems() {
  const { t } = useTranslation()

  const {
    canRename,
    canDelete,
    canCreate,
    startRenaming,
    startDeleting,
    startCreatingFolder,
    startCreatingDocOrFile,
    startUploadingDocOrFile,
    downloadPath,
    selectedFileName,
    canSetRootDocId,
    setRootDocId,
    parentFolderId,
    isDuplicate,
  } = useFileTreeActionable()

  const { project } = useProjectContext()
  const projectOwner = project?.owner?._id

  const downloadWithAnalytics = useCallback(() => {
    // we are only interested in downloads of bib files WRT analytics, for the purposes of promoting the tpr integrations
    if (selectedFileName?.endsWith('.bib')) {
      eventTracking.sendMB('download-bib-file', { projectOwner })
    }
  }, [selectedFileName, projectOwner])

  const createWithAnalytics = useCallback(() => {
    eventTracking.sendMB('new-file-click', { location: 'file-menu' })
    startCreatingDocOrFile()
  }, [startCreatingDocOrFile])

  const uploadWithAnalytics = useCallback(() => {
    eventTracking.sendMB('upload-click', { location: 'file-menu' })
    startUploadingDocOrFile()
  }, [startUploadingDocOrFile])

  const isDisabledDueToNetworkStall = useIsNetworkStalled()

  return (
    <>
      {canRename ? (
        <li role="none">
          <OLDropdownItem
            onClick={startRenaming}
            disabled={isDisabledDueToNetworkStall}
          >
            {t('rename')}
          </OLDropdownItem>
        </li>
      ) : null}
      {downloadPath ? (
        <li role="none">
          <OLDropdownItem
            href={downloadPath}
            onClick={downloadWithAnalytics}
            download={selectedFileName ?? undefined}
            disabled={isDisabledDueToNetworkStall}
          >
            {t('download')}
          </OLDropdownItem>
        </li>
      ) : null}
      {/* Module-provided actions for this file (e.g. SVG -> PDF/PNG). */}
      {fileTreeContextMenuItems.map(({ import: { default: MenuItem }, path }) => (
        <MenuItem
          key={path}
          fileName={selectedFileName}
          downloadPath={downloadPath}
          parentFolderId={parentFolderId ?? ''}
          isDuplicate={(name: string) =>
            isDuplicate(parentFolderId ?? '', name)
          }
        />
      ))}
      {canSetRootDocId ? (
        <>
          <OLDropdownDivider />
          <li role="none">
            <OLDropdownItem
              onClick={setRootDocId}
              disabled={isDisabledDueToNetworkStall}
            >
              {t('set_as_main_document')}
            </OLDropdownItem>
          </li>
        </>
      ) : null}
      {canDelete ? (
        <>
          <OLDropdownDivider />
          <li role="none">
            <OLDropdownItem
              onClick={startDeleting}
              disabled={isDisabledDueToNetworkStall}
            >
              {t('delete')}
            </OLDropdownItem>
          </li>
        </>
      ) : null}
      {canCreate ? (
        <>
          <OLDropdownDivider />
          <li role="none">
            <OLDropdownItem
              onClick={createWithAnalytics}
              disabled={isDisabledDueToNetworkStall}
            >
              {t('new_file')}
            </OLDropdownItem>
          </li>
          <li role="none">
            <OLDropdownItem
              onClick={startCreatingFolder}
              disabled={isDisabledDueToNetworkStall}
            >
              {t('new_folder')}
            </OLDropdownItem>
          </li>
          <li role="none">
            <OLDropdownItem
              onClick={uploadWithAnalytics}
              disabled={isDisabledDueToNetworkStall}
            >
              {t('upload')}
            </OLDropdownItem>
          </li>
        </>
      ) : null}
    </>
  )
}

export default FileTreeItemMenuItems
