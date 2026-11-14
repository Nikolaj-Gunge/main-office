import {
  type Appearance,
  type BodyPart,
  type BodyPose,
  bodyParts,
  PLAYER_COLORS,
  type RemotePlayerState,
  randomAppearance,
  type SkinId,
  WEAPONS,
  WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  ARM_LENGTH,
  type BodyMesh,
  glossyVertexColored,
  recolor,
  type Slot,
  seeded,
  vertexColored,
} from './body-kit.ts'
import { BONES, makeBones, REST_INVERSE, type RigBone, steadyArms } from './body-rig.ts'
import { buildGunModel } from './gun-models.ts'
import { personMesh } from './people.ts'
import { EYE_HALO, EYES, ZOMBIE_EYES, type ZombieLook, zombieBody } from './zombie-bodies.ts'

/**
 * Player models: one smooth skinned mesh per body (people.ts, zombie-bodies.ts) on bones that
 * are placed exactly where the skeleton's hitboxes are (skeleton.ts), so what you see is what
 * you hit — and knees, hips, shoulders and necks bend without gaps.
 */

/** What a body looks like: the admin's skin, or one of the zombies (zombies mode). */
export type BodyLook = SkinId | ZombieLook
export type { ZombieLook }

const ZOMBIE_LOOKS: readonly string[] = ['zombie', 'runner', 'brute', 'screamer', 'stalker']
const isZombie = (skin: BodyLook): skin is ZombieLook => ZOMBIE_LOOKS.includes(skin)

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const lambert = (color: number) => new THREE.MeshLambertMaterial({ color })
const gunMaterial = lambert(0x2b2d33)
const deadEyes = lambert(0x2a0d0d)
/** People blinking under spawn protection. */
const blinkMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.35,
})

/** Survival dresses people in what they wear (gear), from a tank top up; elsewhere, office clothes. */
let survivalDress = false
export function setSurvivalDress(on: boolean): void {
  survivalDress = on
}

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
const meleeGeometry = Object.fromEntries(
  Object.entries(GUN_LENGTH).map(([id, length]) => {
    const [width, height] = GUN_THICKNESS[Number(id) as WeaponId] ?? [0.06, 0.1]
    return [id, box(width, height, length)]
  }),
) as Record<string, THREE.BoxGeometry>

/** A gun in someone's hands: the floor model (gun-models.ts) merged into one vertex-coloured mesh. */
interface HeldGun {
  geometry: THREE.BufferGeometry
  /** Model origin (the grip) offset in the gun part's space, and the muzzle. */
  muzzle: THREE.Vector3
}
const heldGuns = new Map<WeaponId, HeldGun | null>()
/** Where the grip sits in the gun part's space (skeleton: the part is 0.12 m ahead, 0.05 up). */
const GRIP = new THREE.Vector3(0, -0.09, 0.12)

function heldGun(id: WeaponId): HeldGun | null {
  if (heldGuns.has(id)) return heldGuns.get(id) ?? null
  let held: HeldGun | null = null
  try {
    const model = buildGunModel(id)
    model.updateMatrixWorld(true)
    const parts: THREE.BufferGeometry[] = []
    const c = new THREE.Color()
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const color = (material as THREE.MeshLambertMaterial | undefined)?.color
      c.copy(color ?? new THREE.Color(0x2b2d33))
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
      }
      if (!g.getAttribute('normal')) g.computeVertexNormals()
      g.applyMatrix4(mesh.matrixWorld)
      g.translate(GRIP.x, GRIP.y, GRIP.z)
      const n = g.getAttribute('position').count
      const colors = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      parts.push(g)
    })
    const geometry = parts.length > 0 ? mergeGeometries(parts) : null
    for (const g of parts) g.dispose()
    if (geometry) {
      geometry.computeBoundingBox()
      const b = geometry.boundingBox as THREE.Box3
      held = {
        geometry,
        muzzle: new THREE.Vector3(0, b.min.y + (b.max.y - b.min.y) * 0.7, b.min.z),
      }
    }
  } catch {
    held = null
  }
  heldGuns.set(id, held)
  return held
}

/** A rigged body: the part bones (placed every frame), the skinned mesh and what it was built from. */
interface Rig {
  parts: Record<Exclude<RigBone, 'handL' | 'handR'>, THREE.Bone>
  skeleton: THREE.Skeleton
  mesh: THREE.SkinnedMesh
  body: BodyMesh
  /** The geometry is this body's own (people), not shared (zombies): dispose it with the body. */
  owned: boolean
}

function materialsFor(skin: BodyLook, body: BodyMesh, dead: boolean): THREE.Material[] {
  return body.slots.map((slot: Slot) => {
    if (slot === 'vc') return skin === 'stalker' ? glossyVertexColored : vertexColored
    if (slot === 'eyes') return dead || !isZombie(skin) ? deadEyes : ZOMBIE_EYES[skin]
    return slot
  })
}

