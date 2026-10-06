import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as eventTracking from '@/infrastructure/event-tracking'
import getMeta from '@/utils/meta'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import EditorManageTemplateModalWrapper from '../pages/template/components/manage-template-modal/editor-manage-template-modal-wrapper'
import OLButton from '@/shared/components/ol/ol-button'

type TemplateManageResponse = {
  template_id: string
}

export default function ActionsManageTemplate() {

  const templatesAdmin = getMeta('ol-showTemplatesServerPro')
  if (!templatesAdmin) {
    return null
  }

  const [showModal, setShowModal] = useState(false)
  const { pdfFile } = useDetachCompileContext()
  const { t } = useTranslation()

  const handleShowModal = useCallback(() => {
    eventTracking.sendMB('left-menu-template')
    setShowModal(true)
  }, [])

  const openTemplate = useCallback(
    ({ template_id: templateId }: TemplateManageResponse) => {
      location.assign(`/template/${templateId}`)
    },
    [location]
  )

  return (
    <>
      {pdfFile ? (
        <OLButton variant="link" className="left-menu-button" onClick={handleShowModal} leadingIcon='open_in_new'>
          {t('publish_as_template')}
        </OLButton>
      ) : (
        <OLTooltip
          id="disabled-publish-as-template"
          description={"Please compile your project before publishing it as a template"}
          overlayProps={{
            placement: 'top',
          }}
        >
          {/* OverlayTrigger won't fire unless the child is a non-react html element (e.g div, span) */}
          <div>
            <OLButton
              variant="link"
              className="left-menu-button"
              leadingIcon='open_in_new'
              disabled
              aria-label={"Please compile your project before publishing it as a template"}
            >
              {t('publish_as_template')}
            </OLButton>
          </div>
        </OLTooltip>
      )}
      <EditorManageTemplateModalWrapper
        show={showModal}
        handleHide={() => setShowModal(false)}
        openTemplate={openTemplate}
      />
    </>
  )
}
