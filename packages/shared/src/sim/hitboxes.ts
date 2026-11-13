import type { RemotePlayerState } from '../protocol/messages.ts'
import { type BodyPose, bodyParts, type PartName, type Quat, rayOrientedBox } from './skeleton.ts'

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

/**
 * What we need to place someone's hitboxes: the animated body pose (see skeleton.ts) — where
 * they stand and face, aim pitch, crouch, walk cycle and speed, body size.
 */
export type HitPose = BodyPose

/**
 * The pose of another player as clients draw and hit them: their replicated state, plus what the
 * client knows besides — their zombie kind (gait), body size and the server time on screen. The
 * server builds the same pose from its own state (game.ts toHistoryPose).
 */
export function remotePose(
  s: RemotePlayerState,
  extra: { gait?: number; scale?: number; time?: number } = {},
): HitPose {
  return {
    x: s.x,
    y: s.y,
    z: s.z,
    yaw: s.yaw,
    pitch: s.pitch,
    crouch: s.crouch,
    stride: s.stride,
    speed: s.speed,
    grounded: s.grounded,
    moveDir: s.moveDir,
    vy: s.vy,
    land: s.land,
    ads: s.ads,
    shotAge: s.shotAge,
    prone: s.prone,
    slide: s.slide,
    mantle: s.mantle,
    ledge: s.ledge,
    weapon: s.weapon,
    seed: s.id,
    ...extra,
  }
}

/** One hitbox: an oriented box, exactly a drawn body part. */
export interface Hitbox {
  zone: HitZone
  center: Point3
  half: Point3
  rotation: Quat
  part: PartName
}

const ZONE_OF: Record<PartName, HitZone | null> = {
  head: HitZone.Head,
  chest: HitZone.Chest,
  stomach: HitZone.Stomach,
  armL: HitZone.Arm,
  armR: HitZone.Arm,
  thighL: HitZone.Leg,
  shinL: HitZone.Leg,
  thighR: HitZone.Leg,
  shinR: HitZone.Leg,
  gun: null,
}

/** World-space hitboxes for a pose: the body parts you see, minus the gun. */
export function poseHitboxes(pose: HitPose): Hitbox[] {
  const boxes: Hitbox[] = []
  for (const part of bodyParts(pose)) {
    const zone = ZONE_OF[part.name]
    if (zone !== null) boxes.push({ zone, part: part.name, ...part })
  }
  return boxes
}

/** Rough bounding sphere of a pose, to skip far-away players before precise tests. */
export function poseBounds(pose: HitPose): { center: Point3; radius: number } {
  const s = pose.scale ?? 1
  // Lying down, the body's middle is near the floor (and it reaches as far front to back).
  const middle = 0.95 - 0.6 * Math.max(0, Math.min(1, pose.prone ?? 0))
  return { center: { x: pose.x, y: pose.y + middle * s, z: pose.z }, radius: 1.35 * s }
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

export function rayHitbox(ro: Point3, rd: Point3, box: Hitbox): number {
  return rayOrientedBox(ro, rd, box)
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
