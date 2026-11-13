import { type BaseWeaponId, WeaponId } from '@office-fps/shared'
import * as THREE from 'three'
import type { Action, GunModel, Recoil } from './viewmodel.ts'

/**
 * The survival weapons' models. Each is built like the eight originals in viewmodel.ts (boxes,
 * barrel towards -Z, hands included) and exposes the same parts, so it moves with the recoil,
 * reload and action of the original it handles like. Without the hands the same models lie in
 * the world (gun-models.ts).
 */

/** The weapons that only survival mode has (everything but the eight originals). */
export type SurvivalWeaponId = Exclude<WeaponId, BaseWeaponId>

const STEEL = 0x2b2d33
const FRAME = 0x3a3d45
const WOOD = 0x6b4a2f
const SKIN = 0xc68e6a
const SLEEVE = 0x2e4057
const SIGHT = 0xd8d8d8
const SCOPE = 0x15161a
/** Black plastic and rubber: grips, polymer stocks. */
const BLACK = 0x1a1b1f
/** The grey of military steel. */
const PARKERIZED = 0x4b4e57
const STAINLESS = 0x9096a0
const BRASS = 0xb08a3a
const BLADE = 0xc9ccd2
/** The reddish plywood of Soviet rifles. */
const LAMINATE = 0x8a4f24
const WALNUT = 0x5a3b22
const BIRCH = 0xa27b4b
/** Pale wood of bats and tool handles. */
const ASH = 0xb98a52
const RED = 0xb3261e

const materials = new Map<number, THREE.MeshLambertMaterial>()
function material(color: number): THREE.MeshLambertMaterial {
  let m = materials.get(color)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color })
    materials.set(color, m)
  }
  return m
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color))
  mesh.position.set(x, y, z)
  return mesh
}

/** A box turned about its own middle: + lifts its front end, - its back end (radians). */
function tilted(mesh: THREE.Mesh, pitch: number): THREE.Mesh {
  mesh.rotation.x = pitch
  return mesh
}

/** Skin and sleeves: left out when the gun lies in the world. */
function hand(w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = box(w, h, d, SKIN, x, y, z)
  mesh.userData.hand = true
  return mesh
}

function sleeve(w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = box(w, h, d, SLEEVE, x, y, z)
  mesh.userData.hand = true
  return mesh
}

/** The right hand on the grip and its forearm, where every long gun has them. */
function triggerArm(y = -0.075, z = 0.09): THREE.Mesh[] {
  return [
    hand(0.045, 0.06, 0.06, 0.004, y, z),
    sleeve(0.065, 0.075, 0.26, 0.03, y - 0.025, z + 0.16),
  ]
}

/** The left hand under the forend. */
function supportHand(y: number, z: number): THREE.Mesh {
  return hand(0.055, 0.04, 0.07, -0.01, y, z)
}

/** A cylinder lying along the barrel. */
function drum(radius: number, length: number, color: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 8),
    material(color),
  )
  mesh.rotation.x = Math.PI / 2
  mesh.position.set(x, y, z)
  return mesh
}

const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xff2a2a })

/**
 * An open-frame red dot on a riser (the rifle's sight): you look through the frame, over the gun.
 * `y` is the height of the dot, `z` where the frame stands.
 */
function dotSight(y: number, z: number): THREE.Mesh[] {
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.007, 0.0035), dotMaterial)
  dot.position.set(0, y, z - 0.005)
  return [
    box(0.03, 0.035, 0.07, STEEL, 0, y - 0.045, z + 0.02), // riser
    box(0.005, 0.05, 0.012, STEEL, -0.026, y, z),
    box(0.005, 0.05, 0.012, STEEL, 0.026, y, z),
    box(0.057, 0.006, 0.012, STEEL, 0, y + 0.028, z),
    dot,
  ]
}

/**
 * Tall open sights (the MP5's): a front post with a bright tip between two rear ears. `tip` is
 * the height you aim along, `base` where the posts start.
 */
function postSights(tip: number, frontZ: number, rearZ: number, base: number): THREE.Mesh[] {
  const h = tip - 0.003 - base
  const y = base + h / 2
  return [
    box(0.008, h, 0.012, STEEL, 0, y, frontZ),
    box(0.004, 0.012, 0.012, SIGHT, 0, tip, frontZ),
    box(0.008, h, 0.012, STEEL, -0.012, y, rearZ),
    box(0.008, h, 0.012, STEEL, 0.012, y, rearZ),
  ]
}

function action(part: THREE.Object3D, travel: number, time: number, lockOpen = false): Action {
  return { part, travel, time, rest: part.position.z, lockOpen }
}

function marker(x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D()
  o.position.set(x, y, z)
  return o
}

/** A brass cartridge, fed by hand into revolvers and lever-actions. */
function cartridge(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.01, 0.01, 0.026, 0xc9a24a, 0, 0, 0.004),
    box(0.008, 0.008, 0.012, 0x9a6a42, 0, 0, -0.014),
  )
  return g
}

// ── Pistols ──

interface PistolLook {
  slide: number
  frame: number
  grips: number
  /** Slide length and grip width (m): a single-stack .45 is slimmer than a double-stack 9 mm. */
  length: number
  width: number
  recoil: Recoil
  /** What sets it apart: parts on the frame, and parts that ride on the slide. */
  fixed: THREE.Mesh[]
  riding: THREE.Mesh[]
}

/** A slide-operated pistol in the handgun's shape: same hold, same sights, same reload. */
function pistol(look: PistolLook): GunModel {
  const group = new THREE.Group()
  const back = 0.075
  const front = back - look.length
  const grip = tilted(box(look.width, 0.095, 0.042, look.frame, 0, -0.06, 0.05), -0.18)
  const panels = tilted(box(look.width + 0.004, 0.07, 0.03, look.grips, 0, -0.062, 0.051), -0.18)
  // The slide carries the sights, so they blow back with it.
  const slide = new THREE.Group()
  slide.add(
    box(0.032, 0.03, look.length, look.slide, 0, 0.012, (front + back) / 2),
    box(0.006, 0.006, 0.006, SIGHT, 0, 0.03, front + 0.01), // front sight
    box(0.022, 0.006, 0.006, SIGHT, 0, 0.03, back - 0.01), // rear sight
    ...look.riding,
  )
  const mag = new THREE.Group()
  mag.position.set(0, -0.06, 0.05)
  mag.rotation.x = -0.18
  mag.add(
    box(look.width - 0.006, 0.09, 0.032, STEEL),
    box(look.width + 0.002, 0.012, 0.044, look.frame, 0, -0.051, 0),
  )
  const frameLength = look.length - 0.03
  group.add(
    slide,
    mag,
    box(0.03, 0.022, frameLength, look.frame, 0, -0.012, back - frameLength / 2),
    grip,
    panels,
    ...look.fixed,
    hand(0.045, 0.06, 0.06, 0.004, -0.065, 0.055),
    sleeve(0.06, 0.07, 0.25, 0.02, -0.09, 0.2),
  )
  const muzzle = marker(0, 0.012, front - 0.01)
  const ejectPort = marker(0.02, 0.02, -0.01)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.38),
    ads: new THREE.Vector3(0, -0.071, -0.24),
    recoil: look.recoil,
    action: action(slide, 0.035, 0.09, true),
    mag,
    handRest: new THREE.Vector3(-0.05, -0.2, 0.12),
    handle: new THREE.Vector3(0, 0.03, 0.05),
    tilt: { roll: -0.4, pitch: 0.1 },
  }
}

