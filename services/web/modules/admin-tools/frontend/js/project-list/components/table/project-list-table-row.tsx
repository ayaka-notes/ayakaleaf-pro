import { memo } from 'react'
import DateCell from './cells/date-cell'
import { Filter } from '../../context/project-list-context'
import ActionsCell from './cells/actions-cell'
import ActionsDropdown from '../dropdown/actions-dropdown'
import { Project } from '../../../../../types/project/api'
import { ProjectCheckbox } from './project-checkbox'
import { ProjectListOwnerName } from './project-list-owner-name'
import { useUserIdentityContext } from '../../../user-list/context/user-identity-context'

type ProjectListTableRowProps = {
  project: Project
  selected: boolean
  filter: Filter
}
function ProjectListTableRow({ project, selected, filter }: ProjectListTableRowProps) {
  const { getUserNameById } = useUserIdentityContext()
  const ownerName = getUserNameById(project.owner)
  const actorName = filter !== 'deleted' ?
    getUserNameById(project.lastUpdatedBy) :
    getUserNameById(project.deletedBy)
  const eventDate = filter !== 'deleted' ? project.lastUpdated : project.deletedAt

  return (
    <tr className={selected ? 'table-active' : undefined}>
      <td className="dash-cell-checkbox d-none d-md-table-cell">
        <ProjectCheckbox projectId={project.id} projectName={project.name} />
      </td>
      <td className="dash-cell-name" translate="no">
        <a href={`/project/${project.id}`}
        >{project.name}</a>
      </td>
      <td className="dash-cell-date-owner pb-0 d-md-none">
        <DateCell 
          projectId={project.id} 
          actorName={actorName}
          date={eventDate} 
        />
        <ProjectListOwnerName ownerName={ownerName} />
      </td>
      <td className="dash-cell-owner d-none d-md-table-cell">
        <span translate="no">{ownerName}</span>
      </td>
      <td className="dash-cell-date d-none d-md-table-cell">
        <DateCell 
          projectId={project.id} 
          actorName={actorName}
          date={eventDate} 
        />
      </td>
      <td className="dash-cell-actions">
        <div className="d-none d-md-block">
          <ActionsCell project={project} />
        </div>
        <div className="d-md-none">
          <ActionsDropdown project={project} />
        </div>
      </td>
    </tr>
  )
}
export default memo(ProjectListTableRow)
