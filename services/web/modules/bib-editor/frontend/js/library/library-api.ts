/**
 * Library REST client (LIBRARY_PLAN.md §4/§5). Thin typed wrappers over
 * the shared fetch-json (CSRF token + JSON + error model live there).
 * Shapes match the SaaS surface (§1.1; D-C1 `value` field name).
 */
import {
  getJSON,
  postJSON,
  patchJSON,
  FetchError,
  getUserFacingMessage,
} from '@/infrastructure/fetch-json'
import type {
  LibraryEntryApi,
  LibraryFieldApi,
} from './library-model'

export type ApiFailure = {
  message: string
  status?: number
  /** 409: the key the server reports as duplicate */
  duplicateKey?: string
}

/** Map a fetch JSON failure to a UI-facing message + status. */
export function failureFromError(err: unknown): ApiFailure {
  if (err instanceof FetchError) {
    const body = (err.data ?? {}) as {
      message?: string | { text?: string }
      info?: { duplicateKey?: string }
    }
    const message =
      (typeof body.message === 'string' ? body.message : body.message?.text) ||
      getUserFacingMessage(err) ||
      'Something went wrong.'
    return {
      message,
      status: err.response?.status,
      duplicateKey: body.info?.duplicateKey,
    }
  }
  return {
    message:
      (err as Error)?.message || 'Something went wrong.',
  }
}

type ListOptions = {
  search?: string
  trashed?: boolean
  cursor?: string | null
  limit?: number
  signal?: AbortSignal
}

export async function listEntries(
  opts: ListOptions = {}
): Promise<{ items: LibraryEntryApi[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (opts.search?.trim()) params.set('search', opts.search.trim())
  if (opts.trashed) params.set('trashed', 'true')
  if (opts.cursor) params.set('cursor', opts.cursor)
  if (opts.limit) params.set('limit', String(opts.limit))
  const q = params.toString()
  return getJSON<{ items: LibraryEntryApi[]; nextCursor: string | null }>(
    q ? `/library/references?${q}` : '/library/references',
    { signal: opts.signal }
  )
}

export async function createEntries(
  entries: { key: string; type: string; fields: LibraryFieldApi[] }[],
  signal?: AbortSignal
): Promise<LibraryEntryApi[]> {
  const res = await postJSON<{ items: LibraryEntryApi[] }>(
    '/library/references',
    { body: { entries }, signal }
  )
  return res.items
}

export async function matchKeys(
  entries: { key: string }[]
): Promise<string[]> {
  const res = await postJSON<{ matches: string[] }>(
    '/library/references/match',
    { body: { entries } }
  )
  return res.matches
}

export async function updateEntry(
  originalKey: string,
  entry: { key?: string; type: string; fields: LibraryFieldApi[] }
): Promise<LibraryEntryApi> {
  return patchJSON<LibraryEntryApi>(
    `/library/references/${encodeURIComponent(originalKey)}`,
    { body: entry }
  )
}

export async function deleteEntries(
  ids: string[],
  permanent: boolean
): Promise<number> {
  const res = await postJSON<{ deletedCount: number }>(
    '/library/references/delete',
    { body: { ids, permanent } }
  )
  return res.deletedCount
}

export async function restoreEntries(ids: string[]): Promise<number> {
  const res = await postJSON<{ restoredCount: number }>(
    '/library/references/restore',
    { body: { ids } }
  )
  return res.restoredCount
}

export async function countEntries(opts: {
  search?: string
  trashed?: boolean
} = {}): Promise<number> {
  const params = new URLSearchParams()
  if (opts.search?.trim()) params.set('search', opts.search.trim())
  if (opts.trashed) params.set('trashed', 'true')
  const q = params.toString()
  const res = await getJSON<{ count: number }>(
    q ? `/library/references/count?${q}` : '/library/references/count'
  )
  return res.count
}

export async function suggestedKeys(
  base: string,
  extraTaken: string[] = []
): Promise<string[]> {
  const params = new URLSearchParams()
  params.set('base', base)
  if (extraTaken.length > 0) params.set('keys', extraTaken.join(','))
  const res = await getJSON<{ keys: string[] }>(
    `/library/references/citation-key-suggestions?${params.toString()}`
  )
  return res.keys
}

/**
 * .bib download URL (SaaS `download` endpoint). `mode: 'exclusion'`
 * downloads everything NOT matching the search.
 */
export function downloadUrl(opts: {
  ids?: string[]
  search?: string
  mode?: 'inclusion' | 'exclusion'
}): string {
  const params = new URLSearchParams()
  if (opts.mode) params.set('mode', opts.mode)
  if (opts.search?.trim()) params.set('search', opts.search.trim())
  if (opts.ids && opts.ids.length > 0) params.set('ids', opts.ids.join(','))
  const q = params.toString()
  return q ? `/library/references/download?${q}` : '/library/references/download'
}

/** Trigger a browser download of the .bib for the given selection (GET). */
export function triggerDownload(opts: Parameters<typeof downloadUrl>[0]): void {
  const a = document.createElement('a')
  a.href = downloadUrl(opts)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export type { LibraryEntryApi, LibraryFieldApi }
