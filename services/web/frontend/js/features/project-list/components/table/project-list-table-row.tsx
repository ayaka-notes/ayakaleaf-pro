import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import InlineTags from './cells/inline-tags'
import OwnerCell from './cells/owner-cell'
import LastUpdatedCell from './cells/last-updated-cell'
import ActionsCell from './cells/actions-cell'
import ActionsDropdown from '../dropdown/actions-dropdown'
import { getOwnerName } from '../../util/project'
import { Project } from '../../../../../../types/project/dashboard/api'
import { ProjectCheckbox } from './project-checkbox'
import { ProjectListOwnerName } from '@/features/project-list/components/table/project-list-owner-name'

type ProjectListTableRowProps = {
  project: Project
  selected: boolean
}
function ProjectListTableRow({ project, selected }: ProjectListTableRowProps) {
  const { t } = useTranslation()
  const ownerName = getOwnerName(project)
  const isTypst = project.compiler === 'typst'

  const badgeStyle = {
    display: 'inline-block' as const,
    fontSize: '0.7rem',
    fontWeight: 600,
    lineHeight: '1.4rem',
    padding: '0 0.5rem',
    borderRadius: '0.75rem',
    verticalAlign: 'middle' as const,
    whiteSpace: 'nowrap' as const,
    marginLeft: '0.25rem',
  }

  return (
    <tr className={selected ? 'table-active' : undefined}>
      <td className="dash-cell-checkbox d-none d-md-table-cell">
        <ProjectCheckbox projectId={project.id} projectName={project.name} />
      </td>
      <td className="dash-cell-name">
        {isTypst ? (
          <span style={{...badgeStyle, backgroundColor: '#e8f0fe', color: '#1a56b0', marginLeft: 0, marginRight: '0.25rem'}}>
            {t('typst')}
          </span>
        ) : (
          <span style={{...badgeStyle, backgroundColor: '#eef5ee', color: '#3d6e3d', marginLeft: 0, marginRight: '0.25rem'}}>
            {t('latex')}
          </span>
        )}
        <a href={`/project/${project.id}`} translate="no">
          {project.name}
        </a>
        <InlineTags className="d-none d-md-inline" projectId={project.id} />
      </td>
      <td className="dash-cell-date-owner pb-0 d-md-none">
        <LastUpdatedCell project={project} />
        {ownerName ? <ProjectListOwnerName ownerName={ownerName} /> : null}
      </td>
      <td className="dash-cell-owner d-none d-md-table-cell">
        <OwnerCell project={project} />
      </td>
      <td className="dash-cell-date d-none d-md-table-cell">
        <LastUpdatedCell project={project} />
      </td>
      <td className="dash-cell-tag pt-0 d-md-none">
        <InlineTags projectId={project.id} />
      </td>
      <td className="dash-cell-actions">
        <div className="d-none d-lg-block">
          <ActionsCell project={project} />
        </div>
        <div className="d-lg-none">
          <ActionsDropdown project={project} />
        </div>
      </td>
    </tr>
  )
}
export default memo(ProjectListTableRow)
