import { aimProgress, Spring, WEAPONS, WeaponId, type WeaponState } from '@office-fps/shared'
import * as THREE from 'three'
import { survivalGuns } from './survival-guns.ts'

const STEEL = 0x2b2d33
const FRAME = 0x3a3d45
const WOOD = 0x6b4a2f
const SKIN = 0xc68e6a
const SLEEVE = 0x2e4057
const SIGHT = 0xd8d8d8

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  )
  mesh.position.set(x, y, z)
  return mesh
}

/** Height of the rifle's red dot above its bore line (the sight sits on a riser). */
const RED_DOT_Y = 0.09

/** The glowing aiming dot: unlit, so it stays bright red in any light. */
function dot(size: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size / 2),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  )
  mesh.position.set(x, y, z)
  return mesh
}

/** One first-person weapon: its meshes plus where it sits and where things come out of it. */
export interface GunModel {
  group: THREE.Group
  muzzle: THREE.Object3D
  ejectPort: THREE.Object3D
  /** View-space position at the hip and when aiming down sights (sights on screen center). */
  hip: THREE.Vector3
  ads: THREE.Vector3
  /** How each shot throws the model about (visual only). */
  recoil: Recoil
  /** Slide / charging handle that snaps back on each shot. */
  action?: Action
  /** Sniper: the bolt handle, worked back and forward between shots. */
  bolt?: THREE.Object3D
  /** Lever-action: the lever (and the hand in it), swung down and back between shots. */
  lever?: THREE.Object3D
  /** Shotgun: the pump grip, racked back and forward after each shot. */
  pump?: THREE.Object3D
  /** Knife: swings instead of kicking, no muzzle flash. */
  melee?: boolean
  /** No muzzle flash (a suppressor, a crossbow). */
  noFlash?: boolean
  /** Reload: the magazine (it drops out and a new one goes in). */
  mag?: THREE.Object3D
  /** Reload: the support hand on the gun, which lets go to fetch the new magazine. */
  support?: THREE.Object3D
  /** Reload: where the fetching hand starts and ends (gun space). */
  handRest?: THREE.Vector3
  /** Reload, when empty: where the hand works the slide / charging handle (gun space). */
  handle?: THREE.Vector3
  /** Shotgun: shells go in here, one by one. */
  port?: THREE.Vector3
  /** What the hand feeds into `port`, when it isn't a shotgun shell (a cartridge, a bolt). */
  round?: THREE.Object3D
  /** Swings open for the reload and shut after it: break-action barrels, a revolver's cylinder. */
  hinge?: { part: THREE.Object3D; axis: 'x' | 'z'; open: number }
  /**
   * Crossbow: `set` poses the string (0 loosed … 1 cocked, `travel` m further back) and shows or
   * hides the bolt lying on the rail at `rest`.
   */
  bow?: { travel: number; rest: THREE.Vector3; set: (drawn: number, loaded: boolean) => void }
  /** How the gun turns while reloading (radians): roll to show the magazine well, pitch up. */
  tilt?: { roll: number; pitch: number }
}

/**
 * One shot's kick, as the peak of each motion. Springs carry it, so automatic fire stacks the
 * kicks into a shake and a slow `recover` makes a heavy gun feel heavy.
 */
export interface Recoil {
  /** Shove towards the eye (m). */
  back: number
  /** Muzzle flip (radians). */
  climb: number
  /** Twist (radians), mostly clockwise. */
  roll: number
  /** Random left/right jerk (radians). */
  side: number
  /** Spring frequency (rad/s): how fast it settles. */
  recover: number
}

export interface Action {
  part: THREE.Object3D
  /** How far it travels back (m) and how long until it's home again (s). */
  travel: number
  time: number
  rest: number
  /** Pistol: stays back on an empty magazine. */
  lockOpen?: boolean
}

function action(part: THREE.Object3D, travel: number, time: number, lockOpen = false): Action {
  return { part, travel, time, rest: part.position.z, lockOpen }
}

function marker(x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D()
  o.position.set(x, y, z)
  return o
}

