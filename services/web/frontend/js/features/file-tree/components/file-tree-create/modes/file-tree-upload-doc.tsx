import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import Uppy from '@uppy/core'
import XHRUpload from '@uppy/xhr-upload'
import { Dashboard } from '@uppy/react'
import OLButton from '@/shared/components/ol/ol-button'
import { useFileTreeActionable } from '../../../contexts/file-tree-actionable'
import { useProjectContext } from '../../../../../shared/context/project-context'
import * as eventTracking from '../../../../../infrastructure/event-tracking'
import '@uppy/core/dist/style.css'
import '@uppy/dashboard/dist/style.css'
import { refreshProjectMetadata } from '../../../util/api'
import ErrorMessage from '../error-message'
import { debugConsole } from '@/utils/debugging'
import { isAcceptableFile } from '@/features/file-tree/util/is-acceptable-file'
import {
  findFileByNameInFolder,
  findFolderByNameInFolder,
} from '@/features/file-tree/util/is-name-unique-in-folder'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import {
  Conflict,
  FileUploadConflicts,
  FolderUploadConflicts,
} from '@/features/file-tree/components/file-tree-create/file-tree-upload-conflicts'
import getMeta from '@/utils/meta'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import {
  findDuplicateUploadDestinations,
  sanitizeUploadMetadata,
  sortUploadFilesByName,
} from '@/features/file-tree/util/sanitize-upload-metadata'

