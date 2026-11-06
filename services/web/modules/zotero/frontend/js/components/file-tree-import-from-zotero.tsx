import { useTranslation } from 'react-i18next'
import { FormEventHandler, useEffect, useMemo, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import * as eventTracking from '@/infrastructure/event-tracking'
import { useFileTreeActionable } from '@/features/file-tree/contexts/file-tree-actionable'
import { useFileTreeCreateForm } from '@/features/file-tree/contexts/file-tree-create-form'
import { useFileTreeCreateName } from '@/features/file-tree/contexts/file-tree-create-name'
import FileTreeCreateNameInput from '@/features/file-tree/components/file-tree-create/file-tree-create-name-input'
import ErrorMessage from '@/features/file-tree/components/file-tree-create/error-message'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import Notification from '@/shared/components/notification'

export type ZoteroGroup = {
  id: string
  name: string
}

type ZoteroCollection = {
  key: string
  name: string
  parentCollection: string | null
}

function collectionOptions(collections: ZoteroCollection[]) {
  const byKey = new Map(collections.map(c => [c.key, c]))
  return collections.map(collection => {
    const path = [collection.name]
    const visited = new Set([collection.key])
    let parentKey = collection.parentCollection
    while (parentKey && !visited.has(parentKey)) {
      const parent = byKey.get(parentKey)
      if (!parent) break
      path.unshift(parent.name)
      visited.add(parentKey)
      parentKey = parent.parentCollection
    }
    return { key: collection.key, label: path.join(' / ') }
  }).sort((a, b) => a.label.localeCompare(b.label))
}

type FileTreeImportFromZoteroProps = { groups: ZoteroGroup[] }

export default function FileTreeImportFromZotero({ groups }: FileTreeImportFromZoteroProps) {
  const { t } = useTranslation()
  const { name } = useFileTreeCreateName()
  const { setValid } = useFileTreeCreateForm()
  const { finishCreatingLinkedFile, error, inFlight } = useFileTreeActionable()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [selectedCollectionKey, setSelectedCollectionKey] = useState('')
  const {
    runAsync,
    reset,
    data: collections,
    isLoading: collectionsLoading,
    isError: collectionsError,
  } = useAsync<ZoteroCollection[]>({ status: 'pending' })
  const [selectedFormat, setSelectedFormat] = useState('bibtex')
  const sortedCollections = useMemo(() => collectionOptions(collections || []), [collections])

  useEffect(() => {
    const controller = new AbortController()
    reset()

    const query = selectedGroupId ? `?group_id=${encodeURIComponent(selectedGroupId)}` : ''
    runAsync(getJSON<ZoteroCollection[]>(`/user/zotero/collections${query}`, {
      signal: controller.signal,
    }))
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
      })

    return () => controller.abort()
  }, [selectedGroupId, runAsync, reset])

  useEffect(() => {
    setValid(!!name)
  }, [name, setValid])

  const handleSubmit: FormEventHandler = event => {
    event.preventDefault()
    eventTracking.sendMB('new-file-created', {
      method: 'zotero',
      extension: name.split('.').length > 1 ? name.split('.').pop() : '',
    })

    finishCreatingLinkedFile({
      name,
      provider: 'zotero',
      data: {
        group_id: selectedGroupId || undefined,
        collection_key: selectedCollectionKey || undefined,
        format: selectedFormat,
      }
    })
  }

  return (
    <>
    <p>{t('import_a_bibtex_file_from_your_provider_account', { provider: 'Zotero' })}</p>
    <form
      className="form-controls"
      id="create-file"
      noValidate
      onSubmit={handleSubmit}
    >
      <OLFormGroup controlId="zotero-library-select">
        <OLFormLabel>{t('library')}</OLFormLabel>
          <OLFormSelect
            id="zotero-library-select"
            value={selectedGroupId}
            disabled={inFlight}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setSelectedGroupId(e.target.value)
              setSelectedCollectionKey('')
            }}
          >
            <option value="">{t('my_library')}</option>
            {groups?.map(g => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </OLFormSelect>
      </OLFormGroup>

      <OLFormGroup controlId="zotero-collection-select">
        <OLFormLabel>{t('collection')}</OLFormLabel>
        <OLFormSelect
          id="zotero-collection-select"
          value={selectedCollectionKey}
          disabled={inFlight || collectionsLoading}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setSelectedCollectionKey(e.target.value)
          }
        >
          <option value="">{t('all_collections')}</option>
          {!selectedGroupId && (
            <option value="publications">{t('my_publications')}</option>
          )}
          {sortedCollections.map(collection => (
            <option key={collection.key} value={collection.key}>
              {collection.label}
            </option>
          ))}
        </OLFormSelect>
      </OLFormGroup>

      {collectionsError && (
        <Notification type="error" content={t('zotero_could_not_load_collections')} />
      )}

      <FileTreeCreateNameInput
        label={t('file_name_in_this_project')}
        placeholder="zotero.bib"
        error={error}
        inFlight={inFlight}
      />

      <OLFormGroup controlId="zotero-format-select">
        <OLFormLabel>{t('format')}</OLFormLabel>
          <OLFormSelect
            id="zotero-format-select"
            value={selectedFormat}
            disabled={inFlight}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedFormat(e.target.value)
            }
          >
            <option value="bibtex">{'BibTeX'}</option>
            <option value="biblatex">{'BibLaTeX'}</option>
          </OLFormSelect>
      </OLFormGroup>

      {inFlight && (
        <div role="status" className="loading d-flex justify-content-center align-items-center fs-5">
          <div
            aria-hidden="true"
            className="spinner-border spinner-border-sm"
          ></div>
          {t('importing') + '…'}
        </div>
      )}

      {error && <ErrorMessage error={error} />}

    </form>
    </>
  )
}