/** M1911: slim grey steel, wooden grip panels, a hammer spur. */
function m1911(): GunModel {
  return pistol({
    slide: PARKERIZED,
    frame: PARKERIZED,
    grips: WOOD,
    length: 0.2,
    width: 0.027,
    // A .45: a slower, heavier flip than the 9 mm.
    recoil: { back: 0.035, climb: 0.26, roll: 0.07, side: 0.03, recover: 17 },
    fixed: [
      box(0.008, 0.014, 0.012, STEEL, 0, 0.016, 0.083), // hammer
      box(0.012, 0.012, 0.02, PARKERIZED, 0, -0.022, 0.08), // grip safety tang
    ],
    riding: [box(0.016, 0.016, 0.006, STAINLESS, 0, 0.012, -0.127)], // barrel bushing
  })
}

/** Beretta M9: black, fat double-stack grip, the barrel showing through the open slide. */
function m9(): GunModel {
  return pistol({
    slide: BLACK,
    frame: 0x25262b,
    grips: 0x101114,
    length: 0.205,
    width: 0.033,
    recoil: { back: 0.028, climb: 0.18, roll: 0.055, side: 0.03, recover: 21 },
    fixed: [box(0.014, 0.014, 0.014, 0x6a6e77, 0, 0.012, -0.136)], // muzzle past the slide
    riding: [box(0.016, 0.004, 0.075, 0x6a6e77, 0, 0.028, -0.05)], // barrel in the open top
  })
}

/** Suppressed .22 (a Ruger Mark): thin fixed barrel, raked grip, a long can on the front. */
function ruger(): GunModel {
  const group = new THREE.Group()
  // Only the bolt's ears move; barrel and sights stay put.
  const bolt = box(0.034, 0.01, 0.014, STAINLESS, 0, 0.016, 0.077)
  const mag = new THREE.Group()
  mag.position.set(0, -0.06, 0.052)
  mag.rotation.x = -0.3
  mag.add(box(0.018, 0.09, 0.028, STEEL), box(0.026, 0.01, 0.04, BLACK, 0, -0.05, 0))
  group.add(
    box(0.028, 0.028, 0.13, STEEL, 0, 0.014, 0.005), // receiver tube
    bolt,
    box(0.014, 0.014, 0.06, STEEL, 0, 0.014, -0.09), // barrel
    box(0.036, 0.036, 0.17, 0x121316, 0, 0.014, -0.2), // suppressor
    box(0.005, 0.008, 0.008, SIGHT, 0, 0.032, -0.05), // front sight
    box(0.02, 0.008, 0.006, SIGHT, 0, 0.032, 0.06), // rear sight
    box(0.026, 0.02, 0.1, BLACK, 0, -0.008, 0.015), // frame
    mag,
    tilted(box(0.026, 0.1, 0.04, BLACK, 0, -0.058, 0.052), -0.3), // grip
    hand(0.045, 0.06, 0.06, 0.004, -0.065, 0.055),
    sleeve(0.06, 0.07, 0.25, 0.02, -0.09, 0.2),
  )
  const muzzle = marker(0, 0.014, -0.29)
  const ejectPort = marker(0.02, 0.02, 0.03)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.36),
    ads: new THREE.Vector3(0, -0.073, -0.22),
    // Barely moves: a .22 with a weight on the front.
    recoil: { back: 0.01, climb: 0.06, roll: 0.02, side: 0.01, recover: 26 },
    action: action(bolt, 0.03, 0.07, true),
    noFlash: true,
    mag,
    handRest: new THREE.Vector3(-0.05, -0.2, 0.12),
    handle: new THREE.Vector3(0, 0.03, 0.07),
    tilt: { roll: -0.4, pitch: 0.1 },
  }
}

/** .357 revolver: stainless, wooden grip, a cylinder that swings out to be loaded by hand. */
function revolver(): GunModel {
  const group = new THREE.Group()
  // The cylinder hangs on its crane below the frame and swings out to the left.
  const crane = new THREE.Group()
  crane.position.set(-0.004, -0.022, -0.015)
  crane.add(drum(0.021, 0.05, 0x70757f, 0.004, 0.024, 0))
  group.add(
    box(0.02, 0.024, 0.12, STAINLESS, 0, 0.014, -0.105), // barrel
    box(0.012, 0.012, 0.1, STAINLESS, 0, -0.004, -0.1), // lug under the barrel
    box(0.005, 0.012, 0.02, STEEL, 0, 0.032, -0.15), // front sight
    box(0.016, 0.008, 0.09, STAINLESS, 0, 0.0275, -0.01), // top strap
    box(0.018, 0.006, 0.008, STEEL, 0, 0.035, 0.03), // rear sight
    box(0.024, 0.05, 0.012, STAINLESS, 0, 0.002, -0.047), // frame, in front of the cylinder
    box(0.03, 0.055, 0.035, STAINLESS, 0, 0.004, 0.0275), // frame, behind it
    box(0.016, 0.01, 0.075, STAINLESS, 0, -0.024, -0.02), // frame, below it
    crane,
    box(0.008, 0.02, 0.012, STEEL, 0, 0.036, 0.047), // hammer
    box(0.008, 0.006, 0.04, STAINLESS, 0, -0.04, 0.012), // trigger guard
    tilted(box(0.03, 0.09, 0.04, WOOD, 0, -0.062, 0.056), -0.2), // grip
    hand(0.045, 0.06, 0.06, 0.004, -0.065, 0.055),
    sleeve(0.06, 0.07, 0.25, 0.02, -0.09, 0.2),
  )
  const muzzle = marker(0, 0.014, -0.175)
  const ejectPort = marker(0.02, 0.01, -0.015)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.38),
    ads: new THREE.Vector3(0, -0.077, -0.24),
    // A magnum: the muzzle goes for the ceiling and takes its time coming back.
    recoil: { back: 0.045, climb: 0.34, roll: 0.09, side: 0.03, recover: 13 },
    handRest: new THREE.Vector3(-0.05, -0.2, 0.12),
    // Cartridges go in one by one, from behind the swung-out cylinder.
    port: new THREE.Vector3(-0.027, -0.043, 0.03),
    round: cartridge(),
    hinge: { part: crane, axis: 'z', open: 1.35 },
    tilt: { roll: -0.2, pitch: 0.3 },
  }
}