function handgun(): GunModel {
  const group = new THREE.Group()
  const grip = box(0.028, 0.095, 0.042, FRAME, 0, -0.06, 0.05)
  grip.rotateX(0.18)
  // The slide carries the sights, so they blow back with it.
  const slide = new THREE.Group()
  slide.add(
    box(0.032, 0.03, 0.19, STEEL, 0, 0.012, -0.02),
    box(0.006, 0.006, 0.006, SIGHT, 0, 0.03, -0.11), // front sight
    box(0.022, 0.006, 0.006, SIGHT, 0, 0.03, 0.065), // rear sight
  )
  // Magazine inside the grip; only the base plate shows until it drops out.
  const mag = new THREE.Group()
  mag.position.set(0, -0.06, 0.05)
  mag.rotation.x = 0.18
  mag.add(box(0.022, 0.09, 0.032, STEEL), box(0.03, 0.012, 0.044, FRAME, 0, -0.051, 0))
  group.add(
    slide,
    mag,
    box(0.03, 0.022, 0.16, FRAME, 0, -0.012, -0.005), // frame
    grip,
    box(0.045, 0.06, 0.06, SKIN, 0.004, -0.065, 0.055), // hand
    box(0.06, 0.07, 0.25, SLEEVE, 0.02, -0.09, 0.2), // forearm
  )
  const muzzle = marker(0, 0.012, -0.125)
  const ejectPort = marker(0.02, 0.02, -0.01)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.38),
    ads: new THREE.Vector3(0, -0.071, -0.24),
    // Snappy flip, back on target quickly.
    recoil: { back: 0.03, climb: 0.2, roll: 0.06, side: 0.03, recover: 20 },
    action: action(slide, 0.035, 0.09, true),
    mag,
    handRest: new THREE.Vector3(-0.05, -0.2, 0.12),
    handle: new THREE.Vector3(0, 0.03, 0.05),
    tilt: { roll: -0.4, pitch: 0.1 },
  }
}

function rifle(): GunModel {
  const group = new THREE.Group()
  const mag = new THREE.Group()
  mag.position.set(0, -0.08, -0.06)
  mag.rotation.x = -0.25
  mag.add(box(0.03, 0.11, 0.055, STEEL))
  const grip = box(0.028, 0.08, 0.04, FRAME, 0, -0.065, 0.08)
  grip.rotateX(0.3)
  const handle = box(0.014, 0.014, 0.035, SIGHT, 0.03, 0.012, -0.02) // charging handle
  const support = box(0.055, 0.04, 0.07, SKIN, -0.01, -0.045, -0.24)
  group.add(
    box(0.045, 0.06, 0.3, FRAME, 0, 0, 0), // receiver
    handle,
    box(0.05, 0.05, 0.2, STEEL, 0, -0.005, -0.24), // handguard
    box(0.018, 0.018, 0.16, STEEL, 0, 0.005, -0.42), // barrel
    // Red-dot sight on a tall riser: you look through an open frame over the gun, so aiming
    // keeps most of the view clear (iron sights put the whole rifle in your face).
    box(0.03, 0.035, 0.07, STEEL, 0, 0.045, -0.02), // riser
    box(0.005, 0.05, 0.012, STEEL, -0.026, 0.09, -0.04), // frame: left
    box(0.005, 0.05, 0.012, STEEL, 0.026, 0.09, -0.04), // frame: right
    box(0.057, 0.006, 0.012, STEEL, 0, 0.118, -0.04), // frame: top
    dot(0.007, 0, RED_DOT_Y, -0.045),
    box(0.04, 0.07, 0.18, FRAME, 0, -0.02, 0.24), // stock
    mag,
    grip,
    box(0.045, 0.06, 0.06, SKIN, 0.004, -0.075, 0.09), // trigger hand
    support,
    box(0.065, 0.075, 0.26, SLEEVE, 0.03, -0.1, 0.25), // forearm
  )
  const muzzle = marker(0, 0.005, -0.5)
  const ejectPort = marker(0.025, 0.02, -0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.16, -0.44),
    // The dot sits on screen centre, ~0.3 m in front of the eye; the gun itself stays low.
    ads: new THREE.Vector3(0, -RED_DOT_Y, -0.26),
    recoil: { back: 0.018, climb: 0.05, roll: 0.03, side: 0.02, recover: 20 },
    action: action(handle, 0.03, 0.07),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

function sniper(): GunModel {
  const group = new THREE.Group()
  const bolt = box(0.04, 0.012, 0.012, SIGHT, 0.035, 0.012, 0.04)
  const mag = new THREE.Group()
  mag.position.set(0, -0.065, 0.02)
  mag.add(box(0.03, 0.05, 0.07, STEEL))
  const support = box(0.055, 0.04, 0.07, SKIN, -0.01, -0.06, -0.22)
  group.add(
    mag,
    box(0.04, 0.05, 0.32, STEEL, 0, 0, 0), // receiver
    box(0.05, 0.055, 0.42, WOOD, 0, -0.03, -0.02), // stock body
    box(0.02, 0.02, 0.38, STEEL, 0, 0.006, -0.42), // barrel
    box(0.034, 0.034, 0.22, 0x15161a, 0, 0.055, -0.02), // scope tube
    box(0.044, 0.044, 0.03, 0x15161a, 0, 0.055, -0.13), // front bell
    box(0.04, 0.04, 0.03, 0x15161a, 0, 0.055, 0.09), // eyepiece
    box(0.045, 0.08, 0.2, WOOD, 0, -0.02, 0.27), // butt stock
    bolt,
    box(0.045, 0.06, 0.06, SKIN, 0.004, -0.075, 0.09), // trigger hand
    support,
    box(0.065, 0.075, 0.26, SLEEVE, 0.03, -0.11, 0.25), // forearm
  )
  const muzzle = marker(0, 0.006, -0.62)
  const ejectPort = marker(0.03, 0.02, 0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    ads: new THREE.Vector3(0, -0.06, -0.12),
    // A big slow heave.
    recoil: { back: 0.06, climb: 0.28, roll: 0.12, side: 0.03, recover: 11 },
    bolt,
    mag,
    support,
    handRest: support.position.clone(),
    handle: bolt.position.clone(),
  }
}

function shotgun(): GunModel {
  const group = new THREE.Group()
  // The pump: forend + support hand, slides back along the tube magazine after each shot.
  const pump = new THREE.Group()
  const support = box(0.055, 0.04, 0.07, SKIN, -0.01, -0.06, -0.26)
  pump.add(box(0.05, 0.045, 0.14, WOOD, 0, -0.035, -0.26), support) // forend, support hand
  group.add(
    box(0.05, 0.06, 0.26, STEEL, 0, 0, 0), // receiver
    box(0.026, 0.026, 0.46, STEEL, 0, 0.012, -0.34), // barrel
    box(0.022, 0.022, 0.4, FRAME, 0, -0.02, -0.3), // tube magazine
    box(0.006, 0.01, 0.006, SIGHT, 0, 0.03, -0.55), // bead sight
    box(0.05, 0.075, 0.24, WOOD, 0, -0.03, 0.24), // stock
    box(0.045, 0.06, 0.06, SKIN, 0.004, -0.075, 0.09), // trigger hand
    box(0.065, 0.075, 0.26, SLEEVE, 0.03, -0.1, 0.25), // forearm
    pump,
  )
  const muzzle = marker(0, 0.012, -0.58)
  const ejectPort = marker(0.03, 0.015, -0.02)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.16, -0.17, -0.44),
    // Bead sight on screen centre, gun held low and a little away from the eye.
    ads: new THREE.Vector3(0, -0.05, -0.2),
    // The hardest kick: a shove into the shoulder and a big flip.
    recoil: { back: 0.075, climb: 0.32, roll: 0.1, side: 0.04, recover: 12 },
    pump,
    support,
    handRest: support.position.clone(),
    port: new THREE.Vector3(0, -0.04, 0.02),
    tilt: { roll: -0.45, pitch: 0.2 },
  }
}

