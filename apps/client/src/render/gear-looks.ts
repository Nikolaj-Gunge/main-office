import {
  BODY_LOOKS,
  bodyLook,
  FEET_LOOKS,
  feetLook,
  HEAD_LOOKS,
  headLook,
  LEGS_LOOKS,
  legsLook,
  PART_SIZES,
} from '@office-fps/shared'
import * as THREE from 'three'
import { ARM_LENGTH, type Baked, Kit, seeded } from './body-kit.ts'

/**
 * Survival gear as other people see it: one head piece, one body piece, trousers and footwear
 * (gear.ts packs them into the replicated `gear` value). Pieces are decoration on the part
 * groups, a little larger than the parts they cover, baked once per look into one
 * vertex-coloured mesh per part. People in survival always wear a legs and a feet look (grey
 * joggers and bare feet to start with); zombies only ever show head and body pieces.
 */

const H = PART_SIZES.head
const C = PART_SIZES.chest
const S = PART_SIZES.stomach
const T = PART_SIZES.thighL
const N = PART_SIZES.shinL
const L = ARM_LENGTH
const SIDES = [-1, 1] as const
const ARMS = ['armL', 'armR'] as const
/** Legs with the side their outside faces (left is −x). */
const THIGHS = [
  ['thighL', -1],
  ['thighR', 1],
] as const
const SHINS = [
  ['shinL', -1],
  ['shinR', 1],
] as const

/** Shells: just over the chest, stomach and sleeves (sleeves stop short of the hands). */
const SHELL_CHEST = [C.x * 2 + 0.03, C.y * 2 + 0.012, C.z * 2 + 0.03] as const
const SHELL_STOMACH = [S.x * 2 + 0.03, S.y * 2 + 0.01, S.z * 2 + 0.03] as const
const SLEEVE = [0.14, L - 0.08, 0.16] as const
/** Centre of a sleeve: from just past the shoulder end (no z-fighting caps) to the wrist. */
const SLEEVE_Y = -0.06
const CZ = -C.z - 0.016 // front faces of the shells
const SZ = -S.z - 0.016

function makePoliceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 16
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.fillStyle = '#e8ecf0'
  ctx.fillRect(0, 0, 64, 16)
  ctx.fillStyle = '#141c30'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('POLICE', 32, 9)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
/** The reflective POLICE strip (catches a little light even at night). */
const policeStrip = new THREE.MeshLambertMaterial({
  map: makePoliceTexture(),
  emissive: 0x30343a,
})

type Build = (k: Kit) => void