// ── Break-action shotguns ──

/** A side-by-side shotgun that breaks open to load; `sawn` = barrels and stock cut right down. */
function breakAction(sawn: boolean): GunModel {
  const group = new THREE.Group()
  const length = sawn ? 0.2 : 0.5
  const forend = sawn ? 0.1 : 0.2
  // The barrels turn on a pin under them; the breech sits 5 cm behind it, so it lifts clear of
  // the receiver when they drop.
  const pin = new THREE.Vector3(0, -0.02, -0.1)
  const breech = 0.05
  const middle = breech - length / 2
  const barrels = new THREE.Group()
  barrels.position.copy(pin)
  const support = supportHand(-0.035, -0.02 - forend / 2)
  barrels.add(
    box(0.022, 0.024, length, STEEL, -0.012, 0.032, middle),
    box(0.022, 0.024, length, STEEL, 0.012, 0.032, middle),
    box(0.008, 0.006, length, FRAME, 0, 0.045, middle), // rib between them
    box(0.006, 0.008, 0.006, SIGHT, 0, 0.05, breech - length + 0.01), // bead sight
    box(0.046, 0.034, forend, WALNUT, 0, 0.004, -0.02 - forend / 2), // forend
    support,
  )
  group.add(
    box(0.05, 0.056, 0.12, PARKERIZED, 0, -0.002, 0.01), // receiver
    box(0.04, 0.02, 0.06, PARKERIZED, 0, -0.022, -0.08), // knuckle, around the pin
    box(0.008, 0.006, 0.03, STAINLESS, 0, 0.029, 0.04), // top lever
    box(0.006, 0.014, 0.01, STEEL, -0.016, 0.031, 0.06), // hammers
    box(0.006, 0.014, 0.01, STEEL, 0.016, 0.031, 0.06),
    barrels,
    ...triggerArm(),
  )
  if (sawn)
    group.add(tilted(box(0.04, 0.055, 0.12, WALNUT, 0, -0.04, 0.12), 0.5)) // what's left
  else {
    group.add(
      box(0.04, 0.045, 0.08, WALNUT, 0, -0.016, 0.1), // wrist
      box(0.046, 0.075, 0.24, WALNUT, 0, -0.03, 0.24), // stock
    )
  }
  const muzzle = marker(0, 0.012, pin.z + breech - length - 0.01)
  const ejectPort = marker(0.03, 0.015, -0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: sawn ? new THREE.Vector3(0.15, -0.16, -0.4) : new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -0.05, -0.2),
    recoil: sawn
      ? // Nothing to hold on to: it tries to leave your hands.
        { back: 0.07, climb: 0.5, roll: 0.16, side: 0.06, recover: 12 }
      : { back: 0.085, climb: 0.36, roll: 0.11, side: 0.04, recover: 11 },
    support,
    handRest: pin.clone().add(support.position),
    // Shells go into the open breech, the hand coming up beside the gun.
    port: new THREE.Vector3(-0.04, 0.015, 0),
    hinge: { part: barrels, axis: 'x', open: -0.45 },
    tilt: { roll: 0.3, pitch: 0.1 },
  }
}

// ── Kalashnikovs ──

interface KalashnikovLook {
  /** Colour of the stock, grip and handguard. */
  furniture: number
  /** Saiga-12: the shotgun built on the same action (fat barrel, straight box magazine). */
  shotgun: boolean
  recoil: Recoil
  hip: THREE.Vector3
}

