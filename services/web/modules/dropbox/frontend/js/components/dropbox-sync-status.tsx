import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON } from '@/infrastructure/fetch-json'
import useAbortController from '@/shared/hooks/use-abort-controller'
import MaterialIcon from '@/shared/components/material-icon'
import OLSpinner from '@/shared/components/ol/ol-spinner'

const POLL_INTERVAL = 5000

type SyncState = 'checking' | 'synced' | 'in' | 'out' | 'both' | 'error'

// The user's pending work in third-party-datastore (/user/tpds/queues):
// tpdsToWeb from Dropbox, webToTpds to Dropbox
export default function DropboxSyncStatus() {
  const { t } = useTranslation()
  const { signal } = useAbortController()
  const [state, setState] = useState<SyncState>('checking')

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>
    const check = () => {
      getJSON('/user/tpds/queues', { signal })
        .then(({ tpdsToWeb, webToTpds }: { tpdsToWeb: number; webToTpds: number }) => {
          if (tpdsToWeb > 0 && webToTpds > 0) setState('both')
          else if (tpdsToWeb > 0) setState('in')
          else if (webToTpds > 0) setState('out')
          else setState('synced')
        })
        .catch(() => setState('error'))
        .finally(() => {
          if (!signal.aborted) {
            timeout = setTimeout(check, POLL_INTERVAL)
          }
        })
    }
    check()
    return () => clearTimeout(timeout)
  }, [signal])

  const description = {
    checking: t('dropbox_checking_sync_status'),
    synced: t('dropbox_synced'),
    in: `${t('dropbox_sync_in')}…`,
    out: `${t('dropbox_sync_out')}…`,
    both: `${t('dropbox_sync_both')}…`,
    error: t('dropbox_sync_error'),
  }[state]

  return (
    <p
      data-testid="dropbox-sync-status"
      className="d-flex gap-2 align-items-start"
    >
      {state === 'synced' ? (
        <MaterialIcon type="check_circle" className="text-success" />
      ) : state === 'error' ? (
        <MaterialIcon type="cancel" className="text-danger" />
      ) : (
        <OLSpinner size="sm" />
      )}
      <span className="small">{description}</span>
    </p>
  )
}
