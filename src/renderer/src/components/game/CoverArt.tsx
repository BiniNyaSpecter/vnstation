import { useState } from 'react'
import { cx } from '@renderer/lib/cx'

/**
 * Lazy-loaded cover image. If the source is missing or unreadable (moved file,
 * corrupt download) it swaps to the generated fallback instead of showing a
 * broken-image icon.
 */
export function CoverArt({ src, fallback, className }: { src: string; fallback: string; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  return (
    <img
      className={cx('cover', className)}
      src={failedSrc === src ? fallback : src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  )
}
