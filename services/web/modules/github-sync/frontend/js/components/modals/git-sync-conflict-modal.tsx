import { useTranslation, Trans } from 'react-i18next'
import getMeta from '@/utils/meta'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'

import { ProjectSyncState, GitSyncModalStatus } from '../../types/git-sync-types'

type GitSyncConflictModalProps = {
  projectSyncState: ProjectSyncState
  handleHide: () => void
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
}

const GitSyncConflictModal = ({ projectSyncState, handleHide, setModalStatus }: GitSyncConflictModalProps) => {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')

  return (
    <>
      <OLModalBody>
        <div className="notification-list">
          <Notification
            type="warning"
            content={t('github_merge_failed_error', { appName })}
          />
        </div>
        <p className="mt-2">
          <Trans
            i18nKey="github_manual_merge_user_prompt"
            values={{sharelatex_branch: projectSyncState.unmergedBranchName }}
            components={[<b />]}
          />
        </p>
      </OLModalBody>
      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>
        <OLButton
          variant="primary"
          onClick={
            () => setModalStatus('run-merge-resolved')
          }
        >
          {t('continue_github_merge')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncConflictModal
