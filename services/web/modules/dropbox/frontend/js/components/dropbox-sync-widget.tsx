import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import DropboxLogo from '@/shared/svgs/dropbox-logo'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

const DropboxSyncWidgetInner = function DropboxSyncWidget() {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')

  const {
    isLoading: isCheckingConn,
    isError: isErrorConnCheck,
    runAsync: runAsyncConnCheck,
    data: isConnected,
    setData: setConnState,
  } = useAsync<boolean>()

  const {
    isLoading: isUnlinking,
    isError: isErrorUnlink,
    runAsync: runAsyncUnlink,
  } = useAsync<void>()

  const [showUnlinkModal, setShowUnlinkModal] = useState(false)

  const handleConnCheck = useCallback(() => {
    runAsyncConnCheck(getJSON('/user/dropbox/status')).catch(err =>
      debugConsole.error(err?.data?.message || err?.message || err),
    )
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleConnCheck()
  }, [handleConnCheck])

  const handleUnlink = useCallback(() => {
    runAsyncUnlink(postJSON('/user/dropbox/unlink'))
      .then(() => setConnState(false))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
      .finally(() => setShowUnlinkModal(false))
  }, [runAsyncUnlink])

  if (isCheckingConn) {
    return (
      <div className="settings-widget-container">
        <div>
          <DropboxLogo />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4>Dropbox</h4>
          </div>

          <p className="small">
            <span>{t('loading')}…</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="settings-widget-container">
        <div>
          <DropboxLogo size={40} />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="dropbox-sync">Dropbox</h4>
          </div>

          <p className="small">
            {t('dropbox_sync_description', { appName })}
          </p>

          {isErrorConnCheck && (
            <div className="notification-list">
              <Notification
                type="error"
                content={t('dropbox_sync_error')}
              />
            </div>
          )}

          {isErrorUnlink && (
            <div className="notification-list">
              <Notification
                type="error"
                content={t('generic_something_went_wrong')}
              />
            </div>
          )}
        </div>

        <div>
          {isConnected ? (
            <OLButton
              variant="danger-ghost"
              onClick={() => setShowUnlinkModal(true)}
              disabled={isUnlinking}
            >
              {isUnlinking ? t('unlinking') : t('unlink')}
            </OLButton>
          ) : isErrorConnCheck ? (
            <OLButton
              variant="secondary"
              onClick={handleConnCheck}
            >
              {t('reconnect')}
            </OLButton>
          ) : (
            <OLButton
              variant="secondary"
              href="/user/dropbox/oauth"
            >
              {t('link')}
            </OLButton>
          )}
        </div>
      </div>

      <OLModal
        id="dropbox-unlink-modal"
        show={showUnlinkModal}
        onHide={() => setShowUnlinkModal(false)}
        backdrop="static"
      >
        <OLModalHeader>
          <OLModalTitle>
            {t('unlink_provider_account_title', {
              provider: 'Dropbox',
            })}
          </OLModalTitle>
        </OLModalHeader>

        <OLModalBody>
          <p>
            {t('unlink_dropbox_warning')}
          </p>
        </OLModalBody>

        <OLModalFooter>
          <OLButton
            variant="secondary"
            onClick={() => setShowUnlinkModal(false)}
          >
            {t('cancel')}
          </OLButton>

          <OLButton
            variant="danger-ghost"
            onClick={handleUnlink}
            disabled={isUnlinking}
          >
            {isUnlinking ? t('unlinking') : t('unlink')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </>
  )
}

// Hide the widget entirely when Dropbox sync is disabled
export const DropboxSyncWidget = function DropboxSyncWidget() {
  const { dropbox } = useInstanceFeatures()
  if (!dropbox) {
    return null
  }
  return <DropboxSyncWidgetInner />
}
