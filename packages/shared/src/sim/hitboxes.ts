/** Body parts a bullet can hit. */
export const HitZone = {
  None: 0,
  Head: 1,
  Chest: 2,
  Stomach: 3,
  Arm: 4,
  Leg: 5,
} as const
export type HitZone = (typeof HitZone)[keyof typeof HitZone]

/** Damage multipliers (PLAN.md §5.1). Head is an instant kill for every weapon. */
export const ZONE_MULTIPLIER: Record<HitZone, number> = {
  [HitZone.None]: 0,
  [HitZone.Head]: Number.POSITIVE_INFINITY,
  [HitZone.Chest]: 1,
  [HitZone.Stomach]: 0.9,
  [HitZone.Arm]: 0.75,
  [HitZone.Leg]: 0.65,
}

export interface Point3 {
  x: number
  y: number
  z: number
}

/** What we need to place someone's hitboxes: where they stand, which way they face, how crouched. */
export interface HitPose {
  x: number
  y: number
  z: number
  yaw: number
  /** 0 = standing, 1 = crouched. */
  crouch: number
  /** Body size (game rules: tiny people); 1 when omitted. */
  scale?: number
}

export type Hitbox =
  | { zone: HitZone; kind: 'sphere'; center: Point3; radius: number }
  | { zone: HitZone; kind: 'capsule'; a: Point3; b: Point3; radius: number }
  | { zone: HitZone; kind: 'box'; center: Point3; half: Point3; yaw: number }

/**
 * Standing layout in local space (meters; +x = right, -z = forward, y up from the feet).
 * Simple primitives, not the render mesh — cheap to test and identical on client and server.
 */
const LAYOUT = {
  head: { y: 1.64, z: -0.02, radius: 0.13 },
  chest: { y: 1.32, half: { x: 0.22, y: 0.2, z: 0.14 } },
  stomach: { y: 0.97, half: { x: 0.19, y: 0.15, z: 0.13 } },
  arm: { x: 0.3, top: 1.48, bottom: 0.95, radius: 0.07 },
  leg: { x: 0.1, top: 0.8, bottom: 0.1, radius: 0.09 },
}
/** Sizes (radii, half extents) of the layout at body size `s`; positions scale in `world`. */
function scaledLayout(s: number): typeof LAYOUT {
  if (s === 1) return LAYOUT
  const L = LAYOUT
  const half = (h: Point3) => ({ x: h.x * s, y: h.y * s, z: h.z * s })
  return {
    head: { ...L.head, radius: L.head.radius * s },
    chest: { ...L.chest, half: half(L.chest.half) },
    stomach: { ...L.stomach, half: half(L.stomach.half) },
    arm: { ...L.arm, radius: L.arm.radius * s },
    leg: { ...L.leg, radius: L.leg.radius * s },
  }
}

/** Crouched height / standing height: vertical positions scale by this when crouched. */
const CROUCH_SCALE = 1.2 / 1.8

/** World-space hitboxes for a pose. */
export function poseHitboxes(pose: HitPose): Hitbox[] {
  const k = 1 + (CROUCH_SCALE - 1) * pose.crouch
  const s = pose.scale ?? 1
  const cos = Math.cos(pose.yaw) * s
  const sin = Math.sin(pose.yaw) * s
  // Local → world: scale, rotate about Y by yaw (Three.js convention), then translate.
  const world = (x: number, y: number, z: number): Point3 => ({
    x: pose.x + x * cos + z * sin,
    y: pose.y + y * k * s,
    z: pose.z - x * sin + z * cos,
  })
  const L = scaledLayout(s)
  return [
    {
      zone: HitZone.Head,
      kind: 'sphere',
      center: world(0, L.head.y, L.head.z),
      radius: L.head.radius,
    },
    {
      zone: HitZone.Chest,
      kind: 'box',
      center: world(0, L.chest.y, 0),
      half: { ...L.chest.half, y: L.chest.half.y * k },
      yaw: pose.yaw,
    },
    {
      zone: HitZone.Stomach,
      kind: 'box',
      center: world(0, L.stomach.y, 0),
      half: { ...L.stomach.half, y: L.stomach.half.y * k },
      yaw: pose.yaw,
    },
    ...[-1, 1].map(
      (side): Hitbox => ({
        zone: HitZone.Arm,
        kind: 'capsule',
        a: world(side * L.arm.x, L.arm.top, 0),
        b: world(side * L.arm.x, L.arm.bottom, -0.04),
        radius: L.arm.radius,
      }),
    ),
    ...[-1, 1].map(
      (side): Hitbox => ({
        zone: HitZone.Leg,
        kind: 'capsule',
        a: world(side * L.leg.x, L.leg.top, 0),
        b: world(side * L.leg.x, L.leg.bottom, 0),
        radius: L.leg.radius,
      }),
    ),
  ]
}

