import { useTranslation } from 'react-i18next'
import { getAdminUser } from '../meta'
import ProjectsList from '../../shared/projects-list'

// The projects the user owns
function ProjectsTab({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const { user } = getAdminUser()
  return (
    <ProjectsList
      url={`/admin/user/${user.id}/projects/list`}
      id="admin-user-projects"
      ownerId={user.id}
      active={active}
      placeholder={t('search_by_project_name_or_id')}
    />
  )
}

export default ProjectsTab
