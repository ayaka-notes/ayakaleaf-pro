/**
 * Library page state (LIBRARY_PLAN.md §5). Binds the page to the REST
 * client: entries (cursor-paged), search (debounced + local filter),
 * trash view, preview selection (walks the visible list), bulk selection,
 * and toasts ("__count__ reference(s) moved to Trash" + View Trash action).
 *
 * All decisions derive from server state (no per-process memory — R4);
 * after every mutation the list is re-sourced from the server.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { plural } from '../utils/plural'
import * as api from './library-api'
import type { ApiFailure } from './library-api'
import {
  duplicateKeyRowIds,
  entryMatchesQuery,
  toRows,
  type LibraryEntryApi,
  type LibraryFieldApi,
  type LibraryRow,
} from './library-model'

export type LibraryView = 'library' | 'trash'

export type LibraryToast = {
  id: number
  type: 'success' | 'error' | 'info'
  content: string
  action?: { label: string; onClick: () => void }
}

type SaveRequest = {
  key?: string
  type: string
  fields: { name: string; value: string }[]
}

type LibraryContextValue = {
  view: LibraryView
  setView: (view: LibraryView) => void
  entries: LibraryRow[]
  /** Search-filtered rows shown in the list (SaaS: server-filtered). */
  visible: LibraryRow[]
  loading: boolean
  loadError: string | null
  hasMore: boolean
  search: string
  setSearch: (q: string) => void
  selection: string | null
  selected: LibraryRow | null
  select: (rowId: string | null) => void
  stepPreview: (dir: 1 | -1) => void
  canPrev: boolean
  canNext: boolean
  /** Position of the selected entry within the visible list, or -1. */
  previewIndex: number
  bulk: string[]
  toggleBulk: (rowId: string) => void
  setBulkAll: (all: boolean) => void
  duplicateKeyIds: Set<string>
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  addEntries: (apiEntries: { key: string; type: string; fields: LibraryFieldApi[] }[]) => Promise<void>
  saveEntry: (
    rowId: string,
    originalKey: string,
    entry: SaveRequest
  ) => Promise<string | null>
  trashEntries: (rowIds: string[]) => Promise<number>
  permanentDelete: (rowIds: string[]) => Promise<number>
  restoreEntries: (rowIds: string[]) => Promise<number>
  downloadSelection: () => void
  downloadRest: () => void
  /** Download the currently visible (search-filtered) references */
  downloadVisible: () => void
  toasts: LibraryToast[]
  pushToast: (
    type: LibraryToast['type'],
    content: string,
    action?: LibraryToast['action']
  ) => void
  dismissToast: (id: number) => void
  failureFromError: (err: unknown) => ApiFailure
}

const LibraryContext = createContext<LibraryContextValue | undefined>(
  undefined
)

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 250
const TOAST_LIFETIME_MS = 6000
let toastSeq = 1

