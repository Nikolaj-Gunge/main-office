/**
 * Safe mode: the costly passes off — volumetric fog, cascaded shadows, ambient occlusion, the
 * torch's shadow and the clip buffer — for browsers and GPUs where they misbehave or crawl
 * (Safari's WebGL, Chromebooks, GPUs without float textures or with small ones). `auto` turns it
 * on for those (device-tier.ts safeReasons); the menu's On/Off or `?safe=1` / `?safe=0` decide
 * otherwise.
 */

import type { TierSettings } from './device-tier.ts'

export const SAFE_SETTINGS = ['auto', 'on', 'off'] as const
export type SafeSetting = (typeof SAFE_SETTINGS)[number]

/** Whether safe mode is on: the URL flag first, then the setting, then the device. */
export function safeModeOn(
  setting: SafeSetting,
  reasons: readonly string[],
  search: string,
): boolean {
  const flag = new URLSearchParams(search).get('safe')
  if (flag === '1' || flag === 'on') return true
  if (flag === '0' || flag === 'off') return false
  if (setting === 'on') return true
  if (setting === 'off') return false
  return reasons.length > 0
}

/** A tier's settings with safe mode's passes taken out (one shadow map, no AO). */
export function safeTier(t: TierSettings): TierSettings {
  return { ...t, shadowCascades: [t.shadowReach], ao: 0 }
}
