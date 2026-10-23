import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import GiteaLogo from '@/shared/svgs/gitea-logo'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import GitSyncModal from './modals/git-sync-modal'
import { GitSyncModalStatus } from '../types/git-sync-types'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

const GiteaSyncCard = () => {
  const { t } = useTranslation()
  const { giteaSync } = useInstanceFeatures()

  const [showModal, setShowModal] = useState(false)
  const { projectId, name } = useProjectContext()
  const [modalStatus, setModalStatus] = useState<GitSyncModalStatus>('loading')

  if (!giteaSync) {
    return null
  }

  return (
    <>
      <IntegrationCard
        title={'Gitea'}
        description={t('sync_with_a_x_repository', { provider: 'Gitea' })}
        icon={<GiteaLogo size={32} />}
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

export default GiteaSyncCard
