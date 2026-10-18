import { memo, useCallback, useState } from 'react'
import { OLModal } from '@/shared/components/ol/ol-modal'
import ManageTemplateModalContent from './manage-template-modal-content'
import type { Template } from '../../../types/template'

interface ManageTemplateModalProps {
  show: boolean
  handleHide: () => void
  handleAfterPublished: (data: Template) => void
  projectId: string
  projectName: string
}

function ManageTemplateModal({
  show,
  handleHide,
  handleAfterPublished,
  projectId,
  projectName,
}: ManageTemplateModalProps) {
  const [inFlight, setInFlight] = useState(false)

  const onHide = useCallback(() => {
    if (!inFlight) {
      handleHide()
    }
  }, [handleHide, inFlight])

  return (
    <OLModal
      size="lg"
      animation
      show={show}
      onHide={onHide}
      id="publish-template-modal"
      // backdrop="static" will disable closing the modal by clicking
      // outside of the modal element
      backdrop='static'
    >
      <ManageTemplateModalContent
        handleHide={onHide}
        inFlight={inFlight}
        setInFlight={setInFlight}
        handleAfterPublished={handleAfterPublished}
        projectId={projectId}
        projectName={projectName}
      />
    </OLModal>
  )
}

export default memo(ManageTemplateModal)
