import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { getJSON, deleteJSON, isForbidden, type FetchError } from '@/infrastructure/fetch-json'
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
import ZoteroLogo from '@/shared/svgs/zotero-logo'

/**
 * Zotero account linking widget for the Account Settings page.
 * Links the account through the Zotero OAuth flow.
 *
 * Registered via overleafModuleImports.referenceLinkingWidgets.
 */
export const ZoteroWidget = function ZoteroWidget() {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')

  const {
    isLoading: isCheckingConn,
    isError: isErrorConnCheck,
    error: connCheckError,
    runAsync: runAsyncConnCheck,
    data: isConnected,
    setData: setConnState,
  } = useAsync<boolean, FetchError>()

  const {
    isLoading: isUnlinking,
    isError: isErrorUnlink,
    runAsync: runAsyncUnlink,
  } = useAsync<void>()

  const [showUnlinkModal, setShowUnlinkModal] = useState(false)

  const needsRelink = isForbidden(connCheckError)

  const handleConnCheck = useCallback(() => {
    runAsyncConnCheck(getJSON('/user/zotero/status'))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleConnCheck()
  }, [handleConnCheck])

  const handleUnlink = useCallback(() => {
    runAsyncUnlink(deleteJSON('/user/zotero'))
      .then(() => setConnState(false))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
      .finally(() => setShowUnlinkModal(false))
  }, [runAsyncUnlink, setConnState])

  if (isCheckingConn) {
    return (
      <div className="settings-widget-container">
        <div>
          <ZoteroLogo />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4>{t('zotero')}</h4>
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
          <ZoteroLogo size={40} />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="zotero-link">{t('zotero')}</h4>
          </div>

          <p className="small">
            {t('zotero_sync_description', { appName })}
          </p>

          {(isErrorConnCheck && !needsRelink) && (
            <Notification
              type="error"
              content={t('problem_checking_connection_with_provider', { provider: t('zotero') })}
            />
          )}

          {isErrorUnlink && (
            <Notification
              type="error"
              content={t('generic_something_went_wrong')}
            />
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
          ) : isErrorConnCheck && !needsRelink ? (
            <OLButton
              variant="secondary"
              onClick={handleConnCheck}
            >
              {t('reconnect')}
            </OLButton>
          ) : (
            <OLButton
              variant="secondary"
              href="/user/zotero/oauth?popup=0"
            >
              {t('link')}
            </OLButton>
          )}
        </div>
      </div>

      <OLModal
        id="zotero-unlink-modal"
        show={showUnlinkModal}
        onHide={() => setShowUnlinkModal(false)}
        backdrop="static"
        themed="true"
      >
        <OLModalHeader>
          <OLModalTitle>
            {t('unlink_reference', {
              provider: 'Zotero',
            })}
          </OLModalTitle>
        </OLModalHeader>

        <OLModalBody>
          <p>
            {t('unlink_warning_reference', {
              provider: 'Zotero',
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
