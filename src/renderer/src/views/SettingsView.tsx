import { useEffect, useState, type ReactNode } from 'react'
import type { AccentId, GamepadConfirm, MotionMode, NavLayout, SortKey, ThemeId, TitleFont } from '@shared/types'
import { SteamSection } from '@renderer/components/settings/SteamSection'
import { Button } from '@renderer/components/ui/Button'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { cx } from '@renderer/lib/cx'
import { formatBytes } from '@renderer/lib/format'
import { playSound } from '@renderer/lib/sound'
import { ACCENTS, THEMES } from '@renderer/lib/prefs'
import { SORT_OPTIONS } from '@renderer/lib/query'
import { services } from '@renderer/services'
import { useAppStore } from '@renderer/state/appStore'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings__section">
      <h2 className="section-title">{title}</h2>
      <div className="settings__panel">{children}</div>
    </section>
  )
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {description && <div className="setting__description">{description}</div>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  )
}

export function SettingsView() {
  const prefs = useAppStore((state) => state.prefs)
  const setPref = useAppStore((state) => state.setPref)
  const info = useAppStore((state) => state.appInfo)
  const gamepadName = useAppStore((state) => state.gamepadName)
  const hasSamples = useAppStore((state) => state.games.some((game) => game.isSample))
  const addSampleGames = useAppStore((state) => state.addSampleGames)
  const removeSampleGames = useAppStore((state) => state.removeSampleGames)
  const unavailable = 'Available in the desktop app'
  const openDialog = useAppStore((state) => state.openDialog)
  const updatePrefs = useAppStore((state) => state.updatePrefs)
  const osReducesMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <div className="lib settings">
      <div className="lib__scroll" data-scroll-y="">
        <header className="lib__head">
          <div className="lib__heading">
            <h1 className="lib__title">Settings</h1>
          </div>
        </header>

        <Section title="Appearance">
          <Row label="Theme" description="Choose a dark console background or a warm paper theme for daytime reading.">
            <Select
              label="Theme"
              entryPoint
              value={prefs.theme}
              onChange={(value) => setPref('theme', value as ThemeId)}
              options={(Object.entries(THEMES) as Array<[ThemeId, { label: string }]>).map(([id, theme]) => ({
                value: id,
                label: theme.label
              }))}
            />
          </Row>
          <Row label="Accent color" description="Used for focus rings and highlights.">
            <div className="swatches" role="radiogroup" aria-label="Accent color">
              {(Object.entries(ACCENTS) as Array<[AccentId, { label: string; value: string }]>).map(([id, accent]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.accent === id}
                  aria-label={accent.label}
                  title={accent.label}
                  className={cx('swatch', prefs.accent === id && 'is-selected')}
                  style={{ backgroundColor: accent.value }}
                  data-nav=""
                  onClick={() => setPref('accent', id)}
                />
              ))}
            </div>
          </Row>
          <Row label="Navigation" description="A category bar across the top, like a PlayStation home screen, or a side rail.">
            <Select
              label="Navigation"
              value={prefs.navLayout}
              onChange={(value) => setPref('navLayout', value as NavLayout)}
              options={[{ value: 'top', label: 'Top bar' }, { value: 'rail', label: 'Side rail' }]}
            />
          </Row>
          {prefs.navLayout === 'rail' && (
            <Row label="Collapse side rail" description="Show only icons to leave more room for artwork.">
              <Switch label="Collapse side rail" checked={prefs.railCollapsed} onChange={(value) => setPref('railCollapsed', value)} />
            </Row>
          )}
          <Row label="Title style" description="Console uses a light, clean sans-serif. Literary uses a book-like serif.">
            <Select
              label="Title style"
              value={prefs.titleFont}
              onChange={(value) => setPref('titleFont', value as TitleFont)}
              options={[{ value: 'console', label: 'Console' }, { value: 'literary', label: 'Literary' }]}
            />
          </Row>
          <Row
            label="Motion"
            description={
              prefs.motion === 'system' && osReducesMotion
                ? 'Windows is asking apps to reduce motion (Settings, Accessibility, Visual effects, Animation effects), so nothing animates. Choose Full to animate anyway.'
                : 'Full uses every animation. Follow system obeys the Windows animation setting. Reduced turns them all off.'
            }
          >
            <Select
              label="Motion"
              value={prefs.motion}
              onChange={(value) => setPref('motion', value as MotionMode)}
              options={[
                { value: 'full', label: 'Full' },
                { value: 'system', label: 'Follow system' },
                { value: 'reduced', label: 'Reduced' }
              ]}
            />
          </Row>
        </Section>

        <Section title="Sound">
          <Row label="Interface sounds" description="Soft ticks and chimes as you move, select and go back, like a console home screen. They are generated by the app, with no audio files.">
            <Switch label="Interface sounds" checked={prefs.soundEnabled} onChange={(value) => setPref('soundEnabled', value)} />
          </Row>
          <Row label="Volume" description="Kept low by default. Drag to hear it.">
            <div className="range">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={prefs.soundVolume}
                disabled={!prefs.soundEnabled}
                aria-label="Interface sound volume"
                data-nav=""
                onChange={(event) => setPref('soundVolume', Number(event.target.value))}
                onPointerUp={() => playSound('select')}
                onKeyUp={() => playSound('move')}
              />
              <span className="range__value">{Math.round(prefs.soundVolume * 100)}%</span>
            </div>
          </Row>
        </Section>

        <Section title="Artwork">
          <Row label="Background artwork strength" description="Lower this if artwork competes with the text.">
            <div className="range">
              <input
                type="range"
                min={0.4}
                max={1}
                step={0.05}
                value={prefs.backdropStrength}
                aria-label="Background artwork strength"
                data-nav=""
                onChange={(event) => setPref('backdropStrength', Number(event.target.value))}
              />
              <span className="range__value">{Math.round(prefs.backdropStrength * 100)}%</span>
            </div>
          </Row>
        </Section>

        <Section title="Library">
          <Row label="Default sort order" description="Used on Home and in My library.">
            <Select label="Default sort order" value={prefs.defaultSort} onChange={(value) => setPref('defaultSort', value as SortKey)} options={SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }))} />
          </Row>
          <Row label="Show adults-only (18+) games" description="Hidden by default everywhere, including search, collections and Home. Turning this on asks you to confirm you are 18 or older. Their artwork and descriptions are then downloaded like any other game's.">
            <Switch
              label="Show adults-only (18+) games"
              checked={prefs.showRestricted}
              onChange={(value) => {
                if (!value) updatePrefs({ showRestricted: false })
                else if (prefs.adultConfirmed) updatePrefs({ showRestricted: true })
                else openDialog({ type: 'age-gate' })
              }}
            />
          </Row>
          <Row label="Sample games" description="Invented titles with generated artwork, for previewing the interface. They stay separate from your own games and can be removed at any time.">
            {hasSamples ? (
              <Button onClick={() => void removeSampleGames()}>Remove sample games</Button>
            ) : (
              <Button onClick={() => void addSampleGames()}>Add sample games</Button>
            )}
          </Row>
        </Section>

        <SteamSection />

        <Section title="Launching">
          <Row label="Minimize VNStation when a game starts" description="Gets the library window out of the way as soon as the executable launches.">
            <Switch
              label="Minimize VNStation when a game starts"
              checked={prefs.minimizeOnLaunch}
              onChange={(value) => setPref('minimizeOnLaunch', value)}
            />
          </Row>
          <Row label="Bring VNStation back when a game closes" description="Restores and focuses your library when the visual novel exits.">
            <Switch
              label="Bring VNStation back when a game closes"
              checked={prefs.restoreOnExit}
              onChange={(value) => setPref('restoreOnExit', value)}
            />
          </Row>
          <Row
            label="Playtime tracking"
            description="VNStation measures how long the launched executable runs. If a launcher closes and starts another executable in the same game folder, VNStation follows that process automatically. Launchers that hand off to an external app (such as Steam) only report the launcher’s open time."
          >
            <span />
          </Row>
        </Section>

        <Section title="Controller">
          <Row
            label="Controller navigation"
            description="Use a connected Xbox, PlayStation, Switch or XInput controller to browse your library. Automatically pauses while a game is in the foreground."
          >
            <Switch
              label="Controller navigation"
              checked={prefs.gamepadEnabled}
              onChange={(value) => setPref('gamepadEnabled', value)}
            />
          </Row>
          <Row
            label="Confirm button"
            description="Choose whether the bottom face button (A / Cross) or the right face button (B / Circle, Japanese console layout) selects items."
          >
            <Select
              label="Confirm button"
              value={prefs.gamepadConfirm}
              onChange={(value) => setPref('gamepadConfirm', value as GamepadConfirm)}
              options={[
                { value: 'south', label: 'A / Cross (bottom)' },
                { value: 'east', label: 'B / Circle (right)' }
              ]}
            />
          </Row>
          <Row label="Connected controller" description="Press any button on your controller to wake it up.">
            <span className="setting__value">{gamepadName ?? 'No controller detected'}</span>
          </Row>
        </Section>

        <Section title="Metadata">
          <Row label="Look up details on VNDB" description="Finds titles, descriptions and artwork for your games. Turn off to keep VNStation fully offline; your library works the same either way.">
            <Switch label="Look up details on VNDB" checked={prefs.metadataEnabled} onChange={(value) => setPref('metadataEnabled', value)} />
          </Row>
          <Row label="About this data" description="Information comes from VNDB (vndb.org) and is used under the Open Database License. Only the text you search for is sent. Games rated 18+ ask you to confirm your age first; full-screen backgrounds still skip screenshots VNDB flags as explicit or brutal.">
            <span />
          </Row>
        </Section>

        <Section title="Storage">
          <Row label="Library database" description="Your games, collections and settings are saved in this file. Nothing is written to your game folders.">
            <span className="path">{info?.databasePath ?? unavailable}</span>
          </Row>
          <ArtworkCacheRow />
        </Section>

        <Section title="About">
          <Row label="Version">{info ? `${info.name} ${info.version}${info.isPackaged ? '' : ' (development)'}` : unavailable}</Row>
          <Row label="Runtime">{info ? `Electron ${info.electron}, Chromium ${info.chrome}, Node ${info.node}` : unavailable}</Row>
          <Row label="Platform">{info ? `${info.platform} ${info.arch}` : unavailable}</Row>
        </Section>
      </div>
    </div>
  )
}

function ArtworkCacheRow() {
  const entries = useAppStore((state) => state.entries)
  const clear = useAppStore((state) => state.clearArtworkCache)
  const [stats, setStats] = useState<{ files: number; bytes: number } | null>(null)

  useEffect(() => {
    let live = true
    services.metadata.cacheStats().then(
      (result) => live && setStats(result),
      () => live && setStats(null)
    )
    return () => {
      live = false
    }
  }, [entries])

  return (
    <Row label="Artwork cache" description="Downloaded covers and backgrounds, kept on this computer so the library loads fast and works offline. Images you chose yourself are not included.">
      {stats ? (
        <>
          <span className="setting__value">{stats.files} {stats.files === 1 ? 'image' : 'images'} · {formatBytes(stats.bytes)}</span>
          <Button disabled={stats.files === 0} onClick={() => void clear()}>Clear cache</Button>
        </>
      ) : (
        <span>Available in the desktop app</span>
      )}
    </Row>
  )
}
