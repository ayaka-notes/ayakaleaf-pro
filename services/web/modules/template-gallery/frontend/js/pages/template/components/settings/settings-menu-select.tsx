import { ChangeEventHandler, useCallback, useRef, useEffect } from 'react'
import OLFormSelect from '@/shared/components/ol/ol-form-select'

type PossibleValue = string | number | boolean

export type Option<T extends PossibleValue = string> = {
  value: T
  label: string
  ariaHidden?: 'true' | 'false'
  disabled?: boolean
}

export type Optgroup<T extends PossibleValue = string> = {
  label: string
  options: Array<Option<T>>
}

type SettingsMenuSelectProps<T extends PossibleValue = string> = {
  name: string
  options: Array<Option<T>>
  optgroup?: Optgroup<T>
  onChange: (val: T) => void
  value?: T
  disabled?: boolean
}

export default function SettingsMenuSelect<T extends PossibleValue = string>(
  props: SettingsMenuSelectProps<T>
) {

 const { name, options, optgroup, onChange, value, disabled = false } = props
 const defaultApplied = useRef(false)

  useEffect(() => {
    if (value === undefined || value === null) {
      onChange(options?.[0]?.value || optgroup?.options?.[0]?.value)
    }
  }, [value, options, onChange])

  const handleChange: ChangeEventHandler<HTMLSelectElement> = useCallback(
    event => {
      const selectedValue = event.target.value
      let onChangeValue: PossibleValue = selectedValue
      if (typeof value === 'boolean') {
        onChangeValue = selectedValue === 'true'
      } else if (typeof value === 'number') {
        onChangeValue = parseInt(selectedValue, 10)
      }
      onChange(onChangeValue as T)
    },
    [onChange, value]
  )
  const selectRef = useRef<HTMLSelectElement | null>(null)

  return (
    <>

        <OLFormSelect
          onChange={handleChange}
          value={value?.toString()}
          disabled={disabled}
          ref={selectRef}
        >
          {options.map(option => (
            <option
              key={`${name}-${option.value}`}
              value={option.value.toString()}
              aria-hidden={option.ariaHidden}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
          {optgroup ? (
            <optgroup label={optgroup.label}>
              {optgroup.options.map(option => (
                <option
                  value={option.value.toString()}
                  key={option.value.toString()}
                >
                  {option.label}
                </option>
              ))}
            </optgroup>
          ) : null}
        </OLFormSelect>
    </>
  )
}
