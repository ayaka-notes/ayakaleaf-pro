import { useTranslation, Trans } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { deleteJSON } from '@/infrastructure/fetch-json'
import { OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import { debugConsole } from '@/utils/debugging'
import { ProjectSyncState, GitSyncModalStatus } from '../../types/git-sync-types'

type GitSyncUnlinkModalProps = {
  handleHide: () => void
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
  projectSyncState: ProjectSyncState
  projectId: string
}

const GitSyncUnlinkModal = ({
  handleHide,
  setModalStatus,
  projectSyncState,
  projectId,
}: GitSyncUnlinkModalProps) => {
  const { t } = useTranslation()

  const {
    error,
    isLoading,
    runAsync,
  } = useAsync<void>()

  const handleUnlink = () => {
    runAsync(deleteJSON(`/project/${projectId}/github-sync`))
      .then(() => setModalStatus('need-export'))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }

  return (
    <>
      <OLModalBody>
        <p>
          {t('project_linked_to')}:&nbsp;
          <a
            href={`https://github.com/${projectSyncState.repoFullName}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {projectSyncState.repoFullName}
          </a>
        </p>

        <hr />

        {!error ? (
          <div className="notification-list">
            <Notification
              type="warning"
              content={t('unlink_the_project_from_the_current_github_repo')}
            />
          </div>
        ) : (
          <div className="notification-list">
            <Notification
              type="error"
              content={
                error.info?.statusCode === 403 ? (
                  <Trans
                    i18nKey="ask_proj_owner_to_unlink_from_current_github"
                    values={{ projectOwnerEmail: error?.data?.ownerEmail ?? '?' }}
                    components={[
                      error?.data?.ownerEmail ? <a href={`mailto:${error.data.ownerEmail}`} /> : <></>
                    ]}
                  />
                ) : (
                  t('something_went_wrong_server')
                )
              }
            />
          </div>
        )}
      </OLModalBody>


      <OLModalFooter>
        <div className="d-flex gap-2">
          <OLButton
            variant="danger"
            onClick={handleUnlink}
            disabled={isLoading || !!error}
          >
            {t('confirm')}
          </OLButton>

          <OLButton
            variant="secondary"
            onClick={handleHide}
          >
            {t('cancel')}
          </OLButton>
        </div>
      </OLModalFooter>
    </>
  )
}

export default GitSyncUnlinkModal