/** The AK shape: stamped receiver, gas tube over the barrel, charging handle on the right. */
function kalashnikov(look: KalashnikovLook): GunModel {
  const group = new THREE.Group()
  const bore = look.shotgun ? 0.028 : 0.018
  const barrelEnd = look.shotgun ? -0.5 : -0.52
  const mag = new THREE.Group()
  if (look.shotgun) {
    mag.position.set(0, -0.085, -0.055)
    mag.rotation.x = 0.1
    mag.add(box(0.04, 0.12, 0.062, BLACK))
  } else {
    // The banana: two pieces, the lower one swept further forward.
    mag.position.set(0, -0.065, -0.055)
    mag.rotation.x = 0.15
    mag.add(
      box(0.03, 0.075, 0.05, 0x1f2126),
      tilted(box(0.03, 0.075, 0.05, 0x1f2126, 0, -0.062, -0.02), 0.45),
    )
  }
  const handle = box(0.016, 0.012, 0.03, SIGHT, 0.03, 0.012, -0.02)
  const support = supportHand(-0.05, -0.22)
  group.add(
    box(0.045, 0.055, 0.26, STEEL, 0, 0, 0.01), // receiver
    box(0.04, 0.01, 0.2, FRAME, 0, 0.032, 0.03), // dust cover
    handle,
    box(0.048, 0.045, 0.17, look.furniture, 0, -0.008, -0.205), // handguard
    box(0.03, 0.02, 0.15, look.furniture, 0, 0.03, -0.2), // gas tube cover
    box(bore, bore, -0.29 - barrelEnd, STEEL, 0, 0.004, (-0.29 + barrelEnd) / 2), // barrel
    box(0.022, 0.034, 0.025, STEEL, 0, 0.016, -0.3), // gas block
    ...postSights(0.088, barrelEnd + 0.05, -0.1, 0.01),
    tilted(box(0.04, 0.065, 0.2, look.furniture, 0, -0.022, 0.245), 0.08), // stock
    mag,
    tilted(box(0.028, 0.08, 0.04, look.furniture, 0, -0.065, 0.085), -0.25), // grip
    ...triggerArm(),
    support,
  )
  if (!look.shotgun) group.add(box(0.022, 0.022, 0.025, STEEL, 0, 0.004, -0.53)) // muzzle brake
  const muzzle = marker(0, 0.004, look.shotgun ? -0.51 : -0.55)
  const ejectPort = marker(0.025, 0.02, -0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: look.hip,
    ads: new THREE.Vector3(0, -0.088, -0.28),
    recoil: look.recoil,
    action: action(handle, 0.04, 0.07),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** AK-47: red-brown wood, curved magazine. */
function ak47(): GunModel {
  return kalashnikov({
    furniture: LAMINATE,
    shotgun: false,
    // Kicks harder and settles slower than the rifle.
    recoil: { back: 0.024, climb: 0.07, roll: 0.04, side: 0.03, recover: 18 },
    hip: new THREE.Vector3(0.16, -0.16, -0.44),
  })
}

/** Saiga-12: an all-black AK with a shotgun's barrel and a fat box magazine. */
function saiga(): GunModel {
  return kalashnikov({
    furniture: BLACK,
    shotgun: true,
    // A shotgun's shove, softened by the gas action.
    recoil: { back: 0.06, climb: 0.24, roll: 0.08, side: 0.04, recover: 13 },
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
  })
}

// ── Rifles with wooden stocks ──

/** SKS: one long wooden stock, a small fixed magazine, the bayonet folded under the barrel. */
function sks(): GunModel {
  const group = new THREE.Group()
  const wood = 0x7d5a36
  const mag = new THREE.Group()
  mag.position.set(0, -0.06, -0.035)
  mag.add(box(0.03, 0.036, 0.08, STEEL), box(0.03, 0.02, 0.045, STEEL, 0, -0.02, -0.014))
  const handle = box(0.022, 0.012, 0.022, SIGHT, 0.03, 0.022, 0)
  const support = supportHand(-0.062, -0.22)
  group.add(
    box(0.046, 0.05, 0.48, wood, 0, -0.022, -0.09), // stock, all the way to the handguard
    box(0.042, 0.085, 0.2, wood, 0, -0.032, 0.25), // butt
    box(0.038, 0.036, 0.22, STEEL, 0, 0.018, 0), // receiver
    handle,
    box(0.03, 0.022, 0.15, wood, 0, 0.03, -0.21), // upper handguard
    box(0.018, 0.018, 0.3, STEEL, 0, 0.012, -0.44), // barrel
    box(0.022, 0.03, 0.02, STEEL, 0, 0.022, -0.3), // gas block
    box(0.006, 0.014, 0.24, BLADE, 0, -0.008, -0.45), // folded bayonet
    ...postSights(0.075, -0.56, -0.13, 0.02),
    mag,
    ...triggerArm(-0.07, 0.1),
    support,
  )
  const muzzle = marker(0, 0.012, -0.6)
  const ejectPort = marker(0.03, 0.03, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -0.075, -0.26),
    // One round at a time, each a solid thump.
    recoil: { back: 0.03, climb: 0.1, roll: 0.05, side: 0.02, recover: 16 },
    action: action(handle, 0.04, 0.08),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** Ruger 10/22: a small, light carbine in pale wood with a stubby magazine. */
function carbine22(): GunModel {
  const group = new THREE.Group()
  const mag = new THREE.Group()
  mag.position.set(0, -0.065, -0.04)
  mag.rotation.x = 0.12
  mag.add(box(0.026, 0.06, 0.04, BLACK))
  const handle = box(0.018, 0.01, 0.018, SIGHT, 0.026, 0.018, -0.01)
  const support = supportHand(-0.058, -0.16)
  group.add(
    box(0.044, 0.048, 0.36, BIRCH, 0, -0.022, -0.05), // stock
    box(0.04, 0.08, 0.18, BIRCH, 0, -0.03, 0.22), // butt
    box(0.034, 0.034, 0.16, STEEL, 0, 0.015, 0), // receiver
    handle,
    box(0.014, 0.014, 0.26, STEEL, 0, 0.012, -0.21), // barrel
    box(0.048, 0.012, 0.012, STEEL, 0, 0, -0.22), // barrel band
    ...postSights(0.06, -0.32, -0.06, 0.018),
    mag,
    ...triggerArm(-0.07, 0.09),
    support,
  )
  const muzzle = marker(0, 0.012, -0.35)
  const ejectPort = marker(0.026, 0.02, -0.01)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.16, -0.42),
    ads: new THREE.Vector3(0, -0.06, -0.26),
    // A .22: it twitches.
    recoil: { back: 0.008, climb: 0.025, roll: 0.015, side: 0.01, recover: 26 },
    action: action(handle, 0.03, 0.05),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** Hunting rifle: dark walnut, a long thin barrel, a bolt, and a short scope you look through. */
function huntingRifle(): GunModel {
  const group = new THREE.Group()
  const bolt = new THREE.Group()
  bolt.position.set(0.035, 0.012, 0.05)
  bolt.add(box(0.04, 0.012, 0.012, SIGHT), box(0.016, 0.016, 0.016, BLACK, 0.024, -0.006, 0))
  const mag = new THREE.Group()
  mag.position.set(0, -0.058, -0.03)
  mag.add(box(0.03, 0.016, 0.08, STEEL))
  const support = supportHand(-0.062, -0.2)
  // The scope is a hollow tube (four walls), so aiming you see through it: it only zooms a
  // little and doesn't take over the screen like the sniper's.
  const eye = 0.066
  const inner = 0.022
  const scope = (z: number, length: number, wall: number) => [
    box(2 * (inner + wall), wall, length, SCOPE, 0, eye + inner + wall / 2, z),
    box(2 * (inner + wall), wall, length, SCOPE, 0, eye - inner - wall / 2, z),
    box(wall, 2 * inner, length, SCOPE, -inner - wall / 2, eye, z),
    box(wall, 2 * inner, length, SCOPE, inner + wall / 2, eye, z),
  ]
  group.add(
    mag,
    box(0.036, 0.04, 0.26, STEEL, 0, 0.005, 0), // receiver
    box(0.046, 0.05, 0.44, WALNUT, 0, -0.028, -0.07), // stock
    box(0.042, 0.085, 0.2, WALNUT, 0, -0.032, 0.25), // butt
    box(0.016, 0.016, 0.38, STEEL, 0, 0.008, -0.44), // barrel
    ...scope(-0.06, 0.12, 0.004),
    ...scope(-0.125, 0.014, 0.007), // front bell
    box(0.002, 2 * inner, 0.002, 0x08080a, 0, eye, -0.06), // crosshair
    box(2 * inner, 0.002, 0.002, 0x08080a, 0, eye, -0.06),
    box(0.012, 0.02, 0.014, STEEL, 0, 0.034, -0.1), // scope rings
    box(0.012, 0.02, 0.014, STEEL, 0, 0.034, -0.02),
    bolt,
    ...triggerArm(),
    support,
  )
  const muzzle = marker(0, 0.008, -0.64)
  const ejectPort = marker(0.03, 0.02, 0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -eye, -0.24),
    recoil: { back: 0.05, climb: 0.24, roll: 0.1, side: 0.03, recover: 12 },
    bolt,
    mag,
    support,
    handRest: support.position.clone(),
    handle: bolt.position.clone(),
  }
}

/** Lever-action: brass receiver, tube magazine under the barrel, the lever looped round the hand. */
function leverAction(): GunModel {
  const group = new THREE.Group()
  // The lever turns on a pin ahead of the trigger and takes the hand down with it.
  const lever = new THREE.Group()
  lever.position.set(0, -0.03, 0.02)
  lever.add(
    box(0.02, 0.012, 0.11, STEEL, 0, -0.04, 0.065),
    box(0.02, 0.045, 0.012, STEEL, 0, -0.02, 0.115),
    hand(0.045, 0.06, 0.06, 0.004, -0.035, 0.07),
  )
  const support = supportHand(-0.052, -0.2)
  group.add(
    box(0.04, 0.06, 0.16, BRASS, 0, 0, 0), // receiver
    box(0.008, 0.012, 0.012, STEEL, 0, 0.03, 0.07), // hammer
    box(0.018, 0.018, 0.42, STEEL, 0, 0.012, -0.29), // barrel
    box(0.016, 0.016, 0.38, STEEL, 0, -0.008, -0.27), // tube magazine
    box(0.044, 0.04, 0.2, WOOD, 0, -0.014, -0.19), // forend
    box(0.024, 0.012, 0.012, BRASS, 0, -0.002, -0.3), // forend cap
    box(0.036, 0.04, 0.12, WOOD, 0, -0.012, 0.13), // wrist, above the lever's loop
    tilted(box(0.042, 0.075, 0.2, WOOD, 0, -0.034, 0.27), 0.1), // butt
    box(0.004, 0.028, 0.012, BRASS, 0, 0.035, -0.48), // front sight
    box(0.004, 0.026, 0.008, STEEL, -0.008, 0.036, -0.1), // rear sight
    box(0.004, 0.026, 0.008, STEEL, 0.008, 0.036, -0.1),
    lever,
    sleeve(0.065, 0.075, 0.26, 0.03, -0.1, 0.25),
    support,
  )
  const muzzle = marker(0, 0.012, -0.51)
  const ejectPort = marker(0.025, 0.03, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -0.049, -0.22),
    recoil: { back: 0.04, climb: 0.18, roll: 0.07, side: 0.03, recover: 14 },
    lever,
    support,
    handRest: support.position.clone(),
    // Cartridges go in through the gate, one by one.
    port: new THREE.Vector3(-0.005, -0.045, -0.02),
    round: cartridge(),
    tilt: { roll: -0.45, pitch: 0.2 },
  }
}

// ── Submachine guns ──

/** Uzi: a steel box with the magazine up through the grip and the cocking knob on top. */
function uzi(): GunModel {
  const group = new THREE.Group()
  const body = 0x24262b
  const mag = new THREE.Group()
  mag.position.set(0, -0.11, 0.07)
  mag.add(box(0.024, 0.17, 0.032, STEEL), box(0.028, 0.01, 0.036, FRAME, 0, -0.088, 0))
  const knob = box(0.02, 0.014, 0.024, SIGHT, 0, 0.045, -0.04)
  const support = supportHand(-0.05, -0.07)
  group.add(
    box(0.046, 0.06, 0.3, body, 0, 0, 0), // receiver
    box(0.04, 0.008, 0.26, FRAME, 0, 0.034, 0), // top cover
    knob,
    box(0.03, 0.03, 0.022, FRAME, 0, 0.002, -0.16), // barrel nut
    box(0.018, 0.018, 0.07, STEEL, 0, 0.002, -0.185), // barrel
    ...postSights(0.085, -0.13, 0.13, 0.03),
    box(0.036, 0.012, 0.1, FRAME, 0, -0.036, 0.17), // folded stock
    mag,
    box(0.034, 0.1, 0.046, BLACK, 0, -0.075, 0.07), // grip, around the magazine
    box(0.01, 0.008, 0.05, body, 0, -0.05, 0.02), // trigger guard
    ...triggerArm(-0.08, 0.075),
    support,
  )
  const muzzle = marker(0, 0.002, -0.23)
  const ejectPort = marker(0.025, 0.015, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.4),
    ads: new THREE.Vector3(0, -0.085, -0.32),
    recoil: { back: 0.014, climb: 0.035, roll: 0.025, side: 0.03, recover: 24 },
    action: action(knob, 0.035, 0.05),
    mag,
    support,
    handRest: support.position.clone(),
    handle: knob.position.clone(),
  }
}

/** UMP45: a slab of black polymer with a straight magazine and a skeleton stock. */
function ump(): GunModel {
  const group = new THREE.Group()
  const polymer = 0x2a2c31
  const mag = new THREE.Group()
  mag.position.set(0, -0.1, -0.08)
  mag.rotation.x = 0.05
  mag.add(box(0.03, 0.14, 0.042, BLACK))
  const handle = box(0.03, 0.01, 0.01, SIGHT, -0.03, 0.02, -0.16) // cocking lever, front left
  const support = supportHand(-0.05, -0.2)
  group.add(
    box(0.044, 0.065, 0.3, polymer, 0, 0, -0.03), // receiver
    handle,
    box(0.046, 0.05, 0.1, polymer, 0, -0.008, -0.2), // handguard
    box(0.018, 0.018, 0.05, STEEL, 0, 0.005, -0.275), // barrel
    box(0.02, 0.008, 0.28, STEEL, 0, 0.036, -0.04), // top rail
    ...postSights(0.088, -0.22, 0.08, 0.035),
    // Skeleton stock: two bars and a butt plate, daylight between them.
    box(0.018, 0.016, 0.2, polymer, 0, 0.012, 0.22),
    box(0.018, 0.014, 0.18, polymer, 0, -0.035, 0.23),
    box(0.022, 0.085, 0.022, polymer, 0, -0.012, 0.33),
    mag,
    tilted(box(0.028, 0.075, 0.038, polymer, 0, -0.062, 0.075), -0.25), // grip
    ...triggerArm(-0.07, 0.08),
    support,
  )
  const muzzle = marker(0, 0.005, -0.31)
  const ejectPort = marker(0.024, 0.015, -0.04)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.4),
    ads: new THREE.Vector3(0, -0.088, -0.3),
    // Slower and heavier than the MP5: a thud rather than a buzz.
    recoil: { back: 0.016, climb: 0.045, roll: 0.025, side: 0.025, recover: 22 },
    action: action(handle, 0.025, 0.06),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** MAC-10: a grey brick with a stub of barrel, a long magazine in the grip and a strap to hold. */
