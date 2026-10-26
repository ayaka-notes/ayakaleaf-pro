import { useTranslation } from 'react-i18next'
import { FormEventHandler, useEffect, useMemo, useState } from 'react'
import { useFileTreeActionable } from '@/features/file-tree/contexts/file-tree-actionable'
import { useFileTreeCreateForm } from '@/features/file-tree/contexts/file-tree-create-form'
import { useFileTreeMainContext } from '@/features/file-tree/contexts/file-tree-main'
import FileTreeModalCreateFileMode from '@/features/file-tree/components/file-tree-create/file-tree-modal-create-file-mode'
import ErrorMessage from '@/features/file-tree/components/file-tree-create/error-message'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import LoadingSpinner from '@/shared/components/loading-spinner'
import MaterialIcon from '@/shared/components/material-icon'
import Notification from '@/shared/components/notification'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import getMeta from '@/utils/meta'
import {
  authorLabel,
  getCollections,
  getLibraries,
  importItems,
  searchItems,
  type ZoteroCollection,
  type ZoteroItem,
} from '../zotero-api'

export function CreateFileMode() {
  const { t } = useTranslation()
  const { zotero } = useInstanceFeatures()
  const { refProviders } = useFileTreeMainContext()
  const isLinked = (refProviders as Record<string, boolean>)?.zotero

  if (!zotero || !isLinked) {
    return null
  }

  return (
    <FileTreeModalCreateFileMode
      mode="zotero"
      icon="library_books"
      label={t('from_provider', { provider: 'Zotero' })}
    />
  )
}

export function CreateFilePane() {
  const { zotero } = useInstanceFeatures()
  const { newFileCreateMode } = useFileTreeActionable()

  if (!zotero || newFileCreateMode !== 'zotero') {
    return null
  }

  return <ZoteroCreateFilePane />
}

type CollectionNode = ZoteroCollection & { children: CollectionNode[] }

