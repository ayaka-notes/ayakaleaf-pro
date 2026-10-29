import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { debugConsole } from '@/utils/debugging'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import OLNotification from '@/shared/components/ol/ol-notification'

type WebdavUserStatus = {
  connected: boolean
  baseUrl?: string
  rootPath?: string
}

function ImportFromWebdavModalContent({
  handleHide,
}: {
  handleHide: () => void
}) {
  const { t } = useTranslation()
  const [projectName, setProjectName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [status, setStatus] = useState<WebdavUserStatus>()
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    getJSON<WebdavUserStatus>('/user/webdav/status')
      .then(setStatus)
      .catch(err =>
        debugConsole.error(
          '[WebDAV] import: status check failed',
          err?.data?.message || err?.message || err
        )
      )
  }, [])

  const handleImport = () => {
    if (!projectName.trim() || importing) {
      return
    }
    setImporting(true)
    setError(undefined)
    postJSON<{ projectId?: string | null }>('/project/new/webdav', {
      body: {
        projectName: projectName.trim(),
        ...(rootPath.trim() ? { rootPath: rootPath.trim() } : {}),
      },
    })
      .then(data => {
        // The server names the new project after `projectName`; redirect in
        // the usual way (full page load into the new project).
        window.location.href = data?.projectId
          ? `/project/${data.projectId}`
          : '/'
      })
      .catch(err => {
        setError(
          err?.data?.message ||
            err?.message ||
            t('generic_something_went_wrong')
        )
        setImporting(false)
      })
  }

  return (
    <>
      <OLModalHeader onClose={handleHide}>
        <OLModalTitle>{t('webdav.import_from_webdav')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {status && !status.connected && (
          <div className="mb-3">
            <OLNotification
              type="info"
              content={
                <>
                  {t('webdav_credentials_not_found')}{' '}
                  <a href="/user/settings">{t('link_your_account')}</a>
                </>
              }
            />
          </div>
        )}
        {status?.connected && status.baseUrl && (
          <p className="small mb-3">
            {t('connected_to')} <strong>{status.baseUrl}</strong>
          </p>
        )}

        <div className="form-group mb-3">
          <label className="form-label" htmlFor="webdav-import-project-name">
            {t('webdav.project_name')}
          </label>
          <input
            id="webdav-import-project-name"
            className="form-control"
            type="text"
            value={projectName}
            placeholder={t('webdav.project_name_placeholder')}
            onChange={e => setProjectName(e.target.value)}
            required
          />
          <p className="small form-text">
            {t('webdav.project_name_description')}
          </p>
        </div>

        <div className="form-group mb-3">
          <label className="form-label" htmlFor="webdav-import-root-path">
            {t('webdav.remote_root_label')}
          </label>
          <input
            id="webdav-import-root-path"
            className="form-control"
            type="text"
            value={rootPath}
            placeholder="/Overleaf"
            onChange={e => setRootPath(e.target.value)}
          />
          <p className="small form-text">{t('webdav.remote_root_description')}</p>
        </div>

        {error && (
          <OLNotification type="error" content={error} />
        )}
      </OLModalBody>

      <OLModalFooter>
        {importing && (
          <span className="me-2">
            <OLSpinner size="sm" className="me-2" />
            {t('loading')}
          </span>
        )}
        <OLButton
          variant="secondary"
          onClick={handleHide}
          disabled={importing}
        >
          {t('cancel')}
        </OLButton>
        <OLButton
          variant="primary"
          onClick={handleImport}
          disabled={importing || !projectName.trim()}
        >
          {t('webdav.import')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default function ImportFromWebdavModal({
  onHide,
}: {
  onHide: () => void
}) {
  const { webdav } = useInstanceFeatures()
  if (!webdav) {
    return null
  }
  return (
    <OLModal
      id="webdav-import-modal"
      show
      animation
      size="lg"
      onHide={onHide}
      backdrop="static"
    >
      <ImportFromWebdavModalContent handleHide={onHide} />
    </OLModal>
  )
}