function mac10(): GunModel {
  const group = new THREE.Group()
  const mag = new THREE.Group()
  mag.position.set(0, -0.12, 0.07)
  mag.add(box(0.026, 0.18, 0.034, STEEL))
  const knob = box(0.018, 0.014, 0.018, BLACK, 0, 0.036, -0.02)
  const support = supportHand(-0.058, -0.045)
  group.add(
    box(0.052, 0.058, 0.21, PARKERIZED, 0, 0, 0.035), // receiver
    knob,
    box(0.02, 0.02, 0.04, STEEL, 0, -0.004, -0.09), // barrel
    box(0.012, 0.05, 0.014, 0x3b3a2e, 0, -0.045, -0.055), // front strap
    ...postSights(0.06, -0.06, 0.13, 0.029),
    // Wire stock, pushed in.
    box(0.004, 0.004, 0.16, STEEL, -0.029, 0, 0.1),
    box(0.004, 0.004, 0.16, STEEL, 0.029, 0, 0.1),
    box(0.062, 0.04, 0.006, STEEL, 0, 0, 0.183),
    mag,
    box(0.036, 0.095, 0.048, PARKERIZED, 0, -0.075, 0.07), // grip, around the magazine
    ...triggerArm(-0.08, 0.075),
    support,
  )
  const muzzle = marker(0, -0.004, -0.115)
  const ejectPort = marker(0.028, 0.015, 0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.38),
    ads: new THREE.Vector3(0, -0.06, -0.32),
    // Tiny and far too fast: it shakes itself all over the place.
    recoil: { back: 0.016, climb: 0.05, roll: 0.035, side: 0.045, recover: 24 },
    action: action(knob, 0.025, 0.04),
    mag,
    support,
    handRest: support.position.clone(),
    handle: knob.position.clone(),
  }
}

// ── Marksman ──

/** SVD Dragunov: long thin barrel, wooden skeleton stock, the scope sitting off a side rail. */
function svd(): GunModel {
  const group = new THREE.Group()
  const mag = new THREE.Group()
  mag.position.set(0, -0.07, -0.03)
  mag.rotation.x = 0.1
  mag.add(box(0.028, 0.09, 0.06, 0x1f2126))
  const handle = box(0.016, 0.012, 0.03, SIGHT, 0.028, 0.012, -0.02)
  const support = supportHand(-0.045, -0.23)
  group.add(
    mag,
    box(0.04, 0.05, 0.26, STEEL, 0, 0, 0), // receiver
    handle,
    box(0.044, 0.04, 0.2, LAMINATE, 0, -0.002, -0.23), // handguard
    box(0.016, 0.016, 0.36, STEEL, 0, 0.006, -0.51), // barrel
    box(0.022, 0.022, 0.06, STEEL, 0, 0.006, -0.7), // flash hider
    box(0.006, 0.03, 0.01, STEEL, 0, 0.026, -0.65), // front sight
    box(0.03, 0.03, 0.2, SCOPE, 0, 0.062, 0), // scope tube
    box(0.036, 0.036, 0.04, SCOPE, 0, 0.062, -0.11), // hood
    box(0.038, 0.038, 0.05, 0x0e0e10, 0, 0.062, 0.11), // rubber eyepiece
    box(0.012, 0.014, 0.014, SCOPE, 0, 0.084, -0.02), // turret
    box(0.012, 0.024, 0.1, STEEL, -0.014, 0.036, 0), // side mount
    // Skeleton stock: comb above, strut below, the butt joining them.
    box(0.034, 0.032, 0.22, LAMINATE, 0, 0.002, 0.25),
    box(0.03, 0.02, 0.2, LAMINATE, 0, -0.045, 0.27),
    box(0.036, 0.1, 0.03, LAMINATE, 0, -0.025, 0.375),
    box(0.03, 0.012, 0.1, BLACK, 0, 0.024, 0.24), // cheek pad
    tilted(box(0.03, 0.07, 0.035, LAMINATE, 0, -0.055, 0.115), -0.3), // grip
    ...triggerArm(),
    support,
  )
  const muzzle = marker(0, 0.006, -0.74)
  const ejectPort = marker(0.028, 0.02, -0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -0.062, -0.12),
    // Lighter than the bolt-action's heave, and back on target sooner.
    recoil: { back: 0.045, climb: 0.2, roll: 0.09, side: 0.03, recover: 13 },
    action: action(handle, 0.04, 0.08),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

/** Barrett .50: enormous. A slab receiver, a fat barrel with a muzzle brake, a folded bipod. */
function barrett(): GunModel {
  const group = new THREE.Group()
  const body = 0x3b3f37
  const mag = new THREE.Group()
  mag.position.set(0, -0.085, -0.02)
  mag.rotation.x = 0.1
  mag.add(box(0.046, 0.1, 0.12, STEEL))
  const handle = box(0.02, 0.016, 0.035, SIGHT, 0.04, 0.015, -0.05)
  const support = supportHand(-0.062, -0.27)
  group.add(
    mag,
    box(0.06, 0.085, 0.42, body, 0, 0, 0), // receiver
    handle,
    box(0.024, 0.008, 0.36, STEEL, 0, 0.046, 0), // top rail
    box(0.05, 0.06, 0.16, body, 0, 0.004, -0.29), // barrel shroud
    box(0.03, 0.03, 0.36, STEEL, 0, 0.008, -0.55), // barrel
    box(0.075, 0.04, 0.035, STEEL, 0, 0.008, -0.74), // muzzle brake: wide baffle…
    box(0.05, 0.034, 0.03, STEEL, 0, 0.008, -0.772), // …and its nose
    box(0.07, 0.02, 0.02, STEEL, 0, -0.036, -0.3), // bipod yoke
    box(0.012, 0.012, 0.22, STEEL, -0.03, -0.046, -0.41), // bipod legs, folded forward
    box(0.012, 0.012, 0.22, STEEL, 0.03, -0.046, -0.41),
    box(0.036, 0.036, 0.26, SCOPE, 0, 0.09, 0), // scope tube
    box(0.05, 0.05, 0.05, SCOPE, 0, 0.09, -0.15), // front bell
    box(0.044, 0.044, 0.04, SCOPE, 0, 0.09, 0.14), // eyepiece
    box(0.014, 0.03, 0.014, STEEL, 0, 0.062, -0.07), // scope rings
    box(0.014, 0.03, 0.014, STEEL, 0, 0.062, 0.07),
    box(0.055, 0.1, 0.14, body, 0, -0.005, 0.28), // butt
    box(0.055, 0.11, 0.02, BLACK, 0, -0.005, 0.36), // recoil pad
    tilted(box(0.03, 0.085, 0.042, BLACK, 0, -0.08, 0.1), -0.25), // grip
    ...triggerArm(-0.09, 0.1),
    support,
  )
  const muzzle = marker(0, 0.008, -0.8)
  const ejectPort = marker(0.04, 0.02, -0.05)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.18, -0.2, -0.46),
    ads: new THREE.Vector3(0, -0.09, -0.14),
    // It doesn't kick, it shoves you across the room, and it is in no hurry to come back.
    recoil: { back: 0.11, climb: 0.38, roll: 0.14, side: 0.04, recover: 8 },
    action: action(handle, 0.06, 0.14),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
    tilt: { roll: -0.4, pitch: 0.03 },
  }
}

