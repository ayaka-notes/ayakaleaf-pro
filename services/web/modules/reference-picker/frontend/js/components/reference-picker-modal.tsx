import '../../stylesheets/reference-picker.scss'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLButton from '@/shared/components/ol/ol-button'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLTag from '@/shared/components/ol/ol-tag'
import Notification from '@/shared/components/notification'
import MaterialIcon from '@/shared/components/material-icon'
import { useReferencesContext } from '@/features/ide-react/context/references-context'
import { useProjectContext } from '@/shared/context/project-context'
import getMeta from '@/utils/meta'
import { useTranslation } from 'react-i18next'
import type { Bib2JsonEntry } from '@/features/ide-react/references/types'
import {
  authorLabel,
  citeItems,
  getBibFiles,
  getLibraries,
  searchItems,
  type ZoteroItem,
  type ZoteroLibraries,
} from '@modules/tpr-webmodule/frontend/js/zotero-api'

type FocusArea = 'search' | 'list' | 'footer'
type Source = 'local' | 'zotero'

function highlight(text: string, tokens: string[]) {
  if (!text || tokens.length === 0) return text

  const parts: React.ReactNode[] = [text]
  let globalIndex = 0

  tokens.forEach(token => {
    const next: React.ReactNode[] = []
    parts.forEach(part => {
      if (typeof part !== 'string') {
        next.push(part)
        return
      }

      const lower = part.toLowerCase()
      const t = token.toLowerCase()
      let start = 0
      let idx

      while ((idx = lower.indexOf(t, start)) !== -1) {
        if (idx > start) next.push(part.slice(start, idx))
        next.push(
          <span key={`${idx}-${token}-${globalIndex++}`} className="found-token">
            {part.slice(idx, idx + t.length)}
          </span>
        )
        start = idx + t.length
      }

      if (start < part.length) next.push(part.slice(start))
    })
    parts.splice(0, parts.length, ...next)
  })

  return parts
}

