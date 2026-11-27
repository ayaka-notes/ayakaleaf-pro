import { useTranslation } from 'react-i18next'
import { useEffect, useCallback } from 'react'
import useAsync from '@/shared/hooks/use-async'
import { getJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import { useFileTreeActionable } from '@/features/file-tree/contexts/file-tree-actionable'
import FileTreeModalCreateFileMode from '@/features/file-tree/components/file-tree-create/file-tree-modal-create-file-mode'
import FileTreeCreateNameProvider from '@/features/file-tree/contexts/file-tree-create-name'
import FileTreeImportFromZotero, { type ZoteroGroup } from './file-tree-import-from-zotero'

export function CreateFileMode() {
  const { t } = useTranslation()

  return (
    <FileTreeModalCreateFileMode
      mode="zotero"
      icon="library_books"
      label={t('from_provider', { provider: 'Zotero' })}
    />
  )
}

export function CreateFilePane() {
  const { newFileCreateMode } = useFileTreeActionable()
  const { t } = useTranslation()
  const isZoteroMode = newFileCreateMode === 'zotero'

  const {
    runAsync,
    data: groups,
    isSuccess: isGroupsLoaded,
    isError: isGroupsError,
    isLoading: isGroupsLoading,
  } = useAsync<ZoteroGroup[]>()

  const loadGroups = useCallback(() => {
    return runAsync(getJSON('/user/zotero/groups'))
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
      })
  }, [runAsync])

  useEffect(() => {
    if (!isZoteroMode) return

    loadGroups()
  }, [loadGroups, isZoteroMode])

  useEffect(() => {
    if (!isZoteroMode || !isGroupsLoaded || groups) return

    const channel = new BroadcastChannel('zotero')
    channel.onmessage = event => {
      if (event.data?.type === 'zotero-linked') {
        loadGroups()
      }
    }

    return () => channel.close()
  }, [isZoteroMode, isGroupsLoaded, groups, loadGroups])

  if (!isZoteroMode) return null

  if (isGroupsLoading) {
    return (
      <>
        <br/>
        <div role="status" className="loading d-flex justify-content-center align-items-center fs-5">
          <div
            aria-hidden="true"
            className="spinner-border spinner-border-sm"
          ></div>
          {t('loading') + '…'}
        </div>
      </>
    )
  } else if (isGroupsLoaded) {
    if (groups) {
      return (
        <FileTreeCreateNameProvider initialName="zotero.bib">
          <FileTreeImportFromZotero
            groups={groups}
          />
        </FileTreeCreateNameProvider>
      )
    } else {
      return (
        <div className = "referencesImportModal">
          <p>{t('zotero_sync_description')}</p>
          <p>
            <OLButton
              variant="primary"
              onClick={() => {
                const popup = window.open(
                  '/user/zotero/oauth?popup=1',
                  '_blank',
                  'width=600,height=700'
                )
                if (!popup) window.location.assign('/user/zotero/oauth?popup=0')
              }}
            >
              {t('link_to_zotero')}
            </OLButton>
          </p>
        </div>
      )
    }
  } else if (isGroupsError) {
    return (
      <Notification
        type="error"
        content={t('zotero_groups_loading_error', {
          provider: t('zotero'),
        })}
      />
    )
  }
}
