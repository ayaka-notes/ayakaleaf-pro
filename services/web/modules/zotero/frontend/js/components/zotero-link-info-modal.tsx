import { useTranslation, Trans } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { deleteJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import { useState, useEffect } from 'react'
import {
  OLModal,
  OLModalHeader,
  OLModalTitle,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'

type ZoteroLinkInfoModalProps = {
  show: boolean
  isError: boolean
  handleHide: () => void
}

const ZoteroLinkInfoModal = ({ show, isError, handleHide }: ZoteroLinkInfoModalProps) => {
  const { t } = useTranslation()
  const [showUnlinkInfo, setShowUnlinkInfo] = useState(false)

  const {
    isLoading: isUnlinking,
    isError: isErrorUnlink,
    runAsync: runAsyncUnlink,
    reset: resetUnlink,
  } = useAsync<void>()

  const handleUnlink = () => {
    runAsyncUnlink(deleteJSON('/user/zotero'))
      .then(handleHide)
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }

  useEffect(() => {
    if (!show) return
    setShowUnlinkInfo(false)
    resetUnlink()
  }, [show, resetUnlink])

  return (
    <OLModal show={show} onHide={handleHide} backdrop="static" themed="true">
      <OLModalHeader closeButton>
        <OLModalTitle>{t('zotero_integration')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {isErrorUnlink && (
          <Notification type="error" content={t('generic_something_went_wrong')} />
        )}
        {showUnlinkInfo ? (
          <Notification
            type="warning"
            content={t('unlink_warning_reference', { provider: t('zotero') })}
          />
        ) : isError ? (
          <Notification
            type="error"
            content={t('problem_checking_connection_with_provider', {
              provider: t('zotero'),
            })}
          />
        ) : (
          <Notification
            type="info"
            content={
              <Trans
                i18nKey="you_currently_have_x_linked_with_your_overleaf_account"
                values={{ managers: t('zotero') }}
                components={[<b />]}
              />
            }
          />
        )}
      </OLModalBody>

      <OLModalFooter>
        {showUnlinkInfo ? (
          <OLButton
            variant="danger"
            disabled={isUnlinking}
            onClick={handleUnlink}
          >
            {t('confirm')}
          </OLButton>
        ) : (
          <OLButton
            variant="danger-ghost"
            disabled={isUnlinking}
            onClick={() => setShowUnlinkInfo(true)}
          >
            {t('unlink')}
          </OLButton>
        )}
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

export default ZoteroLinkInfoModal
