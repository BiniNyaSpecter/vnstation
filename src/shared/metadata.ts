import type { ContentRating, ProviderMetadata } from './types'

/** A possible match returned by a metadata provider's search. */
export interface MetadataCandidate {
  provider: 'vndb'
  externalId: string
  title: string
  originalTitle: string | null
  releaseDate: string | null
  developers: string[]
  languages: string[]
  /** Remote thumbnail URL, only present when the image passed the content filter. */
  thumbnailUrl: string | null
  contentRating: ContentRating
}

export interface MetadataSearchResult {
  candidates: MetadataCandidate[]
  /** Results left out because they are rated for adults and the filter is on. */
  hiddenRestrictedCount: number
  fromCache: boolean
}

/** Provider data as downloaded, before artwork is cached locally. */
export interface MetadataDetails extends Omit<ProviderMetadata, 'coverUrl' | 'backgroundUrl' | 'fetchedAt'> {
  coverRemoteUrl: string | null
  backgroundRemoteUrl: string | null
}

export type ArtworkKind = 'cover' | 'background'

/** Scheme used for locally cached artwork; served by the main process from the cache folder only. */
export const ART_URL_PREFIX = 'vnstation-art://art/'
