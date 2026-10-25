import { Icon } from './Icon'

export interface SelectOption {
  value: string
  label: string
}

/** A styled native <select>: keyboard, screen-reader and OS-popup behaviour for free. */
export function Select({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
}) {
  return (
    <label className="select">
      <span className="select__label">{label}</span>
      <span className="select__box">
        <select data-nav="" value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={16} />
      </span>
    </label>
  )
}
