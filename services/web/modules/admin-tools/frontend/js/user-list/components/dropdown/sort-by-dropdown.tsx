import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLDropdown as Dropdown,
  OLDropdownHeader as DropdownHeader,
  OLDropdownItem as DropdownItem,
  OLDropdownMenu as DropdownMenu,
  OLDropdownToggle as DropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import { useUserListContext } from '../../context/user-list-context'
import useSort from '../../hooks/use-sort'
import withContent, { SortBtnProps } from '../sort/with-content'
import { Sort } from '../../../../../types/user/api'

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
  const { filter, sort } = useUserListContext()
  const { handleSort } = useSort()
  const sortByTranslations = useRef<Record<Sort['by'], string>>({
    name: t('name'),
    email: t('email'),
    signUpDate: t('sign_up'),
    lastActive: t('last_active'),
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
          column="name"
          text={t('name')}
          sort={sort}
          onClick={() => handleClick('name')}
        />
        <ItemWithContent
          column="email"
          text={t('email')}
          sort={sort}
          onClick={() => handleClick('email')}
        />

        { filter !== 'deleted' ? (
          <ItemWithContent
            column="signUpDate"
            text={t('sign_up')}
            sort={sort}
            onClick={() => handleClick('signUpDate')}
          />
        ) : (
          <ItemWithContent
            column="deletedAt"
            text={t('deleted_at')}
            sort={sort}
            onClick={() => handleClick('deletedAt')}
          />
        )}
        <ItemWithContent
          column="lastActive"
          text={t('last_active')}
          sort={sort}
          onClick={() => handleClick('lastActive')}
        />
      </DropdownMenu>
    </Dropdown>
  )
}

export default SortByDropdown