const HEAD: Record<number, Build> = {
  [HEAD_LOOKS.cap]: (k) => {
    const red = 0xa82828
    k.on('head').box(red, [0.335, 0.1, 0.335], [0, H.y + 0.04, 0.005])
    k.box(red, [0.3, 0.025, 0.16], [0, H.y + 0.0, -H.z - 0.07], [-0.12, 0, 0]) // brim
    k.box(0xeaeaea, [0.04, 0.02, 0.04], [0, H.y + 0.1, 0.005])
  },
  [HEAD_LOOKS.beanie]: (k) => {
    const knit = 0x2f5a78
    k.on('head').box(knit, [0.33, 0.15, 0.33], [0, H.y + 0.04, 0])
    k.box(0x264a64, [0.345, 0.06, 0.345], [0, H.y - 0.03, 0]) // turned-up cuff
    k.box(0xd8d8d0, [0.08, 0.06, 0.08], [0, H.y + 0.14, 0]) // pompom
  },
  [HEAD_LOOKS.hardhat]: (k) => {
    const yellow = 0xf0be14
    const dome = new THREE.SphereGeometry(0.19, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2)
    k.on('head').add(yellow, dome, [0, H.y - 0.02, 0], [0, 0, 0], [1, 0.78, 1.08])
    k.add(
      yellow,
      new THREE.CylinderGeometry(0.235, 0.235, 0.025, 12),
      [0, H.y - 0.01, -0.03],
      [0, 0, 0],
      [1, 1, 1.18],
    )
    k.box(0xd8a80c, [0.05, 0.04, 0.34], [0, H.y + 0.13, 0])
  },
  [HEAD_LOOKS.helmet]: (k) => {
    const olive = 0x4c5634
    const dome = new THREE.SphereGeometry(0.205, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2)
    k.on('head').add(olive, dome, [0, H.y - 0.03, 0.01], [0, 0, 0], [1, 0.82, 1.08])
    k.add(
      olive,
      new THREE.CylinderGeometry(0.21, 0.225, 0.07, 12),
      [0, H.y - 0.06, 0.01],
      [0, 0, 0],
      [1, 1, 1.08],
    )
    k.box(0x343a24, [0.43, 0.03, 0.46], [0, H.y - 0.03, 0.01]) // cover band
    k.box(0x1e1e1a, [0.14, 0.05, 0.03], [0, H.y - 0.01, -0.235]) // NVG mount
    for (const s of SIDES) k.box(0x262620, [0.015, 0.2, 0.03], [s * 0.158, -0.04, -0.03])
    k.box(0x262620, [0.2, 0.015, 0.04], [0, -H.y + 0.01, -0.1])
  },
  [HEAD_LOOKS.bandana]: (k) => {
    const red = 0x9a1c1c
    k.on('head').box(red, [0.32, 0.13, 0.32], [0, -0.07, 0])
    k.box(red, [0.15, 0.15, 0.014], [0, -0.14, -H.z - 0.012], [0, 0, Math.PI / 4]) // the point
    k.box(red, [0.07, 0.06, 0.05], [0, -0.04, H.z + 0.02]) // knot
    for (const s of SIDES)
      k.box(red, [0.04, 0.14, 0.014], [s * 0.03, -0.12, H.z + 0.04], [0.2, 0, s * 0.2])
    const rnd = seeded(5)
    for (let i = 0; i < 9; i++) {
      const x = -0.12 + rnd() * 0.24
      const y = -0.12 + rnd() * 0.09
      k.box(0xf0e8d8, [0.02, 0.02, 0.01], [x, y, -H.z - 0.012])
    }
  },
  [HEAD_LOOKS.cowboy]: (k) => {
    const hide = 0x7a5230
    k.on('head').add(
      hide,
      new THREE.CylinderGeometry(0.3, 0.3, 0.02, 14),
      [0, H.y + 0.01, 0],
      [0, 0, 0],
      [1, 1, 1.12],
    )
    for (const s of SIDES)
      k.box(hide, [0.1, 0.02, 0.5], [s * 0.27, H.y + 0.05, 0], [0, 0, s * 0.55])
    k.box(hide, [0.25, 0.16, 0.3], [0, H.y + 0.09, 0])
    k.box(0x5a3a20, [0.06, 0.03, 0.22], [0, H.y + 0.16, 0]) // the crease
    k.box(0x2a1a10, [0.255, 0.035, 0.305], [0, H.y + 0.035, 0]) // band
  },
  [HEAD_LOOKS.gasmask]: (k) => {
    const rubber = 0x1c1e20
    const fz = -H.z - 0.025
    k.on('head').box(rubber, [0.3, 0.26, 0.05], [0, -0.03, fz])
    k.box(rubber, [0.31, 0.035, 0.31], [0, 0.06, 0]) // strap round the head
    k.box(rubber, [0.03, 0.03, 0.31], [0, H.y + 0.01, 0]) // over the top
    for (const s of SIDES) {
      const lens = new THREE.CylinderGeometry(0.048, 0.048, 0.03, 10)
      k.add(0x0a0a0a, lens, [s * 0.068, 0.03, fz - 0.02], [Math.PI / 2, 0, 0], [1.12, 1, 1.12])
      const glass = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10)
      k.add(0x8fb8c0, glass, [s * 0.068, 0.03, fz - 0.027], [Math.PI / 2, 0, 0])
    }
    const canister = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10)
    k.add(0x4a5236, canister, [0, -0.11, fz - 0.07], [Math.PI / 2 - 0.4, 0, 0])
    k.box(0x2a2e1e, [0.08, 0.02, 0.08], [0, -0.13, fz - 0.115], [-0.4, 0, 0])
  },
}

