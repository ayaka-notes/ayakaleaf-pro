import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import GitlabLogo from '@/shared/svgs/gitlab-logo'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import GitSyncModal from './modals/git-sync-modal'
import { GitSyncModalStatus } from '../types/git-sync-types'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

const GitLabSyncCard = () => {
  const { t } = useTranslation()
  const { gitlabSync } = useInstanceFeatures()

  const [showModal, setShowModal] = useState(false)
  const { projectId, name } = useProjectContext()
  const [modalStatus, setModalStatus] = useState<GitSyncModalStatus>('loading')

  if (!gitlabSync) {
    return null
  }

  return (
    <>
      <IntegrationCard
        title={'GitLab'}
        description={t('sync_with_a_x_repository', { provider: 'GitLab' })}
        icon={<GitlabLogo size={32} />}
        showPaywallBadge={false}
        onClick={() => setShowModal(true)}
      >
      </IntegrationCard>
      <GitSyncModal
        show={showModal}
        modalStatus={modalStatus}
        setModalStatus={setModalStatus}
        handleHide={() => {
          setShowModal(false)
          setModalStatus('loading')
        }}
        projectId={projectId}
        projectName={name}
      />
    </>
  )
}

export default GitLabSyncCard
