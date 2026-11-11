import {
  DEFAULT_MOVEMENT,
  PLAYER_COLORS,
  type RemotePlayerState,
  type SkinId,
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

/** Skin-coloured parts shared by the people skins. */
const SKIN_TONES = [0xf1c6a0, 0xd9a07a, 0xa86f4c, 0x6e4630, 0xffdbbd]
const HAIR_COLORS = [0x2a1c12, 0x5a3b1e, 0xc9a35a, 0x161616, 0x8a4a22, 0x9a9a9a]
const skinMaterials = SKIN_TONES.map((color) => new THREE.MeshLambertMaterial({ color }))
const hairMaterials = HAIR_COLORS.map((color) => new THREE.MeshLambertMaterial({ color }))
const trouserMaterial = new THREE.MeshLambertMaterial({ color: 0x2f3440 })
const shoeMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
const eyeMaterial = new THREE.MeshLambertMaterial({ color: 0x15151a })
const metalMaterial = new THREE.MeshLambertMaterial({ color: 0x8e96a3 })
const darkMetalMaterial = new THREE.MeshLambertMaterial({ color: 0x3c424c })
const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x5ff2ff })
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const people = {
  leg: box(0.17, 0.82, 0.19),
  shoe: box(0.19, 0.08, 0.26),
  torso: box(0.46, 0.62, 0.26),
  arm: box(0.12, 0.56, 0.14),
  hand: box(0.11, 0.1, 0.11),
  head: box(0.3, 0.32, 0.3),
  hair: box(0.32, 0.09, 0.32),
  fringe: box(0.32, 0.06, 0.05),
  eye: box(0.05, 0.04, 0.02),
}
const robot = {
  leg: box(0.15, 0.8, 0.17),
  foot: box(0.2, 0.1, 0.28),
  hip: box(0.4, 0.12, 0.24),
  torso: box(0.5, 0.6, 0.3),
  panel: box(0.26, 0.2, 0.02),
  shoulder: box(0.16, 0.14, 0.18),
  arm: box(0.1, 0.52, 0.12),
  head: box(0.34, 0.3, 0.32),
  visor: box(0.28, 0.07, 0.02),
  antenna: box(0.03, 0.18, 0.03),
  bulb: new THREE.SphereGeometry(0.045, 8, 6),
}

/** A mesh that doesn't cast sun shadows (the shadow map is static, drawn once). */
function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  mesh.castShadow = false
  return mesh
}

/** Builds a skin: `body` holds everything below the neck (feet at 0), `head` is at the eyes. */
function dress(
  skin: SkinId,
  colorIndex: number,
  material: THREE.MeshLambertMaterial,
  body: THREE.Group,
  head: THREE.Group,
): void {
  if (skin === 'worker') {
    const skinTone = skinMaterials[colorIndex % skinMaterials.length] ?? material
    const hair = hairMaterials[(colorIndex * 7) % hairMaterials.length] ?? material
    for (const side of [-1, 1]) {
      body.add(part(people.leg, trouserMaterial, side * 0.11, 0.45, 0))
      body.add(part(people.shoe, shoeMaterial, side * 0.11, 0.04, -0.03))
      body.add(part(people.arm, material, side * 0.3, 1.2, 0))
      body.add(part(people.hand, skinTone, side * 0.3, 0.87, 0))
      head.add(part(people.eye, eyeMaterial, side * 0.07, 0.01, -0.151))
    }
    body.add(part(people.torso, material, 0, 1.17, 0))
    const tie = makeTie(colorIndex)
    tie.position.set(0, 0.93, m.radius - 0.135) // collar at the top of the shirt
    body.add(tie)
    head.add(part(people.head, skinTone, 0, 0.0, 0))
    head.add(part(people.hair, hair, 0, 0.18, 0))
    head.add(part(people.fringe, hair, 0, 0.13, -0.14))
    return
  }
  if (skin === 'robot') {
    for (const side of [-1, 1]) {
      body.add(part(robot.leg, darkMetalMaterial, side * 0.11, 0.45, 0))
      body.add(part(robot.foot, metalMaterial, side * 0.11, 0.05, -0.03))
      body.add(part(robot.shoulder, metalMaterial, side * 0.32, 1.42, 0))
      body.add(part(robot.arm, darkMetalMaterial, side * 0.32, 1.12, 0))
    }
    body.add(part(robot.hip, metalMaterial, 0, 0.9, 0))
    body.add(part(robot.torso, material, 0, 1.2, 0))
    body.add(part(robot.panel, metalMaterial, 0, 1.25, -0.16))
    head.add(part(robot.head, metalMaterial, 0, 0.0, 0))
    head.add(part(robot.visor, glowMaterial, 0, 0.01, -0.165))
    head.add(part(robot.antenna, darkMetalMaterial, 0.08, 0.24, 0))
    head.add(part(robot.bulb, material, 0.08, 0.34, 0))
    return
  }
  // Slime (default): a capsule in the player's color with tie, collar, visor and hat.
  const capsule = part(sharedGeometry.body, material, 0, m.standHeight / 2, 0)
  capsule.add(makeTie(colorIndex))
  body.add(capsule)
  head.add(part(sharedGeometry.visor, visorMaterial, 0, 0, -m.radius + 0.02))
  head.add(makeHat(colorIndex))
}

/**
 * A player as others see them, in the skin the admin picked (slime, office worker, robot) and
 * the player's color. Hitboxes are the same for every skin. Scaled as a whole for tiny people.
 * No floating name tag — names appear when your crosshair is on someone you can see (PLAN.md §6).
 */
export class Avatar {
  readonly root = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly material: THREE.MeshLambertMaterial
  private readonly head = new THREE.Group()
  private readonly muzzle = new THREE.Object3D()
  private readonly gun: THREE.Mesh
  private readonly glint: THREE.Sprite
  private weapon: WeaponId = WeaponId.Rifle

  constructor(name: string, colorIndex: number, skin: SkinId = 'slime') {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    this.material = new THREE.MeshLambertMaterial({ color, transparent: true })
    dress(skin, colorIndex, this.material, this.body, this.head)

    this.gun = new THREE.Mesh(sharedGeometry.guns[this.weapon], gunMaterial)
    this.glint = new THREE.Sprite(glintMaterial.clone())
    this.glint.visible = false
    this.head.add(this.gun, this.muzzle, this.glint)
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
  update(s: RemotePlayerState, timeMs: number, viewer?: THREE.Vector3, scale = 1): void {
    if (s.weapon !== this.weapon) this.setWeapon(s.weapon)
    const height = m.standHeight + (m.crouchHeight - m.standHeight) * s.crouch
    const eye = m.standEyeHeight + (m.crouchEyeHeight - m.standEyeHeight) * s.crouch
    this.root.visible = s.alive
    this.root.position.set(s.x, s.y, s.z)
    this.root.rotation.y = s.yaw
    this.root.scale.setScalar(scale)
    this.body.scale.y = height / m.standHeight
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
        .sub(new THREE.Vector3(s.x, s.y + 1.6 * scale, s.z))
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
