import { aimProgress, Spring, WEAPONS, WeaponId, type WeaponState } from '@office-fps/shared'
import * as THREE from 'three'

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
interface GunModel {
  group: THREE.Group
  muzzle: THREE.Object3D
  ejectPort: THREE.Object3D
  /** View-space position at the hip and when aiming down sights (sights on screen center). */
  hip: THREE.Vector3
  ads: THREE.Vector3
  /** How hard each shot shoves the model back/up (visual only). */
  kick: number
  /** Shotgun: the pump grip, racked back and forward after each shot. */
  pump?: THREE.Object3D
  /** Knife: swings instead of kicking, no muzzle flash. */
  melee?: boolean
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
  group.add(
    box(0.032, 0.03, 0.19, STEEL, 0, 0.012, -0.02), // slide
    box(0.03, 0.022, 0.16, FRAME, 0, -0.012, -0.005), // frame
    grip,
    box(0.006, 0.006, 0.006, SIGHT, 0, 0.03, -0.11), // front sight
    box(0.022, 0.006, 0.006, SIGHT, 0, 0.03, 0.065), // rear sight
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
    kick: 1.8,
  }
}

function rifle(): GunModel {
  const group = new THREE.Group()
  const mag = box(0.03, 0.11, 0.055, STEEL, 0, -0.08, -0.06)
  mag.rotateX(-0.25)
  const grip = box(0.028, 0.08, 0.04, FRAME, 0, -0.065, 0.08)
  grip.rotateX(0.3)
  group.add(
    box(0.045, 0.06, 0.3, FRAME, 0, 0, 0), // receiver
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
    box(0.055, 0.04, 0.07, SKIN, -0.01, -0.045, -0.24), // support hand
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
    kick: 0.7,
  }
}

function sniper(): GunModel {
  const group = new THREE.Group()
  const bolt = box(0.04, 0.012, 0.012, SIGHT, 0.035, 0.012, 0.04)
  group.add(
    box(0.04, 0.05, 0.32, STEEL, 0, 0, 0), // receiver
    box(0.05, 0.055, 0.42, WOOD, 0, -0.03, -0.02), // stock body
    box(0.02, 0.02, 0.38, STEEL, 0, 0.006, -0.42), // barrel
    box(0.034, 0.034, 0.22, 0x15161a, 0, 0.055, -0.02), // scope tube
    box(0.044, 0.044, 0.03, 0x15161a, 0, 0.055, -0.13), // front bell
    box(0.04, 0.04, 0.03, 0x15161a, 0, 0.055, 0.09), // eyepiece
    box(0.045, 0.08, 0.2, WOOD, 0, -0.02, 0.27), // butt stock
    bolt,
    box(0.045, 0.06, 0.06, SKIN, 0.004, -0.075, 0.09), // trigger hand
    box(0.055, 0.04, 0.07, SKIN, -0.01, -0.06, -0.22), // support hand
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
    kick: 1.6,
  }
}

function shotgun(): GunModel {
  const group = new THREE.Group()
  // The pump: forend + support hand, slides back along the tube magazine after each shot.
  const pump = new THREE.Group()
  pump.add(
    box(0.05, 0.045, 0.14, WOOD, 0, -0.035, -0.26), // forend
    box(0.055, 0.04, 0.07, SKIN, -0.01, -0.06, -0.26), // support hand
  )
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
    kick: 2.2,
    pump,
  }
}

function mp5(): GunModel {
  const group = new THREE.Group()
  const mag = box(0.025, 0.1, 0.035, STEEL, 0, -0.08, -0.1)
  mag.rotateX(-0.35) // the MP5's curved magazine, raked forward
  const grip = box(0.026, 0.075, 0.035, FRAME, 0, -0.06, 0.07)
  grip.rotateX(0.3)
  group.add(
    box(0.04, 0.055, 0.26, STEEL, 0, 0, -0.02), // receiver
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
    box(0.055, 0.04, 0.07, SKIN, -0.01, -0.045, -0.2), // support hand
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
    kick: 0.5,
  }
}