/** A shell over chest, stomach and both sleeves in one colour. */
function shells(k: Kit, chest: number, stomach = chest, sleeves: number | null = chest): void {
  k.on('chest').box(chest, SHELL_CHEST)
  k.on('stomach').box(stomach, SHELL_STOMACH)
  if (sleeves !== null) for (const arm of ARMS) k.on(arm).box(sleeves, SLEEVE, [0, SLEEVE_Y, 0])
}

const BODY: Record<number, Build> = {
  [BODY_LOOKS.hoodie]: (k) => {
    const grey = 0x5c616b
    const rib = 0x484c55
    shells(k, grey)
    k.on('chest').box(rib, [0.38, 0.16, 0.16], [0, C.y + 0.02, C.z + 0.05]) // the hood, down
    k.box(rib, [0.24, 0.06, 0.06], [0, C.y + 0.06, C.z + 0.02])
    for (const s of SIDES) k.box(0xe2e2dc, [0.014, 0.13, 0.014], [s * 0.05, C.y - 0.09, CZ - 0.006])
    k.on('stomach').box(rib, [0.26, 0.13, 0.014], [0, -0.02, SZ - 0.004]) // pouch pocket
    k.box(rib, [S.x * 2 + 0.035, 0.05, S.z * 2 + 0.035], [0, -S.y + 0.025, 0])
    for (const arm of ARMS) k.on(arm).box(rib, [0.145, 0.06, 0.165], [0, L / 2 - 0.13, 0])
  },
  [BODY_LOOKS.jacket]: (k) => {
    const leather = 0x3a281c
    const edge = 0x241810
    // Open down the front: the shirt (and tie) show between the panels.
    for (const s of SIDES) {
      k.on('chest').box(leather, [0.2, SHELL_CHEST[1], SHELL_CHEST[2]], [s * 0.145, 0, 0])
      k.box(edge, [0.11, 0.07, 0.03], [s * 0.1, C.y - 0.03, CZ - 0.008], [0, 0, s * 0.45]) // lapel
      k.box(0x9a9aa0, [0.008, 0.3, 0.008], [s * 0.046, 0, CZ - 0.004]) // zip
      k.on('stomach').box(leather, [0.18, SHELL_STOMACH[1], SHELL_STOMACH[2]], [s * 0.135, 0, 0])
      k.box(edge, [0.1, 0.012, 0.012], [s * 0.13, 0.02, SZ - 0.004]) // pocket flap
    }
    k.on('chest').box(leather, [0.1, SHELL_CHEST[1], 0.14], [0, 0, 0.075])
    k.box(edge, [0.4, 0.08, 0.05], [0, C.y + 0.02, C.z]) // collar
    k.on('stomach').box(leather, [0.1, SHELL_STOMACH[1], 0.13], [0, 0, 0.07])
    k.box(edge, [S.x * 2 + 0.035, 0.05, S.z * 2 + 0.035], [0, -S.y + 0.03, 0.0])
    for (const arm of ARMS) {
      k.on(arm).box(leather, SLEEVE, [0, SLEEVE_Y, 0])
      k.box(edge, [0.145, 0.04, 0.165], [0, L / 2 - 0.12, 0])
    }
  },
  [BODY_LOOKS.camo]: (k) => {
    shells(k, 0x5a6440)
    const blots = [0x3a4228, 0x7a7448, 0x26281c, 0x6a5a3a]
    const rnd = seeded(11)
    const blot = (w: number, h: number, at: [number, number, number], ry: number) =>
      k.box(blots[Math.floor(rnd() * blots.length)] as number, [w, h, 0.008], at, [
        0,
        ry,
        rnd() * 0.6,
      ])
    for (const [part, [hx, hy, hz]] of [
      ['chest', SHELL_CHEST],
      ['stomach', SHELL_STOMACH],
    ] as const) {
      k.on(part)
      for (let i = 0; i < 14; i++) {
        const front = i % 2 ? -1 : 1
        const x = (rnd() - 0.5) * (hx - 0.08)
        const y = (rnd() - 0.5) * (hy - 0.06)
        blot(0.06 + rnd() * 0.07, 0.04 + rnd() * 0.05, [x, y, front * (hz / 2 + 0.004)], 0)
      }
      for (const s of SIDES) {
        for (let i = 0; i < 3; i++) {
          const z = (rnd() - 0.5) * (hz - 0.06)
          const y = (rnd() - 0.5) * (hy - 0.06)
          blot(0.05 + rnd() * 0.05, 0.04 + rnd() * 0.04, [s * (hx / 2 + 0.004), y, z], Math.PI / 2)
        }
      }
    }
    for (const arm of ARMS) {
      k.on(arm)
      for (let i = 0; i < 8; i++) {
        const y = -L / 2 + 0.06 + rnd() * (L - 0.2)
        const face = i % 4
        const at: [number, number, number] =
          face < 2 ? [0, y, (face ? 1 : -1) * 0.084] : [(face === 2 ? 1 : -1) * 0.074, y, 0]
        blot(0.06, 0.05 + rnd() * 0.06, at, face < 2 ? 0 : Math.PI / 2)
      }
    }
  },
  [BODY_LOOKS.police]: (k) => {
    const navy = 0x1a2236
    const shirt = 0x86a2c4
    shells(k, navy, navy, shirt)
    k.on('chest').box(policeStrip, [0.34, 0.075, 0.012], [0, -0.04, CZ - 0.004])
    k.box(policeStrip, [0.4, 0.09, 0.012], [0, 0.03, -CZ + 0.004])
    k.box(0xd2a838, [0.045, 0.055, 0.01], [-0.12, 0.08, CZ - 0.005]) // badge
    k.box(0x111111, [0.06, 0.09, 0.04], [0.15, 0.09, CZ - 0.02]) // radio
    k.box(0x111111, [0.02, 0.04, 0.02], [0.17, 0.155, CZ - 0.02])
    for (const s of SIDES) k.box(navy, [0.1, 0.03, 0.3], [s * 0.13, C.y + 0.012, 0])
    k.on('stomach').box(0x101010, [S.x * 2 + 0.04, 0.06, S.z * 2 + 0.04], [0, -S.y + 0.03, 0])
    k.box(0x101010, [0.06, 0.1, 0.05], [0.2, -S.y + 0.0, -0.04]) // holster
    k.box(0x101010, [0.07, 0.06, 0.04], [-0.12, -S.y + 0.03, SZ - 0.015]) // cuffs pouch
  },
  [BODY_LOOKS.military]: (k) => {
    const coyote = 0x6e6246
    const strap = 0x4e4630
    const olive = 0x4c5236
    for (const arm of ARMS) k.on(arm).box(olive, SLEEVE, [0, SLEEVE_Y, 0])
    k.on('chest').box(olive, SHELL_CHEST)
    // Plates front and back, shoulder straps, pouches in rows.
    k.box(coyote, [0.42, 0.3, 0.05], [0, -0.01, CZ - 0.01])
    k.box(coyote, [0.42, 0.3, 0.05], [0, -0.01, -CZ + 0.01])
    for (const s of SIDES) k.box(coyote, [0.09, 0.04, 0.34], [s * 0.13, C.y + 0.02, 0])
    for (let i = 0; i < 3; i++) k.box(strap, [0.4, 0.012, 0.012], [0, -0.1 + i * 0.07, CZ - 0.04])
    k.box(strap, [0.16, 0.1, 0.04], [0, 0.05, CZ - 0.05]) // admin pouch
    k.box(0x1a1a1a, [0.012, 0.22, 0.012], [0.14, C.y + 0.08, -CZ + 0.02], [0.2, 0, 0]) // antenna
    k.box(0x2a2a22, [0.08, 0.12, 0.05], [0.12, 0.0, -CZ + 0.05]) // radio
    k.on('stomach').box(olive, SHELL_STOMACH)
    k.box(coyote, [S.x * 2 + 0.05, 0.14, S.z * 2 + 0.05], [0, 0.07, 0]) // cummerbund
    for (let i = 0; i < 3; i++) {
      k.box(strap, [0.085, 0.13, 0.06], [-0.1 + i * 0.1, 0.06, SZ - 0.04]) // magazine pouches
      k.box(coyote, [0.085, 0.03, 0.065], [-0.1 + i * 0.1, 0.125, SZ - 0.04])
    }
    k.box(0x1c1c18, [S.x * 2 + 0.04, 0.05, S.z * 2 + 0.04], [0, -S.y + 0.03, 0])
  },
  [BODY_LOOKS.raincoat]: (k) => {
    const yellow = 0xe6c21e
    const fold = 0xc8a614
    shells(k, yellow)
    k.on('chest').box(fold, [0.34, 0.12, 0.13], [0, C.y + 0.02, C.z + 0.04]) // hood down
    for (let i = 0; i < 2; i++)
      k.box(0x222222, [0.03, 0.03, 0.012], [0.04, 0.06 - i * 0.12, CZ - 0.004])
    k.box(fold, [0.012, SHELL_CHEST[1], 0.012], [0.02, 0, CZ - 0.002])
    // Long: the skirt hangs to mid-thigh, flaring a little.
    k.on('stomach').box(yellow, [0.47, 0.26, 0.29], [0, -S.y - 0.11, 0])
    k.box(fold, [0.012, 0.5, 0.012], [0.02, -0.12, -0.147])
    for (let i = 0; i < 2; i++)
      k.box(0x222222, [0.03, 0.03, 0.012], [0.04, 0.0 - i * 0.12, SZ - 0.004])
    for (const s of SIDES) k.box(fold, [0.1, 0.012, 0.03], [s * 0.12, -0.02, SZ - 0.004]) // pocket flaps
    for (const arm of ARMS) k.on(arm).box(yellow, [0.15, L - 0.04, 0.17], [0, -0.04, 0])
  },
  [BODY_LOOKS.flannel]: (k) => {
    const red = 0x9a2c26
    const dark = 0x2a1210
    const light = 0xc8584a
    shells(k, red)
    // Plaid: dark bands right round the shell, both ways, with a few lighter ones between.
    for (const [part, [w, h, d]] of [
      ['chest', SHELL_CHEST],
      ['stomach', SHELL_STOMACH],
    ] as const) {
      k.on(part)
      for (const y of [-0.1, 0.0, 0.1]) k.box(dark, [w + 0.006, 0.025, d + 0.006], [0, y, 0])
      for (const x of [-0.16, -0.055, 0.055, 0.16])
        k.box(dark, [0.025, h + 0.006, d + 0.006], [x, 0, 0])
      for (const y of [-0.05, 0.05]) k.box(light, [w + 0.004, 0.01, d + 0.004], [0, y, 0])
    }
    k.on('chest').box(dark, [0.32, 0.05, 0.06], [0, C.y - 0.01, CZ + 0.01]) // collar
    for (const arm of ARMS) {
      k.on(arm)
      for (const y of [-0.18, -0.04, 0.1]) k.box(dark, [0.146, 0.03, 0.166], [0, y, 0])
      k.box(dark, [0.026, L - 0.08, 0.166], [0, SLEEVE_Y, 0])
    }
  },
}

