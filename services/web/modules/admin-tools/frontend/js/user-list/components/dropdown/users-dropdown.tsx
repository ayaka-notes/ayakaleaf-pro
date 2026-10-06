import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Filter,
  useUserListContext,
} from '../../context/user-list-context'
import {
  OLDropdown as Dropdown,
  OLDropdownItem as DropdownItem,
  OLDropdownMenu as DropdownMenu,
  OLDropdownToggle as DropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import UsersFilterMenu from '../users-filter-menu'

type ItemProps = {
  filter: Filter
  text: string
  onClick?: () => void
}

export function Item({ filter, text, onClick }: ItemProps) {
  const { selectFilter } = useUserListContext()
  const handleClick = () => {
    selectFilter(filter)
    onClick?.()
  }

  return (
    <UsersFilterMenu filter={filter}>
      {isActive => (
        <DropdownItem
          as="button"
          tabIndex={-1}
          onClick={handleClick}
          trailingIcon={isActive ? 'check' : undefined}
          active={isActive}
        >
          {text}
        </DropdownItem>
      )}
    </UsersFilterMenu>
  )
}

function UsersDropdown() {
  const { t } = useTranslation()
  const { filter, filterTranslations } = useUserListContext()

  const title = filterTranslations.get(filter) ?? t('all')

  return (
    <Dropdown>
      <DropdownToggle
        id="users-types-dropdown-toggle-btn"
        className="ps-0 mb-0 btn-transparent h3"
        size="lg"
        aria-label={t('filter_users')}
      >
        <span className="text-truncate" aria-hidden>
          {title}
        </span>
      </DropdownToggle>
      <DropdownMenu flip={false}>
        {[...filterTranslations.entries()].map(([key, text]) => (
          <li role="none" key={key}>
            <Item filter={key} text={text} />
          </li>
        ))}
      </DropdownMenu>
    </Dropdown>
  )
}

export default UsersDropdown