function rig(skin: BodyLook, body: BodyMesh, owned: boolean, dead: boolean): Rig {
  const { bones, byName } = makeBones()
  const skeleton = new THREE.Skeleton(
    bones,
    REST_INVERSE.map((m) => m.clone()),
  )
  const materials = materialsFor(skin, body, dead)
  const mesh = new THREE.SkinnedMesh(
    body.geometry,
    materials.length === 1 ? materials[0] : materials,
  )
  mesh.castShadow = false
  mesh.frustumCulled = true
  // Bound by the chest (the mesh rides on it; skinning cancels its own transform).
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6)
  mesh.bind(skeleton, new THREE.Matrix4())
  mesh.userData.ownGeometry = owned
  byName.chest.add(mesh)
  const parts = Object.fromEntries(
    BONES.filter((b) => b !== 'handL' && b !== 'handR').map((b) => [b, byName[b]]),
  ) as Rig['parts']
  return { parts, skeleton, mesh, body, owned }
}

/** The body of a person or zombie (baked geometry; people's is their own). */
function bodyMesh(
  skin: BodyLook,
  colorIndex: number,
  own: number,
  appearance: Appearance,
  gear: number | null,
): { body: BodyMesh; owned: boolean } {
  if (isZombie(skin)) return { body: zombieBody(skin, colorIndex), owned: false }
  return { body: personMesh({ skin, appearance, colorIndex, gear }, own), owned: true }
}

/** A stable face for someone who never chose one (bots, old clients). */
const defaultLook = (colorIndex: number) => randomAppearance(seeded(colorIndex * 7919 + 13))

/**
 * The bones of every body part for a skin, the skinned mesh riding on the chest. Shared by the
 * live avatar and the ragdoll, so a body falls exactly as it stood.
 */
export function buildBody(
  skin: BodyLook,
  colorIndex: number,
  material: THREE.MeshLambertMaterial,
  dead = false,
  appearance?: Appearance,
  gear: number | null = null,
): Record<Exclude<RigBone, 'handL' | 'handR'>, THREE.Object3D> {
  const look = appearance ?? defaultLook(colorIndex)
  const { body, owned } = bodyMesh(skin, colorIndex, material.color.getHex(), look, gear)
  return rig(skin, body, owned, dead).parts
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

/** Places a part bone at a skeleton part (arms also stretch to their shoulder–hand span). */
export function placePart(group: THREE.Object3D, p: BodyPart, size: number): void {
  group.position.set(p.center.x, p.center.y, p.center.z)
  group.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w)
  if (p.name === 'armL' || p.name === 'armR') {
    const stretch = (p.half.y * 2) / ARM_LENGTH
    group.scale.set(size, stretch, size)
    // The hand rides on the end without stretching.
    const hand = group.userData.hand as THREE.Object3D | undefined
    hand?.scale.set(1, size / stretch, 1)
  } else group.scale.setScalar(size)
}

/** Removes a rigged body's own resources (people's geometry). */
export function disposeBody(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh && mesh.userData.ownGeometry) mesh.geometry.dispose()
  })
}

/**
 * Another player as you see them: their body posed on the animated skeleton every frame
 * (running legs, arms on the gun, head following the aim) — the same pose the server hits.
 * No floating name tag — names appear when your crosshair is on someone you can see.
 */
export class Avatar {
  readonly root = new THREE.Group()
  private readonly material: THREE.MeshLambertMaterial
  private readonly skin: BodyLook
  private readonly colorIndex: number
  private rig: Rig
  private readonly gunGroup = new THREE.Group()
  private readonly gun: THREE.Mesh
  private readonly muzzle = new THREE.Object3D()
  private readonly glint: THREE.Sprite
  private weapon: WeaponId = WeaponId.Rifle
  private readonly eyeGlows: THREE.Sprite[] = []
  private readonly glowSize: number = 0.2
  /** People (not the dead) wear survival gear; the value now shown. */
  private readonly wearsGear: boolean
  private gear = 0
  private blinking = false
  /** The pose last drawn (for the ragdoll when they die). */
  lastParts: BodyPart[] = []
  /** Their own look (character creator: build, skin, hair, eyes, beard); none for zombies. */
  readonly appearance?: Appearance
  private readonly look: Appearance

