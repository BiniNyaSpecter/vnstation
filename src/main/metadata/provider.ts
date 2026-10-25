import type { MetadataCandidate, MetadataDetails } from '@shared/metadata'
import type { ContentPolicy } from './vndb'

/** A source of visual novel details. VNDB is the first; others can be added behind this interface. */
export interface MetadataProvider {
  readonly id: 'vndb'
  search(query: string, policy: ContentPolicy): Promise<MetadataCandidate[]>
  getDetails(externalId: string, policy: ContentPolicy): Promise<MetadataDetails>
}
