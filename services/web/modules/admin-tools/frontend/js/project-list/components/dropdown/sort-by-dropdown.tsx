import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useSort from '../../hooks/use-sort'
import withContent, { SortBtnProps } from '../sort/with-content'
import { useProjectListContext } from '../../context/project-list-context'
import { Sort } from '../../../../../types/project/api'
import {
  OLDropdown as Dropdown,
  OLDropdownHeader as DropdownHeader,
  OLDropdownItem as DropdownItem,
  OLDropdownMenu as DropdownMenu,
  OLDropdownToggle as DropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'

function Item({ onClick, text, iconType }: SortBtnProps) {
  return (
    <DropdownItem
      as="button"
      tabIndex={-1}
      onClick={onClick}
      trailingIcon={iconType}
    >
      {text}
    </DropdownItem>
  )
}

const ItemWithContent = withContent(Item)

function SortByDropdown() {
  const { t } = useTranslation()
  const [title, setTitle] = useState(() => t('last_modified'))
  const { filter, sort } = useProjectListContext()
  const { handleSort } = useSort()
  const sortByTranslations = useRef<Record<Sort['by'], string>>({
    title: t('title'),
    lastUpdated: t('last_modified'),
    deletedAt: t('deleted_at'),
  })

  const handleClick = (by: Sort['by']) => {
    setTitle(sortByTranslations.current[by])
    handleSort(by)
  }

  useEffect(() => {
    setTitle(sortByTranslations.current[sort.by])
  }, [sort.by])

  return (
    <Dropdown className="projects-sort-dropdown" align="end">
      <DropdownToggle
        id="projects-sort-dropdown"
        className="pe-0 mb-0 btn-transparent"
        size="sm"
        aria-label={t('sort_projects')}
      >
        <span className="text-truncate" aria-hidden>
          {title}
        </span>
      </DropdownToggle>
      <DropdownMenu flip={false}>
        <DropdownHeader className="text-uppercase">
          {t('sort_by')}:
        </DropdownHeader>
        <ItemWithContent
          column="title"
          text={t('title')}
          sort={sort}
          onClick={() => handleClick('title')}
        />
        <ItemWithContent
          column="owner"
          text={t('owner')}
          sort={sort}
          onClick={() => handleClick('owner')}
        />
        { filter !== 'deleted' ? ( 
          <ItemWithContent
            column="lastUpdated"
            text={t('last_modified')}
            sort={sort}
            onClick={() => handleClick('lastUpdated')}
          />
        ) : (
          <ItemWithContent
            column="deletedAt"
            text={t('deleted_at')}
            sort={sort}
            onClick={() => handleClick('deletedAt')}
          />
        )}
      </DropdownMenu>
    </Dropdown>
  )
}

export default SortByDropdown
