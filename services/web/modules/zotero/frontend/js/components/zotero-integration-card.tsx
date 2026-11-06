import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { getJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import ZoteroLogo from '@/shared/svgs/zotero-logo'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import ZoteroLinkInfoModal from './zotero-link-info-modal'

const ZoteroLinkCard = () => {
  const { t } = useTranslation()

  const [showModal, setShowModal] = useState(false)

  const {
    isError,
    runAsync,
    isLoading
  } = useAsync<boolean>()

  const handleClick = () => {
    if (isLoading) return
    runAsync(getJSON('/user/zotero/status'))
      .then(isConnected => {
        if (isConnected) {
          setShowModal(true)
        } else {
          const popup = window.open(
            '/user/zotero/oauth?popup=1',
            '_blank',
            'width=600,height=700'
          )
          if (!popup) window.location.assign('/user/zotero/oauth?popup=0')
        }
      })
      .catch(err => {
        debugConsole.error(
          err?.data?.message || err?.message || err
        )
        setShowModal(true)
      })
  }

  return (
    <>
      <IntegrationCard
        title={t('zotero')}
        description={t('cite_directly_or_import_references')}
        icon={<ZoteroLogo size={32} />}
        showPaywallBadge={false}
        onClick={handleClick}
      />

      <ZoteroLinkInfoModal
        show={showModal}
        handleHide={() => setShowModal(false)}
        isError={isError}
      />
    </>
  )
}

export default ZoteroLinkCard
