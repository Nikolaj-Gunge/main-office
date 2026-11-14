import {
  type Appearance,
  DEFAULT_APPEARANCE,
  packAppearance,
  unpackAppearance,
} from '@office-fps/shared'
import { type Keybinds, withDefaults } from './input/bindings.ts'

export const COLOR_MODES = { off: 0, levels: 1, palette: 2 } as const
export type ColorMode = keyof typeof COLOR_MODES

export interface Settings {
  /** CS-style sensitivity: degrees per mouse count = sensitivity × 0.022. */
  sensitivity: number
  /** Horizontal field of view in degrees (converted to vertical for the current aspect). */
  fov: number
  /** Target internal render height in pixels. The real height is rounded so pixels scale by a whole number. */
  pixelHeight: number
  /** Make pixels coarser by itself when frames get slow, finer again when there's room. */
  autoQuality: boolean
  /** Soft pixels: smooth upscaling, anti-aliased edges and filtered textures (else crisp squares). */
  smoothPixels: boolean
  colorMode: ColorMode
  /** Per-channel steps in `levels` mode. */
  colorLevels: number
  palette: string
  /** 0 = no dithering, 1 = full ordered dither. */
  dither: number
  /** 0 = no outlines, 1 = black outlines. */
  outlines: number
  /** Glow around bright things (lights, screens, muzzle flash). 0 = off. */
  bloom: number
  /** 0 = flat, 1 = deep black shadows and hot highlights. */
  contrast: number
  /** Colour strength: 1 = as lit, above = more vivid. */
  saturation: number
  /** Dark corners. 0 = none. */
  vignette: number
  /** Bumped when the default look changes, so saved settings pick up the new look once. */
  lookVersion: number
  exposure: number
  /** 0–1. */
  masterVolume: number
  sfxVolume: number
  showStats: boolean
  showDebug: boolean
  /** Aim key toggles scope on/off instead of hold-to-aim (trackpads, two-finger click). */
  aimToggle: boolean
  /**
   * Which renderer draws the game (takes effect on reload; `?renderer=` overrides it). WebGPU
   * falls back to WebGL by itself when the browser has no WebGPU or it fails to start.
   */
  renderer: RendererSetting
  keybinds: Keybinds
}

export const RENDERERS = ['webgl', 'webgpu'] as const
export type RendererSetting = (typeof RENDERERS)[number]

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 2,
  fov: 90,
  // Phase 15 look: still pixel art, but fine and soft — smooth upscaling, anti-aliased edges,
  // filtered textures, barely any banding or dither, thin outlines.
  pixelHeight: 900,
  autoQuality: true,
  smoothPixels: true,
  colorMode: 'levels',
  colorLevels: 160,
  palette: 'resurrect64',
  dither: 0.12,
  outlines: 0.15,
  // Phase 13 look: darker shadows, vivid lights, more glow.
  bloom: 0.85,
  contrast: 0.6,
  saturation: 1.25,
  vignette: 0.4,
  lookVersion: 5,
  exposure: 1,
  masterVolume: 0.8,
  sfxVolume: 1,
  showStats: false,
  // Off for players; developers turn it on with F3.
  showDebug: false,
  aimToggle: false,
  renderer: 'webgl',
  keybinds: withDefaults(undefined),
}

const STORAGE_KEY = 'office-fps:settings'
const LOOK_KEYS = [
  'pixelHeight',
  'smoothPixels',
  'colorMode',
  'colorLevels',
  'dither',
  'outlines',
  'bloom',
  'contrast',
  'saturation',
  'vignette',
  'exposure',
  'lookVersion',
] as const

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>
    const merged = { ...DEFAULT_SETTINGS, ...stored, keybinds: withDefaults(stored.keybinds) }
    if ((stored.lookVersion ?? 1) < DEFAULT_SETTINGS.lookVersion) {
      // New default look: adopt it once, keep everything else (controls, volume, FOV…).
      for (const key of LOOK_KEYS) Object.assign(merged, { [key]: DEFAULT_SETTINGS[key] })
    }
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS, keybinds: withDefaults(undefined) }
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

// --- Character (the creator's look; kept apart so "reset settings" doesn't undo your face) ---

const CHARACTER_KEY = 'office-fps:character'

/** The character made in the creator, or null if this device never made one. */
export function loadAppearance(): Appearance | null {
  try {
    const raw = localStorage.getItem(CHARACTER_KEY)
    if (raw === null) return null
    const stored = JSON.parse(raw) as Partial<Appearance>
    return unpackAppearance(packAppearance({ ...DEFAULT_APPEARANCE, ...stored }))
  } catch {
    return null
  }
}

export function saveAppearance(appearance: Appearance): void {
  localStorage.setItem(CHARACTER_KEY, JSON.stringify(appearance))
}
