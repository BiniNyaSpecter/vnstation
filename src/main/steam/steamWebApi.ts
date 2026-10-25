import { UserFacingError } from '../errors'
import type { Fetcher } from '../metadata/http'

export const STEAM_API_BASE = 'https://api.steampowered.com'
const STEAM_ID64_REGEX = /^7656119\d{10}$/

export interface SecretCipher {
  encrypt(plainText: string): string
  decrypt(cipherText: string): string
}

/**
 * Default fallback cipher used only when OS keyring encryption (`safeStorage`) is
 * unavailable (e.g. headless CI/test runners). Production main process passes
 * Electron's `safeStorage` adapter.
 */
export const fallbackCipher: SecretCipher = {
  encrypt: (plainText: string) => `b64:${Buffer.from(plainText, 'utf8').toString('base64')}`,
  decrypt: (cipherText: string) => {
    if (cipherText.startsWith('b64:')) {
      return Buffer.from(cipherText.slice(4), 'base64').toString('utf8')
    }
    throw new Error('Unsupported secret encoding.')
  }
}

export interface SteamPlayerSummary {
  steamId: string
  personaName: string
  profileUrl: string | null
  avatarUrl: string | null
  isPublic: boolean
}

export interface SteamOwnedGame {
  steamAppId: number
  name: string
  playtimeMinutes: number
  lastPlayedAt: string | null
}

/**
 * Parses a user-supplied Steam identifier:
 *  - Direct 17-digit SteamID64 (`76561198000000000`)
 *  - Profile URL with SteamID64 (`https://steamcommunity.com/profiles/76561198000000000/`)
 *  - Custom URL (`https://steamcommunity.com/id/customname/`)
 *  - Raw vanity name (`customname`)
 */
export function parseSteamIdentifier(raw: string): { kind: 'steamid'; steamId: string } | { kind: 'vanity'; vanity: string } {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new UserFacingError('Enter your SteamID64, Steam profile URL, or custom profile name.')
  }

  if (STEAM_ID64_REGEX.test(trimmed)) {
    return { kind: 'steamid', steamId: trimmed }
  }

  const profileMatch = /steamcommunity\.com\/profiles\/(7656119\d{10})/i.exec(trimmed)
  if (profileMatch) {
    return { kind: 'steamid', steamId: profileMatch[1] }
  }

  const vanityUrlMatch = /steamcommunity\.com\/id\/([a-zA-Z0-9_-]{2,64})/i.exec(trimmed)
  if (vanityUrlMatch) {
    return { kind: 'vanity', vanity: vanityUrlMatch[1] }
  }

  if (/^[a-zA-Z0-9_-]{2,64}$/.test(trimmed)) {
    return { kind: 'vanity', vanity: trimmed }
  }

  throw new UserFacingError('That Steam ID or profile URL is not valid. Enter a 17-digit SteamID64 or your steamcommunity.com profile link.')
}

