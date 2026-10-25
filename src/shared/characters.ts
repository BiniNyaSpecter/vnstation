export type CharacterRole = 'main' | 'primary' | 'side' | 'appears'

export type SpoilerLevel = 0 | 1 | 2

export type SpoilerPreference = 'hide' | 'minor' | 'all'

export interface CharacterTrait {
  id: string
  name: string
  groupName: string | null
  spoiler: SpoilerLevel
  lie: boolean
}

export interface CharacterBiographySegment {
  text: string
  spoiler: boolean
}

export interface CharacterRecord {
  id: string
  vndbId: string
  name: string
  originalName: string | null
  aliases: string[]
  description: string | null
  biographySegments: CharacterBiographySegment[]
  hasBiographySpoilers: boolean
  role: CharacterRole
  /** Spoiler level of this character's presence/role in this specific visual novel (0 = none, 1 = minor, 2 = major). */
  spoiler: SpoilerLevel
  portraitUrl: string | null
  bloodType: string | null
  heightCm: number | null
  weightKg: number | null
  age: number | null
  birthday: [number, number] | null
  traits: CharacterTrait[]
  vndbUrl: string
  fetchedAt: string
}

export interface CharacterListResult {
  vndbId: string
  characters: CharacterRecord[]
  fromCache: boolean
  fetchedAt: string | null
}
