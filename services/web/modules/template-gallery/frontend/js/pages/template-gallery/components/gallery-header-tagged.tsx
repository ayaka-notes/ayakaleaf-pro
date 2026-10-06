import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'
import GallerySearchSortHeader from './gallery-search-sort-header'

export default function GalleryHeaderTagged({ category }) {
  const { t } = useTranslation()
  const title = getMeta('og:title')
  const { templateLinks } = getMeta('ol-ExposedSettings') || []

  const description = templateLinks?.find(link => link.url.split("/").pop() === category)?.description
  const gotoAllLink = (category !== 'all')
  
  return (
    <div className="tagged-header-container">
      { category && (
        <>
          <OLRow>
            <OLCol xs={12} className="text-center">
              <h1 className="gallery-title">
                <span className="eyebrow-text">
                  <span aria-hidden="true">&#123;</span>
                  <span>{t('overleaf_template_gallery')}</span>
                  <span aria-hidden="true">&#125;</span>
                </span>
                {title}
              </h1>
            </OLCol>
          </OLRow>
          <OLRow>
            <OLCol xs={12} className="text-center">
              <p className="gallery-summary">{description}</p>
            </OLCol>
          </OLRow>
        </>
      )}
      <GallerySearchSortHeader
        gotoAllLink={gotoAllLink}
      />
    </div>
  )
}
