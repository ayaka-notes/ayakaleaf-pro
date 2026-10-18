import { useTranslation } from 'react-i18next'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import DefaultNavbar from '@/shared/components/navbar/default-navbar'
import Footer from '@/shared/components/footer/footer'
import getMeta from '@/utils/meta'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'
import TemplateDetails from './template-details'
import TemplatePreview from './template-preview'
import { useTemplateContext, TemplateProvider } from '../context/template-context'

function TemplateRoot() {
  const { isReady } = useWaitForI18n()
  if (!isReady) {
    return null
  }
  return (
    <TemplateProvider>
      <TemplatePageContent />
    </TemplateProvider>
  )
}

function TemplatePageContent() {
  const { t } = useTranslation()
  const navbarProps = getMeta('ol-navbar')
  const footerProps = getMeta('ol-footer')
  const { template } = useTemplateContext()
  const { templateLinks } = getMeta('ol-ExposedSettings') || []
  const categoryName = templateLinks?.find(link => link.url === template.category)?.name

  return (
    <>
      <DefaultNavbar {...navbarProps} />
      <main id="main-content" className="gallery content content-page">
        <div className="container">
          <OLRow className="previous-page-link-container">
            <OLCol lg={5} xl={6}>
              <a className="previous-page-link" href={'/templates/all'}>
                <span className="material-symbols material-symbols-rounded" aria-hidden="true">arrow_left_alt</span>
                {t('all_templates')}
              </a>
              {categoryName && template.category !== '/templates/all' && (
                <>
                  <span className="mx-2">/</span>
                  <a className="previous-page-link" href={template.category}>
                    {categoryName}
                  </a>
                </>
              )}
            </OLCol>
          </OLRow>
          <OLRow>
            <OLCol className="template-item-left-section" md={6}>
              <TemplateDetails />
            </OLCol>
            <OLCol className="template-item-right-section" md={6}>
              <TemplatePreview />
            </OLCol>
          </OLRow>
        </div>
      </main>
      <Footer {...footerProps} />
    </>
  )
}

export default withErrorBoundary(TemplateRoot, GenericErrorBoundaryFallback)
