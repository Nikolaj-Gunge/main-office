import {
  type BodyPart,
  type BodyPose,
  bodyParts,
  PART_SIZES,
  type PartName,
  PLAYER_COLORS,
  type RemotePlayerState,
  type SkinId,
  WEAPONS,
  WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'
import {
  ARM_LENGTH,
  attachBaked,
  glossyVertexColored,
  type Slot,
  vertexColored,
} from './body-kit.ts'
import { gearBodies, showsUnder } from './gear-looks.ts'
import { EYE_HALO, EYES, ZOMBIE_EYES, type ZombieLook, zombieBody } from './zombie-bodies.ts'

/**
 * Player models. Every skin is built on the shared animated skeleton (skeleton.ts): each body
 * part is a group placed exactly where that part's hitbox is, so what you see is what you hit.
 */

/** What a body looks like: the admin's skin, or one of the zombies (zombies mode). */
export type BodyLook = SkinId | ZombieLook
export type { ZombieLook }

const ZOMBIE_LOOKS: readonly string[] = ['zombie', 'runner', 'brute', 'screamer', 'stalker']
const isZombie = (skin: BodyLook): skin is ZombieLook => ZOMBIE_LOOKS.includes(skin)

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const lambert = (color: number) => new THREE.MeshLambertMaterial({ color })

const SKIN_TONES = [0xf1c6a0, 0xd9a07a, 0xa86f4c, 0x6e4630, 0xffdbbd]
const HAIR_COLORS = [0x2a1c12, 0x5a3b1e, 0xc9a35a, 0x161616, 0x8a4a22, 0x9a9a9a]
const TIE_COLORS = [0x1f2a44, 0x7a1f2b, 0x2d4a3a, 0x3b2d4f, 0x8a6a1f, 0x1c1c1c]
const HAT_COLORS = [0x2b2b2e, 0x4a3426, 0x2f3b4a, 0x5a5048]
const skinMaterials = SKIN_TONES.map(lambert)
const hairMaterials = HAIR_COLORS.map(lambert)
const tieMaterials = TIE_COLORS.map(lambert)
const hatMaterials = HAT_COLORS.map(lambert)
const trouserMaterial = lambert(0x2f3440)
const shoeMaterial = lambert(0x1a1a1a)
const beltMaterial = lambert(0x1c1a18)
const collarMaterial = lambert(0xf2f0ea)
const eyeMaterial = lambert(0x15151a)
const visorMaterial = lambert(0x1b1d2a)
const metalMaterial = lambert(0x8e96a3)
const darkMetalMaterial = lambert(0x3c424c)
const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x5ff2ff })
const gunMaterial = lambert(0x2b2d33)
const deadEyes = lambert(0x2a0d0d)
const pick = <T>(list: T[], i: number): T =>
  list[((i % list.length) + list.length) % list.length] as T