/** Trouser legs end this far above the sole (ankles and feet are the feet look's). */
const HEM = 0.07
const SHIN_LEG = [N.x * 2, N.y * 2 - HEM, N.z * 2] as const
const SHIN_LEG_Y = HEM / 2

/**
 * Trousers in one colour: both legs and a waistband round the bottom of the stomach, `hips`
 * wide (wider on the feminine build).
 */
function trousers(k: Kit, color: number, hips: number): void {
  for (const [thigh] of THIGHS) k.on(thigh).box(color, [T.x * 2, T.y * 2, T.z * 2])
  for (const [shin] of SHINS) k.on(shin).box(color, SHIN_LEG, [0, SHIN_LEG_Y, 0])
  k.on('stomach').box(color, [hips + 0.008, 0.08, S.z * 2 + 0.008], [0, -S.y + 0.04, 0])
}

/** A belt with a buckle over the waistband. */
function belt(k: Kit, color: number, hips: number, buckle = 0xb0a890): void {
  k.on('stomach').box(color, [hips + 0.014, 0.035, S.z * 2 + 0.014], [0, -S.y + 0.055, 0])
  k.box(buckle, [0.05, 0.035, 0.01], [0, -S.y + 0.055, -S.z - 0.008])
}

const TZ = -T.z - 0.003 // fronts of the thighs and shins
const NZ = -N.z - 0.003

