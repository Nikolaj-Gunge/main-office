import {
  type Appearance,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  PART_SIZES,
  packAppearance,
  randomAppearance,
  SKIN_TONES,
} from '@office-fps/shared'
import * as THREE from 'three'
import { ARM_LENGTH, type Baked, Kit, pickOf, seeded } from './body-kit.ts'

/**
 * People in the blocky box style: the character creator's look (build, skin, hair, eyes, beard)
 * on top of one of two outfits. In the office everyone wears a shirt in their player colour,
 * a tie, dark trousers and shoes; in survival a white tank top over bare arms (trousers and
 * shoes come from what they wear: gear-looks.ts). Everything is boxes on the hitbox parts, baked
 * per look into a few vertex-coloured meshes per part and shared by everyone who looks the same.
 */

export type Outfit = 'office' | 'survival'

/** What people wear on this map (the survival map sets 'survival' once at start). */
let mapOutfit: Outfit = 'office'
export const setMapOutfit = (outfit: Outfit): void => {
  mapOutfit = outfit
}
export const defaultOutfit = (): Outfit => mapOutfit

/** Someone without a chosen look (bots, old clients): a random one, the same on every screen. */
export const lookFor = (appearance: Appearance | undefined, colorIndex: number): Appearance =>
  appearance ?? randomAppearance(seeded(colorIndex * 13 + 101))

/**
 * A person's baked look. `base` always shows; `crown` is the hair on top of the head (hidden
 * under hats and helmets); `beard` hides under face-covering gear; `under` is the collar and tie
 * (hidden under closed coats).
 */
export interface PersonBody {
  base: Baked
  crown: Baked | null
  beard: Baked | null
  under: Baked | null
}

const H = PART_SIZES.head
const C = PART_SIZES.chest
const S = PART_SIZES.stomach
const T = PART_SIZES.thighL
const N = PART_SIZES.shinL
const L = ARM_LENGTH
const SIDES = [-1, 1] as const
const ARMS = ['armL', 'armR'] as const
const FZ = -H.z // the face

const TIE_COLORS = [0x1f2a44, 0x7a1f2b, 0x2d4a3a, 0x3b2d4f, 0x8a6a1f, 0x1c1c1c]
const TROUSERS = 0x2f3440
const SHOES = 0x1a1a1a
const TANK_TOP = 0xeeeeea
const BLOOD = 0x5a1212

/** Narrower shoulders and waist, wider hips for the feminine build (looks only). */
export function build(body: number): { chest: number; waist: number; hips: number } {
  return body === 1
    ? { chest: C.x * 2 - 0.04, waist: S.x * 2 - 0.05, hips: S.x * 2 + 0.016 }
    : { chest: C.x * 2, waist: S.x * 2, hips: S.x * 2 }
}

const mix = (a: number, b: number, t: number): number =>
  new THREE.Color(a).lerp(new THREE.Color(b), t).getHex()

const cache = new Map<string, PersonBody>()

/** A skin tone gone grey-green and dead (survivors who turned). */
export const undeadSkin = (skin: number): number => mix(mix(skin, 0x7c8a66, 0.6), 0x000000, 0.12)

/**
 * The baked body of a person in an outfit (`colorIndex` picks the office tie). `undead`: the same
 * person after they turned: dead skin, glowing eyes ('eyes' slot), a bloody mouth and a filthy,
 * bloodied top.
 */
export function personBody(
  look: Appearance,
  outfit: Outfit,
  colorIndex: number,
  undead = false,
): PersonBody {
  const tie = outfit === 'office' ? ((colorIndex % 6) + 6) % 6 : 0
  const key = `${outfit}:${packAppearance(look)}:${tie}:${undead ? 'u' : ''}`
  let body = cache.get(key)
  if (!body) {
    body = bakePerson(look, outfit, pickOf(TIE_COLORS, tie), undead)
    cache.set(key, body)
  }
  return body
}