export default function ReferencePickerModal({
  show,
  onClose,
  onApply,
  initialKeys,
}: {
  show: boolean
  onClose: () => void
  onApply: (selectedKeys: string[]) => void
  initialKeys: string[]
}) {
  const { t } = useTranslation()
  const { projectId } = useProjectContext()
  const { searchLocalReferences } = useReferencesContext()
  // Linking happens on the settings page, so this is fixed for the page load.
  const zoteroLinked = Boolean(getMeta('ol-user')?.refProviders?.zotero)

  const [source, setSource] = useState<Source>('local')
  const [query, setQuery] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [results, setResults] = useState<{ _source: Bib2JsonEntry }[]>([])

  // Zotero state
  const [libraries, setLibraries] = useState<ZoteroLibraries | null>(null)
  const [libraryId, setLibraryId] = useState('user')
  const [zoteroItems, setZoteroItems] = useState<ZoteroItem[]>([])
  const [zoteroSelected, setZoteroSelected] = useState<ZoteroItem[]>([])
  const [zoteroLoading, setZoteroLoading] = useState(false)
  const [bibTarget, setBibTarget] = useState('')
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  // Bumped by the refresh button to re-read libraries and the target .bib.
  const [reloadKey, setReloadKey] = useState(0)

  const pendingInitialKeysRef = useRef<string[]>([])
  const requestIdRef = useRef(0)
  const searchFnRef = useRef(searchLocalReferences)

  useEffect(() => {
    searchFnRef.current = searchLocalReferences
  }, [searchLocalReferences])

  const tokens = useMemo(
    () => query.toLowerCase().trim().split(/\s+/).filter(Boolean),
    [query]
  )

  useEffect(() => {
    if (!show) return

    requestIdRef.current++

    setQuery('')
    setSelectedKeys([])
    setResults([])
    setSource('local')
    setZoteroItems([])
    setZoteroSelected([])
    setError('')
    setApplying(false)
    setPage(1)
    setTotal(0)

    pendingInitialKeysRef.current = [...initialKeys]

    const requestId = ++requestIdRef.current

    const perform = async () => {
      const r = await searchFnRef.current('')

      if (requestId !== requestIdRef.current) return

      setResults(r.hits)

      if (pendingInitialKeysRef.current.length > 0) {
        // Preserve every existing key, even ones the local index can't resolve
        // (stale/oversized .bib, unresolved refs); otherwise Replace silently drops them.
        setSelectedKeys(pendingInitialKeysRef.current)
        pendingInitialKeysRef.current = []
      }
    }

    perform()
  }, [show, initialKeys])

  useEffect(() => {
    if (!show || source !== 'local') return

    const requestId = ++requestIdRef.current

    const perform = async () => {
      const r = await searchFnRef.current(query.trim() || '')

      if (requestId !== requestIdRef.current) return

      setResults(r.hits)
    }

    perform()
  }, [query, show, source])

  // Load libraries and the target .bib whenever the Zotero tab is opened or
  // refreshed.
  useEffect(() => {
    if (!show || source !== 'zotero') return

    let cancelled = false

    Promise.all([getLibraries(), getBibFiles(projectId)])
      .then(([libs, bibs]) => {
        if (cancelled) return
        setLibraries(libs)
        setBibTarget(bibs.files[0] || '/references.bib')
        setError('')
      })
      .catch(() => {
        if (!cancelled) setError(t('zotero_reference_loading_error'))
      })

    return () => {
      cancelled = true
    }
  }, [show, source, projectId, t, reloadKey])

  // Zotero search, debounced, one page at a time
  useEffect(() => {
    if (!show || source !== 'zotero') return

    let cancelled = false
    const timer = setTimeout(() => {
      setZoteroLoading(true)
      searchItems({
        libraryId,
        query: query.trim(),
        limit: pageSize,
        start: (page - 1) * pageSize,
      })
        .then(data => {
          if (!cancelled) {
            setZoteroItems(data.items)
            setTotal(data.total)
            setError('')
          }
        })
        .catch(() => {
          if (!cancelled) setError(t('zotero_reference_loading_error'))
        })
        .finally(() => {
          if (!cancelled) setZoteroLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [show, source, libraryId, query, page, pageSize, t])

  // A new search starts from the first page again.
  useEffect(() => {
    setPage(1)
  }, [libraryId, query, pageSize])

  const filteredKeys = results.map(r => r._source.EntryKey)
  const listLength = source === 'local' ? filteredKeys.length : zoteroItems.length

  const [focusArea, setFocusArea] = useState<FocusArea>('search')
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const insertButtonRef = useRef<HTMLButtonElement | null>(null)

  const removeOne = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const index = prev.indexOf(key)
      if (index === -1) return prev
      return [...prev.slice(0, index), ...prev.slice(index + 1)]
    })
  }, [])

  const addOne = useCallback((key: string) => {
    setSelectedKeys(prev => [...prev, key])
  }, [])

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const index = prev.indexOf(key)
      if (index !== -1) {
        // remove one occurrence
        return [...prev.slice(0, index), ...prev.slice(index + 1)]
      }
      return [...prev, key]
    })
  }, [])

  const toggleZoteroItem = useCallback((item: ZoteroItem) => {
    setZoteroSelected(prev => {
      const index = prev.findIndex(selected => selected.key === item.key)
      if (index !== -1) {
        return [...prev.slice(0, index), ...prev.slice(index + 1)]
      }
      return [...prev, item]
    })
  }, [])

  const removeZoteroItem = useCallback((itemKey: string) => {
    setZoteroSelected(prev => prev.filter(item => item.key !== itemKey))
  }, [])

  const toggleAt = useCallback(
    (index: number) => {
      if (source === 'local') {
        const key = filteredKeys[index]
        if (key) toggleKey(key)
      } else {
        const item = zoteroItems[index]
        if (item) toggleZoteroItem(item)
      }
    },
    [source, filteredKeys, zoteroItems, toggleKey, toggleZoteroItem]
  )

  const handleApply = useCallback(async () => {
    if (applying) return

    if (!zoteroSelected.length) {
      onApply(selectedKeys)
      onClose()
      return
    }

    // Items picked from Zotero need their .bib entries written first; the
    // backend returns the citation keys to insert into \cite{...}.
    setApplying(true)
    setError('')
    try {
      const result = await citeItems(projectId, {
        libraryId,
        itemKeys: zoteroSelected.map(item => item.key),
      })
      const merged = [...selectedKeys]
      for (const entry of result.entries) {
        if (entry.citationKey && !merged.includes(entry.citationKey)) {
          merged.push(entry.citationKey)
        }
      }
      window.dispatchEvent(new CustomEvent('reference:added'))
      onApply(merged)
      onClose()
    } catch (err) {
      setError(t('something_went_wrong'))
    } finally {
      setApplying(false)
    }
  }, [
    applying,
    zoteroSelected,
    selectedKeys,
    onApply,
    onClose,
    projectId,
    libraryId,
    t,
  ])

  useEffect(() => {
    if (show) {
      setTimeout(() => searchRef.current?.focus(), 0)
      setFocusArea('search')
      setFocusedIndex(null)
    }
  }, [show])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (focusArea === 'search') {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setFocusArea('list')
          setFocusedIndex(0)
        }
      } else if (focusArea === 'list') {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setFocusedIndex(prev =>
            prev == null ? 0 : Math.min(listLength - 1, prev + 1)
          )
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setFocusedIndex(prev =>
            prev == null ? 0 : Math.max(0, prev - 1)
          )
        } else if (event.key === ' ') {
          event.preventDefault()
          if (focusedIndex !== null) {
            toggleAt(focusedIndex)
          }
        } else if (event.key === 'Enter') {
          event.preventDefault()
          handleApply()
        }
      }

      if (event.key === 'Tab') {
        const isShift = event.shiftKey
        event.preventDefault()
        event.stopPropagation()

        if (!isShift) {
          if (focusArea === 'search') {
            setFocusArea('list')
            setFocusedIndex(0)
            return
          }
          if (focusArea === 'list') {
            setFocusArea('footer')
            setFocusedIndex(null)
            cancelButtonRef.current?.focus()
            return
          }
          if (focusArea === 'footer') {
            if (document.activeElement === cancelButtonRef.current) {
              insertButtonRef.current?.focus()
              return
            } else {
              setFocusArea('search')
              setFocusedIndex(null)
              searchRef.current?.focus()
              return
            }
          }
        }

        if (isShift) {
          if (focusArea === 'search') {
            setFocusArea('footer')
            setFocusedIndex(null)
            insertButtonRef.current?.focus()
            return
          }
          if (focusArea === 'list') {
            setFocusArea('search')
            setFocusedIndex(null)
            searchRef.current?.focus()
            return
          }
          if (focusArea === 'footer') {
            if (document.activeElement === insertButtonRef.current) {
              cancelButtonRef.current?.focus()
              return
            } else {
              setFocusArea('list')
              setFocusedIndex(prev => prev ?? 0)
              return
            }
          }
        }
      }
    },
    [focusArea, listLength, focusedIndex, toggleAt, handleApply]
  )

  useEffect(() => {
    if (focusArea === 'list' && focusedIndex !== null) {
      const el = document.getElementById(`reference-picker-item-${focusedIndex}`)
      if (el) el.focus()
    }
  }, [focusArea, focusedIndex])

  const libraryOptions = useMemo(() => {
    if (!libraries) return []
    return [
      { id: 'user', name: libraries.personal.name || t('my_library') },
      ...libraries.groups,
    ]
  }, [libraries, t])

  return (
    <OLModal show={show} onHide={onClose} size="lg">
      <OLModalHeader>
        <OLModalTitle>{t('search_references')}</OLModalTitle>
      </OLModalHeader>
      <div onKeyDown={onKeyDown}>
        <OLModalBody className="references-search-modal">
          <div className="container-fluid">
            <OLRow className="mb-2">
              <OLButton
                size="sm"
                variant={source === 'local' ? 'primary' : 'secondary'}
                onClick={() => {
                  setSource('local')
                  setError('')
                }}
              >
                {t('references')}
              </OLButton>
              {zoteroLinked && (
                <OLButton
                  size="sm"
                  variant={source === 'zotero' ? 'primary' : 'secondary'}
                  className="ms-2"
                  onClick={() => {
                    setSource('zotero')
                    setError('')
                  }}
                >
                  {t('zotero')}
                </OLButton>
              )}
              {source === 'zotero' && libraryOptions.length > 1 && (
                <select
                  className="form-select form-select-sm ms-2"
                  style={{ width: 'auto', display: 'inline-block' }}
                  aria-label={t('library')}
                  value={libraryId}
                  onChange={event => setLibraryId(event.target.value)}
                >
                  {libraryOptions.map(library => (
                    <option key={library.id} value={library.id}>
                      {library.name}
                    </option>
                  ))}
                </select>
              )}
              {source === 'zotero' && (
                <button
                  type="button"
                  className="btn btn-sm btn-link ms-1 p-0 text-decoration-none align-self-center"
                  onClick={() => setReloadKey(key => key + 1)}
                  aria-label={t('refresh')}
                  title={t('refresh')}
                >
                  <MaterialIcon type="refresh" />
                </button>
              )}
            </OLRow>

            <OLRow>
              <OLFormGroup>
                <OLFormControl
                  name="search"
                  aria-label={t('search')}
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={
                    source === 'local' ? t('search_references') : t('search')
                  }
                  prepend={<MaterialIcon type="search" />}
                  ref={searchRef}
                />
              </OLFormGroup>
            </OLRow>

            <OLRow>
              <div className="selected-key-tag">
                {selectedKeys.map((key, idx) => (
                  <OLTag
                    key={`${key}-${idx}`}
                    closeBtnProps={{ onClick: () => removeOne(key) }}
                  >
                    {key}
                  </OLTag>
                ))}
                {zoteroSelected.map(item => (
                  <OLTag
                    key={`zotero-${item.key}`}
                    closeBtnProps={{ onClick: () => removeZoteroItem(item.key) }}
                  >
                    {item.title.slice(0, 40) || item.key}
                  </OLTag>
                ))}
              </div>
            </OLRow>

            {source === 'zotero' && bibTarget && (
              <OLRow>
                <OLCol md={12}>
                  <p className="small text-muted mb-2">
                    {t('add')} &rarr; {bibTarget}
                  </p>
                </OLCol>
              </OLRow>
            )}

            {error && (
              <OLRow>
                <OLCol md={12}>
                  <Notification type="error" content={error} />
                </OLCol>
              </OLRow>
            )}

            <OLRow className="search-results">
              <OLCol md={12} className="search-results-scroll-container">
                <ul className="list-unstyled">
                  {source === 'local' &&
                    results.map((hit, index) => {
                      const key = hit._source.EntryKey
                      const {
                        title = '',
                        author = '',
                        year = '',
                        journal = '',
                      } = hit._source.Fields ?? {}

                      return (
                        <li
                          key={key}
                          id={`reference-picker-item-${index}`}
                          tabIndex={-1}
                          onClick={() => {
                            setFocusArea('list')
                            setFocusedIndex(index)
                            toggleKey(key)
                          }}
                          className={`search-result-hit ${
                            focusedIndex === index ? 'focused' : ''
                          } ${
                            selectedKeys.includes(key)
                              ? 'selected-search-result-hit'
                              : ''
                          }`}
                        >
                          <OLRow>
                            <OLCol md={12}>
                              <span className="hit-title">
                                {highlight(title, tokens)}
                              </span>
                              <span className="float-end">
                                {highlight(key, tokens)}
                              </span>
                            </OLCol>
                          </OLRow>

                          <OLRow>
                            <OLCol md={12}>
                              {[
                                highlight(author, tokens),
                                highlight(journal, tokens),
                                highlight(year, tokens),
                              ]
                                .filter(Boolean)
                                .reduce((acc, val, i) =>
                                  i === 0
                                    ? [val]
                                    : acc.concat('\u00A0—\u00A0', val),
                                [])}
                            </OLCol>
                          </OLRow>
                        </li>
                      )
                    })}

                  {source === 'zotero' &&
                    zoteroItems.map((item, index) => {
                      const isSelected = zoteroSelected.some(
                        selected => selected.key === item.key
                      )
                      return (
                        <li
                          key={item.key}
                          id={`reference-picker-item-${index}`}
                          tabIndex={-1}
                          onClick={() => {
                            setFocusArea('list')
                            setFocusedIndex(index)
                            toggleZoteroItem(item)
                          }}
                          className={`search-result-hit ${
                            focusedIndex === index ? 'focused' : ''
                          } ${
                            isSelected ? 'selected-search-result-hit' : ''
                          }`}
                        >
                          <OLRow>
                            <OLCol md={12}>
                              <span className="hit-title">
                                {highlight(item.title, tokens)}
                              </span>
                              <span className="float-end">
                                {item.date ? item.date.slice(0, 4) : ''}
                              </span>
                            </OLCol>
                          </OLRow>

                          <OLRow>
                            <OLCol md={12}>
                              {[authorLabel(item), item.publication]
                                .filter(Boolean)
                                .reduce((acc, val, i) =>
                                  i === 0
                                    ? [val]
                                    : acc.concat('\u00A0—\u00A0', val),
                                [])}
                            </OLCol>
                          </OLRow>
                        </li>
                      )
                    })}

                  {source === 'zotero' && zoteroLoading && (
                    <li className="text-muted">
                      {t('loading')}
                      ...
                    </li>
                  )}
                </ul>
              </OLCol>
            </OLRow>

            {source === 'zotero' && total > 0 && (
              <OLRow className="align-items-center mt-2">
                <OLCol md={12} className="d-flex align-items-center">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary me-2"
                    disabled={page <= 1}
                    aria-label="Previous"
                    onClick={() => setPage(current => Math.max(1, current - 1))}
                  >
                    {'\u2039'}
                  </button>
                  <span className="small">
                    {page} / {Math.max(1, Math.ceil(total / pageSize))}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary ms-2"
                    disabled={page >= Math.ceil(total / pageSize)}
                    aria-label="Next"
                    onClick={() => setPage(current => current + 1)}
                  >
                    {'\u203A'}
                  </button>
                  <select
                    className="form-select form-select-sm ms-auto"
                    style={{ width: 'auto' }}
                    aria-label={'Per page'}
                    value={pageSize}
                    onChange={event => setPageSize(Number(event.target.value))}
                  >
                    {[10, 25, 50, 100].map(size => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </OLCol>
              </OLRow>
            )}
          </div>
        </OLModalBody>

        <OLModalFooter>
          <OLButton variant="secondary" onClick={onClose} ref={cancelButtonRef}>
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={handleApply}
            ref={insertButtonRef}
            disabled={applying}
          >
            {initialKeys.length ? t('search_replace') : t('insert')}
          </OLButton>
        </OLModalFooter>
      </div>
    </OLModal>
  )
}
