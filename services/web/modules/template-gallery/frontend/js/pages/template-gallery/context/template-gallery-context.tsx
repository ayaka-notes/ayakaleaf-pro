import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { Template } from '../../types/template'
import { GetTemplatesResponseBody, Sort } from '../types/api'
import getMeta from '@/utils/meta'
import useAsync from '@/shared/hooks/use-async'
import { getTemplates } from '../util/api'
import { debugConsole } from '@/utils/debugging'

export const TEMPLATES_PER_PAGE = 9
const SEARCH_DEBOUNCE_MS = 300

export type TemplateGalleryContextValue = {
  visibleTemplates: Template[]
  totalTemplatesCount: number
  error: Error | null
  sort: Sort
  setSort: React.Dispatch<React.SetStateAction<Sort>>
  searchText: string
  setSearchText: React.Dispatch<React.SetStateAction<string>>
  currentPage: number
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>
}

export const TemplateGalleryContext = createContext<
  TemplateGalleryContextValue | undefined
>(undefined)

type TemplateGalleryProviderProps = {
  children: ReactNode
}

export function TemplateGalleryProvider({ children }: TemplateGalleryProviderProps) {
  const [visibleTemplates, setVisibleTemplates] = useState<Template[]>([])
  const [totalTemplatesCount, setTotalTemplatesCount] = useState<number>(0)
  const [sort, setSort] = useState<Sort>({
    by: 'lastUpdated',
    order: 'desc',
  })

  const [searchText, setSearchText] = useState('')
  const [debouncedSearchText, setDebouncedSearchText] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const {
    error,
    runAsync,
  } = useAsync<GetTemplatesResponseBody>()

  const category = getMeta('ol-templateCategory') || 'all'

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearchText(searchText),
      SEARCH_DEBOUNCE_MS
    )
    return () => clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    runAsync(
      getTemplates({
        sort,
        category,
        page: currentPage,
        pageSize: TEMPLATES_PER_PAGE,
        q: debouncedSearchText,
      })
    )
      .then(data => {
        setVisibleTemplates(data.templates)
        setTotalTemplatesCount(data.totalSize)
      })
      .catch(debugConsole.error)
  }, [runAsync, sort, category, currentPage, debouncedSearchText])

  const value = useMemo<TemplateGalleryContextValue>(
    () => ({
      error,
      searchText,
      setSearchText,
      setSort,
      sort,
      totalTemplatesCount,
      visibleTemplates,
      currentPage,
      setCurrentPage,
    }),
    [
      error,
      searchText,
      setSearchText,
      setSort,
      sort,
      totalTemplatesCount,
      visibleTemplates,
      currentPage,
      setCurrentPage,
    ]
  )

  return (
    <TemplateGalleryContext.Provider value={value}>
      {children}
    </TemplateGalleryContext.Provider>
  )
}

export function useTemplateGalleryContext() {
  const context = useContext(TemplateGalleryContext)
  if (!context) {
    throw new Error(
      'TemplateGalleryContext is only available inside TemplateGalleryProvider'
    )
  }
  return context
}