type LegsBuild = (k: Kit, hips: number) => void

const LEGS: Record<number, LegsBuild> = {
  [LEGS_LOOKS.joggers]: (k, hips) => {
    const grey = 0x8a8d93
    const rib = 0x6c6f75
    trousers(k, grey, hips)
    for (const [shin] of SHINS)
      k.on(shin).box(rib, [N.x * 2 + 0.008, 0.045, N.z * 2 + 0.008], [0, -N.y + HEM + 0.022, 0])
    k.on('stomach').box(rib, [hips + 0.012, 0.03, S.z * 2 + 0.012], [0, -S.y + 0.065, 0])
    for (const s of SIDES)
      k.box(0xf0f0ec, [0.01, 0.06, 0.008], [s * 0.025, -S.y + 0.03, -S.z - 0.008]) // drawstrings
  },
  [LEGS_LOOKS.jeans]: (k, hips) => {
    const denim = 0x3a5684
    const seam = 0xc49a4a
    trousers(k, denim, hips)
    belt(k, 0x4a2e1c, hips)
    for (const [thigh, side] of THIGHS) {
      k.on(thigh).box(0x2e466c, [0.07, 0.07, 0.008], [side * 0.03, T.y - 0.07, -TZ]) // back pocket
      k.box(seam, [0.006, T.y * 2, 0.006], [side * T.x, 0, 0]) // outside seam
      k.box(0x2e466c, [0.06, 0.012, 0.008], [side * -0.04, T.y - 0.05, TZ], [0, 0, side * 0.6]) // pocket
    }
    for (const [shin, side] of SHINS) {
      k.on(shin).box(seam, [0.006, SHIN_LEG[1], 0.006], [side * N.x, SHIN_LEG_Y, 0])
      k.box(0x30486e, [N.x * 2 + 0.008, 0.03, N.z * 2 + 0.008], [0, -N.y + HEM + 0.015, 0]) // turn-up
    }
  },
  [LEGS_LOOKS.cargo]: (k, hips) => {
    const khaki = 0x7c7252
    const dark = 0x5e5640
    trousers(k, khaki, hips)
    belt(k, 0x2a2a24, hips, 0x5a5a50)
    for (const [thigh, side] of THIGHS) {
      // The big pockets on the outside of each thigh, with flaps.
      k.on(thigh).box(khaki, [0.03, 0.13, 0.13], [side * (T.x + 0.014), -0.03, 0])
      k.box(dark, [0.034, 0.03, 0.135], [side * (T.x + 0.015), 0.035, 0])
      k.box(dark, [0.008, T.y * 2, 0.01], [side * -0.03, 0, TZ]) // front seam
    }
    for (const [shin] of SHINS)
      k.on(shin).box(dark, [N.x * 2 + 0.008, 0.03, N.z * 2 + 0.008], [0, -N.y + HEM + 0.015, 0])
  },
  [LEGS_LOOKS.camo]: (k, hips) => {
    trousers(k, 0x5a6440, hips)
    belt(k, 0x2a2a20, hips, 0x4a4a40)
    const blots = [0x3a4228, 0x7a7448, 0x26281c, 0x6a5a3a]
    const rnd = seeded(23)
    for (const [part, [hx, hy, hz], y0] of [
      ...THIGHS.map(([p]) => [p, [T.x, T.y, T.z], 0] as const),
      ...SHINS.map(([p]) => [p, [N.x, N.y, N.z], SHIN_LEG_Y] as const),
    ]) {
      k.on(part)
      for (let i = 0; i < 9; i++) {
        const color = blots[Math.floor(rnd() * blots.length)] as number
        const face = i % 4
        const y = y0 + (rnd() - 0.5) * (hy * 2 - 0.12)
        const w = 0.05 + rnd() * 0.04
        const h = 0.05 + rnd() * 0.06
        if (face < 2)
          k.box(
            color,
            [w, h, 0.008],
            [(rnd() - 0.5) * hx, y, (face ? 1 : -1) * (hz + 0.003)],
            [0, 0, rnd() * 0.6],
          )
        else
          k.box(
            color,
            [0.008, h, w],
            [(face === 2 ? 1 : -1) * (hx + 0.003), y, (rnd() - 0.5) * hz],
            [rnd() * 0.6, 0, 0],
          )
      }
    }
  },
  [LEGS_LOOKS.work]: (k, hips) => {
    const canvas = 0x46423c
    const pad = 0x1c1c1c
    trousers(k, canvas, hips)
    belt(k, 0x1c1a18, hips)
    for (const [thigh, side] of THIGHS) {
      k.on(thigh).box(canvas, [0.03, 0.1, 0.09], [side * (T.x + 0.014), 0.02, 0.02]) // tool pocket
      if (side === 1) k.box(0x8a8a8e, [0.03, 0.12, 0.012], [side * (T.x + 0.03), 0.02, 0.05]) // ruler
    }
    for (const [shin] of SHINS) {
      k.on(shin).box(pad, [0.13, 0.12, 0.03], [0, N.y - 0.06, NZ - 0.01]) // knee pad
      k.box(0xe87a1c, [N.x * 2 + 0.008, 0.04, N.z * 2 + 0.008], [0, -0.04, 0]) // reflective band
      k.box(0xd8dcd8, [N.x * 2 + 0.01, 0.012, N.z * 2 + 0.01], [0, -0.04, 0])
    }
  },
  [LEGS_LOOKS.police]: (k, hips) => {
    const navy = 0x1a2236
    trousers(k, navy, hips)
    belt(k, 0x101010, hips, 0xc8c8c8)
    for (const [thigh, side] of THIGHS)
      k.on(thigh).box(0x4a6ea8, [0.008, T.y * 2, 0.02], [side * (T.x + 0.002), 0, 0])
    for (const [shin, side] of SHINS)
      k.on(shin).box(0x4a6ea8, [0.008, SHIN_LEG[1], 0.02], [side * (N.x + 0.002), SHIN_LEG_Y, 0])
  },
}

