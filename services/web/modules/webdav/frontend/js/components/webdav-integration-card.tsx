import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import WebdavLogo from './webdav-logo.tsx'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import WebdavSyncModal from './webdav-sync-modal.tsx'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

const WebDAVIntegrationCard = () => {
    const { t } = useTranslation()
    const { webdav } = useInstanceFeatures()

    const [showModal, setShowModal] = useState(false)
    const { project } = useProjectContext()

    const projectId = project?._id
    if (!webdav || !projectId) return null

    // Extract relevant project info to pass to modal
    const projectName = project?.name

    return (
        <>
            <IntegrationCard
                title={t('webdav')}
                description={t('sync_with_a_webdav_server')}
                icon={<WebdavLogo size={32} />}
                showPaywallBadge={false}
                onClick={() => setShowModal(true)}
            />
            <WebdavSyncModal
                show={showModal}
                projectId={projectId}
                initialProjectName={projectName}
                handleHide={() => {
                    setShowModal(false)
                }}
            />
        </>
    )
}

export default WebDAVIntegrationCard
