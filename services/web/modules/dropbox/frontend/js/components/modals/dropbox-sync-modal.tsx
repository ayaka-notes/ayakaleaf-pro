import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { FetchError, getJSON, postJSON } from '@/infrastructure/fetch-json'
import { useProjectContext } from '@/shared/context/project-context'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import useAbortController from '@/shared/hooks/use-abort-controller'
import getMeta from '@/utils/meta'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import LoadingSpinner from '@/shared/components/loading-spinner'
import DropboxSyncStatus from '../dropbox-sync-status'

type SyncNowState = 'idle' | 'sending' | 'sent' | 'rate-limited' | 'error'

function LinkedContents() {
  const { t } = useTranslation()
  const { projectId, name } = useProjectContext()
  const { permissionsLevel } = useIdeReactContext()
  const { dropboxAppName } = getMeta('ol-ExposedSettings')
  const { signal } = useAbortController()
  const [syncNow, setSyncNow] = useState<SyncNowState>('idle')

  const handleSyncNow = useCallback(() => {
    setSyncNow('sending')
    postJSON(`/project/${projectId}/dropbox/sync-now`, { signal })
      .then(() => setSyncNow('sent'))
      .catch(err =>
        setSyncNow(
          err instanceof FetchError && err.response?.status === 429
            ? 'rate-limited'
            : 'error'
        )
      )
  }, [projectId, signal])

  // Read-only viewers and reviewers get the project, but their changes in
  // Dropbox do not sync back
  const oneWayMessage =
    permissionsLevel === 'readOnly'
      ? 'read_only_dropbox_sync_message'
      : permissionsLevel === 'review'
        ? 'reviewer_dropbox_sync_message'
        : null

  const folder = `Apps/${dropboxAppName}/${name}`
  return (
    <>
      <p>
        {t('this_project_will_appear_in_your_dropbox_folder_at')}{' '}
        <a
          href={`https://www.dropbox.com/home/${folder
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <strong>{folder}</strong>
        </a>
      </p>
      {oneWayMessage && (
        <Notification
          type="info"
          content={
            <Trans i18nKey={oneWayMessage} components={[<strong key="0" />]} />
          }
        />
      )}
      {/* checks again right after a sync now, while its updates are queued */}
      <DropboxSyncStatus key={syncNow} />
      <p className="small">
        <Trans
          i18nKey="dropbox_sync_troubleshoot"
          components={[
            <OLButton
              key="0"
              variant="link"
              className="btn-inline-link"
              disabled={syncNow === 'sending' || syncNow === 'sent'}
              onClick={handleSyncNow}
            />,
          ]}
        />
      </p>
      {syncNow === 'sent' && (
        <Notification type="info" content={t('dropbox_sync_now_running')} />
      )}
      {syncNow === 'rate-limited' && (
        <Notification
          type="error"
          content={t('dropbox_sync_now_rate_limited')}
        />
      )}
      {syncNow === 'error' && (
        <Notification
          type="error"
          content={t('generic_something_went_wrong')}
        />
      )}
    </>
  )
}

function NotLinkedContents() {
  const { t } = useTranslation()
  const [opened, setOpened] = useState(false)

  if (opened) {
    return <p>{t('refresh_page_after_linking_dropbox')}</p>
  }
  return (
    <p>
      {t('account_not_linked_to_dropbox')}{' '}
      <OLButton
        variant="primary"
        href="/user/settings#project-sync"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpened(true)}
      >
        {t('update_dropbox_settings')}
      </OLButton>
    </p>
  )
}

export default function DropboxSyncModal({
  show,
  handleHide,
}: {
  show: boolean
  handleHide: () => void
}) {
  const { t } = useTranslation()
  const { signal } = useAbortController()
  const [linked, setLinked] = useState<boolean | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!show) {
      return
    }
    getJSON('/user/dropbox/status', { signal })
      .then((isLinked: boolean) => setLinked(isLinked))
      .catch(() => setError(true))
  }, [show, signal])

  return (
    <OLModal show={show} onHide={handleHide} id="dropbox-sync-modal">
      <OLModalHeader>
        <OLModalTitle>{t('sync_with_dropbox')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {error ? (
          <Notification type="error" content={t('dropbox_sync_error')} />
        ) : linked === null ? (
          <LoadingSpinner loadingText={t('checking_dropbox_status')} />
        ) : linked ? (
          <LinkedContents />
        ) : (
          <NotLinkedContents />
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={handleHide}>
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
