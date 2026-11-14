import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON, deleteJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import WakaTimeLogo from '@/shared/svgs/wakatime-logo'
import WakaTimeConnectModal from './wakatime-connect-modal'

type WakaTimeStatus = { connected: boolean; apiUrl?: string; error?: boolean }

/**
 * WakaTime account linking widget (Coding statistics page + Account Settings).
 * Connect options:
 *   1. "Connect with WakaTime" — OAuth2 with wakatime.com (no key handling)
 *   2. "Use an API key" — paste a key from wakatime.com or any
 *      WakaTime-compatible server (e.g. a self-hosted Wakapi instance)
 */
export const WakaTimeWidget = function WakaTimeWidget() {
  const { t } = useTranslation()

  const {
    isLoading: isCheckingConn,
    isError: isErrorConnCheck,
    runAsync: runAsyncConnCheck,
    data: status,
    setData: setStatus,
  } = useAsync<WakaTimeStatus>()

  const {
    isLoading: isUnlinking,
    isError: isErrorUnlink,
    runAsync: runAsyncUnlink,
  } = useAsync<void>()

  const [showConnectModal, setShowConnectModal] = useState(false)

  const handleConnCheck = useCallback(() => {
    runAsyncConnCheck(getJSON('/user/wakatime/status')).catch(err =>
      debugConsole.error(err?.data?.message || err?.message || err)
    )
  }, [runAsyncConnCheck])

  useEffect(() => {
    handleConnCheck()
  }, [handleConnCheck])

  const handleUnlink = useCallback(() => {
    runAsyncUnlink(deleteJSON('/user/wakatime'))
      .then(() => setStatus({ connected: false }))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [runAsyncUnlink, setStatus])

  if (isCheckingConn) {
    return (
      <div className="settings-widget-container">
        <div>
          <WakaTimeLogo size={40} />
        </div>
        <div className="description-container">
          <div className="title-row">
            <h4>WakaTime</h4>
          </div>
          <p className="small">
            <span>{t('loading')}…</span>
          </p>
        </div>
      </div>
    )
  }

  const isConnected = !!status?.connected

  // The user's own dashboard lives at the base of their linked API URL:
  //   https://wakatime.com/api/v1            -> https://wakatime.com
  //   http://host/api/compat/wakatime/v1     -> http://host
  const dashboardUrl = status?.apiUrl
    ? status.apiUrl.replace(/\/api\/compat\/wakatime\/v1\/?$/i, '').replace(/\/api\/v1\/?$/i, '') ||
      'https://wakatime.com'
    : 'https://wakatime.com'

  return (
    <>
      <div className="settings-widget-container">
        <div>
          <WakaTimeLogo size={40} />
        </div>

        <div className="description-container">
          <div className="title-row">
            <h4 id="wakatime-link">WakaTime</h4>
          </div>

          <p className="small">
            {t('wakatime_widget_description', {
              defaultValue:
                'Track coding time in your Overleaf projects. Connect your WakaTime account to see your statistics here — only you can see your own data.',
            })}
          </p>

          {isConnected && status?.apiUrl && (
            <p className="small text-muted">{status.apiUrl}</p>
          )}

          {!window.location.pathname.startsWith('/user/coding-statistics') && (
            <p className="small">
              <a href="/user/coding-statistics">
                {t('view_coding_statistics', { defaultValue: 'View your coding statistics →' })}
              </a>
            </p>
          )}

          {isErrorConnCheck && (
            <Notification
              type="error"
              content={t('problem_checking_connection_with_provider', {
                provider: 'WakaTime',
              })}
            />
          )}

          {isErrorUnlink && (
            <Notification type="error" content={t('generic_something_went_wrong')} />
          )}
        </div>

        <div>
          {isConnected ? (
            <div className="coding-statistics-actions">
              <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
                <OLButton variant="secondary">
                  {t('open_dashboard', { defaultValue: 'Open dashboard' })}
                </OLButton>
              </a>
              <OLButton
                variant="danger-ghost"
                onClick={handleUnlink}
                disabled={isUnlinking}
              >
                {isUnlinking ? t('unlinking') : t('unlink')}
              </OLButton>
            </div>
          ) : (
            <div className="coding-statistics-actions">
              <a href="/user/wakatime/oauth/authorize">
                <OLButton variant="primary">
                  {t('connect_with_wakatime', { defaultValue: 'Connect with WakaTime' })}
                </OLButton>
              </a>
              <OLButton variant="secondary" onClick={() => setShowConnectModal(true)}>
                {t('use_api_key', { defaultValue: 'Use an API key' })}
              </OLButton>
            </div>
          )}
        </div>
      </div>

      <WakaTimeConnectModal
        show={showConnectModal}
        handleHide={() => setShowConnectModal(false)}
        onLinked={handleConnCheck}
      />
    </>
  )
}