function mp5(): GunModel {
  const group = new THREE.Group()
  const mag = new THREE.Group() // the MP5's curved magazine, raked forward
  mag.position.set(0, -0.08, -0.1)
  mag.rotation.x = -0.35
  mag.add(box(0.025, 0.1, 0.035, STEEL))
  const support = box(0.055, 0.04, 0.07, SKIN, -0.01, -0.045, -0.2)
  const grip = box(0.026, 0.075, 0.035, FRAME, 0, -0.06, 0.07)
  grip.rotateX(0.3)
  const handle = box(0.03, 0.01, 0.01, SIGHT, -0.03, 0.018, -0.15) // cocking lever, front left
  group.add(
    box(0.04, 0.055, 0.26, STEEL, 0, 0, -0.02), // receiver
    handle,
    box(0.045, 0.045, 0.12, FRAME, 0, -0.01, -0.2), // handguard
    box(0.016, 0.016, 0.06, STEEL, 0, 0.005, -0.29), // barrel
    // Tall sights on posts: aiming, you look over the gun, not into it.
    box(0.008, 0.06, 0.012, STEEL, 0, 0.055, -0.24), // front sight post
    box(0.004, 0.012, 0.012, SIGHT, 0, 0.088, -0.24), // front sight tip
    box(0.008, 0.06, 0.012, STEEL, -0.012, 0.055, 0.08), // rear sight, left ear
    box(0.008, 0.06, 0.012, STEEL, 0.012, 0.055, 0.08), // rear sight, right ear
    box(0.02, 0.05, 0.14, FRAME, 0, -0.005, 0.18), // collapsed stock
    mag,
    grip,
    box(0.045, 0.06, 0.06, SKIN, 0.004, -0.07, 0.08), // trigger hand
    support,
    box(0.065, 0.075, 0.26, SLEEVE, 0.03, -0.1, 0.24), // forearm
  )
  const muzzle = marker(0, 0.005, -0.33)
  const ejectPort = marker(0.022, 0.015, -0.04)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.15, -0.15, -0.4),
    // Sight tips on screen centre, held well out and low so the gun stays out of the view.
    ads: new THREE.Vector3(0, -0.088, -0.3),
    // Light and fast: a buzz more than a kick.
    recoil: { back: 0.012, climb: 0.03, roll: 0.02, side: 0.025, recover: 26 },
    action: action(handle, 0.02, 0.05),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
  }
}