/** Third-person weapons are plain boxes: how long each is (m), grip to muzzle or tip. */
const GUN_LENGTH: Record<WeaponId, number> = {
  [WeaponId.Handgun]: 0.22,
  [WeaponId.Rifle]: 0.7,
  [WeaponId.Sniper]: 0.95,
  [WeaponId.Shotgun]: 0.8,
  [WeaponId.Knife]: 0.3,
  [WeaponId.Smg]: 0.5,
  [WeaponId.Lmg]: 0.95,
  [WeaponId.Claws]: 0.01,
  [WeaponId.Bat]: 0.8,
  [WeaponId.Crowbar]: 0.6,
  [WeaponId.Machete]: 0.58,
  [WeaponId.Axe]: 0.65,
  [WeaponId.Sledge]: 0.7,
  [WeaponId.Katana]: 0.85,
  [WeaponId.M1911]: 0.22,
  [WeaponId.Revolver]: 0.25,
  [WeaponId.M9]: 0.22,
  [WeaponId.Ruger]: 0.38,
  [WeaponId.SawedOff]: 0.42,
  [WeaponId.Uzi]: 0.42,
  [WeaponId.Ump]: 0.6,
  [WeaponId.Mac10]: 0.3,
  [WeaponId.Ak47]: 0.78,
  [WeaponId.Sks]: 0.9,
  [WeaponId.HuntingRifle]: 0.95,
  [WeaponId.Carbine22]: 0.65,
  [WeaponId.LeverAction]: 0.82,
  [WeaponId.DoubleBarrel]: 0.85,
  [WeaponId.AutoShotgun]: 0.78,
  [WeaponId.Svd]: 1.05,
  [WeaponId.Barrett]: 1.15,
  [WeaponId.Crossbow]: 0.7,
}
/** Width and height of those boxes, where a weapon is slimmer or fatter than most guns. */
const GUN_THICKNESS: Partial<Record<WeaponId, [number, number]>> = {
  [WeaponId.Knife]: [0.03, 0.04],
  [WeaponId.Bat]: [0.04, 0.04],
  [WeaponId.Crowbar]: [0.025, 0.025],
  [WeaponId.Machete]: [0.02, 0.05],
  [WeaponId.Axe]: [0.03, 0.05],
  [WeaponId.Sledge]: [0.04, 0.05],
  [WeaponId.Katana]: [0.02, 0.035],
  [WeaponId.M1911]: [0.04, 0.09],
  [WeaponId.Revolver]: [0.045, 0.09],
  [WeaponId.M9]: [0.045, 0.09],
  [WeaponId.Ruger]: [0.04, 0.07],
  [WeaponId.SawedOff]: [0.06, 0.07],
  [WeaponId.Mac10]: [0.06, 0.09],
  [WeaponId.Carbine22]: [0.05, 0.08],
  [WeaponId.Barrett]: [0.08, 0.13],
  [WeaponId.Crossbow]: [0.1, 0.07],
}
const gunGeometry = Object.fromEntries(
  Object.entries(GUN_LENGTH).map(([id, length]) => {
    const [width, height] = GUN_THICKNESS[Number(id) as WeaponId] ?? [0.06, 0.1]
    return [id, box(width, height, length)]
  }),
) as Record<string, THREE.BoxGeometry>

/** A mesh in part space (origin = part centre; limbs run along their local +Y). */
function part(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  mesh.castShadow = false
  return mesh
}

/**
 * The meshes of every body part for a skin, each in its own group (part space). Shared by the
 * live avatar and the ragdoll, so a body falls exactly as it stood.
 */
export function buildBody(
  skin: BodyLook,
  colorIndex: number,
  material: THREE.MeshLambertMaterial,
  dead = false,
): Record<Exclude<PartName, 'gun'>, THREE.Group> {
  const s = PART_SIZES
  const g = () => new THREE.Group()
  const body = {
    head: g(),
    chest: g(),
    stomach: g(),
    armL: g(),
    armR: g(),
    thighL: g(),
    shinL: g(),
    thighR: g(),
    shinR: g(),
  }
  const skinTone = pick(skinMaterials, colorIndex)
  const hair = pick(hairMaterials, colorIndex * 7)
  const tie = pick(tieMaterials, colorIndex)
  const W = (h: { x: number; y: number; z: number }) => [h.x * 2, h.y * 2, h.z * 2] as const

  if (skin === 'robot') {
    body.head.add(
      part(box(...W(s.head)), metalMaterial),
      part(box(0.26, 0.07, 0.02), glowMaterial, 0, 0.01, -s.head.z - 0.005),
      part(box(0.03, 0.18, 0.03), darkMetalMaterial, 0.08, s.head.y + 0.09, 0),
      part(new THREE.SphereGeometry(0.045, 8, 6), material, 0.08, s.head.y + 0.2, 0),
    )
    body.chest.add(
      part(box(...W(s.chest)), material),
      part(box(0.24, 0.16, 0.02), metalMaterial, 0, 0.02, -s.chest.z - 0.005),
    )
    body.stomach.add(part(box(...W(s.stomach)), metalMaterial))
    for (const arm of [body.armL, body.armR]) {
      arm.add(
        part(box(0.12, 0.46, 0.14), darkMetalMaterial, 0, -0.05, 0),
        part(box(0.16, 0.12, 0.18), metalMaterial, 0, -ARM_LENGTH / 2 + 0.04, 0),
        part(box(0.11, 0.1, 0.11), metalMaterial, 0, ARM_LENGTH / 2 - 0.05, 0),
      )
    }
    for (const thigh of [body.thighL, body.thighR])
      thigh.add(part(box(...W(s.thighL)), darkMetalMaterial))
    for (const shin of [body.shinL, body.shinR]) {
      shin.add(
        part(box(...W(s.shinL)), darkMetalMaterial),
        part(box(0.2, 0.1, 0.28), metalMaterial, 0, -s.shinL.y + 0.03, -0.04),
      )
    }
    return body
  }

  if (skin === 'slime') {
    // The office slime: a jelly person in the player's color, with visor, tie and hat.
    body.head.add(
      part(box(...W(s.head)), material),
      part(box(0.26, 0.09, 0.03), visorMaterial, 0, 0.01, -s.head.z - 0.005),
      makeHat(colorIndex, s.head.y),
    )
    body.chest.add(
      part(box(...W(s.chest)), material),
      under(part(box(0.09, 0.3, 0.03), tie, 0, -0.02, -s.chest.z - 0.01)),
      under(part(box(0.3, 0.06, 0.05), collarMaterial, 0, s.chest.y - 0.03, -s.chest.z)),
    )
    body.stomach.add(part(box(...W(s.stomach)), material))
    for (const arm of [body.armL, body.armR]) arm.add(part(box(0.12, ARM_LENGTH, 0.14), material))
    for (const leg of [body.thighL, body.thighR, body.shinL, body.shinR]) {
      leg.add(part(box(...W(s.thighL)), material))
    }
    return body
  }

  if (isZombie(skin)) {
    // Each kind its own silhouette (zombie-bodies.ts); colorIndex also carries the zombie's id,
    // which picks its variant (clothes, hair, which arm is flayed...).
    const eyes = dead ? deadEyes : ZOMBIE_EYES[skin]
    const skinMaterial = skin === 'stalker' ? glossyVertexColored : vertexColored
    attachBaked(zombieBody(skin, colorIndex), body, (slot: Slot) =>
      slot === 'vc' ? skinMaterial : slot === 'eyes' ? eyes : slot === 'own' ? material : slot,
    )
    return body
  }

  // Office worker (default): shirt in the player's color, tie, trousers, shoes, hair.
  body.head.add(
    part(box(...W(s.head)), skinTone),
    part(box(0.32, 0.09, 0.32), hair, 0, s.head.y + 0.02, 0),
    part(box(0.32, 0.06, 0.05), hair, 0, s.head.y - 0.04, -s.head.z + 0.01),
    part(box(0.05, 0.04, 0.02), eyeMaterial, -0.07, 0.01, -s.head.z - 0.005),
    part(box(0.05, 0.04, 0.02), eyeMaterial, 0.07, 0.01, -s.head.z - 0.005),
  )
  body.chest.add(
    part(box(...W(s.chest)), material),
    under(part(box(0.3, 0.06, 0.05), collarMaterial, 0, s.chest.y - 0.03, -s.chest.z)),
    under(part(box(0.11, 0.07, 0.04), tie, 0, s.chest.y - 0.08, -s.chest.z - 0.01)),
    under(part(box(0.09, 0.24, 0.03), tie, 0, -0.04, -s.chest.z - 0.01)),
  )
  body.stomach.add(
    part(box(...W(s.stomach)), material),
    under(part(box(0.09, 0.2, 0.03), tie, 0, 0.05, -s.stomach.z - 0.01)),
    part(
      box(s.stomach.x * 2 + 0.01, 0.05, s.stomach.z * 2 + 0.01),
      beltMaterial,
      0,
      -s.stomach.y + 0.03,
      0,
    ),
  )
  for (const arm of [body.armL, body.armR]) {
    arm.add(
      part(box(0.12, ARM_LENGTH - 0.1, 0.14), material, 0, -0.05, 0),
      part(box(0.11, 0.1, 0.11), skinTone, 0, ARM_LENGTH / 2 - 0.05, 0),
    )
  }
  for (const thigh of [body.thighL, body.thighR])
    thigh.add(part(box(...W(s.thighL)), trouserMaterial))
  for (const shin of [body.shinL, body.shinR]) {
    shin.add(
      part(box(...W(s.shinL)), trouserMaterial),
      part(box(0.19, 0.08, 0.26), shoeMaterial, 0, -s.shinL.y + 0.02, -0.04),
    )
  }
  return body
}

/** Marks what a closed coat or vest hides (tie, collar). */
function under<T extends THREE.Object3D>(o: T): T {
  o.name = 'under'
  return o
}

