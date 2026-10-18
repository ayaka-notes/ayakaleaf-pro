import { memo } from 'react'
import EmailCell from './cells/email-cell'
import LastActiveCell from './cells/last-active-cell'
import SignUpDateCell from './cells/sign-up-date-cell'
import DeletedAtCell from './cells/deleted-at-cell'
import ActionsCell from './cells/actions-cell'
import ActionsDropdown from '../dropdown/actions-dropdown'
import { User } from '../../../../../types/user/api'
import { UserCheckbox } from './user-checkbox'
import { useUsersPageContext } from '../../../users-page-context'
import { getUserName } from '../../../project-list/util/user'

type UserListTableRowProps = {
  user: User
  selected: boolean
  filter: string
}
function UserListTableRow({ user, selected, filter }: UserListTableRowProps) {
  const fullName = getUserName(user)
  const rowClassName = `${selected ? 'table-active' : ''} ${user.isAdmin ? 'dash-row-admin' : ''}`.trim()
  const { showProjects } = useUsersPageContext()

  return (
    <tr className={rowClassName}>
      <td className="dash-cell-checkbox d-none d-md-table-cell">
        <UserCheckbox userId={user.id} userName={user.email} />
      </td>
      <td className="dash-cell-name">
        <span
          role="link"
          tabIndex={0}
          translate="no"
          onClick={() => { 
            showProjects(user.id)
          }}
          style={{ cursor: 'pointer' }}
        >
          {fullName}
        </span>
      </td>
      <td className="dash-cell-email-date pb-0 d-md-none">
        <span> <EmailCell user={user} /> — <LastActiveCell user={user} /></span>
      </td>
      <td className="dash-cell-email d-none d-md-table-cell">
        <EmailCell user={user} />
      </td>
      {filter !== 'deleted' ? (
        <td className="dash-cell-date-signup d-none d-md-table-cell">
          <SignUpDateCell user={user} />
        </td>
      ) : (
        <td className="dash-cell-date-signup d-none d-md-table-cell">
          <DeletedAtCell user={user} />
        </td>
      )}
      <td className="dash-cell-date-active d-none d-md-table-cell">
        <LastActiveCell user={user} />
      </td>
      <td className="dash-cell-actions">
        <div className="d-none d-lg-block">
          <ActionsCell user={user} />
        </div>
        <div className="d-lg-none">
          <ActionsDropdown user={user} />
        </div>
      </td>
    </tr>
  )
}
export default memo(UserListTableRow)
