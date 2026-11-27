import { useCallback, useEffect, useRef, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

const SEARCH_DEBOUNCE_MS = 300

type ListQuery = { [key: string]: unknown }

// Only the values that differ from the defaults go in the URL. The default
// order depends on the sort, so a changed sort always carries its order.
export function toSearchParams<Q extends ListQuery>(query: Q, defaults: Q) {
  const params = new URLSearchParams()
  for (const key of Object.keys(defaults)) {
    const changed = query[key] !== defaults[key]
    const sortChanged = key === 'order' && query.sort !== defaults.sort
    if (changed || sortChanged) params.set(key, String(query[key]))
  }
  return params
}

// The query a list kept in the URL starts with, after a reload
export function fromSearchParams<Q extends ListQuery>(defaults: Q): Q {
  const params = new URLSearchParams(window.location.search)
  const query: ListQuery = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const value = params.get(key)
    if (value === null) continue
    if (typeof defaults[key] !== 'number') {
      query[key] = value
    } else if (Number.isInteger(Number(value)) && Number(value) > 0) {
      query[key] = Number(value)
    }
  }
  return query as Q
}

// Keeps a list's query in the URL, as the user list does, so that a reload
// shows the same
export function useQueryInUrl<Q extends ListQuery>(
  query: Q,
  defaults: Q,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return
    const params = toSearchParams(query, defaults)
    const search = params.toString() ? `?${params}` : ''
    window.history.replaceState(
      null,
      '',
      window.location.pathname + search + window.location.hash
    )
  }, [query, defaults, enabled])
}

// Fetches a page of an admin list from the backend whenever the query
// changes; typing in the search box is debounced. The first page can come
// with the HTML (initialResult), otherwise it is fetched on mount.
export function usePagedList<
  Q extends { page: number; [key: string]: unknown },
  R extends { query: Q },
>(url: string, initialQuery: Q, initialResult?: R) {
  const [query, setQuery] = useState<Q>(initialResult?.query ?? initialQuery)
  const [result, setResult] = useState<R | null>(initialResult ?? null)
  const [loading, setLoading] = useState(!initialResult)
  const [error, setError] = useState<Error | null>(null)
  const [reloads, setReloads] = useState(0)
  const skipFetch = useRef(Boolean(initialResult))
  const debounceNext = useRef(false)

  useEffect(() => {
    if (skipFetch.current) {
      skipFetch.current = false
      return
    }
    const params = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)])
    )
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        getJSON<R>(`${url}?${params}`, { signal: controller.signal })
          .then(data => {
            setResult(data)
            setError(null)
          })
          .catch(err => {
            if (err.name === 'AbortError') return
            debugConsole.error(err)
            setError(err)
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false)
          })
      },
      debounceNext.current ? SEARCH_DEBOUNCE_MS : 0
    )
    debounceNext.current = false
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [url, query, reloads])

  // any change but a page change starts again from page 1
  const updateQuery = useCallback(
    (update: Partial<Q>, { debounce = false } = {}) => {
      debounceNext.current = debounce
      setQuery(query => ({ ...query, page: 1, ...update }))
    },
    []
  )
  const reload = useCallback(() => setReloads(n => n + 1), [])

  return { query, result, loading, error, updateQuery, reload }
}

// A list in a tab of the user or project page loads with the page; what an
// action on another tab changed (cleared sessions in the audit log, moved
// projects) shows when the tab is opened again
export function useReloadWhenShown(active: boolean, reload: () => void) {
  const shown = useRef(active)
  useEffect(() => {
    if (active && !shown.current) reload()
    shown.current = active
  }, [active, reload])
}
