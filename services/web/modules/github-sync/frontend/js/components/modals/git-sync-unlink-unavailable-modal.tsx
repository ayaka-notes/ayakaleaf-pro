import { useTranslation, Trans } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { deleteJSON } from '@/infrastructure/fetch-json'
import { OLModalBody, OLModalFooter } from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import { debugConsole } from '@/utils/debugging'
import { GitSyncModalStatus } from '../../types/git-sync-types'

type GitSyncUnlinkUnavailableModalProps = {
  handleHide: () => void
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
  projectId: string
}

const GitSyncUnlinkUnavailableModal = ({
  handleHide,
  setModalStatus,
  projectId,
}: GitSyncUnlinkUnavailableModalProps) => {
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
        <div className="notification-list">
          <Notification
            type="error"
            content={t('github_sync_repository_not_found_description')}
          />
        </div>

        {error && (
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
            variant="primary"
            onClick={handleUnlink}
            disabled={isLoading}
          >
            {t('unlink_github_repository')}
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

export default GitSyncUnlinkUnavailableModal