export default function FileTreeUploadDoc() {
  const { t } = useTranslation()
  const { parentFolderId, cancel, droppedFiles, setDroppedFiles } =
    useFileTreeActionable()
  const { fileTreeData } = useFileTreeData()
  const { projectId } = useProjectContext()

  const [error, setError] = useState<string>()
  const [duplicateUploadDestinations, setDuplicateUploadDestinations] =
    useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [folderConflicts, setFolderConflicts] = useState<Conflict[]>([])
  const [overwrite, setOverwrite] = useState(false)
  const dashboardRef = useRef<HTMLDivElement>(null)

  const maxNumberOfFiles = 180
  const maxFileSize = getMeta('ol-ExposedSettings').maxUploadSize

  // calculate conflicts
  const buildConflicts = (files: Record<string, any>) => {
    const conflicts: Conflict[] = []

    for (const file of Object.values(files)) {
      const { name, relativePath } = file.meta

      if (!relativePath) {
        const targetFolderId = file.meta.targetFolderId ?? parentFolderId
        const duplicateFile = findFileByNameInFolder(
          fileTreeData,
          targetFolderId,
          name
        )
        if (duplicateFile) {
          conflicts.push({
            entity: duplicateFile,
            type: 'file',
          })
        }

        const duplicateFolder = findFolderByNameInFolder(
          fileTreeData,
          targetFolderId,
          name
        )
        if (duplicateFolder) {
          conflicts.push({
            entity: duplicateFolder,
            type: 'folder',
          })
        }
      }
    }

    return conflicts
  }

  const buildFolderConflicts = (files: Record<string, any>) => {
    const conflicts: Conflict[] = []

    for (const file of Object.values(files)) {
      const { relativePath } = file.meta

      if (relativePath) {
        const [rootName] = relativePath.replace(/^\//, '').split('/')

        const targetFolderId = file.meta.targetFolderId ?? parentFolderId
        const duplicateFile = findFileByNameInFolder(
          fileTreeData,
          targetFolderId,
          rootName
        )
        if (duplicateFile) {
          conflicts.push({
            entity: duplicateFile,
            type: 'file',
          })
        }

        const duplicateFolder = findFolderByNameInFolder(
          fileTreeData,
          targetFolderId,
          rootName
        )
        if (duplicateFolder) {
          conflicts.push({
            entity: duplicateFolder,
            type: 'folder',
          })
        }
      }
    }

    return conflicts
  }

  const buildEndpoint = (projectId: string, targetFolderId: string) => {
    let endpoint = `/project/${projectId}/upload`

    if (targetFolderId) {
      endpoint += `?folder_id=${targetFolderId}`
    }

    return endpoint
  }

  const rejectDuplicateUploadDestinations = useCallback(
    (files: Record<string, any>) => {
      const duplicates = findDuplicateUploadDestinations(files, parentFolderId)
      setDuplicateUploadDestinations(duplicates)

      if (duplicates.length === 0) {
        setError(currentError =>
          currentError === 'duplicate-upload-destinations'
            ? undefined
            : currentError
        )
        return false
      }

      setError('duplicate-upload-destinations')
      setConflicts([])
      setFolderConflicts([])
      return true
    },
    [parentFolderId]
  )

  // initialise the Uppy object
  const [uppy] = useState(() => {
    const endpoint = buildEndpoint(projectId, parentFolderId)

    return (
      new Uppy<{ relativePath?: string; targetFolderId: string }>({
        // logger: Uppy.debugLogger,
        allowMultipleUploadBatches: false,
        restrictions: {
          maxNumberOfFiles,
          maxFileSize: maxFileSize || null,
        },
        onBeforeFileAdded(file) {
          const { name, relativePath } = sanitizeUploadMetadata(
            file.name,
            file.meta.relativePath
          )
          if (!isAcceptableFile(name, relativePath)) {
            return false
          }
          return {
            ...file,
            // Uppy lowercases names and paths in IDs, hiding case-only collisions.
            id: JSON.stringify([file.id, file.name, file.meta.relativePath]),
            name,
            meta: { ...file.meta, name, relativePath },
          }
        },
        onBeforeUpload(files) {
          if (rejectDuplicateUploadDestinations(files)) {
            return false
          }
          setError(undefined)
          const conflicts = buildConflicts(files)
          const folderConflicts = buildFolderConflicts(files)
          setConflicts(conflicts)
          setFolderConflicts(folderConflicts)
          const canUpload =
            conflicts.length === 0 && folderConflicts.length === 0
          setIsUploading(canUpload)
          return canUpload
        },
        autoProceed: true,
        locale: {
          strings: {
            youCanOnlyUploadX:
              'You can only upload %{smart_count} files at a time',
          },
        },
      })
        // use the basic XHR uploader
        .use(XHRUpload, {
          endpoint,
          headers: {
            'X-CSRF-TOKEN': getMeta('ol-csrfToken'),
          },
          // limit: maxConnections || 1,
          limit: 1,
          fieldName: 'qqfile', // "qqfile" field inherited from FineUploader
        })
        // close the modal when all the uploads completed successfully
        .on('complete', result => {
          setIsUploading(false)
          if (!result.failed.length) {
            cancel()
          }
        })
        // broadcast doc metadata after each successful upload
        .on('upload-success', (file, response) => {
          eventTracking.sendMB('new-file-created', {
            method: 'upload',
            extension:
              file?.name && file?.name.split('.').length > 1
                ? file?.name.split('.').pop()
                : '',
          })
          if (response.body.entity_type === 'doc') {
            window.setTimeout(() => {
              refreshProjectMetadata(projectId, response.body.entity_id)
            }, 250)
          }
        })
        // handle upload errors
        .on('upload-error', (file, error, response) => {
          switch (response?.status) {
            case 429:
              setError('rate-limit-hit')
              break

            case 403:
              setError('not-logged-in')
              break

            default:
              debugConsole.error(error)
              setError(response?.body?.error || 'generic_something_went_wrong')
              break
          }
        })
    )
  })

  const uppyTheme = useActiveOverallTheme('themed-modals')

  useEffect(() => {
    const updateDuplicates = () => {
      const files = Object.fromEntries(
        uppy.getFiles().map(file => [file.id, file])
      )
      const sortedFiles = sortUploadFilesByName(files, parentFolderId)
      const currentFileIds = Object.keys(files)
      const sortedFileIds = Object.keys(sortedFiles)

      if (currentFileIds.some((id, index) => id !== sortedFileIds[index])) {
        // Uppy renders its file list in object-key order.
        uppy.setState({ files: sortedFiles })
      }

      setError(undefined)
      rejectDuplicateUploadDestinations(sortedFiles)
    }

    updateDuplicates()
    uppy.on('file-added', updateDuplicates)
    uppy.on('file-removed', updateDuplicates)

    return () => {
      uppy.off('file-added', updateDuplicates)
      uppy.off('file-removed', updateDuplicates)
    }
  }, [uppy, parentFolderId, rejectDuplicateUploadDestinations])

  useEffect(() => {
    if (uppy && droppedFiles) {
      uppy.setOptions({
        autoProceed: false,
      })
      for (const file of droppedFiles.files) {
        const fileId = uppy.addFile({
          name: file.name,
          type: file.type,
          data: file,
          source: 'Local',
          isRemote: false,
          meta: {
            relativePath: (file as any).relativePath,
            targetFolderId: droppedFiles.targetFolderId,
          },
        })
        const uppyFile = uppy.getFile(fileId)
        uppy.setFileState(fileId, {
          xhrUpload: {
            ...(uppyFile as any).xhrUpload,
            endpoint: buildEndpoint(projectId, droppedFiles.targetFolderId),
          },
        })
      }
    }

    return () => {
      setDroppedFiles(null)
    }
  }, [uppy, droppedFiles, setDroppedFiles, projectId])

  const handleUpload = useCallback(() => {
    uppy.upload().catch(() => {
      // Errors are reported by Uppy Core and the upload-error handler.
    })
  }, [uppy])

  // handle forced overwriting of conflicting files
  const handleOverwrite = useCallback(() => {
    setOverwrite(true)
    uppy.setOptions({
      onBeforeUpload(files) {
        if (rejectDuplicateUploadDestinations(files)) {
          return false
        }
        // don't check for file conflicts
        setIsUploading(true)
        return true
      },
    })
    handleUpload()
  }, [uppy, rejectDuplicateUploadDestinations, handleUpload])

  const showFolderUploadConflicts = !overwrite && folderConflicts.length > 0
  const showFileUploadConfilcts =
    !overwrite && !showFolderUploadConflicts && conflicts.length > 0
  const showDashboard = !showFileUploadConfilcts && !showFolderUploadConflicts

  useEffect(() => {
    if (!showDashboard) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      dashboardRef.current
        ?.querySelector<HTMLButtonElement>('.uppy-Dashboard-browse')
        ?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [showDashboard])

  return (
    <>
      {error && (
        <UploadErrorMessage
          error={error}
          maxNumberOfFiles={maxNumberOfFiles}
          duplicateDestinations={duplicateUploadDestinations}
        />
      )}
      {showFolderUploadConflicts && (
        <FolderUploadConflicts
          cancel={cancel}
          conflicts={folderConflicts}
          handleOverwrite={handleOverwrite}
          setError={setError}
        />
      )}
      {showFileUploadConfilcts && (
        <FileUploadConflicts
          cancel={cancel}
          conflicts={conflicts}
          handleOverwrite={handleOverwrite}
        />
      )}
      {showDashboard && (
        <div ref={dashboardRef}>
          <Dashboard
            uppy={uppy}
            showProgressDetails
            // note={`Up to ${maxNumberOfFiles} files, up to ${maxFileSize / (1024 * 1024)}MB`}
            height={400}
            width="100%"
            showLinkToFileUploadResult={false}
            proudlyDisplayPoweredByUppy={false}
            hideUploadButton
            // allow files or folders to be selected
            fileManagerSelectionType="both"
            theme={uppyTheme}
            locale={{
              strings: {
                // Text to show on the droppable area.
                // `%{browse}` is replaced with a link that opens the system file selection dialog.
                // TODO: 'drag_here' or 'drop_files_here_to_upload'?
                // dropHereOr: `${t('drag_here')} ${t('or')} %{browse}`,
                dropPasteBoth: `Drop or paste your files, folder, or images here. %{browseFiles} or %{browseFolders} from your computer.`,
                // Used as the label for the link that opens the system file selection dialog.
                // browseFiles: t('select_from_your_computer')
                browseFiles: 'Select files',
                browseFolders: 'select a folder',
              },
            }}
          />
          <div className="d-flex justify-content-end mt-2">
            <OLButton
              disabled={
                Boolean(error) ||
                duplicateUploadDestinations.length > 0 ||
                uppy.getFiles().length === 0 ||
                isUploading
              }
              onClick={handleUpload}
            >
              {t('upload')}
            </OLButton>
          </div>
        </div>
      )}
    </>
  )
}

function UploadErrorMessage({
  error,
  maxNumberOfFiles,
  duplicateDestinations,
}: {
  error: string
  maxNumberOfFiles: number
  duplicateDestinations: string[]
}) {
  const { t } = useTranslation()

  switch (error) {
    case 'too-many-files':
      return (
        <>
          {t('maximum_files_uploaded_together', {
            max: maxNumberOfFiles,
          })}
        </>
      )

    default:
      return (
        <ErrorMessage
          error={error}
          duplicateDestinations={duplicateDestinations}
        />
      )
  }
}
