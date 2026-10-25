import { useEffect, useRef, useState } from 'react'
import type { Game } from '@shared/types'
import { cx } from '@renderer/lib/cx'
import { animateScroll, scrollBehavior } from '@renderer/lib/motion'
import { IconButton } from '@renderer/components/ui/Button'
import { preloadImage } from './Backdrop'
import { GameTile } from './GameTile'

export interface GameRowProps {
  title: string
  games: Game[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  className?: string
}

/** A titled horizontal shelf of cover tiles. */
export function GameRow({ title, games, selectedId, onSelect, onOpen, className }: GameRowProps) {
  const track = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const element = track.current
    if (!element) return
    const measure = (): void => setOverflowing(element.scrollWidth > element.clientWidth + 4)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [games.length])

  const rowHasSelection = games.some((game) => game.id === selectedId)

  // Console-style anchoring: the selected tile glides to the left margin, so the hero text, the tile and
  // its label all line up. Positions come from nominal widths, so the result is exact even while the
  // selected tile is still growing.
  useEffect(() => {
    const element = track.current
    if (!element || !probe.current || !rowHasSelection) return
    const index = games.findIndex((game) => game.id === selectedId)
    if (index < 0) return
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0
    const target = Math.max(0, index * (probe.current.getBoundingClientRect().width + gap))
    animateScroll(element, { left: target }, placed.current ? 380 : 0)
    placed.current = true
    // Warm up the neighbours' artwork so the next move crossfades straight away.
    const warm = window.setTimeout(() => {
      for (const neighbour of [games[index + 1], games[index - 1]]) if (neighbour) void preloadImage(neighbour.backgroundUrl)
    }, 150)
    return () => window.clearTimeout(warm)
  }, [selectedId, rowHasSelection, games])

  const page = (direction: 1 | -1): void => {
    const element = track.current
    element?.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: scrollBehavior() })
  }

  return (
    <section className={cx('row', rowHasSelection && 'is-active', className)} aria-label={title}>
      <header className="row__head">
        <h2 className="row__title">{title}</h2>
        <span className="row__count">{games.length}</span>
        {overflowing && (
          <div className="row__pager">
            <IconButton icon="chevronLeft" label={`Scroll ${title} left`} nav={false} onClick={() => page(-1)} />
            <IconButton icon="chevronRight" label={`Scroll ${title} right`} nav={false} onClick={() => page(1)} />
          </div>
        )}
      </header>
      <div className="row__track" ref={track}>
        <span className="row__probe" ref={probe} aria-hidden="true" />
        {games.map((game, index) => {
          const selected = game.id === selectedId
          return (
            <GameTile
              key={game.id}
              game={game}
              selected={selected}
              tabbable={selected || (!rowHasSelection && index === 0)}
              onSelect={() => onSelect(game.id)}
              onOpen={() => onOpen(game.id)}
            />
          )
        })}
      </div>
    </section>
  )
}