  constructor(
    name: string,
    colorIndex: number,
    skin: BodyLook = 'worker',
    appearance?: Appearance,
  ) {
    if (appearance) this.appearance = appearance
    this.look = appearance ?? defaultLook(colorIndex)
    this.skin = skin
    this.colorIndex = colorIndex
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    this.material = new THREE.MeshLambertMaterial({ color })
    this.wearsGear = !isZombie(skin) && survivalDress
    this.rig = this.makeRig()
    if (isZombie(skin)) {
      const eyes = EYES[skin]
      this.glowSize = eyes.glow
      for (const x of [-eyes.x, eyes.x]) {
        const glow = new THREE.Sprite(EYE_GLOW[skin])
        glow.position.set(x, eyes.y, eyes.z - 0.03)
        glow.scale.setScalar(eyes.glow)
        this.eyeGlows.push(glow)
        this.rig.parts.head.add(glow)
      }
    }
    this.gun = new THREE.Mesh(meleeGeometry[WeaponId.Rifle], gunMaterial)
    this.gun.castShadow = false
    this.glint = new THREE.Sprite(glintMaterial.clone())
    this.glint.visible = false
    this.gunGroup.add(this.gun, this.muzzle, this.glint)
    this.root.add(this.gunGroup)
    this.setWeapon(WeaponId.Rifle)
    this.root.name = `avatar:${name}`
  }

  private makeRig(): Rig {
    const { body, owned } = bodyMesh(
      this.skin,
      this.colorIndex,
      this.material.color.getHex(),
      this.look,
      this.wearsGear ? this.gear : null,
    )
    const r = rig(this.skin, body, owned, false)
    for (const bone of Object.values(r.parts)) this.root.add(bone)
    return r
  }

  private setWeapon(id: WeaponId): void {
    this.weapon = id
    this.gun.visible = id !== WeaponId.Claws // zombies hold nothing
    const melee = WEAPONS[id]?.slot === 'melee'
    const held = melee ? null : heldGun(id)
    if (held) {
      this.gun.geometry = held.geometry
      this.gun.material = vertexColored
      this.gun.position.set(0, 0, 0)
      this.muzzle.position.copy(held.muzzle)
    } else {
      // Melee weapons (and anything without a model) stay simple shapes.
      const length = GUN_LENGTH[id] ?? 0.5
      this.gun.geometry = meleeGeometry[id] ?? (meleeGeometry[WeaponId.Rifle] as THREE.BoxGeometry)
      this.gun.material = gunMaterial
      // Gun part centre sits 0.12 m ahead of the grip; the back end ~0.1 m behind the grip.
      this.gun.position.set(0, 0, 0.22 - length / 2)
      this.muzzle.position.set(0, 0, 0.22 - length)
    }
    this.glint.position.set(0, 0.07, -0.05)
  }

  /** Re-dresses them (only when the replicated value changes): the body is rebuilt. */
  private setGear(gear: number): void {
    this.gear = gear
    const old = this.rig
    const bones = Object.values(old.parts)
    const fresh = bodyMesh(
      this.skin,
      this.colorIndex,
      this.material.color.getHex(),
      this.look,
      gear,
    )
    const materials = materialsFor(this.skin, fresh.body, false)
    old.mesh.geometry = fresh.body.geometry
    old.mesh.material = materials.length === 1 ? (materials[0] as THREE.Material) : materials
    if (old.owned) old.body.geometry.dispose()
    old.body = fresh.body
    old.owned = fresh.owned
    old.mesh.userData.ownGeometry = fresh.owned
    this.blinking = false
    void bones
  }

  /**
   * @param pose    their full body pose (remotePose): exactly what their hitboxes are built from.
   * @param viewer  your eye position — a scoped sniper's glint is brightest when they look at you.
   */
  update(s: RemotePlayerState, pose: BodyPose, timeMs: number, viewer?: THREE.Vector3): void {
    if (s.weapon !== this.weapon) this.setWeapon(s.weapon)
    if (this.wearsGear && (s.gear ?? 0) !== this.gear) this.setGear(s.gear ?? 0)
    this.root.visible = s.alive
    const size = pose.scale ?? 1
    const parts = steadyArms(bodyParts(pose))
    this.lastParts = parts
    for (const p of parts) {
      const group = p.name === 'gun' ? this.gunGroup : this.rig.parts[p.name]
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
    if (blink !== this.blinking && !isZombie(this.skin)) {
      this.blinking = blink
      const materials = materialsFor(this.skin, this.rig.body, false)
      if (blink) materials[0] = blinkMaterial
      this.rig.mesh.material = materials.length === 1 ? (materials[0] as THREE.Material) : materials
    }

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
    recolor(this.rig.body, color ?? own)
  }

  /** World position of this player's gun muzzle (for their tracers and flashes). */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    this.gunGroup.updateMatrixWorld(true)
    return target.setFromMatrixPosition(this.muzzle.matrixWorld)
  }

  dispose(): void {
    this.material.dispose()
    if (this.rig.owned) this.rig.body.geometry.dispose()
    this.rig.skeleton.dispose()
    ;(this.glint.material as THREE.SpriteMaterial).dispose()
  }
}
