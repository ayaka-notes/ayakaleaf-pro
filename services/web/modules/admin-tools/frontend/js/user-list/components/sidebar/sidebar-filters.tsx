import {
  Filter,
  useUserListContext,
} from '../../context/user-list-context'
import UsersFilterMenu from '../users-filter-menu'

type SidebarFilterProps = {
  filter: Filter
  text: React.ReactNode
}

export function SidebarFilter({ filter, text }: SidebarFilterProps) {
  const { selectFilter } = useUserListContext()

  return (
    <UsersFilterMenu filter={filter}>
      {isActive => (
        <li className={isActive ? 'active' : ''}>
          <button type="button" onClick={() => selectFilter(filter)}>
            {text}
          </button>
        </li>
      )}
    </UsersFilterMenu>
  )
}

export default function SidebarFilters() {
  const { filterTranslations } = useUserListContext()

  return (
    <ul className="list-unstyled user-list-filters">
      {[...filterTranslations.entries()].map(([key, text]) => (
        <SidebarFilter key={key} filter={key} text={text} />
      ))}
      <li aria-hidden="true">
        <hr />
      </li>
    </ul>
  )
}