function lmg(): GunModel {
  const group = new THREE.Group()
  const grip = box(0.03, 0.08, 0.04, FRAME, 0, -0.07, 0.1)
  grip.rotateX(0.3)
  group.add(
    box(0.06, 0.07, 0.34, FRAME, 0, 0, 0), // receiver
    box(0.05, 0.05, 0.24, STEEL, 0, 0, -0.28), // barrel shroud
    box(0.022, 0.022, 0.2, STEEL, 0, 0, -0.5), // barrel
    box(0.09, 0.09, 0.1, FRAME, 0.02, -0.08, -0.04), // ammo box
    box(0.04, 0.02, 0.06, 0xb08a3a, 0.035, 0.0, -0.04), // belt
    box(0.05, 0.08, 0.2, FRAME, 0, -0.02, 0.27), // stock
    // Tall open sights (like the MP5): you aim over the gun.
    box(0.008, 0.07, 0.012, STEEL, 0, 0.07, -0.36),
    box(0.004, 0.012, 0.012, SIGHT, 0, 0.108, -0.36),
    box(0.008, 0.07, 0.012, STEEL, -0.014, 0.07, 0.06),
    box(0.008, 0.07, 0.012, STEEL, 0.014, 0.07, 0.06),
    grip,
    box(0.045, 0.06, 0.06, SKIN, 0.004, -0.08, 0.1), // trigger hand
    box(0.055, 0.04, 0.07, SKIN, -0.01, -0.05, -0.28), // support hand
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
    kick: 0.9,
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
    kick: 0.3,
    melee: true,
  }
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
  }
  private active: GunModel
  private readonly flash: THREE.Mesh
  private readonly flashLight = new THREE.PointLight(0xffc070, 0, 1.5)
  private flashTime = 0
  private aim = 0
  /** True while looking through a scope: the gun is hidden and the HUD draws the scope. */
  scoped = false

  // Springs: kick back / up, sway (look lag), each with its own snappiness.
  private readonly kickBack = new Spring(18)
  private readonly kickUp = new Spring(16)
  private readonly swayX = new Spring(10)
  private readonly swayY = new Spring(10)

  constructor() {
    for (const model of Object.values(this.models)) {
      model.group.visible = false
      this.root.add(model.group)
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
    this.active.group.visible = false
    this.active = model
    model.group.visible = true
    // Flash and its light ride on the active gun's muzzle.
    model.muzzle.add(this.flash, this.flashLight)
    this.flash.position.set(0, 0, -0.03)
  }

  /** Recoil and muzzle flash for one shot. */
  onShot(): void {
    const k = this.active.kick
    this.kickBack.impulse(0.9 * k)
    this.kickUp.impulse(9 * k)
    if (this.active.melee) return // a swing: no muzzle flash
    this.flashTime = 0.065
    this.flash.rotation.z = Math.random() * Math.PI
  }

  /**
   * @param look   view rotation since last frame (radians) — the gun lags behind it (sway)
   * @param bob    footstep phase and weight from CameraFeel
   */
  update(
    dt: number,
    look: { yaw: number; pitch: number },
    bob: { phase: number; weight: number },
    weapon: WeaponState,
    alive: boolean,
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
    this.swayX.update(dt)
    this.swayY.update(dt)

    // Reload: dip down and roll the gun; draw: rise from below; bolt: a small rock back.
    const reloadTotal = weapon.ammo === 0 ? def.emptyReloadTime : def.reloadTime
    const reloadT = weapon.reload > 0 ? 1 - weapon.reload / reloadTotal : 0
    const reloadDip = Math.sin(reloadT * Math.PI)
    const drawT = def.drawTime > 0 ? weapon.draw / def.drawTime : 0
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
      this.active.pump.position.z = rack * 0.09
    }

    const bobX = Math.cos(bob.phase) * 0.008 * bob.weight * hipWeight
    const bobY = -Math.abs(Math.sin(bob.phase)) * 0.01 * bob.weight * hipWeight

    const m = this.active
    m.group.position
      .lerpVectors(m.hip, m.ads, this.aim)
      .add(
        new THREE.Vector3(
          this.swayX.value * 0.02 + bobX,
          this.swayY.value * 0.02 +
            bobY -
            reloadDip * 0.08 -
            drawT * 0.18 -
            boltT * 0.03 +
            swing * 0.05,
          this.kickBack.value * 0.06 * (1 - this.aim * 0.5),
        ),
      )
    m.group.rotation.set(
      this.kickUp.value * 0.02 - reloadDip * 0.5 - drawT * 0.8,
      this.swayX.value * 0.03,
      reloadDip * 0.6 + boltT * 0.35 + swing * 1.1,
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
}
