import {
  DEFAULT_MOVEMENT,
  PLAYER_COLORS,
  type RemotePlayerState,
  WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'
import { createLabel } from './labels.ts'

const m = DEFAULT_MOVEMENT
const capsuleLength = m.standHeight - m.radius * 2
const sharedGeometry = {
  body: new THREE.CapsuleGeometry(m.radius, capsuleLength, 4, 12),
  visor: new THREE.BoxGeometry(0.36, 0.1, 0.12),
  guns: {
    [WeaponId.Handgun]: new THREE.BoxGeometry(0.05, 0.08, 0.22),
    [WeaponId.Rifle]: new THREE.BoxGeometry(0.06, 0.1, 0.7),
    [WeaponId.Sniper]: new THREE.BoxGeometry(0.06, 0.1, 0.95),
  } as Record<WeaponId, THREE.BoxGeometry>,
}
const visorMaterial = new THREE.MeshLambertMaterial({ color: 0x1b1d2a })
const gunMaterial = new THREE.MeshLambertMaterial({ color: 0x2b2d33 })
/** Gun held at the right, slightly below the eyes; its muzzle is at the far end. */
const GUN_OFFSET = new THREE.Vector3(0.25, -0.2, -0.38)

function makeGlintTexture(): THREE.CanvasTexture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.2, 'rgba(255,250,220,0.8)')
  g.addColorStop(1, 'rgba(255,240,200,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  // Star spikes so it reads as a lens flare even when tiny.
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fillRect(0, size / 2 - 1, size, 2)
  ctx.fillRect(size / 2 - 1, 0, 2, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  return tex
}
const glintMaterial = new THREE.SpriteMaterial({
  map: makeGlintTexture(),
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  fog: false,
  transparent: true,
})

/**
 * Placeholder player model (phase 9 replaces it): a capsule in the player's color, a dark visor
 * showing where they look, a gun held at the right, and a name tag.
 */
export class Avatar {
  readonly root = new THREE.Group()
  private readonly body: THREE.Mesh
  private readonly material: THREE.MeshLambertMaterial
  private readonly head = new THREE.Group()
  private readonly muzzle = new THREE.Object3D()
  private readonly gun: THREE.Mesh
  private readonly glint: THREE.Sprite
  private readonly label: THREE.Sprite
  private weapon: WeaponId = WeaponId.Rifle

  constructor(name: string, colorIndex: number) {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    this.material = new THREE.MeshLambertMaterial({ color, transparent: true })
    this.body = new THREE.Mesh(sharedGeometry.body, this.material)
    this.body.castShadow = true
    this.body.position.y = m.standHeight / 2

    const visor = new THREE.Mesh(sharedGeometry.visor, visorMaterial)
    visor.position.set(0, 0, -m.radius + 0.02)
    this.gun = new THREE.Mesh(sharedGeometry.guns[this.weapon], gunMaterial)
    this.glint = new THREE.Sprite(glintMaterial.clone())
    this.glint.visible = false
    this.head.add(visor, this.gun, this.muzzle, this.glint)
    this.setWeapon(WeaponId.Rifle)

    this.label = createLabel(name)
    this.root.add(this.body, this.head, this.label)
    this.root.name = `avatar:${name}`
  }

  private setWeapon(id: WeaponId): void {
    this.weapon = id
    this.gun.geometry = sharedGeometry.guns[id]
    const length = sharedGeometry.guns[id].parameters.depth
    // Gun's back end stays at the hand; longer guns reach further forward.
    this.gun.position.set(GUN_OFFSET.x, GUN_OFFSET.y, GUN_OFFSET.z - length / 2 + 0.15)
    this.muzzle.position.set(GUN_OFFSET.x, GUN_OFFSET.y, this.gun.position.z - length / 2)
    this.glint.position.set(GUN_OFFSET.x, GUN_OFFSET.y + 0.09, -0.25)
  }

  /**
   * @param viewer  your eye position — a scoped sniper's glint is brightest when they look at you.
   */
  update(s: RemotePlayerState, timeMs: number, viewer?: THREE.Vector3): void {
    if (s.weapon !== this.weapon) this.setWeapon(s.weapon)
    const height = m.standHeight + (m.crouchHeight - m.standHeight) * s.crouch
    const eye = m.standEyeHeight + (m.crouchEyeHeight - m.standEyeHeight) * s.crouch
    this.root.visible = s.alive
    this.root.position.set(s.x, s.y, s.z)
    this.root.rotation.y = s.yaw
    this.body.scale.y = height / m.standHeight
    this.body.position.y = height / 2
    this.head.position.y = eye
    this.head.rotation.x = s.pitch
    this.label.position.y = height + 0.35
    // Spawn protection: blink so attackers know shots won't count yet.
    this.material.opacity = s.protected && Math.floor(timeMs / 150) % 2 === 0 ? 0.35 : 1

    // Scope glint: a scoped sniper flashes towards whoever they're pointing at.
    const scoped = s.alive && s.aiming && s.weapon === WeaponId.Sniper
    this.glint.visible = scoped && viewer !== undefined
    if (this.glint.visible && viewer) {
      const look = new THREE.Vector3(
        -Math.sin(s.yaw) * Math.cos(s.pitch),
        Math.sin(s.pitch),
        -Math.cos(s.yaw) * Math.cos(s.pitch),
      )
      const toViewer = viewer
        .clone()
        .sub(new THREE.Vector3(s.x, s.y + 1.6, s.z))
        .normalize()
      const facing = Math.max(0, look.dot(toViewer))
      const strength = facing ** 6 * (0.85 + 0.15 * Math.sin(timeMs / 90))
      ;(this.glint.material as THREE.SpriteMaterial).opacity = strength
      this.glint.scale.setScalar(0.4 + strength * 1.2)
    }
  }

  /** World position of this player's gun muzzle (for their tracers and flashes). */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true)
    return target.setFromMatrixPosition(this.muzzle.matrixWorld)
  }

  dispose(): void {
    this.material.dispose()
    ;(this.glint.material as THREE.SpriteMaterial).dispose()
    const labelMaterial = this.label.material as THREE.SpriteMaterial
    labelMaterial.map?.dispose()
    labelMaterial.dispose()
  }
}
