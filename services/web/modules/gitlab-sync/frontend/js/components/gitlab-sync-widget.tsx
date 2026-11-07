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
import GitlabLogo from '@/shared/svgs/gitlab-logo'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

const GitLabSyncWidgetInner = function GitLabSyncWidget() {
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
    runAsyncConnCheck(getJSON('/user/gitlab-sync/status')).catch(err =>
      debugConsole.error(err?.data?.message || err?.message || err),
    )
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleConnCheck()
  }, [handleConnCheck])

  const handleUnlink = useCallback(() => {
    runAsyncUnlink(postJSON('/user/gitlab-sync/unlink'))
      .then(() => setConnState(false))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
      .finally(() => setShowUnlinkModal(false))
  }, [runAsyncUnlink])

  if (isCheckingConn) {
    return (
      <div className="settings-widget-container">
        <div>
          <GitlabLogo />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4>GitLab</h4>
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
          <GitlabLogo size={40} />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="gitlab-sync">GitLab</h4>
          </div>

          <p className="small">
            {t('x_sync_description', { provider: 'GitLab', appName })}
          </p>

          {isErrorConnCheck && (
            <div className="notification-list">
              <Notification
                type="error"
                content={t('x_sync_error', { provider: 'GitLab' })}
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
              href="/user/gitlab-sync/oauth2"
            >
              {t('link')}
            </OLButton>
          )}
        </div>
      </div>

      <OLModal
        id="git-sync-modal"
        show={showUnlinkModal}
        onHide={() => setShowUnlinkModal(false)}
        backdrop="static"
      >
        <OLModalHeader>
          <OLModalTitle>
            {t('unlink_provider_account_title', {
              provider: 'GitLab',
            })}
          </OLModalTitle>
        </OLModalHeader>

        <OLModalBody>
          <p>
            {t('unlink_x_warning', {
              provider: 'GitLab',
            })}
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

// Hide the widget entirely when GitLab Sync is disabled
export const GitLabSyncWidget = function GitLabSyncWidget() {
  const { gitlabSync } = useInstanceFeatures()
  if (!gitlabSync) {
    return null
  }
  return <GitLabSyncWidgetInner />
}
