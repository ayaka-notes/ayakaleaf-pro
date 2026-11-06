import { useCallback, useEffect, useRef, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

const SEARCH_DEBOUNCE_MS = 300

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
