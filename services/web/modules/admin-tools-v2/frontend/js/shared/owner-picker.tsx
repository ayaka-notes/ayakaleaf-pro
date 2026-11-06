import classnames from 'classnames'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCombobox } from 'downshift'
import { getJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import MaterialIcon from '@/shared/components/material-icon'
import { OLDropdownItem as DropdownItem } from '@/shared/components/ol/ol-dropdown-menu'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLSpinner from '@/shared/components/ol/ol-spinner'

export type OwnerOption = {
  id: string
  email: string
  firstName?: string
  lastName?: string
}

const SEARCH_DELAY_MS = 200

const displayName = (user: OwnerOption) => {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
  return name ? `${name} <${user.email}>` : user.email
}

// The owner picker (core's add-collaborators input): the admin types a name or an email and picks one of every user of
// the site (not only collaborators), searched in the backend like the user
// list instead of filtering a list loaded up front
function OwnerPicker({
  value,
  onChange,
  excludeIds,
}: {
  value: OwnerOption | null
  onChange: (user: OwnerOption | null) => void
  // the current owner, or the user whose projects move
  excludeIds: string[]
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSelectedRef = useRef<OwnerOption | null>(value)
  const [inputValue, setInputValue] = useState(value ? displayName(value) : '')
  const [options, setOptions] = useState<OwnerOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    lastSelectedRef.current = value
  }, [value])

  // the user list's endpoint: users that are not deleted, by name, email or
  // ID; the picked user's own label is not a search
  // compared by value: callers pass a new array on every render
  const excluded = excludeIds.join(',')
  useEffect(() => {
    if (value && inputValue === displayName(value)) return
    const id = window.setTimeout(() => {
      setLoading(true)
      const params = new URLSearchParams({ search: inputValue.trim(), pageSize: '10' })
      getJSON<{ users: OwnerOption[] }>(`/admin/users/list?${params}`)
        .then(result =>
          setOptions(
            result.users.filter(user => !excluded.split(',').includes(user.id))
          )
        )
        .catch(debugConsole.error)
        .finally(() => setLoading(false))
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [inputValue, value, excluded])

  const focusInput = useCallback(() => inputRef.current?.focus(), [])

  const {
    isOpen,
    highlightedIndex,
    getInputProps,
    getItemProps,
    getMenuProps,
    getLabelProps,
  } = useCombobox<OwnerOption>({
    items: options,
    selectedItem: value,
    inputValue,
    itemToString: item => (item ? displayName(item) : ''),
    defaultHighlightedIndex: 0,
    onInputValueChange: ({ inputValue }) => setInputValue(inputValue ?? ''),
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem) {
        lastSelectedRef.current = selectedItem
        onChange(selectedItem)
        setInputValue(displayName(selectedItem))
      }
    },
  })

  return (
    <div className="tags-input tags-new">
      <OLFormLabel className="small" {...getLabelProps()}>
        {t('select_a_new_owner_for_projects')}
        {loading && <OLSpinner size="sm" className="ms-2" />}
      </OLFormLabel>

      <div className="host">
        <div
          className="tags form-control d-flex align-items-center gap-1"
          onClick={focusInput}
        >
          {value && <MaterialIcon type="person" />}
          <input
            {...getInputProps({
              ref: inputRef,
              className: 'input',
              size: inputValue.length ? inputValue.length + 5 : 5,
              type: 'email',
              placeholder: t('search_by_name_email_or_id'),
              onBlur: () => {
                const last = lastSelectedRef.current
                if (last) {
                  setInputValue(displayName(last))
                } else {
                  setInputValue('')
                  onChange(null)
                }
              },
              onKeyDown: event => {
                if (event.key === 'Enter' && highlightedIndex === -1) {
                  event.preventDefault()
                }
              },
            })}
          />
        </div>

        <ul
          {...getMenuProps()}
          className={classnames('dropdown-menu select-dropdown-menu w-100', {
            show: isOpen,
          })}
        >
          {isOpen && !loading && options.length === 0 && (
            <li className="dropdown-item text-muted">{t('no_results_found')}</li>
          )}
          {isOpen &&
            options.map((item, index) => (
              <li key={item.id} {...getItemProps({ item, index })}>
                <DropdownItem
                  as="span"
                  role={undefined}
                  leadingIcon="person"
                  className={classnames({ active: index === highlightedIndex })}
                >
                  {displayName(item)}
                </DropdownItem>
              </li>
            ))}
        </ul>
      </div>
    </div>
  )
}

export default OwnerPicker