function bakePerson(a: Appearance, outfit: Outfit, tie: number, undead: boolean): PersonBody {
  const own = pickOf(SKIN_TONES, a.skin)
  const skin = undead ? undeadSkin(own) : own
  const hairColor = pickOf(HAIR_COLORS, a.hairColor)
  const shape = build(a.body)
  const base = new Kit()
  const crown = new Kit()
  const beard = new Kit()
  face(base, a, skin, hairColor, undead)
  const style = HAIR_STYLES[a.hair] ?? 'bald'
  HAIR[style](crown.on('head'), base.on('head'), hairColor, skin)
  if (a.beard > 0) BEARD[a.beard]?.(beard.on('head'), hairColor, skin)

  let under: Kit | null = null
  if (outfit === 'office') {
    // Shirt in the player's colour ('own': the avatar's material, so team colours and the spawn
    // blink still work), tie and collar, belt, dark trousers and shoes.
    base.on('chest').box('own', [shape.chest, C.y * 2, C.z * 2])
    if (a.body === 1) base.box('own', [0.3, 0.09, 0.02], [0, -0.02, -C.z - 0.008])
    base.on('stomach').box('own', [shape.waist, S.y * 2, S.z * 2])
    if (a.body === 1) base.box(TROUSERS, [shape.hips, 0.1, S.z * 2 + 0.004], [0, -S.y + 0.05, 0])
    base.box(0x1c1a18, [shape.hips + 0.01, 0.05, S.z * 2 + 0.01], [0, -S.y + 0.03, 0]) // belt
    for (const arm of ARMS) {
      base.on(arm).box('own', [0.12, L - 0.1, 0.14], [0, -0.05, 0])
      base.box(skin, [0.11, 0.1, 0.11], [0, L / 2 - 0.05, 0])
    }
    for (const thigh of ['thighL', 'thighR'] as const)
      base.on(thigh).box(TROUSERS, [T.x * 2, T.y * 2, T.z * 2])
    for (const shin of ['shinL', 'shinR'] as const) {
      base.on(shin).box(TROUSERS, [N.x * 2, N.y * 2, N.z * 2])
      base.box(SHOES, [0.19, 0.08, 0.26], [0, -N.y + 0.02, -0.04])
    }
    under = new Kit()
    under.on('chest').box(0xf2f0ea, [0.3, 0.06, 0.05], [0, C.y - 0.03, -C.z])
    under.box(tie, [0.11, 0.07, 0.04], [0, C.y - 0.08, -C.z - 0.01])
    under.box(tie, [0.09, 0.24, 0.03], [0, -0.04, -C.z - 0.01])
    under.on('stomach').box(tie, [0.09, 0.2, 0.03], [0, 0.05, -S.z - 0.01])
  } else {
    // A white tank top: bare shoulders and arms, straps over the top. Trousers and feet are the
    // worn legs and feet looks (gear-looks.ts).
    base.on('chest').box(skin, [shape.chest, C.y * 2, C.z * 2])
    base.box(TANK_TOP, [shape.chest + 0.008, C.y * 2 - 0.07, C.z * 2 + 0.008], [0, -0.035, 0])
    for (const s of SIDES)
      base.box(TANK_TOP, [0.07, 0.072, C.z * 2 + 0.008], [s * 0.11, C.y - 0.035, 0])
    if (a.body === 1) base.box(TANK_TOP, [0.3, 0.09, 0.02], [0, -0.02, -C.z - 0.012])
    base.on('stomach').box(TANK_TOP, [shape.waist, S.y * 2, S.z * 2])
    for (const arm of ARMS) {
      base.on(arm).box(skin, [0.115, L * 0.5, 0.125], [0, -L / 4, 0]) // upper arm
      base.box(skin, [0.105, L * 0.5, 0.115], [0, L / 4, 0]) // forearm and hand
    }
  }
  if (undead) {
    // Blood down the front and a bitten forearm.
    base.on('chest').box(BLOOD, [0.16, 0.12, 0.012], [0.03, 0.06, -C.z - 0.01])
    base.box(BLOOD, [0.06, 0.2, 0.012], [-0.06, -0.04, -C.z - 0.01])
    base.on('stomach').box(BLOOD, [0.1, 0.12, 0.012], [-0.04, 0.03, -S.z - 0.01])
    base.on('armL').box(BLOOD, [0.11, 0.08, 0.12], [0, L / 4 + 0.04, 0])
  }

  const baked = (k: Kit) => {
    const b = k.bake()
    return Object.keys(b).length > 0 ? b : null
  }
  return {
    base: base.bake(),
    crown: baked(crown),
    beard: baked(beard),
    under: under ? baked(under) : null,
  }
}

