/**
 * Device tiers: how much of the world a machine is asked to draw. On first run the tier is
 * guessed from the GPU's name, memory, cores and whether it's a phone, then checked against a
 * few seconds of real frames; the answer is kept. "Auto" can still step down later if frames stay
 * slow even at the coarsest pixel size (auto-quality.ts). Low / Medium / High in the menu
 * override it.
 */

export const TIERS = ['low', 'medium', 'high'] as const
export type Tier = (typeof TIERS)[number]
/** The menu's choice: a tier, or work it out. */
export type GraphicsSetting = 'auto' | Tier

export interface TierSettings {
  /** The moon's shadow map (texels a side) and how far its shadows reach around you (m). */
  shadowMap: number
  shadowReach: number
  /** Forest chunks in full / simplified / tree cards out to these distances (m), see wilds.ts. */
  forestNear: number
  forestMid: number
  forestFar: number
  /** Ground detail (grass, twigs…) out to this far (m), and how much of the small stuff (0–1). */
  detailView: number
  detailDensity: number
  /** Spent casings and bullet holes lying about at once. */
  casings: number
  decals: number
  /** Screen pixels per CSS pixel at most (phones' 3× screens cost 9× the pixels). */
  maxDpr: number
  /** The day's haze never reaches further than this (m). */
  fogFar: number
  /** Lamps lit at once out in the woods, and inside a camp. */
  lamps: number
  campLamps: number
  /** Falling leaves around you. */
  leaves: number
}

/** High is the game as it was before tiers. */
export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  high: {
    shadowMap: 2048,
    shadowReach: 80,
    forestNear: 100,
    forestMid: 190,
    forestFar: 450,
    detailView: 78,
    detailDensity: 1,
    casings: 48,
    decals: 128,
    maxDpr: Number.POSITIVE_INFINITY,
    fogFar: 420,
    lamps: 6,
    campLamps: 9,
    leaves: 260,
  },
  medium: {
    shadowMap: 2048,
    shadowReach: 64,
    forestNear: 84,
    forestMid: 160,
    forestFar: 380,
    detailView: 64,
    detailDensity: 0.7,
    casings: 32,
    decals: 96,
    maxDpr: 1.5,
    fogFar: 360,
    lamps: 5,
    campLamps: 7,
    leaves: 180,
  },
  low: {
    shadowMap: 1024,
    shadowReach: 50,
    forestNear: 64,
    forestMid: 128,
    forestFar: 300,
    detailView: 50,
    detailDensity: 0.4,
    casings: 12,
    decals: 48,
    maxDpr: 1,
    fogFar: 280,
    lamps: 3,
    campLamps: 4,
    leaves: 90,
  },
}

/** What the browser tells about the machine. */
export interface DeviceInfo {
  /** The GPU's name (WEBGL_debug_renderer_info), '' when the browser won't say. */
  gpu: string
  /** navigator.deviceMemory (GB, rounded down and capped at 8 by browsers), null if unknown. */
  memory: number | null
  cores: number | null
  mobile: boolean
  ios: boolean
}

type GL = WebGLRenderingContext | WebGL2RenderingContext

/** Reads the machine (`gl`: the game's context, for the GPU's name). */
export function readDevice(gl: GL | null): DeviceInfo {
  let gpu = ''
  if (gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
  }
  const nav = navigator as Navigator & {
    deviceMemory?: number
    userAgentData?: { mobile?: boolean }
  }
  const ua = nav.userAgent
  // iPads ask for desktop pages and say "Macintosh"; touch gives them away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)
  const mobile = ios || nav.userAgentData?.mobile === true || /Android|Mobi/i.test(ua)
  return {
    gpu,
    memory: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency || null,
    mobile,
    ios,
  }
}

/** Drawing in software: nothing will be fast. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i
/** Phone and small-laptop GPUs. */
const WEAK = /mali|adreno|powervr|videocore|intel.*\b(hd|uhd)\b|intel\(r\) (hd|uhd)|gma/i
/** Discrete cards and the big integrated ones. */
const STRONG =
  /nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro)|radeon\(tm\) (rx|pro)|apple m\d|iris\(r\) xe|iris xe|arc\(tm\)|intel.*\barc\b/i