function lmg(): GunModel {
  const group = new THREE.Group()
  const grip = box(0.03, 0.08, 0.04, FRAME, 0, -0.07, 0.1)
  grip.rotateX(0.3)
  const handle = box(0.016, 0.016, 0.04, SIGHT, -0.038, 0.01, -0.1) // charging handle, left
  const mag = new THREE.Group()
  mag.position.set(0.02, -0.08, -0.04)
  mag.add(box(0.09, 0.09, 0.1, FRAME), box(0.04, 0.02, 0.06, 0xb08a3a, 0.015, 0.08, 0))
  const support = box(0.055, 0.04, 0.07, SKIN, -0.01, -0.05, -0.28)
  group.add(
    box(0.06, 0.07, 0.34, FRAME, 0, 0, 0), // receiver
    handle,
    box(0.05, 0.05, 0.24, STEEL, 0, 0, -0.28), // barrel shroud
    box(0.022, 0.022, 0.2, STEEL, 0, 0, -0.5), // barrel
    mag, // ammo box and belt
    box(0.05, 0.08, 0.2, FRAME, 0, -0.02, 0.27), // stock
    // Tall open sights (like the MP5): you aim over the gun.
    box(0.008, 0.07, 0.012, STEEL, 0, 0.07, -0.36),
    box(0.004, 0.012, 0.012, SIGHT, 0, 0.108, -0.36),
    box(0.008, 0.07, 0.012, STEEL, -0.014, 0.07, 0.06),
    box(0.008, 0.07, 0.012, STEEL, 0.014, 0.07, 0.06),
    grip,
    box(0.045, 0.06, 0.06, SKIN, 0.004, -0.08, 0.1), // trigger hand
    support,
    box(0.065, 0.075, 0.26, SLEEVE, 0.03, -0.1, 0.26), // forearm
  )
  const muzzle = marker(0, 0, -0.61)
  const ejectPort = marker(0.035, 0.02, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.17, -0.18, -0.46),
    ads: new THREE.Vector3(0, -0.108, -0.34),
    // Heavy: shudders side to side as the belt runs.
    recoil: { back: 0.02, climb: 0.05, roll: 0.05, side: 0.04, recover: 16 },
    action: action(handle, 0.035, 0.07),
    mag,
    support,
    handRest: support.position.clone(),
    handle: handle.position.clone(),
    tilt: { roll: -0.35, pitch: 0.02 },
  }
}

function knife(): GunModel {
  const group = new THREE.Group()
  group.add(
    box(0.03, 0.035, 0.11, 0x1c1c20, 0, 0, 0.02), // handle
    box(0.06, 0.012, 0.016, STEEL, 0, 0, -0.04), // guard
    box(0.008, 0.032, 0.17, 0xc9ccd2, 0, 0.004, -0.13), // blade
    box(0.006, 0.012, 0.05, 0xe8eaee, 0, 0.022, -0.19), // edge highlight near the tip
    box(0.05, 0.06, 0.07, SKIN, 0.005, -0.01, 0.03), // hand
    box(0.065, 0.075, 0.26, SLEEVE, 0.02, -0.03, 0.2), // forearm
  )
  const muzzle = marker(0, 0, -0.22)
  const ejectPort = marker(0, 0, 0)
  group.add(muzzle, ejectPort)
  return {
    group,
    muzzle,
    ejectPort,
    hip: new THREE.Vector3(0.17, -0.17, -0.36),
    ads: new THREE.Vector3(0.17, -0.17, -0.36),
    recoil: { back: 0.01, climb: 0.03, roll: 0, side: 0, recover: 18 },
    melee: true,
  }
}

/** 0…1 → 0…1, easing in and out. */
const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** Where along a path of [time, point] keys the hand is at time `e` (eased between keys). */
function along(keys: [number, THREE.Vector3][], e: number, out: THREE.Vector3): THREE.Vector3 {
  const first = keys[0]
  if (!first) return out
  if (e <= first[0]) return out.copy(first[1])
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1] = keys[i] as [number, THREE.Vector3]
    const [t0, p0] = keys[i - 1] as [number, THREE.Vector3]
    if (e <= t1) return out.lerpVectors(p0, p1, t1 > t0 ? ease((e - t0) / (t1 - t0)) : 1)
  }
  return out.copy((keys.at(-1) as [number, THREE.Vector3])[1])
}

/** Puts a gun's magazine and support hand back where they belong (reload over or cut short). */
function restoreReload(model: GunModel): void {
  const rest = model.mag?.userData.rest as { pos: THREE.Vector3; rot: THREE.Euler } | undefined
  if (model.mag && rest) {
    model.mag.position.copy(rest.pos)
    model.mag.rotation.copy(rest.rot)
    model.mag.visible = true
  }
  if (model.support) model.support.visible = true
}

/** The left hand that fetches magazines and shells (a hand and a bit of sleeve). */
function reloadHand(): THREE.Group {
  const hand = new THREE.Group()
  const sleeve = box(0.065, 0.075, 0.26, SLEEVE, -0.02, -0.07, 0.13)
  sleeve.rotation.x = 0.55
  hand.add(box(0.055, 0.045, 0.07, SKIN), sleeve)
  return hand
}