/** Head, neck, ears, eyes, brows, nose and mouth (`undead`: glowing eyes, a bloody mouth). */
function face(k: Kit, a: Appearance, skin: number, hair: number, undead = false): void {
  const shade = mix(skin, 0x000000, 0.18)
  k.on('head').box(skin, [H.x * 2, H.y * 2, H.z * 2])
  k.box(skin, [0.13, 0.07, 0.13], [0, -H.y - 0.03, 0.01]) // neck
  for (const s of SIDES) k.box(shade, [0.025, 0.06, 0.05], [s * (H.x + 0.01), -0.005, 0.01])
  // Eyes: a white, the iris in the chosen colour, a dark pupil; brows in the hair colour.
  const iris = pickOf(EYE_COLORS, a.eyes)
  for (const s of SIDES) {
    if (undead) k.box('eyes', [0.056, 0.036, 0.01], [s * 0.066, 0.025, FZ - 0.003])
    else {
      k.box(0xf4f1ea, [0.056, 0.036, 0.01], [s * 0.066, 0.025, FZ - 0.003])
      k.box(iris, [0.03, 0.036, 0.012], [s * 0.062, 0.025, FZ - 0.004])
      k.box(0x0c0c0e, [0.014, 0.018, 0.013], [s * 0.062, 0.025, FZ - 0.005])
    }
    k.box(hair, [0.072, 0.016, 0.012], [s * 0.066, 0.063, FZ - 0.003])
  }
  if (a.body === 1)
    for (const s of SIDES) k.box(0x15151a, [0.012, 0.012, 0.013], [s * 0.096, 0.042, FZ - 0.004])
  k.box(shade, [0.04, 0.055, 0.03], [0, -0.022, FZ - 0.012]) // nose
  const lips = a.body === 1 ? mix(skin, 0xa83a44, 0.45) : mix(skin, 0x5a2a22, 0.45)
  k.box(lips, [0.085, 0.016, 0.01], [0, -0.088, FZ - 0.004])
  if (undead) {
    k.box(0x1a0606, [0.09, 0.03, 0.012], [0, -0.09, FZ - 0.005]) // hanging open
    k.box(BLOOD, [0.03, 0.06, 0.012], [0.03, -0.12, FZ - 0.005]) // and dripping
  }
}

type Hair = (crown: Kit, rest: Kit, color: number, skin: number) => void

/** The back of the head and the sides above (or over) the ears, down to `bottom`. */
function backAndSides(k: Kit, color: number, bottom: number, out = 0.005, sideBottom = 0.02): void {
  const top = H.y
  k.box(color, [H.x * 2 + out * 4, top - bottom, 0.03], [0, (top + bottom) / 2, H.z + out])
  for (const s of SIDES) {
    k.box(color, [0.02, top - sideBottom, 0.22], [s * (H.x + out), (top + sideBottom) / 2, 0.03])
  }
}

