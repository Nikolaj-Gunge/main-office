import {
  type BodyPart,
  bodyParts,
  PART_SIZES,
  type PartName,
  PLAYER_COLORS,
  type RemotePlayerState,
  type SkinId,
  WeaponId,
} from '@office-fps/shared'
import * as THREE from 'three'

/**
 * Player models. Every skin is built on the shared animated skeleton (skeleton.ts): each body
 * part is a group placed exactly where that part's hitbox is, so what you see is what you hit.
 */

/** What a body looks like: the admin's skin, or one of the zombies (zombies mode). */
export type BodyLook = SkinId | ZombieLook
/** The dead: walkers, runners, and survival's brutes, screamers and stalkers. */
export type ZombieLook = 'zombie' | 'runner' | 'brute' | 'screamer' | 'stalker'
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
// Zombies: rotting skin, blood, glowing eyes (walkers red, runners yellow).
const zombieSkin = lambert(0x7d9a63)
const runnerSkin = lambert(0xa3ab7e)
const bloodMaterial = lambert(0x5e1212)
const raggedMaterial = lambert(0x3a3a36)
// Far brighter than white (they bloom) and untouched by fog: in the dark you see the eyes first.
const zombieEyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 0.35, 0.2), fog: false })
const runnerEyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 0.3), fog: false })
const bruteEyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 1.2, 0.1), fog: false })
const paleEyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 6, 7), fog: false })
const deadEyes = lambert(0x2a0d0d)
/** Skin, eyes and what's left of their clothes (null = the shirt colour they were given). */
const ZOMBIE_STYLE: Record<
  ZombieLook,
  { flesh: THREE.Material; eyes: THREE.Material; clothes: THREE.Material | null; jaw: number }
> = {
  zombie: { flesh: zombieSkin, eyes: zombieEyes, clothes: null, jaw: 0.05 },
  runner: { flesh: runnerSkin, eyes: runnerEyes, clothes: null, jaw: 0.05 },
  brute: { flesh: lambert(0x6e4038), eyes: bruteEyes, clothes: lambert(0x2a2622), jaw: 0.07 },
  // Mouth hanging open, far too wide.
  screamer: { flesh: lambert(0xb4b6a6), eyes: paleEyes, clothes: lambert(0x6a6458), jaw: 0.14 },
  // A shape of the dark itself; only the eyes show.
  stalker: { flesh: lambert(0x101014), eyes: paleEyes, clothes: lambert(0x0c0c10), jaw: 0.03 },
}
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

