import { useTemplateGalleryContext } from '../context/template-gallery-context'
import { useTranslation } from 'react-i18next'
import SearchForm from './search-form'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'
import useSort from '../hooks/use-sort'
import withContent, { SortBtnProps } from './sort/with-content'
import MaterialIcon from '@/shared/components/material-icon'

function SortBtn({ onClick, text, iconType, screenReaderText }: SortBtnProps) {
  return (
    <button
      className="gallery-header-sort-btn inline-block"
      onClick={onClick}
      aria-label={screenReaderText}
    >
      <span>{text}</span>
        {iconType ? (
          <MaterialIcon type={iconType} />
        ) : (
          <MaterialIcon type="arrow_upward" style={{ visibility: 'hidden' }} />
        )}
    </button>
  )
}

const SortByButton = withContent(SortBtn)

export default function GallerySearchSortHeader( { gotoAllLink }: { boolean } ) {
  const { t } = useTranslation()
  const {
    searchText,
    setSearchText,
    sort,
  } = useTemplateGalleryContext()

  const { handleSort } = useSort()
  return (
    <>
      {/* Search sits on its own centered row, mirroring upstream's templates page */}
      <OLRow className="gallery-search-row">
        <OLCol className="d-flex justify-content-center">
          <SearchForm
            inputValue={searchText}
            setInputValue={setSearchText}
          />
        </OLCol>
      </OLRow>
      <OLRow>
        {gotoAllLink ? (
        <OLCol className="col-auto">
            <a className="previous-page-link" href="/templates/all">
              <i className="material-symbols material-symbols-rounded" aria-hidden="true">arrow_left_alt</i>
              {t('all_templates')}
            </a>
          </OLCol>
        ) : (
        <OLCol className="col-auto">
            <a className="previous-page-link" href="/templates">
              <i className="material-symbols material-symbols-rounded" aria-hidden="true">arrow_left_alt</i>
              {t('template_gallery')}
            </a>
          </OLCol>
        )}
        <OLCol className="d-flex justify-content-end gap-2">
          <SortByButton
            column="lastUpdated"
            text={t('last_updated')}
            sort={sort}
            onClick={() => handleSort('lastUpdated')}
          />

          <SortByButton
            column="name"
            text={t('title')}
            sort={sort}
            onClick={() => handleSort('name')}
          />
        </OLCol>
      </OLRow>
    </>
  )
}
