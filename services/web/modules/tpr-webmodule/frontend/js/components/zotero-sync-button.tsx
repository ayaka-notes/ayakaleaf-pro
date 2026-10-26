import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import Notification from '@/shared/components/notification'
import { useProjectContext } from '@/shared/context/project-context'
import getMeta from '@/utils/meta'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import { syncProject, type SyncResult } from '../zotero-api'

/**
 * File-tree toolbar button that incrementally syncs every Zotero-managed
 * entry in the project's .bib documents (changed items are re-fetched, items
 * removed from a mirrored collection are dropped, hand-written entries are
 * left alone).
 *
 * Registered via overleafModuleImports.fileTreeToolbarComponents.
 */
export default function ZoteroSyncButton() {
  const { t } = useTranslation()
  const { projectId } = useProjectContext()
  const { zotero } = useInstanceFeatures()
  const zoteroLinked = Boolean(getMeta('ol-user')?.refProviders?.zotero)

  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!result && !error) return
    const timer = setTimeout(() => {
      setResult(null)
      setError('')
    }, 6000)
    return () => clearTimeout(timer)
  }, [result, error])

  const handleClick = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    setError('')
    try {
      const summary = await syncProject(projectId)
      setResult(summary)
      // New/updated entries need to land in the client-side reference index.
      window.dispatchEvent(new CustomEvent('reference:added'))
    } catch (err) {
      setError(t('something_went_wrong'))
    } finally {
      setSyncing(false)
    }
  }, [syncing, projectId, t])

  if (!zotero || !zoteroLinked) {
    return null
  }

  const changed = result
    ? result.added + result.updated + result.removed > 0
    : false

  return (
    <>
      <OLTooltip
        id="zotero-sync"
        description={t('sync_with_zotero')}
        overlayProps={{ placement: 'bottom' }}
      >
        <button
          className="btn"
          onClick={handleClick}
          disabled={syncing}
          tabIndex={-1}
          aria-label={t('sync_with_zotero')}
        >
          <MaterialIcon type="sync" />
        </button>
      </OLTooltip>

      {(result || error) && (
        <div
          style={{
            position: 'fixed',
            right: '1rem',
            bottom: '1rem',
            zIndex: 1050,
            maxWidth: '24rem',
          }}
        >
          {error ? (
            <Notification type="error" content={error} />
          ) : changed ? (
            <Notification
              type="success"
              content={`${t('sync')} ✓ +${result?.added} ~${result?.updated} -${result?.removed}`}
            />
          ) : (
            <Notification type="info" content={t('zotero_sync_up_to_date')} />
          )}
        </div>
      )}
    </>
  )
}
