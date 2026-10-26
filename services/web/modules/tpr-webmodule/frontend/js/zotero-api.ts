import { getJSON, postJSON } from '@/infrastructure/fetch-json'

export type ZoteroLibrary = { id: string; name: string }

export type ZoteroLibraries = {
  personal: ZoteroLibrary
  groups: ZoteroLibrary[]
}

export type ZoteroCollection = {
  key: string
  name: string
  numItems: number | null
  parent: string | null
}

export type ZoteroCreator = {
  firstName: string
  lastName: string
  name: string
}

export type ZoteroItem = {
  key: string
  version: number
  itemType: string
  title: string
  date: string
  publication: string
  creators: ZoteroCreator[]
  url: string
  doi: string
}

export type CiteResult = {
  path: string
  entries: {
    itemKey: string
    citationKey: string
    added: boolean
  }[]
}

export type ImportResult = {
  path: string
  imported: number
  skipped: number
  total: number
}

export type SyncResult = {
  files: { path: string; added: number; updated: number; removed: number }[]
  added: number
  updated: number
  removed: number
}

export function getLibraries(): Promise<ZoteroLibraries> {
  return getJSON('/zotero/libraries')
}

export function getCollections(
  libraryId: string
): Promise<{ collections: ZoteroCollection[] }> {
  return getJSON(`/zotero/collections?library=${encodeURIComponent(libraryId)}`)
}

export function searchItems({
  libraryId,
  collectionKey,
  query,
  limit = 10,
  start = 0,
  mode = 'library',
}: {
  libraryId: string
  collectionKey?: string | null
  query?: string
  limit?: number
  start?: number
  mode?: 'library' | 'unfiled' | 'trash'
}): Promise<{ items: ZoteroItem[]; total: number }> {
  const params = new URLSearchParams({
    library: libraryId,
    limit: `${limit}`,
    start: `${start}`,
    mode,
  })
  if (collectionKey) params.set('collection', collectionKey)
  if (query) params.set('q', query)
  return getJSON(`/zotero/items?${params.toString()}`)
}

export function getBibFiles(projectId: string): Promise<{ files: string[] }> {
  return getJSON(`/project/${projectId}/zotero/bib-files`)
}

export function citeItems(
  projectId: string,
  body: {
    libraryId: string
    collectionKey?: string | null
    itemKeys: string[]
    targetPath?: string
  }
): Promise<CiteResult> {
  return postJSON(`/project/${projectId}/zotero/cite`, { body })
}

export function importItems(
  projectId: string,
  body: {
    libraryId: string
    collectionKey?: string | null
    itemKeys: string[]
    name: string
    mirror?: boolean
  }
): Promise<ImportResult> {
  return postJSON(`/project/${projectId}/zotero/import`, { body })
}

export function syncProject(projectId: string): Promise<SyncResult> {
  return postJSON(`/project/${projectId}/zotero/sync`, { body: {} })
}

/**
 * "Yu, Miao, Huang, Zhongmou" -> "Yu, Miao et al." — short author label for the
 * result list; the full author list is in the .bib entry.
 */
export function authorLabel(item: ZoteroItem): string {
  const names = item.creators
    .map(creator =>
      creator.name
        ? creator.name
        : [creator.lastName, creator.firstName].filter(Boolean).join(', ')
    )
    .filter(Boolean)
  if (!names.length) return ''
  return names.length > 1 ? `${names[0]} et al.` : names[0]
}