/** A fedora or a bowler on top of a head of half-height `top`. */
function makeHat(colorIndex: number, top: number): THREE.Group {
  const g = new THREE.Group()
  g.name = 'hat' // hidden under worn head gear
  const material = pick(hatMaterials, colorIndex)
  const brim = part(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 12), material, 0, top + 0.01, 0)
  if (colorIndex % 2 === 0) {
    g.add(
      brim,
      part(new THREE.CylinderGeometry(0.15, 0.17, 0.16, 12), material, 0, top + 0.1, 0),
      part(new THREE.CylinderGeometry(0.172, 0.172, 0.04, 12), lambert(0x111111), 0, top + 0.04, 0),
    )
  } else {
    g.add(
      brim,
      part(
        new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        material,
        0,
        top + 0.01,
        0,
      ),
    )
  }
  return g
}

function makeGlintTexture(): THREE.CanvasTexture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.2, 'rgba(255,250,220,0.8)')
  grad.addColorStop(1, 'rgba(255,240,200,0)')
  ctx.fillStyle = grad
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

function makeEyeGlowTexture(): THREE.CanvasTexture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}
const eyeGlowTexture = makeEyeGlowTexture()
/** The light a zombie's eyes throw off: a soft halo in front of each eye. */
const eyeGlow = (color: THREE.Color) =>
  new THREE.SpriteMaterial({
    map: eyeGlowTexture,
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    transparent: true,
  })
const EYE_GLOW = Object.fromEntries(
  Object.entries(EYE_HALO).map(([look, color]) => [look, eyeGlow(color)]),
) as Record<ZombieLook, THREE.SpriteMaterial>

/** Places a part group at a skeleton part (arms also stretch to their shoulder–hand span). */
export function placePart(group: THREE.Object3D, p: BodyPart, size: number): void {
  group.position.set(p.center.x, p.center.y, p.center.z)
  group.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w)
  if (p.name === 'armL' || p.name === 'armR')
    group.scale.set(size, (p.half.y * 2) / ARM_LENGTH, size)
  else group.scale.setScalar(size)
}

/**
 * Another player as you see them: the skin's part meshes posed on the animated skeleton every
 * frame (running legs, arms on the gun, head following the aim) — the same pose the server hits.
 * No floating name tag — names appear when your crosshair is on someone you can see.
 */
export class Avatar {
  readonly root = new THREE.Group()
  private readonly material: THREE.MeshLambertMaterial
  private readonly parts: Record<Exclude<PartName, 'gun'>, THREE.Group>
  private readonly gunGroup = new THREE.Group()
  private readonly gun: THREE.Mesh
  private readonly muzzle = new THREE.Object3D()
  private readonly glint: THREE.Sprite
  private weapon: WeaponId = WeaponId.Rifle
  private readonly eyeGlows: THREE.Sprite[] = []
  private readonly glowSize: number = 0.2
  /** Survival gear worn (people, and the dead who were survivors); the value shown and its meshes. */
  private gear = 0
  private gearMeshes: THREE.Mesh[] = []
  /** The pose last drawn (for the ragdoll when they die). */
  lastParts: BodyPart[] = []

  constructor(name: string, colorIndex: number, skin: BodyLook = 'worker') {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    this.material = new THREE.MeshLambertMaterial({ color, transparent: true })
    this.parts = buildBody(skin, colorIndex, this.material)
    for (const group of Object.values(this.parts)) this.root.add(group)
    if (isZombie(skin)) {
      const eyes = EYES[skin]
      this.glowSize = eyes.glow
      for (const x of [-eyes.x, eyes.x]) {
        const glow = new THREE.Sprite(EYE_GLOW[skin])
        glow.position.set(x, eyes.y, -PART_SIZES.head.z - 0.03)
        glow.scale.setScalar(eyes.glow)
        this.eyeGlows.push(glow)
        this.parts.head.add(glow)
      }
    }
    this.gun = part(gunGeometry[WeaponId.Rifle] as THREE.BoxGeometry, gunMaterial)
    this.glint = new THREE.Sprite(glintMaterial.clone())
    this.glint.visible = false
    this.gunGroup.add(this.gun, this.muzzle, this.glint)
    this.root.add(this.gunGroup)
    this.setWeapon(WeaponId.Rifle)
    this.root.name = `avatar:${name}`
  }

