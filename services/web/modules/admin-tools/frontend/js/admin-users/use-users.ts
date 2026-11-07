import { useCallback, useEffect, useRef, useState } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import type { UsersQuery, UsersResult } from './types'

const DEFAULT_QUERY: UsersQuery = {
  page: 1,
  pageSize: 10,
  status: 'all',
  auth: 'all',
  role: 'all',
  search: '',
  sort: 'signUpDate',
  order: 'desc',
}

const SEARCH_DEBOUNCE_MS = 300

// Only the values that differ from the defaults go in the URL. The default
// order depends on the sort, so a changed sort always carries its order.
export function toSearchParams(query: UsersQuery) {
  const params = new URLSearchParams()
  for (const key of Object.keys(DEFAULT_QUERY) as (keyof UsersQuery)[]) {
    const changed = query[key] !== DEFAULT_QUERY[key]
    const sortChanged = key === 'order' && query.sort !== DEFAULT_QUERY.sort
    if (changed || sortChanged) params.set(key, String(query[key]))
  }
  return params
}

export function useUsers(initialResult: UsersResult) {
  const [query, setQuery] = useState<UsersQuery>(initialResult.query)
  const [result, setResult] = useState<UsersResult>(initialResult)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [reloads, setReloads] = useState(0)
  const isFirstRender = useRef(true)
  const debounceNext = useRef(false)

  useEffect(() => {
    const params = toSearchParams(query)
    const search = params.toString() ? `?${params}` : ''
    window.history.replaceState(
      null,
      '',
      window.location.pathname + search + window.location.hash
    )

    // the first page comes with the HTML
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        getJSON<UsersResult>(`/admin/users/list${search}`, {
          signal: controller.signal,
        })
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
  }, [query, reloads])

  // Any change but a page change starts again from page 1
  const updateQuery = useCallback(
    (update: Partial<UsersQuery>, { debounce = false } = {}) => {
      debounceNext.current = debounce
      setQuery(query => ({ ...query, page: 1, ...update }))
    },
    []
  )

  // After an action, fetch the same page again so rows and counts match
  const reload = useCallback(() => setReloads(n => n + 1), [])

  return { query, result, loading, error, updateQuery, reload }
}
