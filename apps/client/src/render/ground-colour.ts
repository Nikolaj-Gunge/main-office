import {
  CELL,
  coverAt,
  heightAt,
  type Lake,
  Surface,
  smoothstep,
  surfaceAt,
  type Terrain,
  valueNoise,
} from '@office-fps/shared'

/**
 * The colour of the forest floor at a point, blended rather than picked: neighbouring surfaces
 * run into each other over a few metres, bare dirt shows through the needles in patches, moss
 * and grass where the trees thin out, and mud collects in hollows and by the water (`mud` says
 * how much, 0–1: the wet ground shader darkens and shines those parts most when it rains).
 */
export interface GroundColour {
  r: number
  g: number
  b: number
  mud: number
}

type Rgb = [number, number, number]

const rgb = (hex: number): Rgb => [
  srgbToLinear(((hex >> 16) & 255) / 255),
  srgbToLinear(((hex >> 8) & 255) / 255),
  srgbToLinear((hex & 255) / 255),
]

function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4
}

/** Each surface's own colour (what the old per-vertex shades averaged to). */
const BASE: Record<number, Rgb> = {
  [Surface.Forest]: rgb(0x2a2c1a),
  [Surface.Meadow]: rgb(0x384a21),
  [Surface.Dirt]: rgb(0x45392a),
  [Surface.Sand]: rgb(0x6e6449),
  [Surface.Rock]: rgb(0x505356),
}
const NEEDLES = rgb(0x3a2c1c)
const DIRT = rgb(0x46392a)
const MOSS = rgb(0x26351a)
const GRASS = rgb(0x3e5226)
const MUD = rgb(0x261e15)

const mixInto = (out: Rgb, c: Rgb, t: number) => {
  out[0] += (c[0] - out[0]) * t
  out[1] += (c[1] - out[1]) * t
  out[2] += (c[2] - out[2]) * t
}

/** Where the ground at (x, z) is: what colour, and how muddy. */
export function groundColour(
  t: Terrain,
  lakes: readonly Lake[],
  x: number,
  z: number,
  out: GroundColour,
): GroundColour {
  // The surfaces around blend into each other over a couple of cells (no hard seams).
  const c: Rgb = [0, 0, 0]
  let total = 0
  for (const [dx, dz, w] of SAMPLES) {
    const base = BASE[surfaceAt(t, x + dx, z + dz)] ?? (BASE[Surface.Forest] as Rgb)
    c[0] += base[0] * w
    c[1] += base[1] * w
    c[2] += base[2] * w
    total += w
  }
  c[0] /= total
  c[1] /= total
  c[2] /= total
  const surface = surfaceAt(t, x, z)
  const soft = surface === Surface.Forest || surface === Surface.Meadow
  const cover = coverAt(t, x, z)
  const patch = valueNoise(x / 23, z / 23, 31)
  const fine = valueNoise(x / 7, z / 7, 32)
  if (soft) {
    // Under the trees: needle litter, bare earth in patches, moss where it's damp and shaded.
    mixInto(c, NEEDLES, cover * 0.35 * smoothstep(-0.2, 0.4, fine))
    mixInto(c, DIRT, smoothstep(0.25, 0.6, patch) * 0.55)
    mixInto(c, MOSS, cover * smoothstep(0.2, 0.7, -patch) * 0.5)
    // Grass where the canopy opens up.
    mixInto(c, GRASS, (1 - cover) * smoothstep(-0.3, 0.3, -patch) * 0.4)
  }
  // Hollows (lower than the ground around) and lake shores collect water: mud.
  const h = heightAt(t, x, z)
  const r = CELL * 1.5
  const around =
    (heightAt(t, x + r, z) +
      heightAt(t, x - r, z) +
      heightAt(t, x, z + r) +
      heightAt(t, x, z - r)) /
    4
  let mud = smoothstep(0.08, 0.5, around - h)
  for (const lake of lakes) {
    const d = Math.hypot(x - lake.x, z - lake.z)
    if (d > lake.r + 45) continue
    mud = Math.max(
      mud,
      (1 - smoothstep(lake.r, lake.r + 40, d)) * (1 - smoothstep(0.5, 3, h - lake.y)),
    )
  }
  if (surface === Surface.Dirt) mud = Math.max(mud, 0.35 + 0.3 * smoothstep(0, 0.6, patch))
  if (surface === Surface.Rock || surface === Surface.Sand) mud *= 0.3
  mud = Math.min(1, mud + smoothstep(0.3, 0.8, patch) * 0.25 * (soft ? 1 : 0))
  mixInto(c, MUD, mud * 0.45)
  // A little unevenness everywhere.
  const shade = 1 + fine * 0.07
  out.r = c[0] * shade
  out.g = c[1] * shade
  out.b = c[2] * shade
  out.mud = mud
  return out
}

/** Where the blend looks (m) and how much each counts. */
const SAMPLES: [number, number, number][] = [
  [0, 0, 2],
  [CELL, 0, 1],
  [-CELL, 0, 1],
  [0, CELL, 1],
  [0, -CELL, 1],
  [CELL * 1.6, CELL * 1.6, 0.6],
  [-CELL * 1.6, CELL * 1.6, 0.6],
  [CELL * 1.6, -CELL * 1.6, 0.6],
  [-CELL * 1.6, -CELL * 1.6, 0.6],
]
