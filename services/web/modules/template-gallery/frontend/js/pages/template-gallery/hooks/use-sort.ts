import { useTemplateGalleryContext } from '../context/template-gallery-context'
import { Sort } from '../types/api'
import { SortingOrder } from '@ol-types/sorting-order'

const toggleSort = (order: SortingOrder): SortingOrder => {
  return order === 'asc' ? 'desc' : 'asc'
}

function useSort() {
  const { sort, setSort } = useTemplateGalleryContext()
  const handleSort = (by: Sort['by']) => {
    setSort(prev => ({
      by,
      order: prev.by === by ? toggleSort(sort.order) : by === 'lastUpdated' ? 'desc' : 'asc',
    }))
  }
  return { handleSort }
}

export default useSort
