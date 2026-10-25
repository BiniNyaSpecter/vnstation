import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClassificationOverride, SteamCatalogItem, SteamStatus, VnClassification } from '@shared/steam'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Dialog, DialogActions, DialogBody } from '@renderer/components/ui/Dialog'
import { cx } from '@renderer/lib/cx'
import { formatPlaytime, formatRelativeDate } from '@renderer/lib/format'
import { playSound } from '@renderer/lib/sound'
import { services } from '@renderer/services'
import { bridge } from '@renderer/services/bridge'
import { useAppStore } from '@renderer/state/appStore'

export function SteamSection() {
  const showToast = useAppStore((state) => state.showToast)
  const reloadLibrary = useAppStore((state) => state.reloadLibrary)
  const allowAdult = useAppStore((state) => state.prefs.showRestricted && state.prefs.adultConfirmed)

  const [status, setStatus] = useState<SteamStatus | null>(null)
  const [busy, setBusy] = useState<'connecting' | 'syncing' | 'disconnecting' | 'cleaning' | null>(null)
  const [showConfigForm, setShowConfigForm] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)

  // Form state
  const [steamIdInput, setSteamIdInput] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [localPathInput, setLocalPathInput] = useState('')

  const refreshStatus = useCallback(async () => {
    try {
      const next = await services.steam.getStatus()
      setStatus(next)
      setSteamIdInput((prev) => prev || next.steamId || '')
      setLocalPathInput((prev) => prev || next.localSteamPath || next.detectedSteamPath || '')
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleConnectApi = async () => {
    setBusy('connecting')
    try {
      const next = await services.steam.connect({
        mode: 'api',
        steamIdOrVanity: steamIdInput,
        apiKey: apiKeyInput || undefined
      })
      setStatus(next)
      setApiKeyInput('')
      setShowConfigForm(false)
      showToast(`Connected to Steam profile “${next.personaName ?? next.steamId}”.`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not connect to Steam Web API.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleConnectLocal = async (pathOverride?: string) => {
    setBusy('connecting')
    try {
      const next = await services.steam.connect({
        mode: 'local',
        localSteamPath: pathOverride ?? localPathInput
      })
      setStatus(next)
      setLocalPathInput(next.localSteamPath ?? '')
      setShowConfigForm(false)
      showToast('Connected local Steam installation folder.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not use that Steam folder.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleBrowseSteamFolder = async () => {
    if (!bridge) return
    const picked = await bridge.dialogs.pickFolder()
    if (picked.status === 'picked') {
      setLocalPathInput(picked.path)
    } else if (picked.status === 'invalid') {
      showToast(picked.message, 'error')
    }
  }

  const handleSync = async () => {
    setBusy('syncing')
    try {
      const summary = await services.steam.sync({ allowAdult })
      await reloadLibrary()
      await refreshStatus()
      const parts: string[] = [
        `${summary.importedVnCount} new VN${summary.importedVnCount === 1 ? '' : 's'} imported`,
        `${summary.updatedVnCount} updated`
      ]
      if (summary.reviewCount > 0) parts.push(`${summary.reviewCount} in review queue`)
      if (summary.excludedCount > 0) parts.push(`${summary.excludedCount} non-VN skipped`)
      showToast(`Steam sync complete: ${parts.join(', ')}.`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Steam synchronization failed.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleDisconnect = async () => {
    setBusy('disconnecting')
    try {
      const next = await services.steam.disconnect()
      setStatus(next)
      setApiKeyInput('')
      showToast('Disconnected from Steam. Already imported games stay in your library.', 'info')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not disconnect Steam.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleCleanupUnavailable = async () => {
    setBusy('cleaning')
    try {
      const removed = await services.steam.cleanupUnavailable()
      await reloadLibrary()
      await refreshStatus()
      showToast(
        removed === 0
          ? 'No unavailable Steam entries needed cleanup.'
          : `Removed ${removed} unavailable Steam ${removed === 1 ? 'entry' : 'entries'} from your library.`,
        'success'
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not clean up unavailable entries.', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!bridge) {
    return (
      <section className="settings__section">
        <h2 className="section-title">Integrations · Steam</h2>
        <div className="settings__panel">
          <div className="setting">
            <div className="setting__text">
              <div className="setting__label">Steam library integration</div>
              <div className="setting__description">Available in the desktop app.</div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const connected = Boolean(status?.connected)
  const counts = status?.catalogCounts ?? { total: 0, vn: 0, review: 0, excluded: 0, unavailable: 0 }

  return (
    <section className="settings__section">
      <h2 className="section-title">Integrations · Steam</h2>
      <div className="settings__panel">
        <div className="setting">
          <div className="setting__text">
            <div className="setting__label">
              Steam connection status{' '}
              <Badge tone={connected ? 'accent' : 'soft'}>
                {connected
                  ? status?.mode === 'both'
                    ? 'Web API + Local Folder'
                    : status?.mode === 'api'
                      ? 'Steam Web API'
                      : 'Local Steam Folder'
                  : 'Not connected'}
              </Badge>
            </div>
            <div className="setting__description">
              {connected ? (
                <div className="steam-status-meta">
                  {status?.personaName && (
                    <div>
                      Account: <strong>{status.personaName}</strong> ({status.steamId})
                    </div>
                  )}
                  {status?.localSteamPath && (
                    <div>
                      Local folder: <span className="path">{status.localSteamPath}</span>
                    </div>
                  )}
                  <div>
                    Last synced: {status?.lastSyncedAt ? formatRelativeDate(status.lastSyncedAt) : 'Not synced yet'}
                  </div>
                </div>
              ) : (
                'Import only Visual Novels from your Steam library using the official Steam Web API or by scanning your local Steam installation.'
              )}
            </div>
          </div>
          <div className="setting__control">
            {connected && (
              <Button
                variant="primary"
                size="md"
                disabled={busy !== null}
                onClick={() => void handleSync()}
              >
                {busy === 'syncing' ? 'Synchronizing…' : 'Synchronize library'}
              </Button>
            )}
            <Button
              size="md"
              disabled={busy !== null}
              onClick={() => setShowConfigForm((v) => !v)}
            >
              {connected ? (showConfigForm ? 'Hide setup' : 'Configure') : (showConfigForm ? 'Hide setup' : 'Connect Steam')}
            </Button>
            {connected && (
              <Button
                size="md"
                disabled={busy !== null}
                onClick={() => void handleDisconnect()}
              >
                Disconnect
              </Button>
            )}
          </div>
        </div>

        {counts.total > 0 && (
          <div className="setting">
            <div className="setting__text">
              <div className="setting__label">Visual Novel classification & review queue</div>
              <div className="setting__description">
                {counts.vn} confirmed Visual {counts.vn === 1 ? 'Novel' : 'Novels'} imported ·{' '}
                {counts.review} uncertain {counts.review === 1 ? 'match' : 'matches'} in review queue ·{' '}
                {counts.excluded} non-VN Steam {counts.excluded === 1 ? 'game' : 'games'} excluded.
              </div>
            </div>
            <div className="setting__control">
              <Button onClick={() => setCatalogOpen(true)}>
                {counts.review > 0 ? `Review queue (${counts.review})` : `Manage catalog (${counts.total})`}
              </Button>
              {counts.unavailable > 0 && (
                <Button disabled={busy !== null} onClick={() => void handleCleanupUnavailable()}>
                  Clean up unavailable ({counts.unavailable})
                </Button>
              )}
            </div>
          </div>
        )}

        {showConfigForm && (
          <div className="steam-setup">
            <div className="steam-setup__card">
              <h3 className="steam-setup__title">Option A · Steam Web API (Owned games & playtime)</h3>
              <p className="steam-setup__desc">
                Reads your public owned games list and total playtime from Steam. Requires a 17-digit SteamID64 (or custom profile URL)
                and a personal Steam Web API key from <code>steamcommunity.com/dev/apikey</code>. Your API key is encrypted by the OS and
                never leaves this computer. Set <strong>Game details</strong> to <strong>Public</strong> in your Steam privacy settings.
              </p>
              <div className="steam-setup__fields">
                <label className="field">
                  <span className="field__label">SteamID64 or Profile URL</span>
                  <input
                    type="text"
                    className="input"
                    data-nav=""
                    placeholder="76561198000000000 or https://steamcommunity.com/id/yourname"
                    value={steamIdInput}
                    onChange={(e) => setSteamIdInput(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">
                    Steam Web API key {status?.hasApiKey ? '(stored securely — leave blank to keep existing key)' : ''}
                  </span>
                  <input
                    type="password"
                    className="input"
                    data-nav=""
                    autoComplete="off"
                    placeholder={status?.hasApiKey ? '••••••••••••••••••••••••••••••••' : '32-character hexadecimal key'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                </label>
              </div>
              <div className="steam-setup__actions">
                <Button
                  variant="primary"
                  disabled={busy !== null}
                  onClick={() => void handleConnectApi()}
                >
                  {busy === 'connecting' ? 'Connecting…' : 'Save & connect Web API'}
                </Button>
              </div>
            </div>

            <div className="steam-setup__card">
              <h3 className="steam-setup__title">Option B · Local Steam installation (Installed games, no API key needed)</h3>
              <p className="steam-setup__desc">
                Scans <code>steamapps/libraryfolders.vdf</code> and <code>appmanifest_*.acf</code> across your local Steam library folders.
                Works with private profiles and without an API key, importing only installed games matched as Visual Novels on VNDB.
              </p>
              <div className="steam-setup__fields">
                <label className="field">
                  <span className="field__label">Steam installation folder</span>
                  <div className="steam-setup__path-row">
                    <input
                      type="text"
                      className="input"
                      data-nav=""
                      placeholder="C:\Program Files (x86)\Steam"
                      value={localPathInput}
                      onChange={(e) => setLocalPathInput(e.target.value)}
                    />
                    <Button onClick={() => void handleBrowseSteamFolder()}>Browse…</Button>
                  </div>
                </label>
              </div>
              <div className="steam-setup__actions">
                <Button
                  variant="primary"
                  disabled={busy !== null}
                  onClick={() => void handleConnectLocal()}
                >
                  {busy === 'connecting' ? 'Scanning…' : 'Use local Steam folder'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {catalogOpen && (
        <SteamCatalogDialog
          allowAdult={allowAdult}
          onClose={() => setCatalogOpen(false)}
          onChanged={async () => {
            await reloadLibrary()
            await refreshStatus()
          }}
        />
      )}
    </section>
  )
}

function SteamCatalogDialog({
  allowAdult,
  onClose,
  onChanged
}: {
  allowAdult: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const showToast = useAppStore((state) => state.showToast)
  const [items, setItems] = useState<SteamCatalogItem[]>([])
  const [tab, setTab] = useState<'all' | VnClassification>('review')
  const [filterText, setFilterText] = useState('')
  const [busyAppId, setBusyAppId] = useState<number | null>(null)

  const loadCatalog = useCallback(async () => {
    try {
      const list = await services.steam.listCatalog()
      setItems(list)
      if (list.some((i) => i.classification === 'review')) {
        setTab((prev) => (prev === 'review' ? 'review' : prev))
      } else {
        setTab((prev) => (prev === 'review' ? 'all' : prev))
      }
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const counts = useMemo(
    () => ({
      all: items.length,
      review: items.filter((i) => i.classification === 'review').length,
      vn: items.filter((i) => i.classification === 'vn').length,
      excluded: items.filter((i) => i.classification === 'excluded').length
    }),
    [items]
  )

  const filtered = useMemo(() => {
    const query = filterText.trim().toLowerCase()
    return items.filter((item) => {
      if (tab !== 'all' && item.classification !== tab) return false
      if (!query) return true
      return (
        item.name.toLowerCase().includes(query) ||
        String(item.steamAppId).includes(query) ||
        (item.vndbTitle && item.vndbTitle.toLowerCase().includes(query))
      )
    })
  }, [items, tab, filterText])

  const handleOverride = async (steamAppId: number, override: ClassificationOverride) => {
    setBusyAppId(steamAppId)
    try {
      const updated = await services.steam.setClassificationOverride(steamAppId, override, { allowAdult })
      setItems((prev) => prev.map((item) => (item.steamAppId === steamAppId ? updated : item)))
      await onChanged()
      showToast(
        override === 'include'
          ? `Included “${updated.name}” in your Visual Novel library.`
          : override === 'exclude'
            ? `Excluded “${updated.name}” from your Visual Novel library.`
            : `Reset “${updated.name}” to automatic classification.`,
        'success'
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update classification.', 'error')
    } finally {
      setBusyAppId(null)
    }
  }

  const handleLinkVndb = async (steamAppId: number, externalId: string) => {
    setBusyAppId(steamAppId)
    try {
      const updated = await services.steam.linkCatalogVndb(steamAppId, externalId, { allowAdult })
      setItems((prev) => prev.map((item) => (item.steamAppId === steamAppId ? updated : item)))
      await onChanged()
      showToast(`Linked “${updated.name}” to VNDB (${externalId}) and added to your library.`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not link VNDB entry.', 'error')
    } finally {
      setBusyAppId(null)
    }
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Steam Catalog & Visual Novel Classification"
      description="Non-VN Steam games stay excluded from your library automatically. You can review uncertain matches or override any game below."
    >
      <DialogBody>
        <div className="steam-catalog">
          <div className="steam-catalog__bar">
            <div className="chars__roles" role="tablist" aria-label="Filter Steam catalog">
              {(
                [
                  ['review', 'Review queue', counts.review],
                  ['vn', 'Imported VNs', counts.vn],
                  ['excluded', 'Excluded non-VNs', counts.excluded],
                  ['all', 'All evaluated', counts.all]
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={cx('chip-btn', tab === key && 'is-active')}
                  data-nav=""
                  onClick={() => {
                    playSound('select')
                    setTab(key)
                  }}
                >
                  <span>{label}</span>
                  <span className="chip-btn__count">{count}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              className="input steam-catalog__search"
              placeholder="Filter by title or AppID…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>

          {filtered.length === 0 ? (
            <p className="steam-catalog__empty">No Steam entries match this filter.</p>
          ) : (
            <div className="steam-catalog__list">
              {filtered.map((item) => {
                const isBusy = busyAppId === item.steamAppId
                return (
                  <div key={item.steamAppId} className="steam-catalog__item">
                    <div className="steam-catalog__info">
                      <div className="steam-catalog__title-row">
                        <strong className="steam-catalog__name">{item.name}</strong>
                        <Badge
                          tone={
                            item.classification === 'vn'
                              ? 'accent'
                              : 'soft'
                          }
                        >
                          {item.classification === 'vn'
                            ? 'Visual Novel'
                            : item.classification === 'review'
                              ? 'Needs Review'
                              : 'Excluded'}
                        </Badge>
                        {item.manualOverride && <Badge>Manual override</Badge>}
                        {!item.available && <Badge>Unavailable</Badge>}
                      </div>
                      <div className="steam-catalog__sub">
                        AppID {item.steamAppId} · {item.source === 'steam-api' ? 'Steam Web API' : 'Local install'} ·{' '}
                        {item.installed ? 'Installed' : 'Not installed'} · {formatPlaytime(item.playtimeMinutes)} ·{' '}
                        {item.reason}
                        {item.vndbId ? ` (VNDB ${item.vndbId}${item.vndbTitle ? `: ${item.vndbTitle}` : ''})` : ''}
                      </div>

                      {item.candidateMatches.length > 0 && item.classification !== 'excluded' && (
                        <div className="steam-catalog__candidates">
                          <span className="steam-catalog__cand-label">VNDB candidates:</span>
                          {item.candidateMatches.map((cand) => (
                            <button
                              key={cand.id}
                              type="button"
                              className={cx('chip-btn', item.vndbId === cand.id && 'is-active')}
                              disabled={isBusy}
                              data-nav=""
                              onClick={() => void handleLinkVndb(item.steamAppId, cand.id)}
                            >
                              {cand.title} ({cand.id})
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="steam-catalog__actions">
                      {item.classification !== 'vn' && (
                        <Button
                          size="md"
                          variant="primary"
                          disabled={isBusy}
                          onClick={() => void handleOverride(item.steamAppId, 'include')}
                        >
                          Include as VN
                        </Button>
                      )}
                      {item.classification !== 'excluded' && (
                        <Button
                          size="md"
                          disabled={isBusy}
                          onClick={() => void handleOverride(item.steamAppId, 'exclude')}
                        >
                          Exclude
                        </Button>
                      )}
                      {item.manualOverride !== null && (
                        <Button
                          size="md"
                          disabled={isBusy}
                          onClick={() => void handleOverride(item.steamAppId, null)}
                        >
                          Reset to auto
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogBody>
      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
