/**
 * Mendeley picker modal — same UX family as the Zotero picker:
 *   pick a library (My Library or a group) + optional search →
 *   list documents (page 1 + "Load more") → select some → Import.
 *
 * Ends by calling `onInsert(bibtexText)` with the combined BibTeX of the
 * selected items (fetched server-side, one request per selected
 * document — Mendeley has no multi-item export endpoint).
 * "Mendeley not linked" (409) renders a Link action to the OAuth flow.
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
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import Notification from '@/shared/components/notification'
import { getJSON } from '@/infrastructure/fetch-json'

type Library = { id: string; kind: 'user' | 'group'; name: string }
type MItem = {
  key: string
  title: string
  type: string
  year: string
  firstCreator: string
  venue: string
}

type MendeleyPickerModalProps = {
  show: boolean
  handleHide: () => void
  /** Host writes these BibTeX entries (raw text, combined). */
  onInsert: (bibtexText: string) => void
}

function errorMessage(err: unknown, fallback: string | null): string | null {
  if (err && typeof err === 'object') {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) {
      return data.message === 'mendeley_not_linked'
        ? 'mendeley_not_linked'
        : data.message
    }
    if ((err as { message?: string }).message) {
      return (err as { message: string }).message
    }
  }
  return fallback
}

const ITEMS_PER_PAGE = 50

