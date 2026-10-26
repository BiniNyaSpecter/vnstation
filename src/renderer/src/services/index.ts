import type { GameLauncher, LibraryRepository, MetadataApi, PreferencesRepository, SocialApi, SteamApi } from '@shared/contracts'
import { createSampleSnapshot } from '@shared/sampleLibrary'
import { LocalStoragePreferences } from '@renderer/lib/prefs'
import { bridge } from './bridge'
import { InMemoryLibraryRepository } from './inMemoryLibraryRepository'
import { StubGameLauncher } from './stubGameLauncher'
import { unavailableMetadata } from './unavailableMetadata'
import { unavailableSocial } from './unavailableSocial'
import { unavailableSteam } from './unavailableSteam'

/**
 * Composition root for side-effectful services. In Electron the library, metadata,
 * launcher and settings are backed by the main process over IPC; in a plain browser
 * they fall back to in-memory sample data so the interface can still be developed.
 */
export const services: {
  library: LibraryRepository
  metadata: MetadataApi
  steam: SteamApi
  social: SocialApi
  launcher: GameLauncher
  preferences: PreferencesRepository
} = bridge
  ? {
      library: bridge.library,
      metadata: bridge.metadata,
      steam: bridge.steam,
      social: bridge.social,
      launcher: bridge.launcher,
      preferences: bridge.settings
    }
  : {
      library: new InMemoryLibraryRepository(createSampleSnapshot()),
      metadata: unavailableMetadata,
      steam: unavailableSteam,
      social: unavailableSocial,
      launcher: new StubGameLauncher(),
      preferences: new LocalStoragePreferences()
    }