/** The tier a machine starts at, before any frame is drawn. */
export function tierFromDevice(d: DeviceInfo): Tier {
  if (SOFTWARE.test(d.gpu)) return 'low'
  const small = (d.memory !== null && d.memory <= 4) || (d.cores !== null && d.cores <= 4)
  if (d.ios) return 'low'
  if (d.mobile) return small || WEAK.test(d.gpu) || d.gpu === '' ? 'low' : 'medium'
  if (STRONG.test(d.gpu)) return small ? 'medium' : 'high'
  if (WEAK.test(d.gpu)) return d.memory !== null && d.memory <= 2 ? 'low' : 'medium'
  // An unknown GPU (or one the browser won't name): judge by the rest.
  if (d.memory !== null && d.memory >= 8 && d.cores !== null && d.cores >= 8) return 'high'
  return small ? 'low' : 'medium'
}

/** One tier down (low stays low). */
export function stepDown(tier: Tier): Tier {
  return tier === 'high' ? 'medium' : 'low'
}

/**
 * After the probe: frames that averaged `avgMs` at `tier` say where it really belongs. Only ever
 * down — under vsync a fast machine and a just-fast-enough one both show 16.7 ms.
 */
export function tierFromProbe(tier: Tier, avgMs: number): Tier {
  if (avgMs > 45) return 'low'
  if (avgMs > 28) return stepDown(tier)
  return tier
}

/** The tier to draw at for the menu's choice. */
export function effectiveTier(setting: GraphicsSetting, auto: Tier): Tier {
  return setting === 'auto' ? auto : setting
}

/** Seconds of play skipped before the probe (shaders compiling, the forest filling in). */
const PROBE_WAIT = 2
/** Seconds of frames the probe averages. */
const PROBE_TIME = 4
/** Auto steps down after this long (s) under 40 fps at the coarsest pixel size. */
const SLOW_FOR = 6
const SLOW_FPS = 40

interface Stored {
  tier: Tier
  /** The GPU it was worked out for: a new one starts over. */
  gpu: string
  probed: boolean
}

/** Somewhere to keep the answer (localStorage in the browser). */
export interface TierStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'office-fps:device-tier'

/**
 * The automatic tier: detected once, probed once, stepped down when the machine keeps
 * struggling, and remembered.
 */
export class AutoTier {
  tier: Tier
  private probed: boolean
  private readonly gpu: string
  private readonly store: TierStore | null
  private played = 0
  private probeSum = 0
  private probeCount = 0
  private slowFor = 0
  private windowSum = 0
  private windowCount = 0

  constructor(device: DeviceInfo, store: TierStore | null) {
    this.gpu = device.gpu
    this.store = store
    const saved = load(store)
    if (saved && saved.gpu === device.gpu && TIERS.includes(saved.tier)) {
      this.tier = saved.tier
      this.probed = saved.probed
    } else {
      this.tier = tierFromDevice(device)
      this.probed = false
      this.save()
    }
  }

  /** Still waiting to time the first seconds of play? */
  get probing(): boolean {
    return !this.probed
  }

  /**
   * A frame of play took `dt` s; `coarsest`: automatic quality has no coarser pixels left.
   * Returns true when the tier changed.
   */
  frame(dt: number, coarsest: boolean): boolean {
    // A stall (tab hidden, loading) says nothing about the machine.
    if (dt >= 0.25) return false
    this.played += dt
    if (!this.probed) {
      if (this.played < PROBE_WAIT) return false
      this.probeSum += dt
      this.probeCount++
      if (this.played < PROBE_WAIT + PROBE_TIME) return false
      this.probed = true
      const before = this.tier
      this.tier = tierFromProbe(this.tier, (this.probeSum / this.probeCount) * 1000)
      this.save()
      return this.tier !== before
    }
    if (this.tier === 'low') return false
    this.windowSum += dt
    this.windowCount++
    if (this.windowSum < 1) return false
    const fps = this.windowCount / this.windowSum
    this.slowFor = coarsest && fps < SLOW_FPS ? this.slowFor + this.windowSum : 0
    this.windowSum = 0
    this.windowCount = 0
    if (this.slowFor < SLOW_FOR) return false
    this.slowFor = 0
    this.tier = stepDown(this.tier)
    this.save()
    return true
  }

  private save(): void {
    const value: Stored = { tier: this.tier, gpu: this.gpu, probed: this.probed }
    try {
      this.store?.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {
      // Private mode or full: work it out again next time.
    }
  }
}

function load(store: TierStore | null): Stored | null {
  try {
    const raw = store?.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}
