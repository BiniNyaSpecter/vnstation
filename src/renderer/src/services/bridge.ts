import type { VNStationApi } from '@shared/api'

/**
 * The preload-provided native API, or `null` when the UI runs in a plain browser
 * (useful for design work). Always check for `null` before using it.
 */
export const bridge: VNStationApi | null = typeof window !== 'undefined' ? (window.vnstation ?? null) : null
