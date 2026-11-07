import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DropboxLogo from '@/shared/svgs/dropbox-logo'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import DropboxSyncModal from './modals/dropbox-sync-modal'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

const DropboxCard = () => {
  const { t } = useTranslation()
  const { dropbox } = useInstanceFeatures()
  const [showModal, setShowModal] = useState(false)

  if (!dropbox) {
    return null
  }

  return (
    <>
      <IntegrationCard
        title={t('dropbox')}
        description={t('sync_all_projects_with_dropbox')}
        icon={<DropboxLogo size={32} />}
        showPaywallBadge={false}
        onClick={() => setShowModal(true)}
      />
      <DropboxSyncModal
        show={showModal}
        handleHide={() => setShowModal(false)}
      />
    </>
  )
}

export default DropboxCard
