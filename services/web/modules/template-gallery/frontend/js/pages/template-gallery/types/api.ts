import { SortingOrder } from '@ol-types/sorting-order'
import { Template } from '../../types/template'

export type Sort = {
  by: 'lastUpdated' | 'name'
  order: SortingOrder
}

export type GetTemplatesResponseBody = {
  totalSize: number
  templates: Template[]
}
