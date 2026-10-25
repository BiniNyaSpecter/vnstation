import { playSound } from '@renderer/lib/sound'
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
  entryPoint = false,
  onChange
}: {
  label: string
  value: string
  options: SelectOption[]
  entryPoint?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="select">
      <span className="select__label">{label}</span>
      <span className="select__box">
        <select
          data-nav=""
          data-nav-default={entryPoint ? '' : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && options.length > 0) {
              event.preventDefault()
              const currentIndex = options.findIndex((option) => option.value === value)
              const nextIndex = (currentIndex + 1) % options.length
              playSound('select')
              onChange(options[nextIndex].value)
            }
          }}
        >
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
