/**
 * Zotero picker modal (P4 — BIB_ORCID_TEMPLATES_PLAN.md).
 *
 * Same UX as the ORCID picker, source = the user's OWN linked Zotero:
 *   step 'library': pick a library (main library or a group) + an
 *                   optional collection + Browse
 *   step 'items':   list items (newest first), select some, Import
 *
 * The modal ends by calling `onInsert(bibtexText)` with the combined
 * BibTeX of the selected items (one combined Zotero request server-side;
 * the host surface parses and writes it through its own guarded import
 * path). "Zotero not linked" (409) renders a link action to the OAuth
 * flow.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalHeader,
  OLModalTitle,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import Notification from '@/shared/components/notification'
import { getJSON } from '@/infrastructure/fetch-json'

type Library = { id: string; kind: 'user' | 'group'; name: string }
type Collection = { key: string; name: string }
type ZItem = {
  key: string
  title: string
  itemType: string
  date: string
  firstCreator: string
}

type ZoteroPickerModalProps = {
  show: boolean
  handleHide: () => void
  /** Host writes these BibTeX entries (raw text, combined). */
  onInsert: (bibtexText: string) => void
}

type Step = 'library' | 'items'

function errorMessage(err: unknown, fallback: string | null): string | null {
  if (err && typeof err === 'object') {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message === 'zotero_not_linked' ? 'zotero_not_linked' : data.message
    if ((err as { message?: string }).message) {
      return (err as { message: string }).message
    }
  }
  return fallback
}

const ITEMS_PER_PAGE = 100