/** Rough bounding sphere of a pose, to skip far-away players before precise tests. */
export function poseBounds(pose: HitPose): { center: Point3; radius: number } {
  const s = pose.scale ?? 1
  return { center: { x: pose.x, y: pose.y + 0.9 * s, z: pose.z }, radius: 1.1 * s }
}

const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z
const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

/** Distance along a normalized ray to a sphere, or -1. */
export function raySphere(ro: Point3, rd: Point3, center: Point3, radius: number): number {
  const oc = sub(ro, center)
  const b = dot(oc, rd)
  const c = dot(oc, oc) - radius * radius
  const h = b * b - c
  if (h < 0) return -1
  const t = -b - Math.sqrt(h)
  if (t >= 0) return t
  return c <= 0 ? 0 : -1 // origin inside counts as a hit at distance 0
}

/** Distance along a normalized ray to a capsule (segment a–b, radius), or -1. After Inigo Quilez. */
export function rayCapsule(ro: Point3, rd: Point3, a: Point3, b: Point3, radius: number): number {
  const ba = sub(b, a)
  const oa = sub(ro, a)
  const baba = dot(ba, ba)
  const bard = dot(ba, rd)
  const baoa = dot(ba, oa)
  const rdoa = dot(rd, oa)
  const oaoa = dot(oa, oa)
  const qa = baba - bard * bard
  const qb = baba * rdoa - baoa * bard
  const qc = baba * oaoa - baoa * baoa - radius * radius * baba
  const h = qb * qb - qa * qc
  if (h >= 0 && qa > 1e-9) {
    const t = (-qb - Math.sqrt(h)) / qa
    const y = baoa + t * bard
    if (y > 0 && y < baba && t >= 0) return t
  }
  // Caps: whichever end sphere the ray reaches first.
  const tA = raySphere(ro, rd, a, radius)
  const tB = raySphere(ro, rd, b, radius)
  if (tA < 0) return tB
  if (tB < 0) return tA
  return Math.min(tA, tB)
}

/** Distance along a normalized ray to a box rotated about Y, or -1. Slab test in box space. */
export function rayBox(ro: Point3, rd: Point3, center: Point3, half: Point3, yaw: number): number {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const p = sub(ro, center)
  // World → local: inverse yaw rotation.
  const o = { x: p.x * cos - p.z * sin, y: p.y, z: p.x * sin + p.z * cos }
  const d = { x: rd.x * cos - rd.z * sin, y: rd.y, z: rd.x * sin + rd.z * cos }
  let tMin = Number.NEGATIVE_INFINITY
  let tMax = Number.POSITIVE_INFINITY
  for (const axis of ['x', 'y', 'z'] as const) {
    const h = half[axis]
    if (Math.abs(d[axis]) < 1e-12) {
      if (o[axis] < -h || o[axis] > h) return -1
      continue
    }
    let t1 = (-h - o[axis]) / d[axis]
    let t2 = (h - o[axis]) / d[axis]
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return -1
  }
  if (tMax < 0) return -1
  return Math.max(tMin, 0)
}

export function rayHitbox(ro: Point3, rd: Point3, box: Hitbox): number {
  switch (box.kind) {
    case 'sphere':
      return raySphere(ro, rd, box.center, box.radius)
    case 'capsule':
      return rayCapsule(ro, rd, box.a, box.b, box.radius)
    case 'box':
      return rayBox(ro, rd, box.center, box.half, box.yaw)
  }
}

/**
 * Closest hitbox the ray hits within `maxDistance`. Ties go to the more valuable zone, so a shot
 * grazing both head and chest counts as the head (head is listed first).
 */
export function raycastPose(
  ro: Point3,
  rd: Point3,
  maxDistance: number,
  pose: HitPose,
): { distance: number; zone: HitZone } | null {
  const bounds = poseBounds(pose)
  if (raySphere(ro, rd, bounds.center, bounds.radius) < 0) return null
  let best: { distance: number; zone: HitZone } | null = null
  for (const box of poseHitboxes(pose)) {
    const t = rayHitbox(ro, rd, box)
    if (t < 0 || t > maxDistance) continue
    if (!best || t < best.distance - 1e-4) best = { distance: t, zone: box.zone }
  }
  return best
}

/** Unit view direction from yaw/pitch (yaw 0 looks down -Z, pitch up is positive). */
export function viewDirection(yaw: number, pitch: number): Point3 {
  const cp = Math.cos(pitch)
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp }
}
