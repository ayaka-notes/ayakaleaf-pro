import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLRow from '@/shared/components/ol/ol-row'
import {
  useTemplateGalleryContext,
  TEMPLATES_PER_PAGE,
} from '../context/template-gallery-context'
import TemplateGalleryEntry from './template-gallery-entry'
import GalleryPagination from './gallery-pagination'

export default function TemplateGallery() {
  const { t } = useTranslation()
  const {
    searchText,
    sort,
    visibleTemplates,
    totalTemplatesCount,
    currentPage,
    setCurrentPage,
  } = useTemplateGalleryContext()

  const totalPages = Math.ceil(totalTemplatesCount / TEMPLATES_PER_PAGE)

  useEffect(() => {
    setCurrentPage(1)
  }, [sort, setCurrentPage])

  const [lastNonSearchPage, setLastNonSearchPage] = useState(1)
  const [isSearching, setIsSearching] = useState(false)
  useEffect(() => {
    if (searchText.length > 0) {
      if (!isSearching) {
        setLastNonSearchPage(currentPage)
        setIsSearching(true)
      }
      setCurrentPage(1)
    } else {
      if (isSearching) {
        setCurrentPage(lastNonSearchPage)
        setIsSearching(false)
      }
    }
  }, [searchText])

  const currentTemplates = visibleTemplates

  return (
    <>
      <OLRow className="gallery-container">
        {currentTemplates.length > 0 ? (
          currentTemplates.map(p => (
            <TemplateGalleryEntry
              className="gallery-thumbnail col-12 col-md-6 col-lg-4"
              key={p.id}
              template={p}
            />
          ))
        ) : (
          <OLRow>
            <p className="text-center">{"No Templates."}</p>
          </OLRow>
        )}
      </OLRow>
      <div className="d-flex justify-content-center">
        <GalleryPagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
    </>
  )
}