/** Arm meshes are built for this length; the arm group stretches to the real shoulder–hand span. */
const ARM_LENGTH = PART_SIZES.armR.y * 2

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
      part(box(0.09, 0.3, 0.03), tie, 0, -0.02, -s.chest.z - 0.01),
      part(box(0.3, 0.06, 0.05), collarMaterial, 0, s.chest.y - 0.03, -s.chest.z),
    )
    body.stomach.add(part(box(...W(s.stomach)), material))
    for (const arm of [body.armL, body.armR]) arm.add(part(box(0.12, ARM_LENGTH, 0.14), material))
    for (const leg of [body.thighL, body.thighR, body.shinL, body.shinR]) {
      leg.add(part(box(...W(s.thighL)), material))
    }
    return body
  }

  if (isZombie(skin)) {
    // A dead office worker: torn shirt (in the player's color), blood, no shoes, glowing eyes.
    const style = ZOMBIE_STYLE[skin]
    const flesh = style.flesh
    const eyes = dead ? deadEyes : style.eyes
    if (style.clothes) material = style.clothes as THREE.MeshLambertMaterial
    body.head.add(
      part(box(...W(s.head)), flesh),
      part(box(0.2, 0.05, 0.22), hair, -0.04, s.head.y + 0.01, 0.03), // patchy hair
      part(box(0.06, 0.04, 0.02), eyes, -0.07, 0.02, -s.head.z - 0.006),
      part(box(0.06, 0.04, 0.02), eyes, 0.07, 0.02, -s.head.z - 0.006),
      part(
        box(0.14, style.jaw, 0.02),
        skin === 'screamer' ? eyeMaterial : bloodMaterial,
        0,
        -0.06 - style.jaw / 2,
        -s.head.z - 0.006,
      ), // jaw
    )
    body.chest.add(
      part(box(...W(s.chest)), material),
      part(box(0.16, 0.12, 0.02), bloodMaterial, 0.05, -0.02, -s.chest.z - 0.006),
      part(box(0.1, 0.08, 0.02), flesh, -0.1, 0.05, -s.chest.z - 0.007), // torn open
    )
    body.stomach.add(
      part(box(...W(s.stomach)), material),
      part(box(0.12, 0.1, 0.02), bloodMaterial, -0.06, 0.03, -s.stomach.z - 0.006),
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
        part(box(0.12, ARM_LENGTH * 0.55, 0.14), material, 0, -ARM_LENGTH * 0.22, 0), // sleeve
        part(box(0.1, ARM_LENGTH * 0.5, 0.11), flesh, 0, ARM_LENGTH * 0.24, 0), // bare forearm
      )
    }
    for (const thigh of [body.thighL, body.thighR])
      thigh.add(part(box(...W(s.thighL)), raggedMaterial))
    for (const shin of [body.shinL, body.shinR]) {
      shin.add(
        part(box(s.shinL.x * 2, s.shinL.y, s.shinL.z * 2), raggedMaterial, 0, s.shinL.y / 2, 0),
        part(box(0.14, s.shinL.y, 0.15), flesh, 0, -s.shinL.y / 2, 0), // bare, torn trousers
        part(box(0.16, 0.06, 0.24), flesh, 0, -s.shinL.y + 0.02, -0.04), // feet
      )
    }
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
    part(box(0.3, 0.06, 0.05), collarMaterial, 0, s.chest.y - 0.03, -s.chest.z),
    part(box(0.11, 0.07, 0.04), tie, 0, s.chest.y - 0.08, -s.chest.z - 0.01),
    part(box(0.09, 0.24, 0.03), tie, 0, -0.04, -s.chest.z - 0.01),
  )
  body.stomach.add(
    part(box(...W(s.stomach)), material),
    part(box(0.09, 0.2, 0.03), tie, 0, 0.05, -s.stomach.z - 0.01),
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

/** A fedora or a bowler on top of a head of half-height `top`. */
function makeHat(colorIndex: number, top: number): THREE.Group {
  const g = new THREE.Group()
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
const EYE_GLOW: Record<ZombieLook, THREE.SpriteMaterial> = {
  zombie: eyeGlow(new THREE.Color(2.4, 0.08, 0.04)),
  runner: eyeGlow(new THREE.Color(2, 1.1, 0.06)),
  brute: eyeGlow(new THREE.Color(3, 0.4, 0.03)),
  screamer: eyeGlow(new THREE.Color(1.2, 1.5, 1.8)),
  stalker: eyeGlow(new THREE.Color(1.6, 1.8, 2.2)),
}

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
  /** The pose last drawn (for the ragdoll when they die). */
  lastParts: BodyPart[] = []

  constructor(name: string, colorIndex: number, skin: BodyLook = 'worker') {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? 0xffffff
    this.material = new THREE.MeshLambertMaterial({ color, transparent: true })
    this.parts = buildBody(skin, colorIndex, this.material)
    for (const group of Object.values(this.parts)) this.root.add(group)
    if (isZombie(skin)) {
      for (const x of [-0.07, 0.07]) {
        const glow = new THREE.Sprite(EYE_GLOW[skin])
        glow.position.set(x, 0.02, -PART_SIZES.head.z - 0.03)
        glow.scale.setScalar(0.26)
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

  /**
   * @param viewer  your eye position — a scoped sniper's glint is brightest when they look at you.
   */
  update(s: RemotePlayerState, timeMs: number, viewer?: THREE.Vector3, size = 1): void {
    if (s.weapon !== this.weapon) this.setWeapon(s.weapon)
    this.root.visible = s.alive
    const parts = bodyParts({
      x: s.x,
      y: s.y,
      z: s.z,
      yaw: s.yaw,
      pitch: s.pitch,
      crouch: s.crouch,
      stride: s.stride,
      speed: s.speed,
      grounded: s.grounded,
      scale: size,
    })
    this.lastParts = parts
    for (const p of parts) {
      const group = p.name === 'gun' ? this.gunGroup : this.parts[p.name]
      placePart(group, p, size)
    }
    // Zombie eyes smoulder: the halo breathes, each zombie in its own time.
    if (this.eyeGlows.length > 0) {
      const breath = 0.2 + 0.04 * Math.sin(timeMs / 420 + this.root.id)
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
