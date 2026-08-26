import { GetTemplatesResponseBody, Sort } from '../types/api'
import { getJSON } from '@/infrastructure/fetch-json'

export type GetTemplatesParams = {
  sort: Sort
  category: string
  page: number
  pageSize: number
  q?: string
}

export function getTemplates({
  sort,
  category,
  page,
  pageSize,
  q,
}: GetTemplatesParams): Promise<GetTemplatesResponseBody> {
  const queryParams = new URLSearchParams({
    by: sort.by,
    order: sort.order,
    category,
    page: String(page),
    pageSize: String(pageSize),
  })
  if (q) {
    queryParams.set('q', q)
  }

  return getJSON(`/api/templates?${queryParams.toString()}`)
}
