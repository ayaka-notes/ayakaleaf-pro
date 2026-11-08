import { useCallback, useState } from 'react'
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

type TikzFileExportApi = {
  formats: ('png' | 'svg' | 'pdf')[]
  isExportable: (name: string | null | undefined) => boolean
  export: (
    opts: {
      format: 'png' | 'svg' | 'pdf'
      baseFileName: string
      projectId: string
      parentFolderId: string
      downloadPath?: string
    }
  ) => Promise<string>
}

const tikzFileExportApis = importOverleafModules('tikzFileExports') as {
  import: { default: TikzFileExportApi }
  path: string
}[]
const tikzFileExport = tikzFileExportApis[0]?.import?.default

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
  } = useFileTreeActionable()

  const { project, projectId } = useProjectContext()
  const projectOwner = project?.owner?._id
  const [tikzExportBusy, setTikzExportBusy] = useState<string | null>(null)

  const showTikzExportToast = useCallback((detail: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('ide:show-toast', { detail }))
  }, [])

  const handleTikzExport = useCallback(
    async (format: 'png' | 'svg' | 'pdf') => {
      if (!tikzFileExport || !selectedFileName) return
      setTikzExportBusy(format)
      try {
        const fileName = await tikzFileExport.export({
          format,
          baseFileName: selectedFileName,
          projectId,
          parentFolderId,
          downloadPath,
        })
        showTikzExportToast({ key: 'tikz:export-created', fileName })
      } catch (err) {
        showTikzExportToast({
          key: 'tikz:export-failed',
          detail: err instanceof Error ? err.message : String(err),
        })
      } finally {
        setTikzExportBusy(null)
      }
    },
    [
      tikzFileExport,
      selectedFileName,
      projectId,
      parentFolderId,
      downloadPath,
      showTikzExportToast,
    ]
  )

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
      {tikzFileExport?.isExportable?.(selectedFileName) ? (
        <>
          <li role="none">
            <OLDropdownItem
              onClick={() => handleTikzExport('png')}
              disabled={isDisabledDueToNetworkStall || tikzExportBusy != null}
            >
              {t('tikz_export_to_png')}
            </OLDropdownItem>
          </li>
          <li role="none">
            <OLDropdownItem
              onClick={() => handleTikzExport('svg')}
              disabled={isDisabledDueToNetworkStall || tikzExportBusy != null}
            >
              {t('tikz_export_to_svg')}
            </OLDropdownItem>
          </li>
          <li role="none">
            <OLDropdownItem
              onClick={() => handleTikzExport('pdf')}
              disabled={isDisabledDueToNetworkStall || tikzExportBusy != null}
            >
              {t('tikz_export_to_pdf')}
            </OLDropdownItem>
          </li>
        </>
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
