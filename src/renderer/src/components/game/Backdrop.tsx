import { useEffect, useState } from 'react'
import type { Game } from '@shared/types'
import { cx } from '@renderer/lib/cx'
import { reducedMotion } from '@renderer/lib/motion'

type BackdropGame = Pick<Game, 'backgroundUrl' | 'backgroundFallbackUrl'>

interface Layer {
  key: number
  src: string
  /** Fixed when the layer is created, so a layer never changes class (and jumps) mid-fade. */
  enter: boolean
}

/**
 * Keeps decoded HTMLImageElement instances pinned in memory so Blink never evicts
 * their decoded bitmap textures when switching tabs or when the window is occluded
 * (Alt+Tab) and restored.
 */
const decodedImages = new Map<string, HTMLImageElement>()
const DECODED_LIMIT = 36

export function preloadImage(src: string): Promise<boolean> {
  if (!src) return Promise.resolve(false)
  if (decodedImages.has(src)) return Promise.resolve(true)
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  return image.decode().then(
    () => {
      if (decodedImages.size >= DECODED_LIMIT) {
        const oldest = decodedImages.keys().next().value
        if (oldest !== undefined) decodedImages.delete(oldest)
      }
      decodedImages.set(src, image)
      return true
    },
    () => false
  )
}

/**
 * Full-bleed artwork behind the content. Mounted once in `AppShell` so switching
 * tabs never unmounts and reloads the background image. When the selected game
 * changes, the new image is decoded in memory first, then fades in on top of the
 * current one; the layers beneath are dropped once it is fully opaque.
 */
export function Backdrop({
  game,
  drift = false,
  dimmed = false,
  hidden = false
}: {
  game?: BackdropGame | null
  drift?: boolean
  dimmed?: boolean
  hidden?: boolean
}) {
  const backgroundUrl = game?.backgroundUrl ?? ''
  const backgroundFallbackUrl = game?.backgroundFallbackUrl ?? ''
  const [layers, setLayers] = useState<Layer[]>(() => {
    if (backgroundUrl) void preloadImage(backgroundUrl)
    return backgroundUrl ? [{ key: 0, src: backgroundUrl, enter: false }] : []
  })

  useEffect(() => {
    if (!backgroundUrl) return
    let cancelled = false
    const show = (src: string): void => {
      if (cancelled) return
      setLayers((current) => {
        if (current.length === 0) return [{ key: 0, src, enter: false }]
        const top = current[current.length - 1]
        if (top.src === src) return current
        if (reducedMotion()) return [{ key: top.key + 1, src, enter: false }]
        // At most two older layers stay underneath, however fast the selection moves.
        return [...current.slice(-2), { key: top.key + 1, src, enter: true }]
      })
    }
    void preloadImage(backgroundUrl).then(async (ok) => {
      if (ok) return show(backgroundUrl)
      if (backgroundFallbackUrl) {
        await preloadImage(backgroundFallbackUrl)
        show(backgroundFallbackUrl)
      }
    })
    return () => {
      cancelled = true
    }
  }, [backgroundUrl, backgroundFallbackUrl])

  const settle = (key: number): void => setLayers((current) => current.filter((layer) => layer.key >= key))

  return (
    <div
      className={cx(
        'backdrop',
        drift && 'backdrop--drift',
        dimmed && 'backdrop--dim',
        hidden && 'is-hidden'
      )}
      aria-hidden="true"
    >
      <div className="backdrop__layers">
        {layers.map((layer) => (
          <BackdropImage
            key={layer.key}
            src={layer.src}
            fallback={backgroundFallbackUrl}
            enter={layer.enter}
            onEntered={() => settle(layer.key)}
          />
        ))}
      </div>
      <div className="backdrop__scrim" />
    </div>
  )
}

function BackdropImage({ src, fallback, enter, onEntered }: { src: string; fallback: string; enter: boolean; onEntered: () => void }) {
  const [failed, setFailed] = useState(false)
  return (
    <img
      className={enter ? 'backdrop__img backdrop__img--in' : 'backdrop__img'}
      src={failed ? fallback : src}
      alt=""
      decoding="sync"
      draggable={false}
      onError={() => setFailed(true)}
      onAnimationEnd={(event) => {
        if (event.animationName === 'backdrop-in') onEntered()
      }}
    />
  )
}
