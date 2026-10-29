import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as eventTracking from '../../../../infrastructure/event-tracking'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import getMeta from '@/utils/meta'

import {
  OLDropdownDivider,
  OLDropdownItem,
} from '@/shared/components/ol/ol-dropdown-menu'
import { useFileTreeActionable } from '../../contexts/file-tree-actionable'
import { useFileTreeSelectable } from '../../contexts/file-tree-selectable'
import { findInTree } from '../../util/find-in-tree'
import { duplicateFile } from '../../util/duplicate-file'
import useIsNetworkStalled from '@/features/ide-react/hooks/use-is-network-stalled'
import {
  showFileDuplicated,
  showFileDuplicateError,
} from '../file-tree-duplicate-toasts'

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

  const { projectId, project } = useProjectContext()
  const projectOwner = project?.owner?._id

  const { fileTreeData } = useFileTreeData()
  const { selectedEntityIds } = useFileTreeSelectable()
  const [duplicating, setDuplicating] = useState(false)

  const selectedEntity = useMemo(() => {
    if (selectedEntityIds.size !== 1) {
      return null
    }
    const [selectedEntityId] = selectedEntityIds
    return findInTree(fileTreeData, selectedEntityId)
  }, [fileTreeData, selectedEntityIds])

  // Duplicate is offered for real file content: binary file refs and
  // ordinary text documents (LaTeX / .bib, ...). Excluded: folders, and
  // linked-file documents whose content is owned by an external provider
  // (Zotero / Mendeley / linked project files) — copying their cached
  // content is not meaningful.
  const selectedDocEntity =
    selectedEntity?.type === 'doc' ? selectedEntity.entity : null
  const isLinkedFileDoc = !!(
    (selectedDocEntity as { linkedFileData?: { provider?: string } })
      ?.linkedFileData?.provider
  )

  const canDuplicate =
    (selectedEntity?.type === 'fileRef' ||
      (selectedEntity?.type === 'doc' && !isLinkedFileDoc)) &&
    !!downloadPath &&
    !!selectedFileName

  const duplicate = useCallback(() => {
    if (duplicating || !downloadPath || !selectedFileName) {
      return
    }
    setDuplicating(true)
    duplicateFile({
      projectId,
      downloadPath,
      folderId: parentFolderId ?? '',
      sourceName: selectedFileName,
      exists: (name) => isDuplicate(parentFolderId ?? '', name),
      csrfToken: (getMeta('ol-csrfToken') as string) || '',
    })
      .then(result => {
        if (result.ok) {
          showFileDuplicated(result.name)
        } else {
          showFileDuplicateError(result.error)
        }
      })
      .finally(() => setDuplicating(false))
  }, [
    duplicating,
    downloadPath,
    selectedFileName,
    projectId,
    parentFolderId,
    isDuplicate,
  ])

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
      {canDuplicate ? (
        <li role="none">
          <OLDropdownItem
            onClick={duplicate}
            disabled={isDisabledDueToNetworkStall || duplicating}
          >
            {t('duplicate')}
          </OLDropdownItem>
        </li>
      ) : null}
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
