import {
  DEFAULT_MOVEMENT,
  PLAYER_COLORS,
  type RemotePlayerState,
  WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'

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

// Office wear: a tie on the chest and a hat, picked per player from these.
const TIE_COLORS = [0x1f2a44, 0x7a1f2b, 0x2d4a3a, 0x3b2d4f, 0x8a6a1f, 0x1c1c1c]
const HAT_COLORS = [0x2b2b2e, 0x4a3426, 0x2f3b4a, 0x5a5048]
const tieMaterials = TIE_COLORS.map((color) => new THREE.MeshLambertMaterial({ color }))
const hatMaterials = HAT_COLORS.map((color) => new THREE.MeshLambertMaterial({ color }))
const bandMaterial = new THREE.MeshLambertMaterial({ color: 0x111111 })
const collarMaterial = new THREE.MeshLambertMaterial({ color: 0xf2f0ea })
const wear = {
  tie: new THREE.BoxGeometry(0.09, 0.42, 0.03),
  knot: new THREE.BoxGeometry(0.11, 0.07, 0.04),
  collar: new THREE.BoxGeometry(0.3, 0.06, 0.05),
  brim: new THREE.CylinderGeometry(0.44, 0.44, 0.03, 12),
  crown: new THREE.CylinderGeometry(0.25, 0.28, 0.2, 12),
  band: new THREE.CylinderGeometry(0.285, 0.285, 0.045, 12),
  bowler: new THREE.SphereGeometry(0.29, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
}

/** Tie + collar on the chest, attached to the body so they squash with crouching. */
function makeTie(colorIndex: number): THREE.Group {
  const g = new THREE.Group()
  const material = tieMaterials[colorIndex % tieMaterials.length] ?? tieMaterials[0]
  // Body mesh is centred at half height: chest ≈ 0.3 m above its centre, front at -radius.
  const front = -m.radius - 0.005
  const tie = new THREE.Mesh(wear.tie, material)
  tie.position.set(0, 0.24, front)
  tie.rotation.x = -0.12 // follows the curve of the belly a little
  const knot = new THREE.Mesh(wear.knot, material)
  knot.position.set(0, 0.48, front - 0.005)
  const collar = new THREE.Mesh(wear.collar, collarMaterial)
  collar.position.set(0, 0.53, front + 0.01)
  g.add(tie, knot, collar)
  return g
}

/** A fedora or a bowler, sitting on top of the head (head group origin = eyes). */
function makeHat(colorIndex: number): THREE.Group {
  const g = new THREE.Group()
  const material = hatMaterials[colorIndex % hatMaterials.length] ?? hatMaterials[0]
  const top = m.standHeight - m.standEyeHeight // capsule top above the eyes
  if (colorIndex % 2 === 0) {
    const brim = new THREE.Mesh(wear.brim, material)
    brim.position.y = top - 0.02
    const crown = new THREE.Mesh(wear.crown, material)
    crown.position.y = top + 0.09
    const band = new THREE.Mesh(wear.band, bandMaterial)
    band.position.y = top + 0.02
    g.add(brim, crown, band)
  } else {
    const brim = new THREE.Mesh(wear.brim, material)
    brim.scale.set(0.8, 1, 0.8)
    brim.position.y = top - 0.02
    const dome = new THREE.Mesh(wear.bowler, material)
    dome.position.y = top - 0.02
    g.add(brim, dome)
  }
  for (const part of g.children) part.castShadow = false
  return g
}
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
 * Placeholder player model: a capsule in the player's color dressed for the office — tie and
 * collar, fedora or bowler hat — with a dark visor showing where they look and a gun at the right. No floating name tag — names appear when
 * your crosshair is on someone you can see (PLAN.md §6).
 */
export class Avatar {
  readonly root = new THREE.Group()
  private readonly body: THREE.Mesh
  private readonly material: THREE.MeshLambertMaterial
  private readonly head = new THREE.Group()
  private readonly muzzle = new THREE.Object3D()
  private readonly gun: THREE.Mesh
  private readonly glint: THREE.Sprite
  private weapon: WeaponId = WeaponId.Rifle

  constructor(name: string, colorIndex: number) {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    this.material = new THREE.MeshLambertMaterial({ color, transparent: true })
    this.body = new THREE.Mesh(sharedGeometry.body, this.material)
    // No sun shadow: the shadow map is static (drawn once), and indoors the roof shades you anyway.
    this.body.castShadow = false
    this.body.position.y = m.standHeight / 2

    const visor = new THREE.Mesh(sharedGeometry.visor, visorMaterial)
    visor.position.set(0, 0, -m.radius + 0.02)
    this.gun = new THREE.Mesh(sharedGeometry.guns[this.weapon], gunMaterial)
    this.glint = new THREE.Sprite(glintMaterial.clone())
    this.glint.visible = false
    this.head.add(visor, this.gun, this.muzzle, this.glint, makeHat(colorIndex))
    this.body.add(makeTie(colorIndex))
    this.setWeapon(WeaponId.Rifle)

    this.root.add(this.body, this.head)
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
  }
}