export function LibraryProvider({
  children,
  initialView = 'library',
}: {
  children: React.ReactNode
  initialView?: LibraryView
}) {
  const { t } = useTranslation()
  const [view, setViewState] = useState<LibraryView>(initialView)
  const [entries, setEntries] = useState<LibraryRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearchState] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const [bulk, setBulk] = useState<string[]>([])
  const [toasts, setToasts] = useState<LibraryToast[]>([])

  // Latest search/view for stable fetch callbacks (no effect churn).
  const paramsRef = useRef({ search, view })
  paramsRef.current = { search, view }
  const requestSeq = useRef(0)
  const fetchingRef = useRef(false)
  const nextCursorRef = useRef<string | null>(null)
  useEffect(() => {
    nextCursorRef.current = nextCursor
  }, [nextCursor])

  const pushToast = useCallback(
    (
      type: LibraryToast['type'],
      content: string,
      action?: LibraryToast['action']
    ) => {
      const id = toastSeq++
      setToasts(prev => [...prev.slice(-3), { id, type, content, action }])
      window.setTimeout(() => {
        setToasts(prev => prev.filter(toast => toast.id !== id))
      }, TOAST_LIFETIME_MS)
    },
    []
  )

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }, [])

  const failureFromError = useCallback(
    (err: unknown) => api.failureFromError(err),
    []
  )

  /** Fetch one page; `append` continues an existing list. */
  const fetchPage = useCallback(
    async (append: boolean) => {
      const seq = ++requestSeq.current
      if (!append) {
        setEntries([])
        setNextCursor(null)
        setLoading(true)
      }
      try {
        const result = await api.listEntries({
          search: paramsRef.current.search,
          trashed: paramsRef.current.view === 'trash',
          cursor: append ? nextCursorRef.current : null,
          limit: PAGE_SIZE,
        })
        if (seq !== requestSeq.current) return
        setEntries(prev => (append ? [...prev, ...toRows(result.items)] : toRows(result.items)))
        setNextCursor(result.nextCursor)
        if (!append) setLoadError(null)
      } catch (err) {
        if (seq !== requestSeq.current) return
        if (!append) {
          setLoadError(api.failureFromError(err).message)
        } else {
          pushToast('error', api.failureFromError(err).message)
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    },
    [pushToast]
  )
  const refresh = useCallback(() => fetchPage(false), [fetchPage])

  const loadMore = useCallback(async () => {
    if (!nextCursorRef.current || fetchingRef.current) return
    fetchingRef.current = true
    try {
      await fetchPage(true)
    } finally {
      fetchingRef.current = false
    }
  }, [fetchPage])

  // Initial load + search/view changes (search debounced).
  const firstLoadRef = useRef(true)
  useEffect(() => {
    const debounce = firstLoadRef.current ? 0 : SEARCH_DEBOUNCE_MS
    firstLoadRef.current = false
    const timer = window.setTimeout(() => {
      void fetchPage(false)
    }, debounce)
    return () => window.clearTimeout(timer)
  }, [search, view, fetchPage])

  const visible = useMemo(
    () => entries.filter(row => entryMatchesQuery(row.entry, search)),
    [entries, search]
  )

  const setView = useCallback((next: LibraryView) => {
    setViewState(next)
    setSelection(null)
    setBulk([])
  }, [])

  const setSearch = useCallback((q: string) => setSearchState(q), [])

  const select = useCallback((rowId: string | null) => {
    setSelection(rowId)
  }, [])

  const selected = useMemo(
    () => entries.find(row => row.rowId === selection) ?? null,
    [entries, selection]
  )
  const previewIndex = useMemo(
    () => (selection ? visible.findIndex(row => row.rowId === selection) : -1),
    [visible, selection]
  )

  const stepPreview = useCallback(
    (dir: 1 | -1) => {
      if (previewIndex === -1 || visible.length === 0) return
      const nextIndex = previewIndex + dir
      if (dir > 0 && nextIndex >= visible.length) {
        // End of the loaded page with more to come: extend the list (the
        // button is enabled via canNext; the next Next then advances).
        if (nextCursorRef.current) {
          void loadMore()
        }
        return
      }
      if (nextIndex < 0 || nextIndex >= visible.length) return
      setSelection(visible[nextIndex].rowId)
    },
    [previewIndex, visible, loadMore]
  )

  const canPrev = previewIndex > 0
  const canNext =
    previewIndex !== -1 && (previewIndex < visible.length - 1 || nextCursor !== null)

  const toggleBulk = useCallback((rowId: string) => {
    setBulk(prev =>
      prev.includes(rowId) ? prev.filter(id => id !== rowId) : [...prev, rowId]
    )
  }, [])

  const setBulkAll = useCallback((all: boolean) => {
    setBulk(all ? visible.map(row => row.rowId) : [])
  }, [visible])

  const duplicateKeyIds = useMemo(() => duplicateKeyRowIds(entries), [entries])

  // Drop stale selection/bulk rows after list refreshes (deleted entries).
  useEffect(() => {
    const present = new Set(entries.map(row => row.rowId))
    setSelection(prev => (prev === null || present.has(prev) ? prev : null))
    setBulk(prev => {
      const next = prev.filter(id => present.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [entries])

  const addEntries = useCallback(
    async (apiEntries: { key: string; type: string; fields: LibraryFieldApi[] }[]) => {
      // Persist first (item: "added" toast without a POST was the P0 bug);
      // surface the server's 409 duplicate-key message verbatim.
      try {
        await api.createEntries(
          apiEntries.map(e => ({
            key: e.key,
            type: e.type,
            fields: e.fields,
          }))
        )
      } catch (err) {
        const failure = api.failureFromError(err)
        pushToast('error', failure.message)
        return
      }
      await refresh()
      pushToast(
        'success',
        plural(t, apiEntries.length, 'one_ref_added', 'many_ref_added')
      )
    },
    [refresh, pushToast, t]
  )

  const saveEntry = useCallback(
    async (rowId: string, originalKey: string, entry: SaveRequest) => {
      try {
        // rowId carries the stable row identity (Mongo `_id` when the list
        // has one) so duplicate-key rows address the exact document; the
        // server falls back to the key otherwise.
        await api.updateEntry(originalKey, entry, rowId)
        await refresh()
        return null
      } catch (err) {
        return api.failureFromError(err).message
      }
    },
    [refresh]
  )

  const trashEntries = useCallback(
    async (rowIds: string[]) => {
      try {
        const count = await api.deleteEntries(rowIds, false)
        setSelection(null)
        await refresh()
        setBulk([])
        pushToast(
          'success',
          plural(t, count, 'one_ref_trashed', 'many_ref_trashed'),
          { label: t('View Trash'), onClick: () => setView('trash') }
        )
        return count
      } catch (err) {
        pushToast('error', api.failureFromError(err).message)
        return 0
      }
    },
    [refresh, pushToast, t, setView]
  )

  const permanentDelete = useCallback(
    async (rowIds: string[]) => {
      try {
        const count = await api.deleteEntries(rowIds, true)
        setSelection(null)
        await refresh()
        setBulk([])
        pushToast(
          'success',
          plural(t, count, 'one_ref_deleted', 'many_ref_deleted')
        )
        return count
      } catch (err) {
        pushToast('error', api.failureFromError(err).message)
        return 0
      }
    },
    [refresh, pushToast, t]
  )

  const restoreEntries = useCallback(
    async (rowIds: string[]) => {
      try {
        const count = await api.restoreEntries(rowIds)
        await refresh()
        setBulk([])
        pushToast(
          'success',
          plural(t, count, 'one_ref_restored', 'many_ref_restored')
        )
        return count
      } catch (err) {
        pushToast('error', api.failureFromError(err).message)
        return 0
      }
    },
    [refresh, pushToast, t]
  )

  const downloadSelection = useCallback(() => {
    api.triggerDownload({ ids: bulk })
  }, [bulk])

  const downloadVisible = useCallback(() => {
    api.triggerDownload({
      search: paramsRef.current.search || undefined,
    })
  }, [])

  const downloadRest = useCallback(() => {
    api.triggerDownload({
      mode: search ? 'exclusion' : 'inclusion',
      search: search || undefined,
    })
  }, [search])

  const hasMore = nextCursor !== null

  const value = useMemo<LibraryContextValue>(
    () => ({
      view,
      setView,
      entries,
      visible,
      loading,
      loadError,
      hasMore,
      search,
      setSearch,
      selection,
      selected,
      select,
      stepPreview,
      canPrev,
      canNext,
      previewIndex,
      bulk,
      toggleBulk,
      setBulkAll,
      duplicateKeyIds,
      refresh,
      loadMore,
      addEntries,
      saveEntry,
      trashEntries,
      permanentDelete,
      restoreEntries,
      downloadSelection,
    downloadRest,
    downloadVisible,
      toasts,
      pushToast,
      dismissToast,
      failureFromError,
    }),
    [
      view, setView, entries, visible, loading, loadError, hasMore, search,
      setSearch, selection, selected, select, stepPreview, canPrev, canNext,
      bulk, toggleBulk, setBulkAll, duplicateKeyIds, refresh, loadMore,
      addEntries, saveEntry, trashEntries, permanentDelete, restoreEntries,
      downloadSelection, downloadRest, downloadVisible, toasts, pushToast, dismissToast,
      failureFromError,
    ]
  )

  return (
    <LibraryContext.Provider value={value}>
      {children}
    </LibraryContext.Provider>
  )
}

export function useLibrary() {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider')
  return ctx
}
