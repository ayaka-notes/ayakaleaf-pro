import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { useTranslation } from 'react-i18next'
import { useProjectListContext } from '../../../../context/project-list-context'
import { untrashProjectForUser } from '../../../../util/api'

export default function UntrashProjectsButton() {
  const { selectedProjects, toggleSelectedProject, updateProjectViewData } =
    useProjectListContext()
  const { t } = useTranslation()
  const text = t('restore')

  const handleUntrashProjects = async () => {
    for (const project of selectedProjects) {
      await untrashProjectForUser(project.id, project.owner)
      toggleSelectedProject(project.id, false)
      updateProjectViewData({ ...project, trashed: false })
    }
  }

  return (
    <OLTooltip
      id="tooltip-download-projects"
      description={text}
      overlayProps={{ placement: 'bottom', trigger: ['hover', 'focus'] }}
    >
      <OLIconButton
        onClick={handleUntrashProjects}
        variant="secondary"
        accessibilityLabel={text}
        icon="restore"
      />
    </OLTooltip>
  )
}

