import type { MetadataCandidate } from '@shared/metadata'
import type {
  ClassificationConfidence,
  ClassificationOverride,
  SteamCandidateMatch,
  VnClassification
} from '@shared/steam'
import type { SteamVndbReleaseMatch } from '../metadata/vndb'

const NON_GAME_SUFFIX =
  /\b(?:original\s+soundtrack|soundtrack|ost|digital\s+art\s*book|art\s*book|artbook|wallpapers?|dedicated\s+server|sdk|benchmark|bonus\s+tracks|mini\s+soundtrack|vocal\s+collection)\b/i

const EDITION_SUFFIXES =
  /\b(?:hd\s+remaster(?:ed)?|remastered|director'?s\s+cut|complete\s+edition|definitive\s+edition|steam\s+edition|english\s+edition|international\s+edition|anniversary\s+edition|collector'?s\s+edition|game\s+of\s+the\s+year\s+edition|goty\s+edition|full\s+voice\s+edition|plus\s+edition|hd\s+edition|special\s+edition|deluxe\s+edition)\b/gi

/** Strips trademark symbols and normalizes case/punctuation for strict title comparison. */
export function normalizeStrictTitle(title: string): string {
  return title
    .replace(/[™®©]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Strips edition/remaster suffixes in addition to punctuation for normalized title comparison. */
export function normalizeLooseTitle(title: string): string {
  const withoutParens = title
    .replace(/[™®©]/g, '')
    .replace(/\((?:[^)]*(?:edition|remaster|cut|version|steam|english|hd)[^)]*)\)/gi, ' ')
    .replace(/\[(?:[^\]]*(?:edition|remaster|cut|version|steam|english|hd)[^\]]*)\]/gi, ' ')
    .replace(/(?:\s*[-–—:]\s*)?(?:hd\s+remaster(?:ed)?|remastered|director'?s\s+cut|complete\s+edition|definitive\s+edition|steam\s+edition|english\s+edition|international\s+edition|anniversary\s+edition|collector'?s\s+edition|full\s+voice\s+edition|hd\s+edition|special\s+edition|deluxe\s+edition)\s*$/gi, ' ')
    .replace(EDITION_SUFFIXES, ' ')
  return normalizeStrictTitle(withoutParens)
}

/** Computes word-level Jaccard similarity between two normalized titles (0 to 1). */
export function titleSimilarity(a: string, b: string): number {
  const normA = normalizeLooseTitle(a)
  const normB = normalizeLooseTitle(b)
  if (!normA || !normB) return 0
  if (normA === normB) return 1

  const tokensA = new Set(normA.split(' ').filter((w) => w.length > 0))
  const tokensB = new Set(normB.split(' ').filter((w) => w.length > 0))
  if (tokensA.size === 0 || tokensB.size === 0) return 0

  let intersection = 0
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++
  }
  const union = new Set([...tokensA, ...tokensB]).size
  return union === 0 ? 0 : intersection / union
}

export function isNonGameSteamEntry(title: string): boolean {
  return NON_GAME_SUFFIX.test(title)
}

export interface ClassificationDecision {
  classification: VnClassification
  confidence: ClassificationConfidence
  reason: string
  vndbId: string | null
  vndbTitle: string | null
  candidateMatches: SteamCandidateMatch[]
}

function toCandidateMatch(candidate: MetadataCandidate): SteamCandidateMatch {
  return {
    id: candidate.externalId,
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    releaseDate: candidate.releaseDate,
    developer: candidate.developers[0] ?? null
  }
}

/**
 * Classifies one Steam entry using:
 *  1. Persistent manual user override (`include` / `exclude`) if present
 *  2. Exact Steam AppID release extlink match from VNDB
 *  3. Official & alternative VNDB title match
 *  4. Normalized title match (edition/remaster suffixes stripped)
 *  5. Ambiguous/partial match isolation into the `review` queue vs `excluded`
 */
