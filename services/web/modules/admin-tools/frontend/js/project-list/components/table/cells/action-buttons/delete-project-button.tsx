import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Project } from '../../../../../../../types/project/api'
import DeleteProjectModal from '../../../modals/delete-project-modal'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import { deleteProject } from '../../../../util/api'
import { useProjectListContext } from '../../../../context/project-list-context'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'

type DeleteProjectButtonProps = {
  project: Project
  children: (text: string, handleOpenModal: () => void) => React.ReactElement
}

function DeleteProjectButton({ project, children }: DeleteProjectButtonProps) {

  if (!project.trashed || project.deleted) return null

  const { toggleSelectedProject, updateProjectViewData } = useProjectListContext()
  const { t } = useTranslation()
  const text = t('delete')
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

  const handleDeleteProject = useCallback(async () => {
    await deleteProject(project.id)
    toggleSelectedProject(project.id, false)
    updateProjectViewData({
      ...project,
      deleted: true,
    })
  }, [project, toggleSelectedProject, updateProjectViewData])

  return (
    <>
      {children(text, handleOpenModal)}
      <DeleteProjectModal
        projects={[project]}
        actionHandler={handleDeleteProject}
        showModal={showModal}
        handleCloseModal={handleCloseModal}
      />
    </>
  )
}

const DeleteProjectButtonTooltip = memo(function DeleteProjectButtonTooltip({
  project,
}: Pick<DeleteProjectButtonProps, 'project'>) {
  return (
    <DeleteProjectButton project={project}>
      {(text, handleOpenModal) => (
        <OLTooltip
          key={`tooltip-delete-project-${project.id}`}
          id={`delete-project-${project.id}`}
          description={text}
          overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
        >
          <OLIconButton
            onClick={handleOpenModal}
            variant="link"
            accessibilityLabel={text}
            className="action-btn"
            icon="block"
          />
        </OLTooltip>
      )}
    </DeleteProjectButton>
  )
})

export default memo(DeleteProjectButton)
export { DeleteProjectButtonTooltip }
