import { useTranslation } from 'react-i18next'
import { memo, useCallback, useState } from 'react'
import { Project } from '../../../../../../../types/project/api'
import PurgeProjectModal from '../../../modals/purge-project-modal'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import { useProjectListContext } from '../../../../context/project-list-context'
import { purgeProject } from '../../../../util/api'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'

type PurgeProjectButtonProps = {
  project: Project
  children: (text: string, handleOpenModal: () => void) => React.ReactElement
}

function PurgeProjectButton({ project, children }: PurgeProjectButtonProps) {

  if (!project.deleted) return null

  const { removeProjectFromView } = useProjectListContext()
  const { t } = useTranslation()
  const text = t('delete_permanently')
  const [showModal, setShowModal] = useState(false)
  const isMounted = useIsMounted()

  const handleOpenModal = useCallback(() => {
    setShowModal(true)
  }, [])

  const handleCloseModal = useCallback(() => {
    if (isMounted.current) {
      setShowModal(false)
    }
  }, [isMounted])

  const handlePurgeProject = useCallback(async () => {
    await purgeProject(project.id)
    removeProjectFromView(project)
  }, [project, removeProjectFromView])

  return (
    <>
      {children(text, handleOpenModal)}
      <PurgeProjectModal
        projects={[project]}
        actionHandler={handlePurgeProject}
        showModal={showModal}
        handleCloseModal={handleCloseModal}
      />
    </>
  )
}

const PurgeProjectButtonTooltip = memo(function PurgeProjectButtonTooltip({
  project,
}: Pick<PurgeProjectButtonProps, 'project'>) {
  return (
    <PurgeProjectButton project={project}>
      {(text, handleOpenModal) => (
        <OLTooltip
          key={`tooltip-purge-project-${project.id}`}
          id={`purge-project-${project.id}`}
          description={text}
          overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
        >
          <OLIconButton
            onClick={handleOpenModal}
            variant="link"
            accessibilityLabel={text}
            className="action-btn"
            icon="delete_forever"
          />
        </OLTooltip>
      )}
    </PurgeProjectButton>
  )
})

export default memo(PurgeProjectButton)
export { PurgeProjectButtonTooltip }
