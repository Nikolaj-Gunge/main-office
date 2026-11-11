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
  colorMode: ColorMode
  /** Per-channel steps in `levels` mode. */
  colorLevels: number
  palette: string
  /** 0 = no dithering, 1 = full ordered dither. */
  dither: number
  /** 0 = no outlines, 1 = black outlines. */
  outlines: number
  exposure: number
  /** 0–1. */
  masterVolume: number
  sfxVolume: number
  showStats: boolean
  showDebug: boolean
  keybinds: Keybinds
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 2,
  fov: 90,
  pixelHeight: 270,
  colorMode: 'levels',
  colorLevels: 24,
  palette: 'resurrect64',
  dither: 1,
  outlines: 0.35,
  exposure: 1,
  masterVolume: 0.8,
  sfxVolume: 1,
  showStats: false,
  // Off for players; developers turn it on with F3.
  showDebug: false,
  keybinds: withDefaults(undefined),
}

const STORAGE_KEY = 'office-fps:settings'

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...stored, keybinds: withDefaults(stored.keybinds) }
  } catch {
    return { ...DEFAULT_SETTINGS, keybinds: withDefaults(undefined) }
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
