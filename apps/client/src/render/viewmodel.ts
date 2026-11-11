import { Spring, WEAPONS, type WeaponState } from '@office-fps/shared'
import * as THREE from 'three'

/** Where the gun sits in view space: hip (bottom right) and aiming down the sights (centered). */
const HIP = new THREE.Vector3(0.15, -0.15, -0.38)
const ADS = new THREE.Vector3(0, -0.071, -0.24)
const ADS_SPEED = 12

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  )
  mesh.position.set(x, y, z)
  return mesh
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
  private readonly gun = new THREE.Group()
  private readonly muzzle = new THREE.Object3D()
  private readonly ejectPort = new THREE.Object3D()
  private readonly flash: THREE.Mesh
  private readonly flashLight = new THREE.PointLight(0xffc070, 0, 1.5)
  private flashTime = 0
  private aim = 0

  // Springs: kick back / up, sway (look lag), each with its own snappiness.
  private readonly kickBack = new Spring(18)
  private readonly kickUp = new Spring(16)
  private readonly swayX = new Spring(10)
  private readonly swayY = new Spring(10)

  constructor() {
    // Handgun from boxes: slide, frame, grip, trigger guard; plus a hand. Phase 9 swaps in models.
    const steel = 0x2b2d33
    const frame = 0x3a3d45
    const skin = 0xc68e6a
    const sleeve = 0x2e4057
    this.gun.add(
      box(0.032, 0.03, 0.19, steel, 0, 0.012, -0.02), // slide
      box(0.03, 0.022, 0.16, frame, 0, -0.012, -0.005), // frame
      box(0.028, 0.095, 0.042, frame, 0, -0.06, 0.05), // grip
      box(0.006, 0.006, 0.006, 0xd8d8d8, 0, 0.03, -0.11), // front sight
      box(0.022, 0.006, 0.006, 0xd8d8d8, 0, 0.03, 0.065), // rear sight
      box(0.045, 0.06, 0.06, skin, 0.004, -0.065, 0.055), // hand
      box(0.06, 0.07, 0.25, sleeve, 0.02, -0.09, 0.2), // forearm
    )
    this.gun.children.at(-3)?.rotateX(0.18)
    this.muzzle.position.set(0, 0.012, -0.125)
    this.ejectPort.position.set(0.02, 0.02, -0.01)
    this.gun.add(this.muzzle, this.ejectPort)

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.09, 0.09),
      new THREE.MeshBasicMaterial({
        map: makeFlashTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.flash.position.copy(this.muzzle.position).add(new THREE.Vector3(0, 0, -0.03))
    this.flash.visible = false
    this.gun.add(this.flash)
    this.flashLight.position.copy(this.muzzle.position)
    this.gun.add(this.flashLight)

    this.root.add(this.gun)
    this.scene.add(this.root)
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3f35, 1.6))
    const key = new THREE.DirectionalLight(0xfff1d6, 1.6)
    key.position.set(0.5, 1, 0.3)
    this.scene.add(key)
  }

  /** 0 = hip fire, 1 = fully aiming down sights (drives the FOV zoom). */
  get aimProgress(): number {
    return this.aim
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** Recoil and muzzle flash for one shot. */
  onShot(): void {
    this.kickBack.impulse(0.9)
    this.kickUp.impulse(9)
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
    aiming: boolean,
    alive: boolean,
  ): void {
    const def = WEAPONS[weapon.id]
    this.root.visible = alive
    this.aim += ((aiming && weapon.reload === 0 ? 1 : 0) - this.aim) * Math.min(1, dt * ADS_SPEED)
    const hipWeight = 1 - this.aim * 0.85

    this.swayX.impulse(-look.yaw * 1.5 * hipWeight)
    this.swayY.impulse(look.pitch * 1.5 * hipWeight)
    this.kickBack.update(dt)
    this.kickUp.update(dt)
    this.swayX.update(dt)
    this.swayY.update(dt)

    // Reload: dip down and roll the gun; draw: rise from below.
    const reloadTotal = weapon.ammo === 0 ? def.emptyReloadTime : def.reloadTime
    const reloadT = weapon.reload > 0 ? 1 - weapon.reload / reloadTotal : 0
    const reloadDip = Math.sin(reloadT * Math.PI)
    const drawT = def.drawTime > 0 ? weapon.draw / def.drawTime : 0

    const bobX = Math.cos(bob.phase) * 0.008 * bob.weight * hipWeight
    const bobY = -Math.abs(Math.sin(bob.phase)) * 0.01 * bob.weight * hipWeight

    this.gun.position
      .lerpVectors(HIP, ADS, this.aim)
      .add(
        new THREE.Vector3(
          this.swayX.value * 0.02 + bobX,
          this.swayY.value * 0.02 + bobY - reloadDip * 0.08 - drawT * 0.18,
          this.kickBack.value * 0.06 * (1 - this.aim * 0.5),
        ),
      )
    this.gun.rotation.set(
      this.kickUp.value * 0.02 - reloadDip * 0.5 - drawT * 0.8,
      this.swayX.value * 0.03,
      reloadDip * 0.6,
    )

    this.flashTime -= dt
    const flashing = this.flashTime > 0
    this.flash.visible = flashing
    this.flashLight.intensity = flashing ? 3 : 0

    this.gun.updateMatrixWorld(true)
    this.muzzleView.setFromMatrixPosition(this.muzzle.matrixWorld)
    this.ejectView.setFromMatrixPosition(this.ejectPort.matrixWorld)
  }
}
