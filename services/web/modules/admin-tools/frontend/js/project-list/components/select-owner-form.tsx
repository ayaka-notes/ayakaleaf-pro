import classnames from 'classnames'
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useCombobox } from 'downshift'
import MaterialIcon from '@/shared/components/material-icon'
import { OLDropdownItem as DropdownItem } from '@/shared/components/ol/ol-dropdown-menu'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import { UserRef } from '../../../../types/project/api'
import { getUserName } from '../util/user'

const FILTER_DELAY_MS = 200
const MAX_RESULTS = 100

function getDisplayName(user: UserRef) {
  return `${getUserName(user)} <${user.email}>`
}

const SelectOwnerForm = React.forwardRef<
  HTMLInputElement,
  {
    loading: boolean
    users: UserRef[]
    value: UserRef | null
    onChange: (user: UserRef | null) => void
  }
>(function SelectOwnerForm(
  { loading, users, value, onChange },
  forwardedRef
) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!forwardedRef) return

    if (typeof forwardedRef === 'function') {
      forwardedRef(inputRef.current)
    } else {
      forwardedRef.current = inputRef.current
    }
  }, [forwardedRef])

  const lastSelectedRef = useRef<UserRef | null>(value)

  const [inputValue, setInputValue] = useState(
    value ? getDisplayName(value) : ''
  )
  const [debouncedInput, setDebouncedInput] = useState(inputValue)

  useEffect(() => {
    lastSelectedRef.current = value
  }, [value])

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedInput(inputValue)
    }, FILTER_DELAY_MS)

    return () => {
      window.clearTimeout(id)
    }
  }, [inputValue])

  const filteredOptions = useMemo(() => {
    if (!debouncedInput) {
      return users.slice(0, MAX_RESULTS)
    }

    const query = debouncedInput.toLowerCase()
    const result: UserRef[] = []

    for (const user of users) {
      const label = getDisplayName(user).toLowerCase()

      if (label.includes(query)) {
        result.push(user)
        if (result.length >= MAX_RESULTS) {
          break
        }
      }
    }

    return result
  }, [users, debouncedInput])

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  const {
    isOpen,
    highlightedIndex,
    getInputProps,
    getItemProps,
    getMenuProps,
    getLabelProps,
  } = useCombobox<UserRef>({
    items: filteredOptions,
    selectedItem: value,
    inputValue,
    itemToString: item => (item ? getDisplayName(item) : ''),
    defaultHighlightedIndex: 0,

    onInputValueChange: ({ inputValue }) => {
      setInputValue(inputValue ?? '')
    },

    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem) {
        lastSelectedRef.current = selectedItem
        onChange(selectedItem)
        setInputValue(getDisplayName(selectedItem))
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
              placeholder: t('select_a_new_owner_for_projects'),
              onBlur: () => {
                const last = lastSelectedRef.current
                if (last) {
                  setInputValue(getDisplayName(last))
                } else {
                  setInputValue('')
                  onChange(null)
                }
              },
              onKeyDown: e => {
                if (e.key === 'Enter' && highlightedIndex === -1) {
                  e.preventDefault()
                }
              },
            })}
          />
        </div>

        <ul
          {...getMenuProps()}
          className={classnames(
            'dropdown-menu select-dropdown-menu w-100',
            { show: isOpen }
          )}
        >
          {isOpen && filteredOptions.length === 0 && (
            <li className="dropdown-item text-muted">
              {t('No results')}
            </li>
          )}

          {isOpen &&
            filteredOptions.map((item, index) => (
              <li
                key={item.id}
                {...getItemProps({ item, index })}
              >
                <DropdownItem
                  as="span"
                  role={undefined}
                  leadingIcon="person"
                  className={classnames({
                    active: index === highlightedIndex,
                  })}
                >
                  {getDisplayName(item)}
                </DropdownItem>
              </li>
            ))}
        </ul>
      </div>
    </div>
  )
})

export default SelectOwnerForm