export function validateApiKeyFormat(raw: string): string {
  const key = raw.trim()
  if (!/^[A-Fa-f0-9]{32}$/.test(key)) {
    throw new UserFacingError('Enter a valid 32-character hexadecimal Steam Web API key (from steamcommunity.com/dev/apikey).')
  }
  return key.toUpperCase()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export class SteamWebApiClient {
  constructor(private readonly fetcher: Fetcher) {}

  async resolveSteamId(input: string, apiKey: string): Promise<string> {
    const parsed = parseSteamIdentifier(input)
    if (parsed.kind === 'steamid') return parsed.steamId

    const url = new URL(`${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/`)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('vanityurl', parsed.vanity)

    const body = await this.getJson(url.toString())
    const response = isRecord(body) && isRecord(body.response) ? body.response : null
    if (!response || response.success !== 1 || typeof response.steamid !== 'string' || !STEAM_ID64_REGEX.test(response.steamid)) {
      throw new UserFacingError(`Could not find a Steam profile with the custom URL “${parsed.vanity}”. Check the spelling or use your 17-digit SteamID64.`)
    }
    return response.steamid
  }

  async getPlayerSummary(steamId: string, apiKey: string): Promise<SteamPlayerSummary> {
    const url = new URL(`${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('steamids', steamId)

    const body = await this.getJson(url.toString())
    const response = isRecord(body) && isRecord(body.response) ? body.response : null
    const players = response && Array.isArray(response.players) ? response.players : []
    const player = players.find(isRecord)
    if (!player) {
      throw new UserFacingError('Steam did not return a profile for that SteamID64. Check that the SteamID64 is correct.')
    }

    return {
      steamId: typeof player.steamid === 'string' ? player.steamid : steamId,
      personaName: typeof player.personaname === 'string' && player.personaname.trim() ? player.personaname.trim() : `Steam User ${steamId.slice(-4)}`,
      profileUrl: typeof player.profileurl === 'string' ? player.profileurl : null,
      avatarUrl: typeof player.avatarmedium === 'string' ? player.avatarmedium : (typeof player.avatar === 'string' ? player.avatar : null),
      isPublic: Number(player.communityvisibilitystate ?? 1) === 3
    }
  }

  async getOwnedGames(steamId: string, apiKey: string, isProfilePublic = true): Promise<SteamOwnedGame[]> {
    const url = new URL(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`)
    url.searchParams.set('key', apiKey)
    url.searchParams.set('steamid', steamId)
    url.searchParams.set('include_appinfo', '1')
    url.searchParams.set('include_played_free_games', '1')
    url.searchParams.set('format', 'json')

    const body = await this.getJson(url.toString())
    const response = isRecord(body) && isRecord(body.response) ? body.response : null
    if (!response) {
      throw new UserFacingError('Steam sent a response VNStation could not read.')
    }

    if (!Array.isArray(response.games)) {
      if (!isProfilePublic || Object.keys(response).length === 0) {
        throw new UserFacingError(
          'Your Steam game list is hidden by your Steam privacy settings. Set both “My profile” and “Game details” to Public in Steam Privacy Settings, or use Local Steam folder import instead.'
        )
      }
      return []
    }

    const games: SteamOwnedGame[] = []
    for (const raw of response.games) {
      if (!isRecord(raw)) continue
      const appId = Number(raw.appid)
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      if (!Number.isInteger(appId) || appId <= 0 || !name) continue

      const playtimeMinutes = typeof raw.playtime_forever === 'number' && Number.isFinite(raw.playtime_forever)
        ? Math.max(0, Math.trunc(raw.playtime_forever))
        : 0

      const rtimeLastPlayed = typeof raw.rtime_last_played === 'number' ? raw.rtime_last_played : 0
      const lastPlayedAt = rtimeLastPlayed > 946684800 ? new Date(rtimeLastPlayed * 1000).toISOString() : null

      games.push({
        steamAppId: appId,
        name,
        playtimeMinutes,
        lastPlayedAt
      })
    }

    return games.sort((a, b) => a.name.localeCompare(b.name))
  }

  private async getJson(url: string): Promise<unknown> {
    let response
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'VNStation' },
        signal: AbortSignal.timeout(15_000)
      })
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new UserFacingError('Steam Web API took too long to respond. Try again in a moment.')
      }
      throw new UserFacingError('Could not reach the Steam Web API. Check your internet connection, or use Local Steam folder import.')
    }

    if (response.status === 401 || response.status === 403) {
      throw new UserFacingError('Steam rejected that Web API key. Check that your Steam Web API key is valid and active.')
    }
    if (response.status === 429) {
      throw new UserFacingError('Steam asked VNStation to slow down. Wait a minute and try again.')
    }
    if (response.status >= 500) {
      throw new UserFacingError('Steam Web API is having trouble right now. Try again later.')
    }
    if (!response.ok) {
      throw new UserFacingError(`Steam Web API could not process that request (HTTP ${response.status}).`)
    }

    try {
      return await response.json()
    } catch {
      throw new UserFacingError('Steam sent a response VNStation could not read.')
    }
  }
}