export default function MendeleyPickerModal({
  show,
  handleHide,
  onInsert,
}: MendeleyPickerModalProps) {
  const { t } = useTranslation()

  const [notLinked, setNotLinked] = useState(false)

  // -- libraries --
  const [loadingLibraries, setLoadingLibraries] = useState(false)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [libraryIdx, setLibraryIdx] = useState(0)
  const [libraryError, setLibraryError] = useState<string | null>(null)

  // -- search + items --
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<MItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  // -- import state --
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const currentLibrary = libraries[libraryIdx]

  const resetItemsState = useCallback(() => {
    setItems([])
    setItemsError(null)
    setNextCursor(null)
    setSelectedKeys(new Set())
    setLoadMoreError(null)
  }, [])

  // -----------------------------------------------------------------------
  // Reset when the modal closes
  // -----------------------------------------------------------------------
  const handleClose = useCallback(() => {
    setNotLinked(false)
    setLibraries([])
    setLibraryIdx(0)
    setLibraryError(null)
    setSearch('')
    setImporting(false)
    setImportError(null)
    resetItemsState()
    handleHide()
  }, [handleHide, resetItemsState])

  // -----------------------------------------------------------------------
  // Fetch helper: one documents page for the given library/search/cursor
  // -----------------------------------------------------------------------
  const fetchDocuments = useCallback(
    (lib: Library, searchQ: string, cursor: string | undefined, replace: boolean) => {
      setItemsLoading(true)
      const qs = new URLSearchParams({
        libraryKind: lib.kind,
        limit: String(ITEMS_PER_PAGE),
      })
      if (lib.kind === 'group') qs.set('library', lib.id)
      if (searchQ) qs.set('query', searchQ.slice(0, 300))
      if (cursor) qs.set('cursor', cursor)
      return getJSON<{ items: MItem[]; next: string | null }>(
        `/user/mendeley/picker/documents?${qs.toString()}`,
      )
        .then(data => {
          const page = (data.items || []).filter(i => i && i.key)
          setItems(prev => (replace ? page : prev.concat(page)))
          setNextCursor(data.next || null)
        })
        .catch(err => {
          const msg = errorMessage(err, t('Failed to load items'))
          if (msg === 'mendeley_not_linked') {
            setNotLinked(true)
          } else if (replace) {
            setItemsError(msg)
          } else {
            setLoadMoreError(msg)
          }
        })
        .finally(() => setItemsLoading(false))
    },
    [t],
  )

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
    setLibraryIdx(0)
    setSearch('')
    resetItemsState()
    void getJSON<Library[]>('/user/mendeley/picker/libraries')
      .then(data => {
        if (!alive) return
        const libs = Array.isArray(data)
          ? data.filter(l => l && (l.kind === 'user' || l.kind === 'group'))
          : []
        setLibraries(libs)
      })
      .catch(err => {
        if (!alive) return
        const msg = errorMessage(err, t('Failed to load your Mendeley library'))
        if (msg === 'mendeley_not_linked') setNotLinked(true)
        else setLibraryError(msg)
      })
      .finally(() => {
        if (alive) setLoadingLibraries(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  // -----------------------------------------------------------------------
  // Item browsing (explicit actions: library switch / search / load more)
  // -----------------------------------------------------------------------
  const loadItems = useCallback(
    (lib: Library | undefined, searchQ: string) => {
      if (!lib) return
      setNextCursor(null)
      void fetchDocuments(lib, searchQ, undefined, true)
    },
    [fetchDocuments],
  )

  const handleLibrarySwitch = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setLibraryIdx(Number(e.target.value) || 0)
      resetItemsState()
      const idx = Number(e.target.value) || 0
      setPendingReload({ libIdx: idx, searchQ: '' })
    },
    [resetItemsState],
  )

  // deferred reload after library switch (libraries state updates first)
  const [pendingReload, setPendingReload] = useState<{
    libIdx: number
    searchQ: string
  } | null>(null)
  useEffect(() => {
    if (!pendingReload) return
    const lib = libraries[pendingReload.libIdx]
    if (lib) loadItems(lib, pendingReload.searchQ)
    setPendingReload(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReload, libraries])

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!currentLibrary) return
      resetItemsState()
      loadItems(currentLibrary, search.trim())
    },
    [currentLibrary, resetItemsState, loadItems, search],
  )

  const handleLoadMore = useCallback(() => {
    if (!currentLibrary || !nextCursor || itemsLoading) return
    setLoadMoreError(null)
    void fetchDocuments(currentLibrary, search.trim(), nextCursor, false)
  }, [currentLibrary, nextCursor, itemsLoading, fetchDocuments, search])

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

  const visibleKeys = items.map(i => i.key)
  const allSelected =
    visibleKeys.length > 0 && visibleKeys.every(k => selectedKeys.has(k))
  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedKeys(prev => {
        const next = new Set(prev)
        visibleKeys.forEach(k => next.delete(k))
        return next
      })
    } else {
      setSelectedKeys(prev => {
        const next = new Set(prev)
        visibleKeys.forEach(k => next.add(k))
        return next
      })
    }
  }, [allSelected, visibleKeys])

  // -----------------------------------------------------------------------
  // Import
  // -----------------------------------------------------------------------
  const handleImport = useCallback(async () => {
    if (!currentLibrary || selectedKeys.size === 0) return
    setImporting(true)
    setImportError(null)
    try {
      const qs = new URLSearchParams({
        ids: Array.from(selectedKeys).join(','),
      })
      if (currentLibrary.kind === 'group') {
        qs.set('libraryKind', 'group')
        qs.set('library', currentLibrary.id)
      }
      const data = await getJSON<{ bibtex: string }>(
        `/user/mendeley/picker/bibtex?${qs.toString()}`,
      )
      onInsert(data.bibtex || '')
      handleClose()
    } catch (err) {
      const msg = errorMessage(err, null)
      if (msg === 'mendeley_not_linked') {
        setNotLinked(true)
        setImportError(t('Mendeley is no longer linked to your account'))
      } else {
        setImportError(errorMessage(err, t('Could not import from Mendeley')))
      }
      setImporting(false)
    }
  }, [currentLibrary, selectedKeys, onInsert, handleClose, t])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <OLModal show={show} onHide={handleClose} data-testid="mendeley-picker-modal">
      <OLModalHeader closeButton>
        <OLModalTitle>{t('Import from Mendeley')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {notLinked ? (
          <>
            <p>{t('Mendeley is not linked to your account yet.')}</p>
            <p>{t('Link your Mendeley account to import references')}</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <OLButton
                variant="primary"
                href="/user/mendeley/oauth?popup=0"
                target="_blank"
              >
                {t('Link Mendeley')}
              </OLButton>
              <OLButton variant="secondary" onClick={handleClose}>
                {t('Cancel')}
              </OLButton>
            </div>
          </>
        ) : (
          <>
            {libraryError && (
              <Notification
                type="error"
                content={libraryError}
                isDismissible
                onDismiss={() => setLibraryError(null)}
              />
            )}
            {loadingLibraries && <p>{t('Loading your Mendeley library…')}</p>}
            {!loadingLibraries && libraries.length > 0 && (
              <>
                <OLFormGroup>
                  <OLFormLabel htmlFor="mend-lib-select">
                    {t('library')}
                  </OLFormLabel>
                  <OLFormSelect
                    id="mend-lib-select"
                    value={String(libraryIdx)}
                    onChange={handleLibrarySwitch}
                  >
                    {libraries.map((lib, i) => (
                      <option key={`${lib.kind}-${lib.id}`} value={String(i)}>
                        {lib.name}
                      </option>
                    ))}
                  </OLFormSelect>
                </OLFormGroup>
                <form
                  onSubmit={handleSearch}
                  style={{ display: 'flex', gap: '8px', alignItems: 'end' }}
                >
                  <OLFormGroup style={{ flex: 1 }}>
                    <OLFormLabel htmlFor="mend-search">{t('Search')}</OLFormLabel>
                    <OLFormControl
                      id="mend-search"
                      value={search}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setSearch(e.target.value)
                      }
                      placeholder="title, author, keywords…"
                    />
                  </OLFormGroup>
                  <OLButton type="submit" variant="secondary" disabled={itemsLoading}>
                    {t('Search')}
                  </OLButton>
                </form>

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

                {itemsLoading && items.length === 0 && <p>{t('Loading items…')}</p>}

                {!itemsLoading && items.length === 0 && !itemsError && (
                  <p>
                    {t('No items found')}
                    {search ? `: “${search}”` : ''}
                  </p>
                )}

                {items.length > 0 && (
                  <>
                    <div style={{ marginBottom: '8px' }}>
                      <OLFormCheckbox
                        checked={allSelected}
                        onChange={toggleAll}
                        label={t('Select all (__count__)', {
                          count: visibleKeys.length,
                        })}
                      />
                    </div>
                    <div
                      style={{
                        maxHeight: '350px',
                        overflowY: 'auto',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                      }}
                      data-testid="mend-items"
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
                            <th
                              style={{
                                padding: '6px 10px',
                                textAlign: 'left',
                                width: '70px',
                              }}
                            >
                              {t('Year')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((w, i) => (
                            <tr
                              key={w.key || i}
                              style={{ borderBottom: '1px solid var(--border-color)' }}
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
                                {w.type || '—'}
                              </td>
                              <td style={{ padding: '6px 10px', fontSize: '12px' }}>
                                {w.year || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div
                      style={{
                        marginTop: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-secondary, #666)',
                        }}
                      >
                        {t('Showing __count__ item(s)', { count: items.length })}
                      </span>
                      {nextCursor && (
                        <OLButton
                          variant="ghost"
                          size="sm"
                          onClick={handleLoadMore}
                          disabled={itemsLoading}
                        >
                          {itemsLoading ? t('Loading…') : t('Load more')}
                        </OLButton>
                      )}
                      {loadMoreError && (
                        <span style={{ color: 'var(--danger-color, #b00)', fontSize: '12px' }}>
                          {loadMoreError}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </OLModalBody>

      {!notLinked && !itemsLoading && items.length > 0 && (
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
