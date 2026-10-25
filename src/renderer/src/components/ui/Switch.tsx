import { cx } from '@renderer/lib/cx'

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('switch', checked && 'is-on')}
      data-nav=""
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" />
    </button>
  )
}
