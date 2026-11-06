import { Fragment } from 'react'
import classnames from 'classnames'
import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import {
  OLDropdown,
  OLDropdownDivider,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'

export type FilterOption = {
  value: string
  label: string
  count?: number
  // what the option means, shown when hovering a question mark beside it
  help?: string
  indented?: boolean
  separated?: boolean
}

// A Status filter: All, the statuses it adds up indented under it, and apart
// from them the deleted ones, which All does not count
export function statusOptionLayout(value: string) {
  return {
    indented: value !== 'all' && value !== 'deleted',
    separated: value === 'deleted',
  }
}

// core's dropdown with the toggle of the share modal's permission dropdowns
// (edit-member.tsx): a ghost button, no default caret, keyboard_arrow_down
function FilterDropdown({
  id,
  toggleText,
  active = false,
  options,
  value,
  onChange,
  align,
  drop,
  size,
}: {
  size?: 'sm'
  id: string
  toggleText: string
  active?: boolean
  options: FilterOption[]
  value: string
  onChange: (value: string) => void
  align?: 'start' | 'end'
  drop?: 'up' | 'down'
}) {
  return (
    <OLDropdown className="admin-panel-dropdown" align={align} drop={drop}>
      <OLDropdownToggle
        id={id}
        variant="ghost"
        size={size}
        className={classnames(
          'd-flex align-items-center gap-1 no-default-caret admin-panel-dropdown-toggle',
          { active }
        )}
      >
        <span>{toggleText}</span>
        <MaterialIcon type="keyboard_arrow_down" />
      </OLDropdownToggle>
      {/* as in core's group members table (members-table/dropdown-button.tsx):
          fixed, so the table panel's overflow does not cut the menu off */}
      <OLDropdownMenu flip renderOnMount popperConfig={{ strategy: 'fixed' }}>
        {options.map(option => (
          <Fragment key={option.value}>
            {option.separated && <OLDropdownDivider />}
            <OLDropdownItem
              as="button"
              className={classnames({
                'admin-panel-filter-indented': option.indented,
              })}
              active={option.value === value}
              aria-current={option.value === value}
              leadingIcon={
                option.value === value ? (
                  'check'
                ) : (
                  <OLDropdownItem.EmptyLeadingIcon />
                )
              }
              trailingIcon={
                option.count === undefined ? undefined : (
                  <span className="admin-panel-filter-count">
                    {option.count}
                  </span>
                )
              }
              onClick={() => onChange(option.value)}
            >
              {option.label}
              {option.help && (
                // core's help icon (figure-modal-options.tsx)
                <OLTooltip
                  id={`${id}-${option.value}-help`}
                  description={option.help}
                  overlayProps={{ delay: 0, placement: 'right' }}
                >
                  <span className="ms-1">
                    <MaterialIcon type="help" className="align-text-bottom" />
                  </span>
                </OLTooltip>
              )}
            </OLDropdownItem>
          </Fragment>
        ))}
      </OLDropdownMenu>
    </OLDropdown>
  )
}

export default FilterDropdown