/** A shotgun shell: red hull, brass base. */
function shell(): THREE.Group {
  const g = new THREE.Group()
  g.add(
    box(0.017, 0.017, 0.045, 0xb3261e, 0, 0, -0.006),
    box(0.019, 0.019, 0.012, 0xc9a24a, 0, 0, 0.022),
  )
  return g
}

function makeFlashTexture(): THREE.CanvasTexture {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,230,1)')
  g.addColorStop(0.35, 'rgba(255,200,80,0.9)')
  g.addColorStop(1, 'rgba(255,120,20,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  return tex
}

/**
 * First-person hands + gun, rendered in its own scene with its own camera (narrower FOV) on top
 * of the world: the gun never clips into walls and is pixelated with the same pass. Every motion
 * is spring-driven so kick, sway, bob and reload layer naturally.
 */
export class Viewmodel {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10)
  /** Muzzle position in view space, refreshed every frame (for tracers and the world flash light). */
  readonly muzzleView = new THREE.Vector3()
  /** Ejection port in view space (where spent casings fly out). */
  readonly ejectView = new THREE.Vector3()

  private readonly root = new THREE.Group()
  private readonly models: Record<WeaponId, GunModel> = {
    [WeaponId.Handgun]: handgun(),
    [WeaponId.Rifle]: rifle(),
    [WeaponId.Sniper]: sniper(),
    [WeaponId.Shotgun]: shotgun(),
    [WeaponId.Knife]: knife(),
    [WeaponId.Smg]: mp5(),
    [WeaponId.Lmg]: lmg(),
    // Only zombies have claws, and nobody plays one: no first-person model.
    [WeaponId.Claws]: knife(),
    ...survivalGuns(),
  }
  private active: GunModel
  private readonly flash: THREE.Mesh
  private readonly flashLight = new THREE.PointLight(0xffc070, 0, 1.5)
  private flashTime = 0
  /** Eased: hands busy climbing (gun lowered out of view). */
  private climb = 0
  private aim = 0
  /** True while looking through a scope: the gun is hidden and the HUD draws the scope. */
  scoped = false

  // Springs: kick back / up / twist / sideways, sway (look lag), each with its own snappiness.
  private readonly kickBack = new Spring(18)
  private readonly kickUp = new Spring(16)
  private readonly kickRoll = new Spring(16)
  private readonly kickSide = new Spring(16)
  /** Seconds since the last shot (drives the slide / charging handle). */
  private sinceShot = Number.POSITIVE_INFINITY
  private readonly swayX = new Spring(10)
  private readonly swayY = new Spring(10)

  // Reload: the fetching hand, what it carries, and the reload being played.
  private readonly hand = reloadHand()
  private readonly carried = new THREE.Group()
  private readonly shell = shell()
  private readonly handAt = new THREE.Vector3()
  private reloadTotal = 0
  private reloadEmpty = false
  private reloadShells = 0
  /** Seconds into the reload last frame (to catch the moments things click in). */
  private reloadLast = -1

  constructor() {
    for (const model of Object.values(this.models)) {
      model.group.visible = false
      this.root.add(model.group)
      if (model.mag) {
        model.mag.userData.rest = {
          pos: model.mag.position.clone(),
          rot: model.mag.rotation.clone(),
        }
      }
      if (model.bolt) model.bolt.userData.rest = model.bolt.position.z
    }
    this.active = this.models[WeaponId.Handgun]

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.09, 0.09),
      new THREE.MeshBasicMaterial({
        map: makeFlashTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.flash.visible = false

    this.scene.add(this.root)
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3f35, 1.6))
    const key = new THREE.DirectionalLight(0xfff1d6, 1.6)
    key.position.set(0.5, 1, 0.3)
    this.scene.add(key)
    this.setWeapon(WeaponId.Handgun)
  }

  /** 0 = hip fire, 1 = fully aiming down sights (eased, for visuals). */
  get aimProgress(): number {
    return this.aim
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  private setWeapon(id: WeaponId): void {
    const model = this.models[id]
    if (model === this.active && model.group.visible) return
    restoreReload(this.active)
    this.active.group.visible = false
    this.active = model
    model.group.visible = true
    const { recover } = model.recoil
    this.kickBack.frequency = recover * 1.1
    this.kickUp.frequency = recover
    this.kickRoll.frequency = recover
    this.kickSide.frequency = recover * 1.2
    this.sinceShot = Number.POSITIVE_INFINITY
    // The reload hand works on whichever gun is out, carrying a copy of its magazine (or a shell).
    model.group.add(this.hand, this.carried)
    this.carried.clear()
    if (model.mag) {
      const copy = model.mag.clone()
      copy.position.set(0, 0, 0)
      copy.rotation.set(0, 0, 0)
      this.carried.add(copy)
    } else if (model.port) this.carried.add(model.round ?? this.shell)
    this.hand.visible = false
    this.carried.visible = false
    this.reloadTotal = 0
    // Flash and its light ride on the active gun's muzzle.
    model.muzzle.add(this.flash, this.flashLight)
    this.flash.position.set(0, 0, -0.03)
  }

  /** A small knock to the gun (a magazine seating, a slide slamming home). */
  private bump(back: number, climb: number): void {
    this.kickBack.impulse(back * this.kickBack.frequency * Math.E)
    this.kickUp.impulse(climb * this.kickUp.frequency * Math.E)
  }

  /** Recoil and muzzle flash for one shot. */
  onShot(): void {
    const r = this.active.recoil
    // Less of it while aiming, so the sights stay usable.
    const aimed = 1 - this.aim * 0.55
    // A critically damped spring kicked with velocity v peaks at v / (frequency · e).
    const kick = (spring: Spring, peak: number) => spring.impulse(peak * spring.frequency * Math.E)
    const vary = () => 0.8 + Math.random() * 0.4
    kick(this.kickBack, r.back * vary() * (1 - this.aim * 0.4))
    kick(this.kickUp, r.climb * vary() * aimed)
    kick(this.kickRoll, r.roll * vary() * aimed * (Math.random() < 0.75 ? 1 : -1))
    kick(this.kickSide, r.side * (Math.random() * 2 - 1) * aimed)
    this.sinceShot = 0
    if (this.active.melee || this.active.noFlash) return // a swing, a suppressor: no muzzle flash
    this.flashTime = 0.065
    this.flash.rotation.z = Math.random() * Math.PI
  }

  /**
   * @param look   view rotation since last frame (radians) — the gun lags behind it (sway)
   * @param bob    footstep phase and weight from CameraFeel
   * @param busy   0–1: hands busy climbing (the gun drops out of the way) or tilted in a slide
   */
  update(
    dt: number,
    look: { yaw: number; pitch: number },
    bob: { phase: number; weight: number },
    weapon: WeaponState,
    alive: boolean,
    busy: { climb: number; slide: number } = { climb: 0, slide: 0 },
  ): void {
    const def = WEAPONS[weapon.id]
    this.setWeapon(weapon.id)
    // Ease the shared (linear) aim progress so the gun glides into place.
    const t = aimProgress(weapon)
    this.aim = t * t * (3 - 2 * t)
    // Scope overlay exactly when fully aimed — the same moment accuracy becomes perfect.
    this.scoped = def.scoped && t >= 1
    this.root.visible = alive && !this.scoped
    const hipWeight = 1 - this.aim * 0.85

    this.swayX.impulse(-look.yaw * 1.5 * hipWeight)
    this.swayY.impulse(look.pitch * 1.5 * hipWeight)
    this.kickBack.update(dt)
    this.kickUp.update(dt)
    this.kickRoll.update(dt)
    this.kickSide.update(dt)
    this.sinceShot += dt
    this.swayX.update(dt)
    this.swayY.update(dt)

    // Reload: a real one (see reloadPose); draw: rise from below (and drop away while climbing);
    // bolt: a small rock back.
    const reload = this.reloadPose(weapon, def)
    this.climb += (busy.climb - this.climb) * Math.min(1, dt * 14)
    const drawT = Math.max(def.drawTime > 0 ? weapon.draw / def.drawTime : 0, this.climb)
    const boltT =
      def.fireMode === 'bolt' && weapon.cooldown > 0
        ? Math.sin((1 - weapon.cooldown / def.fireInterval) * Math.PI)
        : 0

    // Knife: a quick slash right-to-left across the view after each swing.
    const swing =
      this.active.melee && weapon.cooldown > 0
        ? Math.sin(Math.min(1, (1 - weapon.cooldown / def.fireInterval) * 2.2) * Math.PI)
        : 0

    // Pump: rack back and forward in the middle of the cooldown (ka-chunk).
    if (this.active.pump) {
      const t = weapon.cooldown > 0 ? 1 - weapon.cooldown / def.fireInterval : 1
      const rack = t > 0.25 && t < 0.85 ? Math.sin(((t - 0.25) / 0.6) * Math.PI) : 0
      this.active.pump.position.z = Math.max(rack, reload.pump) * 0.09
    }

    // Slide / charging handle: slams back with the shot, rides home again.
    const act = this.active.action
    if (act && !reload.action) {
      const home = Math.min(1, this.sinceShot / act.time)
      const back = act.lockOpen && weapon.ammo === 0 ? 1 : (1 - home) ** 2
      act.part.position.z = act.rest + back * act.travel
    }
    // Sniper bolt: worked back and forward in step with the rock of the gun.
    if (this.active.bolt) {
      const rest = this.active.bolt.userData.rest as number
      this.active.bolt.position.z = rest + boltT * 0.07 + reload.bolt * 0.07
    }
    // Lever: swung down and forward and back up again, the same way.
    if (this.active.lever) this.active.lever.rotation.x = Math.max(boltT, reload.bolt) * 0.5
    // Break-action barrels drop and a revolver's cylinder swings out as the gun tilts to reload.
    const hinge = this.active.hinge
    if (hinge) hinge.part.rotation[hinge.axis] = reload.tilt * hinge.open
    // Crossbow: cocked with a bolt on the rail while it is loaded (the reload poses it itself).
    if (this.active.bow && weapon.reload <= 0) {
      this.active.bow.set(weapon.ammo > 0 ? 1 : 0, weapon.ammo > 0)
    }

    const bobX = Math.cos(bob.phase) * 0.008 * bob.weight * hipWeight
    const bobY = -Math.abs(Math.sin(bob.phase)) * 0.01 * bob.weight * hipWeight

    const m = this.active
    m.group.position
      .lerpVectors(m.hip, m.ads, this.aim)
      .add(
        new THREE.Vector3(
          this.swayX.value * 0.02 + bobX - reload.tilt * 0.05,
          this.swayY.value * 0.02 +
            bobY +
            reload.tilt * 0.075 -
            drawT * 0.18 -
            boltT * 0.03 +
            swing * 0.05,
          this.kickBack.value + reload.tilt * 0.02,
        ),
      )
    const tilt = m.tilt ?? { roll: -0.55, pitch: 0.05 }
    m.group.rotation.set(
      this.kickUp.value + reload.tilt * tilt.pitch - drawT * 0.8,
      this.swayX.value * 0.03 + this.kickSide.value + reload.tilt * 0.12,
      reload.tilt * tilt.roll +
        boltT * 0.35 +
        swing * 1.1 -
        this.kickRoll.value +
        busy.slide * 0.25 * (1 - this.aim),
    )
    if (swing > 0) m.group.position.x -= swing * 0.14

    this.flashTime -= dt
    const flashing = this.flashTime > 0
    this.flash.visible = flashing
    this.flashLight.intensity = flashing ? 3 : 0

    m.group.updateMatrixWorld(true)
    this.muzzleView.setFromMatrixPosition(m.muzzle.matrixWorld)
    this.ejectView.setFromMatrixPosition(m.ejectPort.matrixWorld)
  }

  /**
   * Plays the reload on the active gun: tilt it, drop the magazine, fetch a new one with the
   * other hand, seat it, and on an empty gun work the slide or charging handle. The shotgun is
   * fed shell by shell instead. Timed to the reload sounds (combat.ts): magazine out 0.12 s in,
   * in 0.45 s (0.7 s when empty) before the end, slide 0.28 s before the end.
   * Returns how far the gun is tilted (0–1) and how far back the action, pump and bolt are.
   */
  private reloadPose(
    weapon: WeaponState,
    def: (typeof WEAPONS)[WeaponId],
  ): { tilt: number; action: boolean; pump: number; bolt: number } {
    const m = this.active
    const idle = { tilt: 0, action: false, pump: 0, bolt: 0 }
    const rest = m.mag?.userData.rest as { pos: THREE.Vector3; rot: THREE.Euler } | undefined
    const reloading = weapon.reload > 0 && !m.melee
    if (!reloading) {
      if (this.reloadTotal > 0) {
        // Done (or cut short by a weapon switch): everything back where it belongs.
        this.reloadTotal = 0
        restoreReload(m)
        this.hand.visible = false
        this.carried.visible = false
      }
      return idle
    }
    if (this.reloadTotal === 0) {
      this.reloadEmpty = weapon.ammo === 0
      this.reloadTotal = this.reloadEmpty ? def.emptyReloadTime : def.reloadTime
      this.reloadShells = Math.max(1, Math.min(def.magSize - weapon.ammo, weapon.reserve))
      this.reloadLast = 0
    }
    const T = this.reloadTotal
    const e = Math.max(0, T - weapon.reload)
    const crossed = (at: number) => this.reloadLast < at && e >= at
    const empty = this.reloadEmpty
    const outAt = 0.12
    const inAt = T - (empty ? 0.7 : 0.45)
    const slideAt = T - 0.28
    const tilt = Math.min(ease(e / 0.25), ease((T - e) / 0.3))
    const pose = { tilt, action: false, pump: 0, bolt: 0 }
    const handRest = m.handRest ?? new THREE.Vector3(-0.05, -0.2, 0.1)
    const low = handRest.clone().add(new THREE.Vector3(-0.04, -0.3, 0.12))
    const keys: [number, THREE.Vector3][] = []
    /** Pull-back of the action: back over 0.1 s before `slideAt`, slammed home just after. */
    const pull =
      e < slideAt - 0.1
        ? 0
        : e < slideAt
          ? (e - (slideAt - 0.1)) / 0.1
          : 1 - ease((e - slideAt) / 0.05)
    let handOut = e > 0.03 && e < T - 0.04
    this.carried.visible = false

    if (m.bow && m.port && m.handle) {
      // Crossbow: haul the string back until it latches, then lay a new bolt on the rail.
      const cockAt = 0.75
      const loosed = m.handle.clone().add(new THREE.Vector3(0, 0, -m.bow.travel))
      keys.push(
        [0, handRest],
        [0.2, loosed],
        [cockAt, m.handle],
        [cockAt + 0.3, low],
        [Math.max(cockAt + 0.35, inAt - 0.3), low],
        [inAt, m.port],
        [Math.min(T - 0.04, inAt + 0.28), handRest],
      )
      along(keys, e, this.handAt)
      m.bow.set(ease((e - 0.2) / (cockAt - 0.2)), e >= inAt)
      this.carried.visible = e > cockAt + 0.3 && e < inAt
      this.carried.rotation.set(0, 0, 0)
      this.carried.position.copy(this.handAt).add(m.bow.rest).sub(m.port)
      if (crossed(cockAt)) this.bump(0.008, 0.03)
    } else if (m.port) {
      // Shotgun: shell after shell into the loading port.
      const port = m.port
      const below = port.clone().add(new THREE.Vector3(-0.02, -0.11, 0.07))
      const start = 0.35
      const period = Math.max(0.1, (inAt - start) / this.reloadShells)
      keys.push([0, handRest], [start, below])
      if (e >= start && e < inAt) {
        const u = ((e - start) % period) / period
        this.handAt.lerpVectors(below, port, u < 0.5 ? ease(u / 0.5) : 1 - ease((u - 0.5) / 0.5))
        this.carried.visible = u < 0.5
        this.carried.rotation.set(0, 0, 0)
        this.carried.position.copy(this.handAt).add(new THREE.Vector3(0, 0.03, -0.01))
        if (
          Math.floor((this.reloadLast - start) / period) < Math.floor((e - start) / period) &&
          this.reloadLast >= start
        )
          this.bump(0.004, 0.01)
      } else {
        keys.push([inAt, below], [empty ? slideAt - 0.15 : T - 0.04, handRest])
        along(keys, e, this.handAt)
      }
      if (empty) {
        handOut = e > 0.03 && e < slideAt - 0.15
        pose.pump = pull
        pose.bolt = pull
      }
    } else {
      // Magazine guns: out it drops, a new one comes up from below and is pushed home.
      const well = rest ? rest.pos.clone().add(new THREE.Vector3(0, -0.075, 0.015)) : handRest
      const under = well.clone().add(new THREE.Vector3(-0.01, -0.09, 0.03))
      keys.push(
        [0, handRest],
        [outAt + 0.05, handRest],
        [outAt + 0.35, low],
        [Math.max(outAt + 0.4, inAt - 0.38), low],
        [inAt - 0.1, under],
        [inAt, well],
      )
      if (empty && m.handle) {
        const handle = m.handle
        const pulled = handle.clone().add(new THREE.Vector3(0, 0, 0.04))
        keys.push(
          [slideAt - 0.12, handle],
          [slideAt, m.action?.lockOpen ? handle : pulled],
          [T - 0.04, handRest],
        )
      } else keys.push([Math.min(T - 0.04, inAt + 0.28), handRest])
      along(keys, e, this.handAt)

      if (m.mag && rest) {
        if (e < outAt || e >= inAt) {
          m.mag.position.copy(rest.pos)
          m.mag.rotation.copy(rest.rot)
          m.mag.visible = true
        } else {
          // Falling out under its own weight.
          const t = e - outAt
          m.mag.position.set(rest.pos.x, rest.pos.y - 2.4 * t * t - 0.02 * t, rest.pos.z + 0.04 * t)
          m.mag.rotation.set(rest.rot.x + 2.5 * t, rest.rot.y, rest.rot.z + 0.8 * t)
          m.mag.visible = t < 0.5
          // The new one rides in the hand from below until it's seated.
          if (e > outAt + 0.35) {
            this.carried.visible = true
            this.carried.position.copy(this.handAt).add(rest.pos).sub(well)
            this.carried.rotation.copy(rest.rot)
          }
        }
      }
      if (empty) {
        pose.action = m.action !== undefined
        if (m.action) {
          const back = m.action.lockOpen ? (e < slideAt ? 1 : 1 - ease((e - slideAt) / 0.05)) : pull
          m.action.part.position.z = m.action.rest + back * m.action.travel
        }
        if (m.bolt) pose.bolt = pull
      }
    }

    this.hand.position.copy(this.handAt)
    this.hand.visible = handOut
    if (m.support) m.support.visible = !handOut
    if (crossed(inAt)) this.bump(0.01, 0.04)
    if (empty && !m.bow && crossed(slideAt)) this.bump(0.012, 0.05)
    this.reloadLast = e
    return pose
  }
}