const HAIR: Record<(typeof HAIR_STYLES)[number], Hair> = {
  bald: () => {},
  buzz: (_crown, k, color, skin) => {
    const fuzz = mix(skin, color, 0.6)
    k.box(fuzz, [0.306, 0.03, 0.306], [0, H.y, 0])
    k.box(fuzz, [0.306, 0.2, 0.012], [0, 0.06, H.z + 0.003])
    for (const s of SIDES) k.box(fuzz, [0.012, 0.12, 0.2], [s * (H.x + 0.003), 0.08, 0.04])
    k.box(fuzz, [0.306, 0.025, 0.012], [0, H.y - 0.0125, FZ - 0.003])
  },
  short: (crown, k, color) => {
    crown.box(color, [0.32, 0.09, 0.32], [0, H.y + 0.02, 0])
    k.box(color, [0.32, 0.06, 0.05], [0, H.y - 0.04, FZ + 0.01])
    backAndSides(k, color, -0.05)
  },
  'side part': (crown, k, color) => {
    const dark = mix(color, 0x000000, 0.2)
    crown.box(color, [0.14, 0.07, 0.32], [-0.09, H.y + 0.015, 0])
    crown.box(color, [0.19, 0.1, 0.32], [0.065, H.y + 0.03, 0])
    crown.box(dark, [0.01, 0.071, 0.24], [-0.02, H.y + 0.015, -0.03]) // the parting
    k.box(color, [0.22, 0.06, 0.05], [0.04, H.y - 0.025, FZ + 0.005], [0, 0, -0.12])
    backAndSides(k, color, -0.05)
  },
  messy: (crown, k, color) => {
    const rnd = seeded(7)
    crown.box(color, [0.32, 0.08, 0.32], [0, H.y + 0.015, 0])
    for (let i = 0; i < 11; i++) {
      const x = (rnd() - 0.5) * 0.26
      const z = (rnd() - 0.5) * 0.26
      const tufts = [0.05 + rnd() * 0.04, 0.05 + rnd() * 0.05, 0.05 + rnd() * 0.04] as const
      crown.box(color, tufts, [x, H.y + 0.05 + rnd() * 0.03, z], [rnd() - 0.5, rnd(), rnd() - 0.5])
    }
    for (let i = 0; i < 5; i++) {
      const x = -0.12 + i * 0.06
      k.box(
        color,
        [0.06, 0.05 + rnd() * 0.05, 0.04],
        [x, H.y - 0.03, FZ + 0.005],
        [0, 0, (rnd() - 0.5) * 0.6],
      )
    }
    backAndSides(k, color, -0.08, 0.008)
  },
  mohawk: (crown, k, color, skin) => {
    const shaved = mix(skin, color, 0.35)
    k.box(shaved, [0.306, 0.012, 0.306], [0, H.y - 0.002, 0])
    for (const s of SIDES) k.box(shaved, [0.012, 0.12, 0.2], [s * (H.x + 0.003), 0.08, 0.04])
    k.box(shaved, [0.306, 0.2, 0.012], [0, 0.06, H.z + 0.003])
    // The crest, front to back, in uneven spikes.
    for (let i = 0; i < 5; i++) {
      const h = 0.1 + ((i * 3) % 4) * 0.025
      crown.box(color, [0.07, h, 0.066], [0, H.y + h / 2 - 0.01, -0.13 + i * 0.065])
    }
    crown.box(color, [0.07, 0.14, 0.04], [0, 0.08, H.z + 0.02])
  },
  bob: (crown, k, color) => {
    crown.box(color, [0.33, 0.08, 0.33], [0, H.y + 0.015, 0])
    k.box(color, [0.33, 0.07, 0.05], [0, H.y - 0.05, FZ + 0.005])
    k.box(color, [0.33, 0.3, 0.04], [0, 0, H.z + 0.02])
    for (const s of SIDES) k.box(color, [0.04, 0.28, 0.26], [s * (H.x + 0.02), -0.02, 0.02])
  },
  ponytail: (crown, k, color) => {
    crown.box(color, [0.32, 0.06, 0.32], [0, H.y + 0.01, 0])
    k.box(color, [0.32, 0.04, 0.04], [0, H.y - 0.02, FZ + 0.01])
    backAndSides(k, color, -0.04)
    k.box(mix(color, 0x000000, 0.4), [0.075, 0.04, 0.05], [0, 0.04, H.z + 0.035]) // hair tie
    k.box(color, [0.07, 0.28, 0.06], [0, -0.1, H.z + 0.07], [-0.3, 0, 0])
  },
  long: (crown, k, color) => {
    crown.box(color, [0.33, 0.08, 0.33], [0, H.y + 0.015, 0])
    for (const s of SIDES) {
      k.box(color, [0.14, 0.07, 0.05], [s * 0.085, H.y - 0.04, FZ + 0.005], [0, 0, s * 0.25])
      k.box(color, [0.04, 0.42, 0.24], [s * (H.x + 0.02), -0.08, 0.03])
    }
    k.box(color, [0.34, 0.5, 0.05], [0, -0.1, H.z + 0.02])
  },
  bun: (crown, k, color) => {
    crown.box(color, [0.32, 0.05, 0.32], [0, H.y + 0.005, 0])
    crown.box(color, [0.13, 0.11, 0.12], [0, H.y + 0.07, 0.06])
    k.box(color, [0.32, 0.035, 0.04], [0, H.y - 0.02, FZ + 0.01])
    backAndSides(k, color, -0.06)
  },
}

type Beard = (k: Kit, color: number, skin: number) => void

const moustache = (k: Kit, color: number) => {
  k.box(color, [0.12, 0.03, 0.025], [0, -0.064, FZ - 0.012])
  for (const s of SIDES) k.box(color, [0.025, 0.04, 0.02], [s * 0.058, -0.08, FZ - 0.01])
}

/** Indexed like BEARDS (0 = none). */
const BEARD: Beard[] = [
  () => {},
  (k, color, skin) => {
    const stubble = mix(skin, color, 0.3)
    k.box(stubble, [0.29, 0.09, 0.008], [0, -0.115, FZ - 0.002])
    k.box(stubble, [0.1, 0.02, 0.008], [0, -0.066, FZ - 0.002])
    for (const s of SIDES) k.box(stubble, [0.008, 0.12, 0.18], [s * (H.x + 0.003), -0.09, -0.04])
  },
  moustache,
  (k, color) => {
    moustache(k, color)
    k.box(color, [0.085, 0.075, 0.03], [0, -0.128, FZ - 0.012])
  },
  (k, color) => {
    k.box(color, [0.3, 0.12, 0.035], [0, -0.12, FZ - 0.014])
    for (const s of SIDES) k.box(color, [0.03, 0.18, 0.22], [s * (H.x + 0.012), -0.07, -0.03])
    k.box(color, [0.14, 0.035, 0.04], [0, -0.062, FZ - 0.02])
    k.box(color, [0.24, 0.06, 0.07], [0, -0.18, FZ + 0.015])
    k.box(0x2a1612, [0.07, 0.014, 0.01], [0, -0.09, FZ - 0.033]) // mouth
  },
]