/** A crossbow bolt: shaft, broadhead, two coloured vanes. Origin at the middle of the shaft. */
function crossbowBolt(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.006, 0.006, 0.3, STAINLESS),
    box(0.012, 0.012, 0.03, STEEL, 0, 0, -0.16),
    box(0.02, 0.003, 0.04, RED, 0, 0, 0.12),
    box(0.003, 0.02, 0.04, 0xe6c229, 0, 0, 0.12),
  )
  return g
}

/** Crossbow: limbs swept back from the front, a string you can see cocked or loosed, a red dot. */
function crossbow(): GunModel {
  const group = new THREE.Group()
  const body = 0x3a4030
  const sides = [-1, 1] as const
  // Limbs: each a bar from the riser, swept back towards its tip.
  const sweep = 0.35
  const span = 0.2
  const tipX = 0.03 + span * Math.cos(sweep)
  const tipZ = -0.36 + span * Math.sin(sweep)
  for (const side of sides) {
    const limb = new THREE.Group()
    limb.position.set(side * 0.03, 0, -0.36)
    limb.rotation.y = -side * sweep
    limb.add(box(span, 0.014, 0.022, BLACK, (side * span) / 2, 0, 0))
    group.add(limb)
  }
  // The string: two straight halves from the limb tips to wherever the middle is held.
  const stringY = 0.016
  const travel = 0.24
  const halves = sides.map((side) => ({ side, mesh: box(1, 0.004, 0.004, 0xd9d2c0) }))
  const resting = crossbowBolt()
  const rest = new THREE.Vector3(0, 0.022, -0.2)
  resting.position.copy(rest)
  const set = (drawn: number, loaded: boolean) => {
    const middleZ = tipZ + drawn * travel
    for (const { side, mesh } of halves) {
      mesh.position.set((side * tipX) / 2, stringY, (tipZ + middleZ) / 2)
      mesh.rotation.y = Math.atan2(tipZ - middleZ, -side * tipX)
      mesh.scale.x = Math.hypot(tipX, middleZ - tipZ)
    }
    resting.visible = loaded
  }
  set(1, true)
  const support = supportHand(-0.05, -0.2)
  group.add(
    box(0.036, 0.04, 0.52, body, 0, -0.008, -0.1), // stock and rail
    box(0.01, 0.004, 0.36, BLACK, 0, 0.013, -0.17), // groove the bolt lies in
    box(0.04, 0.085, 0.18, body, 0, -0.03, 0.25), // butt
    box(0.07, 0.034, 0.04, STEEL, 0, 0, -0.36), // riser the limbs bolt on to
    box(0.054, 0.006, 0.006, STEEL, 0, 0, -0.415), // stirrup
    box(0.006, 0.006, 0.04, STEEL, -0.024, 0, -0.395),
    box(0.006, 0.006, 0.04, STEEL, 0.024, 0, -0.395),
    box(0.03, 0.02, 0.07, STEEL, 0, 0.02, 0.01), // latch
    ...dotSight(0.09, 0.02),
    ...halves.map((half) => half.mesh),
    resting,
    tilted(box(0.028, 0.075, 0.038, BLACK, 0, -0.065, 0.08), -0.25), // grip
    ...triggerArm(),
    support,
  )
  const muzzle = marker(0, 0.022, -0.4)
  const ejectPort = marker(0, 0.02, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.14, -0.17, -0.42),
    ads: new THREE.Vector3(0, -0.09, -0.26),
    // No powder: just the slap of the limbs.
    recoil: { back: 0.012, climb: 0.03, roll: 0.01, side: 0.006, recover: 20 },
    noFlash: true,
    support,
    handRest: support.position.clone(),
    // Where the hand hauls the string to, and where it lets go of the new bolt.
    handle: new THREE.Vector3(0, stringY + 0.02, tipZ + travel + 0.01),
    port: new THREE.Vector3(-0.045, 0.03, -0.1),
    round: crossbowBolt(),
    bow: { travel, rest, set },
    tilt: { roll: 0.12, pitch: 0.08 },
  }
}

// ── Melee: built lying along -Z with the hand at the origin, then held up in the fist ──

function bat(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.034, 0.034, 0.02, ASH, 0, 0, 0.055), // knob
    box(0.022, 0.022, 0.3, ASH, 0, 0, -0.1), // handle
    box(0.025, 0.025, 0.16, 0x2b2b2f, 0, 0, -0.02), // grip tape
    box(0.032, 0.032, 0.16, ASH, 0, 0, -0.33), // taper
    box(0.044, 0.044, 0.34, ASH, 0, 0, -0.58), // barrel
  )
  return g
}

function crowbar(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.02, 0.02, 0.52, RED, 0, 0, -0.21), // shaft
    box(0.024, 0.01, 0.03, BLADE, 0, 0, 0.06), // chisel end
    // The hook: round the bend in two pieces, ending in a flat claw pointing back down.
    tilted(box(0.02, 0.02, 0.07, RED, 0, -0.02, -0.5), -0.6),
    tilted(box(0.02, 0.02, 0.07, RED, 0, -0.069, -0.53), -1.5),
    tilted(box(0.026, 0.008, 0.045, BLADE, 0, -0.12, -0.521), -2.2),
  )
  return g
}

function machete(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.026, 0.036, 0.13, BLACK, 0, 0, -0.01), // handle
    box(0.006, 0.05, 0.3, BLADE, 0, 0.004, -0.225), // blade
    box(0.006, 0.062, 0.14, BLADE, 0, -0.002, -0.44), // wider towards the tip
    box(0.004, 0.01, 0.4, 0xe8eaee, 0, -0.027, -0.29), // edge
  )
  return g
}

function axe(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.024, 0.032, 0.62, ASH, 0, 0, -0.26), // handle
    box(0.03, 0.1, 0.075, RED, 0, -0.045, -0.52), // head
    box(0.03, 0.035, 0.05, RED, 0, 0.03, -0.52), // poll
    box(0.012, 0.03, 0.11, 0xd5d8dd, 0, -0.105, -0.52), // edge
  )
  return g
}

function sledge(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.026, 0.026, 0.6, ASH, 0, 0, -0.25), // handle
    box(0.075, 0.15, 0.075, 0x565a62, 0, 0, -0.58), // head
    box(0.066, 0.012, 0.066, 0x8d9199, 0, 0.081, -0.58), // its two faces
    box(0.066, 0.012, 0.066, 0x8d9199, 0, -0.081, -0.58),
  )
  return g
}

function katana(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.022, 0.03, 0.22, 0x15151a, 0, 0, -0.06), // grip
    box(0.024, 0.032, 0.012, BRASS, 0, 0, 0.056), // pommel
    box(0.055, 0.06, 0.008, 0x8a6f3a, 0, 0, -0.175), // guard
    box(0.008, 0.028, 0.02, BRASS, 0, 0, -0.19), // collar
    box(0.005, 0.026, 0.32, 0xdfe3e8, 0, 0, -0.36), // blade…
    tilted(box(0.005, 0.024, 0.26, 0xdfe3e8, 0, 0.008, -0.645), 0.07), // …curving up to the tip
  )
  // The wrap: pale diamonds down the grip.
  for (let i = 0; i < 5; i++) g.add(box(0.024, 0.01, 0.014, 0xe0d8c4, 0, 0, 0.03 - i * 0.04))
  return g
}

interface Hold {
  /** How far the tip is raised and turned in towards the middle of the view (radians). */
  pitch: number
  yaw: number
  /** Turned about its own length, so a head or an edge faces the way it swings. */
  spin: number
  /** Distance from the hand to the tip (m). */
  reach: number
  hip: THREE.Vector3
  recoil: Recoil
}

/** A melee weapon in the fist, held up and ready; it swings like the knife. */
function held(tool: THREE.Group, hold: Hold): GunModel {
  const group = new THREE.Group()
  tool.rotation.set(hold.pitch, hold.yaw, hold.spin)
  const muzzle = marker(0, 0, -hold.reach)
  tool.add(muzzle)
  const ejectPort = marker(0, 0, 0)
  group.add(
    tool,
    hand(0.05, 0.06, 0.07, 0.005, -0.01, 0.01),
    sleeve(0.065, 0.075, 0.26, 0.02, -0.03, 0.18),
    ejectPort,
  )
  return {
    group,
    muzzle,
    ejectPort,
    hip: hold.hip,
    ads: hold.hip,
    recoil: hold.recoil,
    melee: true,
  }
}

/** The melee weapons as they lie (no hand, flat), for the world. */
const TOOLS: Partial<Record<WeaponId, () => THREE.Group>> = {
  [WeaponId.Bat]: bat,
  [WeaponId.Crowbar]: crowbar,
  [WeaponId.Machete]: machete,
  [WeaponId.Axe]: axe,
  [WeaponId.Sledge]: sledge,
  [WeaponId.Katana]: katana,
}

const light = { back: 0.01, climb: 0.04, roll: 0, side: 0, recover: 16 }
const heavy = { back: 0.025, climb: 0.08, roll: 0, side: 0, recover: 10 }

const BUILDERS: Record<SurvivalWeaponId, () => GunModel> = {
  [WeaponId.Bat]: () =>
    held(bat(), {
      pitch: 0.8,
      yaw: 0.1,
      spin: 0,
      reach: 0.75,
      hip: new THREE.Vector3(0.2, -0.2, -0.4),
      recoil: light,
    }),
  [WeaponId.Crowbar]: () =>
    held(crowbar(), {
      pitch: 0.9,
      yaw: 0.15,
      spin: -0.3,
      reach: 0.53,
      hip: new THREE.Vector3(0.19, -0.19, -0.38),
      recoil: light,
    }),
  [WeaponId.Machete]: () =>
    held(machete(), {
      pitch: 0.8,
      yaw: 0.15,
      spin: 0,
      reach: 0.51,
      hip: new THREE.Vector3(0.18, -0.18, -0.38),
      recoil: light,
    }),
  [WeaponId.Axe]: () =>
    held(axe(), {
      pitch: 0.9,
      yaw: 0.12,
      spin: -0.35,
      reach: 0.57,
      hip: new THREE.Vector3(0.2, -0.2, -0.4),
      recoil: heavy,
    }),
  [WeaponId.Sledge]: () =>
    held(sledge(), {
      pitch: 0.9,
      yaw: 0.1,
      spin: -0.3,
      reach: 0.62,
      hip: new THREE.Vector3(0.2, -0.21, -0.4),
      // A lot of iron on a stick: it drags the arm with it.
      recoil: { back: 0.035, climb: 0.1, roll: 0, side: 0, recover: 8 },
    }),
  [WeaponId.Katana]: () =>
    held(katana(), {
      pitch: 0.75,
      yaw: 0.1,
      spin: 0,
      reach: 0.77,
      hip: new THREE.Vector3(0.19, -0.2, -0.4),
      recoil: light,
    }),
  [WeaponId.M1911]: m1911,
  [WeaponId.Revolver]: revolver,
  [WeaponId.M9]: m9,
  [WeaponId.Ruger]: ruger,
  [WeaponId.SawedOff]: () => breakAction(true),
  [WeaponId.Uzi]: uzi,
  [WeaponId.Ump]: ump,
  [WeaponId.Mac10]: mac10,
  [WeaponId.Ak47]: ak47,
  [WeaponId.Sks]: sks,
  [WeaponId.HuntingRifle]: huntingRifle,
  [WeaponId.Carbine22]: carbine22,
  [WeaponId.LeverAction]: leverAction,
  [WeaponId.DoubleBarrel]: () => breakAction(false),
  [WeaponId.AutoShotgun]: saiga,
  [WeaponId.Svd]: svd,
  [WeaponId.Barrett]: barrett,
  [WeaponId.Crossbow]: crossbow,
}

/** A first-person model of every survival weapon, by weapon id. */
export function survivalGuns(): Record<SurvivalWeaponId, GunModel> {
  return Object.fromEntries(Object.entries(BUILDERS).map(([id, build]) => [id, build()])) as Record<
    SurvivalWeaponId,
    GunModel
  >
}

/**
 * A survival weapon as it lies in the world: its first-person model without the hands, resting
 * on y = 0 (melee weapons flat, and centred so they turn about their middle). `null` for the
 * eight originals, which gun-models.ts builds itself.
 */
export function survivalWorldModel(id: WeaponId): THREE.Group | null {
  const tool = TOOLS[id]
  const build = (BUILDERS as Partial<Record<WeaponId, () => GunModel>>)[id]
  const model = tool ? tool() : build ? build().group : null
  if (!model) return null
  const hands: THREE.Object3D[] = []
  model.traverse((part) => {
    if (part.userData.hand) hands.push(part)
  })
  for (const part of hands) part.removeFromParent()
  const bounds = new THREE.Box3().setFromObject(model)
  model.position.y = -bounds.min.y
  if (tool) model.position.z = -(bounds.min.z + bounds.max.z) / 2
  const out = new THREE.Group()
  out.add(model)
  return out
}