export function classifySteamEntry(input: {
  steamAppId: number
  name: string
  manualOverride?: ClassificationOverride
  existingVndbId?: string | null
  existingVndbTitle?: string | null
  releaseMatches?: readonly SteamVndbReleaseMatch[]
  titleCandidates?: readonly MetadataCandidate[]
}): ClassificationDecision {
  const {
    name,
    manualOverride = null,
    existingVndbId = null,
    existingVndbTitle = null,
    releaseMatches = [],
    titleCandidates = []
  } = input

  const candidateMatches = titleCandidates.slice(0, 5).map(toCandidateMatch)

  if (manualOverride === 'exclude') {
    return {
      classification: 'excluded',
      confidence: 'manual',
      reason: 'Excluded manually by you.',
      vndbId: existingVndbId,
      vndbTitle: existingVndbTitle,
      candidateMatches
    }
  }

  if (manualOverride === 'include') {
    const chosenId = existingVndbId ?? releaseMatches[0]?.vndbId ?? candidateMatches[0]?.id ?? null
    const chosenTitle = existingVndbTitle ?? releaseMatches[0]?.title ?? candidateMatches[0]?.title ?? null
    return {
      classification: 'vn',
      confidence: 'manual',
      reason: 'Included manually by you.',
      vndbId: chosenId,
      vndbTitle: chosenTitle,
      candidateMatches
    }
  }

  // 1. Exact Steam AppID release extlink on VNDB
  if (releaseMatches.length > 0) {
    const nonTrial = releaseMatches.filter((m) => m.rtype !== 'trial')
    const pool = nonTrial.length > 0 ? nonTrial : releaseMatches
    const uniqueVnIds = [...new Set(pool.map((m) => m.vndbId))]

    if (uniqueVnIds.length === 1) {
      const match = pool[0]
      return {
        classification: 'vn',
        confidence: 'high',
        reason: 'Verified Steam release on VNDB.',
        vndbId: match.vndbId,
        vndbTitle: match.title,
        candidateMatches: pool.map((m) => ({
          id: m.vndbId,
          title: m.title,
          originalTitle: m.originalTitle,
          releaseDate: null,
          developer: null
        }))
      }
    }

    // Multiple distinct VNs linked to the same Steam AppID: check if one matches the Steam title directly
    const strictSteam = normalizeStrictTitle(name)
    const looseSteam = normalizeLooseTitle(name)
    const exactReleaseVn = pool.find(
      (m) =>
        normalizeStrictTitle(m.title) === strictSteam ||
        (m.originalTitle && normalizeStrictTitle(m.originalTitle) === strictSteam) ||
        normalizeLooseTitle(m.title) === looseSteam
    )
    if (exactReleaseVn) {
      return {
        classification: 'vn',
        confidence: 'high',
        reason: 'Verified Steam release on VNDB.',
        vndbId: exactReleaseVn.vndbId,
        vndbTitle: exactReleaseVn.title,
        candidateMatches: pool.map((m) => ({
          id: m.vndbId,
          title: m.title,
          originalTitle: m.originalTitle,
          releaseDate: null,
          developer: null
        }))
      }
    }

    // Multi-VN bundle where title doesn't single out just one: place in review with the exact linked VNs
    return {
      classification: 'review',
      confidence: 'medium',
      reason: 'This Steam release bundles multiple visual novels on VNDB. Choose which entry to link.',
      vndbId: null,
      vndbTitle: null,
      candidateMatches: pool.map((m) => ({
        id: m.vndbId,
        title: m.title,
        originalTitle: m.originalTitle,
        releaseDate: null,
        developer: null
      }))
    }
  }

  // Filter out obvious soundtracks/artbooks/tools before title matching
  if (isNonGameSteamEntry(name)) {
    return {
      classification: 'excluded',
      confidence: 'high',
      reason: 'Soundtrack, artbook, or non-game utility.',
      vndbId: null,
      vndbTitle: null,
      candidateMatches: []
    }
  }

  if (titleCandidates.length === 0) {
    return {
      classification: 'excluded',
      confidence: 'high',
      reason: 'No matching visual novel found on VNDB.',
      vndbId: null,
      vndbTitle: null,
      candidateMatches: []
    }
  }

  const strictSteam = normalizeStrictTitle(name)
  const looseSteam = normalizeLooseTitle(name)

  // 2. Exact official or alternative title match
  const strictMatches = titleCandidates.filter(
    (c) =>
      normalizeStrictTitle(c.title) === strictSteam ||
      (c.originalTitle !== null && normalizeStrictTitle(c.originalTitle) === strictSteam)
  )

  if (strictMatches.length === 1) {
    const match = strictMatches[0]
    return {
      classification: 'vn',
      confidence: 'high',
      reason: 'Exact title match on VNDB.',
      vndbId: match.externalId,
      vndbTitle: match.title,
      candidateMatches: [toCandidateMatch(match), ...candidateMatches.filter((c) => c.id !== match.externalId)].slice(0, 5)
    }
  }

  if (strictMatches.length > 1) {
    return {
      classification: 'review',
      confidence: 'low',
      reason: `Multiple visual novels on VNDB share the title “${name}”. Review and pick the right match.`,
      vndbId: null,
      vndbTitle: null,
      candidateMatches: strictMatches.slice(0, 5).map(toCandidateMatch)
    }
  }

  // 3. Normalized title match (edition / remaster / director's cut suffixes removed)
  const looseMatches = titleCandidates.filter(
    (c) =>
      Boolean(looseSteam) &&
      (normalizeLooseTitle(c.title) === looseSteam ||
        (c.originalTitle !== null && normalizeLooseTitle(c.originalTitle) === looseSteam))
  )

  if (looseMatches.length === 1) {
    const match = looseMatches[0]
    return {
      classification: 'vn',
      confidence: 'medium',
      reason: 'Matched normalized title on VNDB.',
      vndbId: match.externalId,
      vndbTitle: match.title,
      candidateMatches: [toCandidateMatch(match), ...candidateMatches.filter((c) => c.id !== match.externalId)].slice(0, 5)
    }
  }

  if (looseMatches.length > 1) {
    return {
      classification: 'review',
      confidence: 'low',
      reason: 'Multiple VNDB entries match the normalized title. Review and choose the right one.',
      vndbId: null,
      vndbTitle: null,
      candidateMatches: looseMatches.slice(0, 5).map(toCandidateMatch)
    }
  }

  // 4. Partial / ambiguous similarity check -> isolate in Review queue if close, otherwise Exclude
  const closeCandidates = titleCandidates.filter((c) => {
    const simTitle = titleSimilarity(name, c.title)
    const simOrig = c.originalTitle ? titleSimilarity(name, c.originalTitle) : 0
    return Math.max(simTitle, simOrig) >= 0.6
  })

  if (closeCandidates.length > 0) {
    return {
      classification: 'review',
      confidence: 'low',
      reason: 'Similar title found on VNDB, but not an exact match. Confirm before importing.',
      vndbId: null,
      vndbTitle: null,
      candidateMatches: closeCandidates.slice(0, 5).map(toCandidateMatch)
    }
  }

  return {
    classification: 'excluded',
    confidence: 'high',
    reason: 'Not recognized as a visual novel on VNDB.',
    vndbId: null,
    vndbTitle: null,
    candidateMatches: []
  }
}
