import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import {
  OLModalHeader,
  OLModalTitle,
  OLModal,
} from '@/shared/components/ol/ol-modal'

import { getJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'

import GitSyncLoadingModal from './git-sync-loading-modal'
import GitSyncMergeOverviewModal from './git-sync-merge-overview-modal'
import GitSyncMergeModal from './git-sync-merge-modal'
import GitSyncConflictModal from './git-sync-conflict-modal'
import GitSyncExportModal from './git-sync-export-modal'
import GitSyncNeedAuthModal from './git-sync-need-auth-modal'
import GitSyncNeedPermissionModal from './git-sync-need-permission-modal'
import GitSyncConfirmUnlinkModal from './git-sync-confirm-unlink-modal'
import GitSyncUnlinkUnavailableModal from './git-sync-unlink-unavailable-modal'
import GitSyncCannotExportModal from './git-sync-cannot-export-modal'

import { GitSyncModalStatus, ProjectSyncState } from '../../types/git-sync-types'

type GitSyncModalProps = {
  show: boolean
  handleHide: () => void
  projectId: string
  projectName: string
  modalStatus: GitSyncModalStatus
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
}

function GitSyncModal({
  show,
  handleHide,
  projectId,
  projectName,
  modalStatus,
  setModalStatus,
}: GitSyncModalProps) {

  const { t } = useTranslation()
  const [commitMessage, setCommitMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

const {
  runAsync: runAsyncConn,
  error: errorConn,
  setError: setErrorConn,
  data: dataConn,
} = useAsync<boolean>()

const {
  runAsync,
  data: projectSyncState,
  setData: setProjectSyncState,
  error,
  setError,
} = useAsync<ProjectSyncState>()

  useEffect(() => {
    if (!show) return
    if (modalStatus !== 'loading') return

    const fetchProjectState = () => {
      setError(null)
      setErrorMessage('')

      runAsync(getJSON(`/project/${projectId}/github-sync/state`))
        .then(pss => {
          switch (pss.mergeStatus) {
            // pss.ownerEmail is set to the email address of the project owner
            // or null if the user is the project owner
            // only owner can export project to git server
            case 'need-export':
              if (!pss.ownerEmail) setModalStatus('need-export')
              else setModalStatus('cannot-export')
              break

            case 'clean':
            case 'diverged':
              setModalStatus('merge-overview')
              break

            case 'conflict':
              setModalStatus('show-conflict')
              break

            // user does not have push permission to repo
            // pss.ownerEmail is set to the email address of the owner
            // or null if the user is the project owner
            // if the user is owner, it seems that repo is not accessible
            case 'need-permission': {
              if (!pss.ownerEmail) setModalStatus('unlink-unavailable')
              else setModalStatus('need-permission')
              break
            }
          }
        })
        .catch(err => {
          debugConsole.error(err?.data?.message || err?.message || err)
          setErrorMessage(t('generic_something_went_wrong'))
        })
    }

    const fetchConnectionStatus = () => {
      setErrorConn(null)
      setErrorMessage('')

      runAsyncConn(getJSON(`/user/github-sync/status`))
        .then(isConnected => {
          if (!isConnected) {
            setModalStatus('need-auth')
            return
          }
          fetchProjectState()
        })
        .catch(err => {
          debugConsole.error(err?.data?.message || err?.message || err)
          setErrorMessage(t('generic_something_went_wrong'))
        })
    }

    fetchConnectionStatus()

  }, [show, modalStatus, projectId, runAsyncConn, runAsync])

  return (
    <OLModal show={show} onHide={handleHide} backdrop="static">
      <OLModalHeader closeButton>
        <OLModalTitle>{t('sync_with_github')}</OLModalTitle>
      </OLModalHeader>

      {modalStatus === 'loading' && (
        <GitSyncLoadingModal
          handleHide={handleHide}
          setModalStatus={setModalStatus}
          errorMessage={errorMessage}
        />
      )}

      {modalStatus === 'need-export' && (
        <GitSyncExportModal
          projectId={projectId}
          projectName={projectName}
          handleHide={handleHide}
          setModalStatus={setModalStatus}
        />
      )}

      {modalStatus === 'cannot-export' && (
        <GitSyncCannotExportModal
          projectSyncState={projectSyncState}
          handleHide={handleHide}
        />
      )}

      {modalStatus === 'need-auth' && (
        <GitSyncNeedAuthModal
          handleHide={handleHide}
        />
      )}

      {modalStatus === 'need-permission' && (
        <GitSyncNeedPermissionModal
          handleHide={handleHide}
          projectSyncState={projectSyncState}
        />
      )}

      {modalStatus === 'merge-overview' && (
        <GitSyncMergeOverviewModal
          projectId={projectId}
          projectSyncState={projectSyncState}
          setModalStatus={setModalStatus}
          handleHide={handleHide}
          commitMessage={commitMessage}
          setCommitMessage={setCommitMessage}
        />
      )}

      {modalStatus === 'confirm-unlink' && (
        <GitSyncConfirmUnlinkModal
          projectId={projectId}
          projectSyncState={projectSyncState}
          setModalStatus={setModalStatus}
          handleHide={handleHide}
        />
      )}

      {modalStatus === 'unlink-unavailable' && (
        <GitSyncUnlinkUnavailableModal
          projectId={projectId}
          setModalStatus={setModalStatus}
          handleHide={handleHide}
        />
      )}

      {(modalStatus === 'run-merge' ||
        modalStatus === 'run-merge-resolved') && (
        <GitSyncMergeModal
          handleHide={handleHide}
          modalStatus={modalStatus}
          setModalStatus={setModalStatus}
          commitMessage={commitMessage}
          setCommitMessage={setCommitMessage}
          projectId={projectId}
          setProjectSyncState={setProjectSyncState}
        />
      )}

      {modalStatus === 'show-conflict' && (
        <GitSyncConflictModal
          projectSyncState={projectSyncState}
          handleHide={handleHide}
          setModalStatus={setModalStatus}
        />
      )}

    </OLModal>
  )
}

export default GitSyncModal
