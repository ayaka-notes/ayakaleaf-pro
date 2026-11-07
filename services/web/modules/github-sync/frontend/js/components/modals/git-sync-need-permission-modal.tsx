import { useTranslation, Trans } from 'react-i18next'
import getMeta from '@/utils/meta'
import Notification from '@/shared/components/notification'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { ProjectSyncState, GitSyncExposedSettings } from '../../types/git-sync-types'

type GitSyncNeedPermissionModalProps = {
  projectSyncState: ProjectSyncState
  handleHide: () => void
}

const GitSyncNeedPermissionModal = ({ projectSyncState, handleHide }: GitSyncNeedPermissionModalProps) => {
  const { t } = useTranslation()
  const { githubUrl } = getMeta('ol-ExposedSettings') as GitSyncExposedSettings
  return (
    <>
      <OLModalBody>
        <div className="notification-list">
          <Notification
            type="warning"
            content={(
              <Trans
                i18nKey="only_project_owner_can_link_github"
                values={{
                  repoFullName: projectSyncState.repoFullName ?? '?',
                  projectOwnerEmail: projectSyncState.ownerEmail ?? '?',
                }}
                components={[
                  projectSyncState.repoFullName ? (
                    <a
                      href={`${githubUrl}/${projectSyncState.repoFullName}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    />
                  ) : (
                    <></>
                  ),
                  projectSyncState.ownerEmail ? <a href={`mailto:${projectSyncState.ownerEmail}`} /> : <></>
                ]}
              />
            )}
          />
        </div>
      </OLModalBody>
      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncNeedPermissionModal
