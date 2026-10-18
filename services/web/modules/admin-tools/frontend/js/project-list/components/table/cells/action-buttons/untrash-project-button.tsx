import { useTranslation } from 'react-i18next'
import { memo, useCallback } from 'react'
import { Project } from '../../../../../../../types/project/api'
import { useProjectListContext } from '../../../../context/project-list-context'
import { untrashProjectForUser } from '../../../../util/api'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'

type UntrashProjectButtonProps = {
  project: Project
  children: (
    text: string,
    untrashProject: () => Promise<void>
  ) => React.ReactElement
}

function UntrashProjectButton({
  project,
  children,
}: UntrashProjectButtonProps) {

  if (!project.trashed || project.deleted) return null

  const { t } = useTranslation()
  const text = t('untrash')
  const { toggleSelectedProject, updateProjectViewData } =
    useProjectListContext()

  const handleUntrashProject = useCallback(async () => {
    await untrashProjectForUser(project.id, project.owner)
    toggleSelectedProject(project.id, false)
    updateProjectViewData({ ...project, trashed: false })
  }, [project, toggleSelectedProject, updateProjectViewData])

  return children(text, handleUntrashProject)
}

const UntrashProjectButtonTooltip = memo(function UntrashProjectButtonTooltip({
  project,
}: Pick<UntrashProjectButtonProps, 'project'>) {
  return (
    <UntrashProjectButton project={project}>
      {(text, handleUntrashProject) => (
        <OLTooltip
          key={`tooltip-untrash-project-${project.id}`}
          id={`untrash-project-${project.id}`}
          description={text}
          overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
        >
          <OLIconButton
            onClick={handleUntrashProject}
            variant="link"
            accessibilityLabel={text}
            className="action-btn"
            icon="restore_page"
          />
        </OLTooltip>
      )}
    </UntrashProjectButton>
  )
})

export default memo(UntrashProjectButton)
export { UntrashProjectButtonTooltip }
