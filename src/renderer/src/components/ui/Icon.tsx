import type { ReactNode } from 'react'
import { cx } from '@renderer/lib/cx'

export type IconName =
  | 'home' | 'library' | 'recent' | 'heart' | 'heartFilled' | 'collections' | 'settings' | 'search'
  | 'plus' | 'play' | 'info' | 'more' | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'close'
  | 'grid' | 'shelf' | 'check' | 'alert' | 'panel' | 'folder' | 'copy' | 'trash' | 'arrowLeft' | 'mark' | 'edit'

const ICONS: Record<IconName, ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" />,
  library: (
    <>
      <path d="M4 4h7v7H4z" />
      <path d="M13 4h7v7h-7z" />
      <path d="M4 13h7v7H4z" />
      <path d="M13 13h7v7h-7z" />
    </>
  ),
  recent: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  heart: <path d="M12 19.5s-7-4.4-7-9.7a4 4 0 0 1 7-2.5 4 4 0 0 1 7 2.5c0 5.3-7 9.7-7 9.7z" />,
  heartFilled: <path d="M12 19.5s-7-4.4-7-9.7a4 4 0 0 1 7-2.5 4 4 0 0 1 7 2.5c0 5.3-7 9.7-7 9.7z" fill="currentColor" />,
  collections: (
    <>
      <path d="m12 4 8 4-8 4-8-4z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M18 7h2M4 17h2M11 17h9" />
      <circle cx="15.5" cy="7" r="2.3" />
      <circle cx="8.5" cy="17" r="2.3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.9v.1" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  grid: (
    <>
      <path d="M4 4h7v7H4z" />
      <path d="M13 4h7v7h-7z" />
      <path d="M4 13h7v7H4z" />
      <path d="M13 13h7v7h-7z" />
    </>
  ),
  shelf: (
    <>
      <path d="M3 8h5v8H3z" />
      <path d="M10 6h5v12h-5z" />
      <path d="M17 8h4v8h-4z" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 4 3 19h18z" />
      <path d="M12 10v4M12 16.6v.1" />
    </>
  ),
  panel: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M9 5v14" />
    </>
  ),
  folder: <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  copy: (
    <>
      <path d="M9 9h10v11H9z" />
      <path d="M5 15V4h10" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M10 7V4.5h4V7" />
      <path d="m6.5 7 1 13h9l1-13" />
    </>
  ),
  arrowLeft: <path d="M19 12H5m6-6-6 6 6 6" />,
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  mark: <path d="M7 4h10v16l-5-3.6L7 20z" fill="currentColor" />
}

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={cx('icon', className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}