  private setWeapon(id: WeaponId): void {
    this.weapon = id
    const length = GUN_LENGTH[id]
    this.gun.geometry = gunGeometry[id] as THREE.BoxGeometry
    this.gun.visible = id !== WeaponId.Claws // zombies hold nothing
    // Gun part centre sits 0.12 m ahead of the grip; the gun's back end ~0.1 m behind the grip.
    this.gun.position.set(0, 0, 0.22 - length / 2)
    this.muzzle.position.set(0, 0, 0.22 - length)
    this.glint.position.set(0, 0.07, -0.05)
  }

  /** Swaps the worn head and body pieces (only when the replicated value changes). */
  private setGear(gear: number): void {
    this.gear = gear
    for (const mesh of this.gearMeshes) mesh.removeFromParent()
    this.gearMeshes = []
    const { head, body } = gearBodies(gear)
    const resolve = (slot: Slot) =>
      slot === 'vc' ? vertexColored : slot === 'own' || slot === 'eyes' ? this.material : slot
    if (head) this.gearMeshes.push(...attachBaked(head, this.parts, resolve))
    if (body) this.gearMeshes.push(...attachBaked(body, this.parts, resolve))
    const hat = this.parts.head.getObjectByName('hat')
    if (hat) hat.visible = head === null
    const under = showsUnder(gear)
    for (const group of [this.parts.chest, this.parts.stomach]) {
      for (const child of group.children) if (child.name === 'under') child.visible = under
    }
  }

  /**
   * @param pose    their full body pose (remotePose): exactly what their hitboxes are built from.
   * @param viewer  your eye position — a scoped sniper's glint is brightest when they look at you.
   */
  update(s: RemotePlayerState, pose: BodyPose, timeMs: number, viewer?: THREE.Vector3): void {
    if (s.weapon !== this.weapon) this.setWeapon(s.weapon)
    // The dead wear gear only if they were one of you (the server sends 0 for the rest).
    if ((s.gear ?? 0) !== this.gear) this.setGear(s.gear ?? 0)
    this.root.visible = s.alive
    const size = pose.scale ?? 1
    const parts = bodyParts(pose)
    this.lastParts = parts
    for (const p of parts) {
      const group = p.name === 'gun' ? this.gunGroup : this.parts[p.name]
      placePart(group, p, size)
    }
    // Zombie eyes smoulder: the halo breathes, each zombie in its own time.
    if (this.eyeGlows.length > 0) {
      const breath = this.glowSize * (1 + 0.2 * Math.sin(timeMs / 420 + this.root.id))
      // Only from the front: no halo round the back of the head.
      const facing = viewer
        ? -Math.sin(s.yaw) * (viewer.x - s.x) - Math.cos(s.yaw) * (viewer.z - s.z) > 0
        : true
      for (const glow of this.eyeGlows) {
        glow.visible = facing
        glow.scale.setScalar(breath)
      }
    }
    // Spawn protection: blink so attackers know shots won't count yet.
    const blink = s.protected && Math.floor(timeMs / 150) % 2 === 0
    this.material.opacity = blink ? 0.35 : 1
    for (const mesh of this.gearMeshes) mesh.visible = !blink

    // Scope glint: a scoped sniper flashes towards whoever they're pointing at.
    const scoped = s.alive && s.aiming && WEAPONS[s.weapon]?.scoped === true
    this.glint.visible = scoped && viewer !== undefined
    if (this.glint.visible && viewer) {
      const look = new THREE.Vector3(
        -Math.sin(s.yaw) * Math.cos(s.pitch),
        Math.sin(s.pitch),
        -Math.cos(s.yaw) * Math.cos(s.pitch),
      )
      const toViewer = viewer
        .clone()
        .sub(new THREE.Vector3(s.x, s.y + 1.6 * size, s.z))
        .normalize()
      const facing = Math.max(0, look.dot(toViewer))
      const strength = facing ** 6 * (0.85 + 0.15 * Math.sin(timeMs / 90))
      ;(this.glint.material as THREE.SpriteMaterial).opacity = strength
      this.glint.scale.setScalar(0.4 + strength * 1.2)
    }
  }

  /** Team color instead of the player's own (team modes); null = back to their own. */
  setTint(color: number | null, own: number): void {
    this.material.color.setHex(color ?? own)
  }

  /** World position of this player's gun muzzle (for their tracers and flashes). */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    this.gunGroup.updateMatrixWorld(true)
    return target.setFromMatrixPosition(this.muzzle.matrixWorld)
  }

  dispose(): void {
    this.material.dispose()
    ;(this.glint.material as THREE.SpriteMaterial).dispose()
  }
}