/** A shoe: sole, upper, toe cap; its top `height` up from the ground. */
function shoe(k: Kit, upper: number, sole: number, height: number, width = 0.17): void {
  k.box(sole, [width + 0.01, 0.025, 0.275], [0, -N.y + 0.0125, -0.05])
  k.box(upper, [width, height - 0.02, 0.26], [0, -N.y + 0.025 + (height - 0.025) / 2, -0.05])
}

type FeetBuild = (k: Kit, skin: number) => void

const FEET: Record<number, FeetBuild> = {
  [FEET_LOOKS.barefoot]: (k, skin) => {
    const shade = new THREE.Color(skin).multiplyScalar(0.82).getHex()
    for (const [shin] of SHINS) {
      k.on(shin).box(skin, [0.11, HEM + 0.01, 0.12], [0, -N.y + (HEM + 0.01) / 2, 0]) // ankle
      k.box(skin, [0.13, 0.05, 0.24], [0, -N.y + 0.025, -0.05])
      k.box(shade, [0.132, 0.02, 0.03], [0, -N.y + 0.01, -0.155]) // toes
    }
  },
  [FEET_LOOKS.sneakers]: (k) => {
    for (const [shin] of SHINS) {
      k.on(shin)
      shoe(k, 0xe8e8e4, 0xb8b8b4, 0.085)
      k.box(0xc8362e, [0.172, 0.03, 0.11], [0, -N.y + 0.045, 0.0]) // side stripe
      k.box(0x2a2a2e, [0.07, 0.008, 0.11], [0, -N.y + 0.086, -0.1]) // laces
    }
  },
  [FEET_LOOKS.boots]: (k) => {
    for (const [shin] of SHINS) {
      k.on(shin)
      shoe(k, 0x5a3a22, 0x2a1c12, 0.1, 0.18)
      k.box(0x5a3a22, [0.17, 0.12, 0.19], [0, -N.y + 0.12, 0]) // shaft over the trouser leg
      k.box(0x3a2416, [0.175, 0.025, 0.195], [0, -N.y + 0.17, 0]) // padded collar
      k.box(0xc8a050, [0.06, 0.1, 0.008], [0, -N.y + 0.1, -0.1]) // laces
    }
  },
  [FEET_LOOKS.military]: (k) => {
    for (const [shin] of SHINS) {
      k.on(shin)
      shoe(k, 0x2a2622, 0x121212, 0.1, 0.18)
      k.box(0x2a2622, [0.17, 0.17, 0.19], [0, -N.y + 0.145, 0]) // tall shaft
      k.box(0x8a7a5a, [0.172, 0.06, 0.192], [0, -N.y + 0.19, 0]) // canvas top
      for (let i = 0; i < 4; i++)
        k.box(0x0a0a0a, [0.06, 0.008, 0.008], [0, -N.y + 0.08 + i * 0.04, -0.1])
    }
  },
}

