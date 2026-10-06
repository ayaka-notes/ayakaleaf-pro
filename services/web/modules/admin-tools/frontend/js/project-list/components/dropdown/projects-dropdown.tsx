import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Filter,
  useProjectListContext,
} from '../../context/project-list-context'
import {
  OLDropdown as Dropdown,
  OLDropdownHeader as DropdownHeader,
  OLDropdownItem as DropdownItem,
  OLDropdownMenu as DropdownMenu,
  OLDropdownToggle as DropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import ProjectsFilterMenu from '../projects-filter-menu'

type ItemProps = {
  filter: Filter
  text: string
  onClick?: () => void
}

export function Item({ filter, text, onClick }: ItemProps) {
  const { selectFilter } = useProjectListContext()
  const handleClick = () => {
    selectFilter(filter)
    onClick?.()
  }

  return (
    <ProjectsFilterMenu filter={filter}>
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
    </ProjectsFilterMenu>
  )
}

function ProjectsDropdown() {
  const { t } = useTranslation()
  const [title, setTitle] = useState(() => t('all_projects'))
  const { filter } = useProjectListContext()
  const filterTranslations = useRef<Record<Filter, string>>({
    owned: t('all_projects'),
    inactive: t('archived_projects'),
    trashed: t('trashed_projects'),
    deleted: t('delete_projects'),
  })

  useEffect(() => {
    setTitle(filterTranslations.current[filter])
  }, [filter, t])

  return (
    <Dropdown>
      <DropdownToggle
        id="projects-types-dropdown-toggle-btn"
        className="ps-0 mb-0 btn-transparent h4"
        size="lg"
        aria-label={t('filter_projects')}
      >
        <span className="text-truncate" aria-hidden>
          {title}
        </span>
      </DropdownToggle>
      <DropdownMenu flip={false}>
        <li role="none">
          <Item filter="owned" text={t('all_projects')} />
        </li>
        <li role="none">
          <Item filter="inactive" text={t('archived_projects')} />
        </li>
        <li role="none">
          <Item filter="trashed" text={t('trashed_projects')} />
        </li>
        <li role="none">
          <Item filter="deleted" text={t('delete_projects')} />
        </li>
      </DropdownMenu>
    </Dropdown>
  )
}

export default ProjectsDropdown