function buildCollectionTree(collections: ZoteroCollection[]): CollectionNode[] {
  const byKey = new Map<string, CollectionNode>()
  for (const collection of collections) {
    byKey.set(collection.key, { ...collection, children: [] })
  }
  const roots: CollectionNode[] = []
  for (const node of byKey.values()) {
    const parent = node.parent ? byKey.get(node.parent) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function CollectionTree({
  nodes,
  depth = 0,
  selectedKey,
  onSelect,
  expanded,
  onToggleExpand,
}: {
  nodes: CollectionNode[]
  depth?: number
  selectedKey: string
  onSelect: (key: string) => void
  expanded: Set<string>
  onToggleExpand: (key: string) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      {nodes.map(node => {
        const hasChildren = node.children.length > 0
        const isOpen = expanded.has(node.key)
        return (
          <div key={node.key}>
            <div
              className="d-flex align-items-center"
              style={{ paddingLeft: `${depth * 1.25}rem` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="btn btn-sm btn-link p-0 me-1 text-decoration-none"
                  onClick={() => onToggleExpand(node.key)}
                  aria-label={isOpen ? t('collapse') : t('expand')}
                >
                  <MaterialIcon type={isOpen ? 'expand_more' : 'chevron_right'} />
                </button>
              ) : (
                <span style={{ width: '1.5rem', display: 'inline-block' }} />
              )}
              <button
                type="button"
                className={`btn btn-sm p-0 text-start text-decoration-none ${
                  selectedKey === node.key ? 'fw-bold' : 'text-body'
                }`}
                onClick={() => {
                  onSelect(selectedKey === node.key ? '' : node.key)
                  if (hasChildren && !isOpen) {
                    onToggleExpand(node.key)
                  }
                }}
              >
                <MaterialIcon
                  type={isOpen ? 'folder_open' : 'folder'}
                  className="me-1"
                />
                {node.name}
                <span className="text-muted small ms-1">
                  ({node.numItems ?? 0})
                </span>
              </button>
            </div>
            {hasChildren && isOpen && (
              <CollectionTree
                nodes={node.children}
                depth={depth + 1}
                selectedKey={selectedKey}
                onSelect={onSelect}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

function ZoteroCreateFilePane() {
  const { t } = useTranslation()
  const projectId = getMeta('ol-project_id')
  const { setValid } = useFileTreeCreateForm()
  const { cancel } = useFileTreeActionable()

  // Step 1: Library Category. Nothing else shows until it is chosen.
  const [libraries, setLibraries] = useState<{ id: string; name: string }[]>([])
  const [libraryId, setLibraryId] = useState('')
  const [loadingLibraries, setLoadingLibraries] = useState(true)

  // Step 2: Collection
  const [collections, setCollections] = useState<ZoteroCollection[]>([])
  const [collectionKey, setCollectionKey] = useState('')
  const [loadingCollections, setLoadingCollections] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Step 3: References
  const [items, setItems] = useState<ZoteroItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)

  const [name, setName] = useState('zotero.bib')
  const [nameTouched, setNameTouched] = useState(false)
  const [mirror, setMirror] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const itemMode: 'library' | 'unfiled' | 'trash' =
    collectionKey === '__trash__'
      ? 'trash'
      : collectionKey === '__unfiled__'
        ? 'unfiled'
        : 'library'
  const itemCollectionKey = itemMode === 'library' ? collectionKey || null : null

  useEffect(() => {
    setValid(
      Boolean(libraryId) &&
        Boolean(name) &&
        selected.length > 0 &&
        !loadingItems &&
        !submitting &&
        itemMode !== 'trash'
    )
  }, [
    setValid,
    libraryId,
    name,
    selected.length,
    loadingItems,
    submitting,
    itemMode,
  ])

  // Libraries
  useEffect(() => {
    let cancelled = false
    setLoadingLibraries(true)
    getLibraries()
      .then(data => {
        if (cancelled) return
        setLibraries([
          { id: 'user', name: data.personal.name || t('my_library') },
          ...data.groups,
        ])
      })
      .catch(() => {
        if (!cancelled) setError(t('zotero_groups_loading_error'))
      })
      .finally(() => {
        if (!cancelled) setLoadingLibraries(false)
      })
    return () => {
      cancelled = true
    }
  }, [t, reloadKey])

  // Collections of the selected category
  useEffect(() => {
    if (!libraryId) return
    let cancelled = false
    setCollections([])
    setCollectionKey('')
    setLoadingCollections(true)
    getCollections(libraryId)
      .then(data => {
        if (cancelled) return
        setCollections(data.collections)
        setExpanded(
          new Set(
            data.collections
              .filter(collection =>
                data.collections.some(other => other.parent === collection.key)
              )
              .map(collection => collection.key)
          )
        )
      })
      .catch(() => {
        if (!cancelled) setError(t('zotero_groups_loading_error'))
      })
      .finally(() => {
        if (!cancelled) setLoadingCollections(false)
      })
    return () => {
      cancelled = true
    }
  }, [libraryId, reloadKey])

  // Default the file name to zotero-<collection>.bib until the user edits it.
  useEffect(() => {
    if (nameTouched) return
    if (!collectionKey || collectionKey.startsWith('__')) {
      setName('zotero.bib')
      return
    }
    const collection = collections.find(c => c.key === collectionKey)
    if (collection) {
      const safe = collection.name.replace(/[\\/:*?"<>|]/g, '').trim()
      setName(`zotero-${safe}.bib`)
    }
  }, [collectionKey, collections, nameTouched])

  useEffect(() => {
    setPage(1)
  }, [libraryId, collectionKey, query, pageSize])

  // Trashed items are read-only.
  useEffect(() => {
    if (itemMode === 'trash') {
      setSelected([])
    }
  }, [itemMode])

  // References, one page at a time
  useEffect(() => {
    if (!libraryId) return
    let cancelled = false
    setLoadingItems(true)
    const timer = setTimeout(() => {
      searchItems({
        libraryId,
        collectionKey: itemCollectionKey,
        query,
        limit: pageSize,
        start: (page - 1) * pageSize,
        mode: itemMode,
      })
        .then(data => {
          if (cancelled) return
          setItems(data.items)
          setTotal(data.total)
          setError('')
        })
        .catch(() => {
          if (!cancelled) setError(t('zotero_reference_loading_error'))
        })
        .finally(() => {
          if (!cancelled) setLoadingItems(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    libraryId,
    itemCollectionKey,
    itemMode,
    query,
    page,
    pageSize,
    t,
    reloadKey,
  ])

  const tree = useMemo(() => buildCollectionTree(collections), [collections])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const allSelected = items.length > 0 && selected.length === items.length

  const toggleAll = () => {
    setSelected(allSelected ? [] : items.map(item => item.key))
  }

  const toggle = (key: string) => {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  const handleSubmit: FormEventHandler = event => {
    event.preventDefault()

    if (!libraryId || !name || loadingItems || submitting || !selected.length) {
      return
    }

    setSubmitting(true)
    setError('')
    importItems(projectId, {
      libraryId,
      collectionKey: itemMode === 'library' ? collectionKey || null : null,
      itemKeys: selected,
      name,
      mirror,
    })
      .then(() => {
        window.dispatchEvent(new CustomEvent('reference:added'))
        cancel()
      })
      .catch(() => {
        setError(t('zotero_reference_loading_error'))
        setSubmitting(false)
      })
  }

  return (
    <form
      className="form-controls"
      id="create-file"
      noValidate
      onSubmit={handleSubmit}
    >
      {error && (
        <div className="notification-list">
          <Notification type="error" content={error} className="mb-3" />
        </div>
      )}

      <OLFormGroup controlId="zotero-library-select">
        <OLFormLabel>{t('library')}</OLFormLabel>
        <OLFormSelect
          id="zotero-library-select"
          value={libraryId}
          disabled={submitting || loadingLibraries}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setLibraryId(e.target.value)
          }
        >
          <option value="">{'Select a category'}</option>
          {libraries.map(library => (
            <option key={library.id} value={library.id}>
              {library.name}
            </option>
          ))}
        </OLFormSelect>
      </OLFormGroup>

      {!libraryId && (
        <p className="small text-muted d-flex align-items-center">
          {loadingLibraries ? <LoadingSpinner align="left" /> : 'Select a category'}
        </p>
      )}

      {libraryId && (
        <>
          <OLFormGroup controlId="zotero-collection-tree">
            <div className="d-flex align-items-center justify-content-between">
              <OLFormLabel>{'Collection'}</OLFormLabel>
              <button
                type="button"
                className="btn btn-sm btn-link p-0 mb-2 text-decoration-none"
                onClick={() => setReloadKey(key => key + 1)}
                disabled={submitting || loadingCollections}
                aria-label={t('refresh')}
                title={t('refresh')}
              >
                <MaterialIcon type="refresh" />
              </button>
            </div>
            <div
              className="border rounded p-2 mb-1"
              style={{ maxHeight: '160px', overflowY: 'auto' }}
            >
              {loadingCollections && (
                <div className="py-2">
                  <LoadingSpinner align="left" />
                </div>
              )}
              {!loadingCollections && (
                <>
                  <div className="d-flex align-items-center">
                    <span style={{ width: '1.5rem', display: 'inline-block' }} />
                    <button
                      type="button"
                      className={`btn btn-sm p-0 text-start text-decoration-none ${
                        collectionKey === '' ? 'fw-bold' : 'text-body'
                      }`}
                      onClick={() => setCollectionKey('')}
                    >
                      {t('all')}
                    </button>
                  </div>
                  {tree.length === 0 && (
                    <p className="text-muted small mb-0 ms-4">
                      {t('no_collections_found')}
                    </p>
                  )}
                  <CollectionTree
                    nodes={tree}
                    selectedKey={collectionKey}
                    onSelect={setCollectionKey}
                    expanded={expanded}
                    onToggleExpand={key =>
                      setExpanded(prev => {
                        const next = new Set(prev)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                    }
                  />

                  <div className="border-top mt-1 pt-1">
                    {[
                      {
                        key: '__unfiled__',
                        label: 'Unfiled Items',
                        icon: 'inbox',
                      },
                      { key: '__trash__', label: t('trash'), icon: 'delete' },
                    ].map(node => (
                      <div className="d-flex align-items-center" key={node.key}>
                        <span
                          style={{ width: '1.5rem', display: 'inline-block' }}
                        />
                        <button
                          type="button"
                          className={`btn btn-sm p-0 text-start text-decoration-none ${
                            collectionKey === node.key
                              ? 'fw-bold'
                              : 'text-body'
                          }`}
                          onClick={() =>
                            setCollectionKey(
                              collectionKey === node.key ? '' : node.key
                            )
                          }
                        >
                          <MaterialIcon type={node.icon} className="me-1" />
                          {node.label}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <p className="small text-muted mb-0">
              {collectionKey === ''
                ? t('all')
                : collectionKey === '__unfiled__'
                  ? 'Unfiled Items'
                  : collectionKey === '__trash__'
                    ? t('trash')
                    : collections.find(c => c.key === collectionKey)?.name}
            </p>
          </OLFormGroup>

          <OLFormGroup controlId="zotero-file-name">
            <OLFormLabel>{t('file_name')}</OLFormLabel>
            <OLFormControl
              type="text"
              placeholder="zotero.bib"
              required
              value={name}
              disabled={submitting}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNameTouched(true)
                setName(e.target.value)
              }}
            />
          </OLFormGroup>

          <OLFormGroup controlId="zotero-item-search">
            <OLFormLabel>{t('references')}</OLFormLabel>
            <OLFormControl
              type="search"
              placeholder={t('search')}
              value={query}
              disabled={submitting}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setQuery(e.target.value)
              }
            />
          </OLFormGroup>

          <div className="d-flex align-items-center justify-content-between mb-2">
            <span className="small text-muted">
              {t('selected')}: {selected.length} / {total}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={toggleAll}
              disabled={submitting || itemMode === 'trash'}
            >
              {t('select_all')}
            </button>
          </div>

          <div
            className="zotero-item-list border rounded p-2 mb-2"
            style={{ maxHeight: '220px', overflowY: 'auto' }}
          >
            {loadingItems && (
              <div className="py-2">
                <LoadingSpinner align="left" />
              </div>
            )}
            {!loadingItems && items.length === 0 && (
              <p className="text-muted mb-0">{t('search')}</p>
            )}
            {!loadingItems &&
              items.map(item => (
                <div className="form-check" key={item.key}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`zotero-item-${item.key}`}
                    checked={selected.includes(item.key)}
                    disabled={submitting || itemMode === 'trash'}
                    onChange={() => toggle(item.key)}
                  />
                  <label
                    className="form-check-label small"
                    htmlFor={`zotero-item-${item.key}`}
                  >
                    {item.title}
                    <span className="text-muted">
                      {' '}
                      — {authorLabel(item)}
                      {item.date ? `, ${item.date.slice(0, 4)}` : ''}
                    </span>
                  </label>
                </div>
              ))}
          </div>

          <div className="d-flex align-items-center mb-3">
            <button
              type="button"
              className="btn btn-sm btn-secondary me-2"
              disabled={page <= 1 || submitting}
              aria-label="Previous"
              onClick={() => setPage(current => Math.max(1, current - 1))}
            >
              {'\u2039'}
            </button>
            <span className="small">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-secondary ms-2"
              disabled={page >= pageCount || submitting}
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
              disabled={submitting}
              onChange={event => setPageSize(Number(event.target.value))}
            >
              {[10, 25, 50, 100].map(size => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="form-check mb-3 d-flex align-items-center">
            <input
              className="form-check-input"
              type="checkbox"
              id="zotero-mirror"
              checked={mirror}
              disabled={submitting}
              onChange={() => setMirror(value => !value)}
            />
            <label className="form-check-label small" htmlFor="zotero-mirror">
              {t('sync')} — Zotero
            </label>
            <OLTooltip
              id="zotero-mirror-help"
              description={'Keep this .bib in sync with the whole collection: new items are added, items removed from the collection are dropped, changed items are updated. Hand-written entries are never touched.'}
              overlayProps={{ placement: 'top' }}
            >
              <span
                className="ms-2 text-muted"
                style={{ cursor: 'help', display: 'inline-flex' }}
                tabIndex={0}
                aria-label={'Keep this .bib in sync with the whole collection: new items are added, items removed from the collection are dropped, changed items are updated. Hand-written entries are never touched.'}
              >
                <MaterialIcon type="help" />
              </span>
            </OLTooltip>
          </div>
        </>
      )}
    </form>
  )
}