export default function ZoteroPickerModal({
  show,
  handleHide,
  onInsert,
}: ZoteroPickerModalProps) {
  const { t } = useTranslation()

  const [step, setStep] = useState<Step>('library')
  const [notLinked, setNotLinked] = useState(false)

  // -- library step --
  const [loadingLibraries, setLoadingLibraries] = useState(false)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [libraryIdx, setLibraryIdx] = useState(0)
  const [collections, setCollections] = useState<Collection[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)
  const [collectionKey, setCollectionKey] = useState('')
  const [libraryError, setLibraryError] = useState<string | null>(null)

  // -- items step --
  const [items, setItems] = useState<ZItem[]>([])
  const [total, setTotal] = useState(0)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  // -- import state --
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const currentLibrary = libraries[libraryIdx]

  // -----------------------------------------------------------------------
  // Reset when the modal closes
  // -----------------------------------------------------------------------
  const handleClose = useCallback(() => {
    setStep('library')
    setNotLinked(false)
    setLibraries([])
    setLibraryIdx(0)
    setCollections([])
    setCollectionKey('')
    setLibraryError(null)
    setItems([])
    setTotal(0)
    setItemsError(null)
    setSelectedKeys(new Set())
    setImporting(false)
    setImportError(null)
    handleHide()
  }, [handleHide])

  // -----------------------------------------------------------------------
  // Load libraries when the modal opens
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!show) return
    let alive = true
    setLoadingLibraries(true)
    setLibraryError(null)
    setNotLinked(false)
    setLibraries([])
    setCollections([])
    setCollectionKey('')
    setLibraryIdx(0)
    void getJSON<Library[]>('/user/zotero/picker/libraries')
      .then(data => {
        if (!alive) return
        const libs = Array.isArray(data) ? data : []
        setLibraries(libs)
        if (libs.length === 0) {
          setLibraryError(t('Failed to load your Zotero libraries'))
        }
      })
      .catch(err => {
        if (!alive) return
        const msg = errorMessage(err, t('Failed to load your Zotero libraries'))
        if (msg === 'zotero_not_linked') setNotLinked(true)
        else setLibraryError(msg)
      })
      .finally(() => {
        if (alive) setLoadingLibraries(false)
      })
    return () => {
      alive = false
    }
  }, [show, t])

  // -----------------------------------------------------------------------
  // Load the collections of the selected library
  // -----------------------------------------------------------------------
  const loadCollections = useCallback(
    (lib: Library) => {
      setCollections([])
      setCollectionKey('')
      setCollectionsLoading(true)
      const qs = new URLSearchParams({ libraryKind: lib.kind })
      if (lib.kind === 'group') qs.set('library', lib.id)
      void getJSON<Collection[]>(`/user/zotero/picker/collections?${qs.toString()}`)
        .then(data => {
          setCollections(Array.isArray(data) ? data : [])
        })
        .catch(err => {
          const msg = errorMessage(err, null)
          if (msg === 'zotero_not_linked') setNotLinked(true)
        })
        .finally(() => setCollectionsLoading(false))
    },
    []
  )

  useEffect(() => {
    if (show && currentLibrary) {
      loadCollections(currentLibrary)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, libraryIdx, libraries.length])

  // -----------------------------------------------------------------------
  // Browse items
  // -----------------------------------------------------------------------
  const browse = useCallback(() => {
    if (!currentLibrary) return
    setStep('items')
    setItemsError(null)
    setImportError(null)
    setItems([])
    setSelectedKeys(new Set())
    setItemsLoading(true)
    const qs = new URLSearchParams({
      libraryKind: currentLibrary.kind,
    })
    if (currentLibrary.kind === 'group') qs.set('library', currentLibrary.id)
    if (collectionKey) qs.set('collection', collectionKey)
    qs.set('limit', String(ITEMS_PER_PAGE))
    void getJSON<{ items: ZItem[]; total: number }>(
      `/user/zotero/picker/items?${qs.toString()}`
    )
      .then(data => {
        setItems(data.items || [])
        setTotal(data.total || (data.items || []).length)
      })
      .catch(err => {
        const msg = errorMessage(err, t('Failed to load items'))
        if (msg === 'zotero_not_linked') {
          setNotLinked(true)
          setStep('library')
        } else {
          setItemsError(msg)
        }
      })
      .finally(() => setItemsLoading(false))
  }, [currentLibrary, collectionKey, t])

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------
  const toggleItem = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const allSelected = items.length > 0 && items.every(i => selectedKeys.has(i.key))
  const toggleAll = useCallback(() => {
    if (allSelected) setSelectedKeys(new Set())
    else setSelectedKeys(new Set(items.map(i => i.key)))
  }, [allSelected, items])

  // -----------------------------------------------------------------------
  // Import
  // -----------------------------------------------------------------------
  const handleImport = useCallback(async () => {
    if (!currentLibrary || selectedKeys.size === 0) return
    setImporting(true)
    setImportError(null)
    try {
      const qs = new URLSearchParams({
        libraryKind: currentLibrary.kind,
        keys: Array.from(selectedKeys).join(','),
      })
      if (currentLibrary.kind === 'group') qs.set('library', currentLibrary.id)
      const data = await getJSON<{ bibtex: string }>(
        `/user/zotero/picker/bibtex?${qs.toString()}`
      )
      onInsert(data.bibtex || '')
      handleClose()
    } catch (err) {
      const msg = errorMessage(err, null)
      if (msg === 'zotero_not_linked') {
        setNotLinked(true)
        setImportError(t('Zotero is no longer linked to your account'))
      } else {
        setImportError(errorMessage(err, t('Could not import from Zotero')))
      }
      setImporting(false)
    }
  }, [currentLibrary, selectedKeys, onInsert, handleClose, t])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <OLModal show={show} onHide={handleClose} data-testid="zotero-picker-modal">
      <OLModalHeader closeButton>
        <OLModalTitle>
          {step === 'library'
            ? t('Import from Zotero')
            : t('Items', {
                author: currentLibrary?.name || t('Zotero'),
              })}
        </OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {notLinked ? (
          <>
            <p>{t('Zotero is not linked to your account yet.')}</p>
            <p>
              {t('Link your Zotero account to import references. Create a key at ') +
                (
                  <a
                    href="https://www.zotero.org/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    zotero.org/settings/keys
                  </a>
                ) +
                t(' (library access + read access to all groups).')}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <OLButton
                variant="primary"
                href="/user/zotero/oauth?popup=0"
                target="_blank"
              >
                {t('Link Zotero')}
              </OLButton>
              <OLButton variant="secondary" onClick={handleClose}>
                {t('Cancel')}
              </OLButton>
            </div>
          </>
        ) : (
          <>
            {step === 'library' && (
              <>
                {libraryError && (
                  <Notification
                    type="error"
                    content={libraryError}
                    isDismissible
                    onDismiss={() => setLibraryError(null)}
                  />
                )}
                {loadingLibraries && <p>{t('Loading your Zotero libraries…')}</p>}
                {!loadingLibraries && libraries.length > 0 && (
                  <>
                    <OLFormGroup>
                      <OLFormLabel htmlFor="zot-lib-select">{t('library')}</OLFormLabel>
                      <OLFormSelect
                        id="zot-lib-select"
                        value={String(libraryIdx)}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                          setLibraryIdx(Number(e.target.value) || 0)
                        }
                      >
                        {libraries.map((lib, i) => (
                          <option key={`${lib.kind}-${lib.id}`} value={String(i)}>
                            {lib.name}
                          </option>
                        ))}
                      </OLFormSelect>
                    </OLFormGroup>
                    <OLFormGroup>
                      <OLFormLabel htmlFor="zot-coll-select">
                        {t('collection')} ({t('optional')})
                      </OLFormLabel>
                      <OLFormSelect
                        id="zot-coll-select"
                        value={collectionKey}
                        disabled={collectionsLoading}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                          setCollectionKey(e.target.value)
                        }
                      >
                        <option value="">{t('All items')}</option>
                        {collections.map(c => (
                          <option key={c.key} value={c.key}>
                            {c.name}
                          </option>
                        ))}
                      </OLFormSelect>
                    </OLFormGroup>
                    <OLButton
                      variant="primary"
                      onClick={browse}
                    >
                      {t('Browse items')}
                    </OLButton>
                  </>
                )}
              </>
            )}

            {step === 'items' && (
              <>
                <OLButton
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep('library')
                    setItemsError(null)
                    setImportError(null)
                  }}
                  style={{ padding: 0, marginBottom: '8px' }}
                  data-testid="zot-back"
                >
                  {t('Back to libraries')}
                </OLButton>

                {itemsLoading && <p>{t('Loading items…')}</p>}

                {itemsError && (
                  <Notification
                    type="error"
                    content={itemsError}
                    isDismissible
                    onDismiss={() => setItemsError(null)}
                  />
                )}
                {importError && (
                  <Notification
                    type="warning"
                    content={importError}
                    isDismissible
                    onDismiss={() => setImportError(null)}
                  />
                )}

                {!itemsLoading && items.length > 0 && (
                  <>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary, #666)' }}>
                      {t('Showing __shown__ of __total__ (newest first)', {
                        shown: items.length,
                        total,
                      })}
                    </p>
                    <div style={{ marginBottom: '8px' }}>
                      <OLFormCheckbox
                        checked={allSelected}
                        onChange={toggleAll}
                        label={t('Select all (__count__)', { count: items.length })}
                      />
                    </div>
                    <div
                      style={{
                        maxHeight: '350px',
                        overflowY: 'auto',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                      }}
                      data-testid="zot-items"
                    >
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr
                            style={{
                              borderBottom: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-light-secondary)',
                            }}
                          >
                            <th style={{ padding: '6px 10px', width: '30px' }} />
                            <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                              {t('Title')}
                            </th>
                            <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                              {t('Type')}
                            </th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', width: '70px' }}>
                              {t('Year')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((w, i) => (
                            <tr
                              key={w.key || i}
                              style={{
                                borderBottom: '1px solid var(--border-color)',
                              }}
                            >
                              <td style={{ padding: '6px 10px' }}>
                                <OLFormCheckbox
                                  checked={selectedKeys.has(w.key)}
                                  onChange={() => toggleItem(w.key)}
                                  aria-label={w.title || t('Untitled')}
                                />
                              </td>
                              <td style={{ padding: '6px 10px' }}>
                                {w.title || t('Untitled')}
                                {w.firstCreator ? (
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      color: 'var(--text-secondary, #666)',
                                    }}
                                  >
                                    {` — ${w.firstCreator}`}
                                  </span>
                                ) : null}
                              </td>
                              <td style={{ padding: '6px 10px', fontSize: '12px' }}>
                                {w.itemType || '—'}
                              </td>
                              <td style={{ padding: '6px 10px', fontSize: '12px' }}>
                                {(w.date || '').slice(0, 4) || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </OLModalBody>

      {step === 'items' && !notLinked && !itemsLoading && items.length > 0 && (
        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleClose}>
            {t('Cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={() => void handleImport()}
            disabled={selectedKeys.size === 0 || importing}
            isLoading={importing}
          >
            {t('Import selected (__count__)', { count: selectedKeys.size })}
          </OLButton>
        </OLModalFooter>
      )}
    </OLModal>
  )
}