const cache = new Map<string, Baked | null>()

function bake(key: string, build: Build | undefined): Baked | null {
  if (cache.has(key)) return cache.get(key) ?? null
  let baked: Baked | null = null
  if (build) {
    const k = new Kit()
    build(k)
    baked = k.bake()
  }
  cache.set(key, baked)
  return baked
}

/** The head piece and body piece for a replicated gear value (null = nothing shows). */
export function gearBodies(gear: number): { head: Baked | null; body: Baked | null } {
  const h = headLook(gear)
  const b = bodyLook(gear)
  return { head: bake(`h${h}`, HEAD[h]), body: bake(`b${b}`, BODY[b]) }
}

/**
 * A person's trousers and footwear in survival (`hips`: waistband width for their build; `skin`:
 * their skin tone, for bare feet).
 */
export function lowerBody(gear: number, hips: number, skin: number): Baked[] {
  const l = legsLook(gear)
  const f = feetLook(gear)
  const legs = bake(`l${l}:${hips}`, (k) => (LEGS[l] ?? LEGS[0])?.(k, hips))
  const feet = bake(`f${f}:${f === 0 ? skin : 0}`, (k) => (FEET[f] ?? FEET[0])?.(k, skin))
  return [legs, feet].filter((b): b is Baked => b !== null)
}

/** Jackets are worn open: what's under them (tie, collar) stays visible. */
export const showsUnder = (gear: number): boolean => {
  const b = bodyLook(gear)
  return b === BODY_LOOKS.none || b === BODY_LOOKS.jacket
}
