import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

type WebdavStatus = {
  connected: boolean
  baseUrl?: string
  rootPath?: string
  lastSyncAt?: string | null
  lastSyncError?: string | null
  lastConflict?: {
    projectId: string
    path?: string | null
    detectedAt: string
  } | null
}

type WebdavForm = {
  baseUrl: string
  username: string
  password: string
  rootPath: string
}

function logWebdavError(operation: string, error: any) {
  const serverMessage =
    typeof error?.data?.message === 'string'
      ? error.data.message
      : error?.data?.message?.text
  debugConsole.error(`[WebDAV] ${operation} failed`, {
    message: serverMessage || error?.message,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
    method: error?.options?.method,
    url: error?.url,
  })
}

export default function WebdavWidget() {
  const { t } = useTranslation()
  const { webdav } = useInstanceFeatures()
  const [status, setStatus] = useState<WebdavStatus>()
  const [form, setForm] = useState<WebdavForm>({
    baseUrl: '',
    username: '',
    password: '',
    rootPath: '/Overleaf',
  })
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const nextStatus = await getJSON<WebdavStatus>('/user/webdav/status')
      setStatus(nextStatus)
      if (nextStatus.lastSyncError) {
        debugConsole.error('[WebDAV] server reported a sync error', {
          message: nextStatus.lastSyncError,
          conflict: nextStatus.lastConflict || undefined,
          lastSyncAt: nextStatus.lastSyncAt || undefined,
        })
      }
      if (nextStatus.connected) {
        setForm(current => ({
          ...current,
          baseUrl: nextStatus.baseUrl || current.baseUrl,
          rootPath: nextStatus.rootPath || current.rootPath,
        }))
      }
    } catch (refreshError) {
      logWebdavError('status refresh', refreshError)
      setError(t('generic_something_went_wrong'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    refresh()
  }, [refresh])

  const updateField = (field: keyof WebdavForm, value: string) => {
    setForm(current => ({ ...current, [field]: value }))
  }

  // Poll is no longer available in user settings - sync via project pages
  // Note: resolve conflict is handled directly from the webdav-sync-modal

  const disconnect = async () => {
    setWorking(true)
    setError(undefined)
    try {
      await postJSON('/user/webdav/disconnect')
      setStatus({ connected: false })
      setForm(current => ({
        ...current,
        baseUrl: '',
        username: '',
        password: '',
        rootPath: '/Overleaf',
      }))
    } catch (disconnectError: any) {
      logWebdavError('disconnect', disconnectError)
      setError(disconnectError?.data?.message || disconnectError?.message || t('generic_something_went_wrong'))
    } finally {
      setWorking(false)
    }
  }

  const connect = async () => {
    setWorking(true)
    setError(undefined)
    try {
      await postJSON('/user/webdav/connect', { body: form })
      await refresh()
    } catch (connectError: any) {
      logWebdavError('connect', connectError)
      setError(connectError?.data?.message || connectError?.message || t('generic_something_went_wrong'))
    } finally {
      setWorking(false)
    }
  }

  if (!webdav) {
    return null
  }

  if (loading) {
    return (
      <div className="settings-widget-container">
        <div className="d-none d-md-block" aria-hidden="true" />
        <div className="description-container">
          <h4>{t('webdav')}</h4>
          <p className="small">{t('loading')}...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-widget-container">
      <div className="d-none d-md-block" aria-hidden="true" />
      <div className="description-container">
        <div className="title-row">
          <h4 id="webdav">{t('webdav')}</h4>
        </div>
        <p className="small">{t('webdav_description')}</p>
        {error && <OLNotification type="error" content={error} />}
        {status?.lastSyncError && (
          <OLNotification type="error" content={status.lastSyncError} />
        )}
        {status?.connected ? (
          <>
            <p className="small">
              {t('connected_to')} <strong>{status.baseUrl}</strong>.
            </p>
            {/* Sync buttons moved to project pages */}
            <p className="small text-muted mb-2">
              {t('webdav_sync_hint')}
            </p>
            <OLButton
              variant="danger-ghost"
              onClick={disconnect}
              disabled={working}
            >
              {t('webdav_disconnect')}
            </OLButton>
            <p className="small text-muted">{t('webdav_unlink_note')}</p>
          </>
        ) : (
        // The password field lives in a real <form> and connect is the
        // submit handler: browser auth heuristics + Enter submits (a11y).
        <form
          onSubmit={event => {
            event.preventDefault()
            if (working) return
            connect()
          }}
        >
            <label className="form-label" htmlFor="webdav-base-url">{t('webdav_base_url_label')}</label>
            <p className="small form-text">{t('webdav_base_url_description')}</p>
            <input
              id="webdav-base-url"
              className="form-control mb-2"
              value={form.baseUrl}
              onChange={event => updateField('baseUrl', event.target.value)}
              placeholder={t('webdav_server_url_placeholder')}
              type="url"
              required
            />
            <label className="form-label" htmlFor="webdav-username">{t('webdav_username_label')}</label>
            <input
              id="webdav-username"
              className="form-control mb-2"
              value={form.username}
              onChange={event => updateField('username', event.target.value)}
              autoComplete="username"
              required
            />
            <label className="form-label" htmlFor="webdav-password">{t('webdav_password_label')}</label>
            <input
              id="webdav-password"
              className="form-control mb-2"
              value={form.password}
              onChange={event => updateField('password', event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
            <label className="form-label" htmlFor="webdav-root-path">{t('webdav_remote_root_label')}</label>
            <input
              id="webdav-root-path"
              className="form-control mb-2"
              value={form.rootPath}
              onChange={event => updateField('rootPath', event.target.value)}
              required
            />
            <OLButton
              type="submit"
              variant="secondary"
              disabled={working || !form.baseUrl || !form.username || !form.password}
            >
              {working ? t('loading') : t('webdav_connect')}
            </OLButton>
        </form>
        )}
      </div>
    </div>
  )
}