import type { WeaponId } from '../sim/weapons.ts'
import type { BinaryReader, BinaryWriter } from './binary.ts'
import type { RemotePlayerState } from './messages.ts'
import { decodePitch, decodeYaw, encodePitch, encodeYaw } from './quantize.ts'

/*
 * Delta-compressed remote players in snapshots.
 *
 * Each entity goes on the wire as the exact integers it is sent as (its "wire" form). A snapshot
 * may name a baseline: an earlier snapshot the client has acknowledged. Every entity the client
 * knew at that baseline is then sent as a bitmask of the field groups that changed plus only
 * those groups; anything else (new to the client, or no baseline) goes in full. Because both
 * ends keep the same record of what the client knew after each snapshot (SnapshotCodec), and
 * the WebSocket is reliable and ordered, the client can always rebuild the exact same state.
 */

const TAU = Math.PI * 2

const FLAG_GROUNDED = 2
const FLAG_DEAD = 4
const FLAG_PROTECTED = 8
const FLAG_AIMING = 16
const FLAG_LIGHT = 32

/** A remote player as the exact numbers that go on the wire (see the F_ indices). */
export type WireRemote = readonly number[]

// Field indices of a WireRemote.
const F_ID = 0
const F_X = 1
const F_Z = 2
const F_Y = 3
const F_YAW = 4
const F_PITCH = 5
const F_CROUCH = 6
const F_FLAGS = 7
const F_WEAPON = 8
const F_STRIDE = 9
const F_SPEED = 10
const F_MOVE_DIR = 11
const F_VY = 12
const F_LAND = 13
const F_ADS = 14
const F_SHOT_AGE = 15
const F_PRONE = 16
const F_SLIDE = 17
const F_MANTLE = 18
const F_LEDGE = 19
const F_GEAR = 20
const F_WINDUP = 21
const FIELD_COUNT = 22

type FieldType = 'f32' | 'u16' | 'i16' | 'u8'

/**
 * What changes together goes together: one mask bit per group. Position is split so someone
 * walking on flat ground doesn't resend their height.
 */
const GROUPS: readonly (readonly [number, FieldType])[][] = [
  [
    [F_X, 'f32'],
    [F_Z, 'f32'],
  ],
  [[F_Y, 'f32']],
  [[F_YAW, 'u16']],
  [[F_PITCH, 'i16']],
  [[F_CROUCH, 'u8']],
  [[F_FLAGS, 'u8']],
  [[F_WEAPON, 'u8']],
  [[F_STRIDE, 'u8']],
  [[F_SPEED, 'u8']],
  [[F_MOVE_DIR, 'u8']],
  [
    [F_VY, 'u8'],
    [F_LAND, 'u8'],
  ],
  [[F_ADS, 'u8']],
  [[F_SHOT_AGE, 'u8']],
  [
    [F_PRONE, 'u8'],
    [F_SLIDE, 'u8'],
  ],
  [
    [F_MANTLE, 'u8'],
    [F_LEDGE, 'u8'],
  ],
  [
    [F_GEAR, 'u16'],
    [F_WINDUP, 'u8'],
  ],
]

/** Every group present: the entity is sent whole. */
export const FULL_MASK = (1 << GROUPS.length) - 1

/** The groups flattened, in wire order: field index, type, its group's mask bit. */
const ORDER: readonly (readonly [number, FieldType, number])[] = GROUPS.flatMap((fields, g) =>
  fields.map(([i, type]) => [i, type, 1 << g] as const),
)

const unit = (v: number | undefined, fallback = 0) =>
  Math.round(Math.max(0, Math.min(1, v ?? fallback)) * 255)

/** A remote player's state quantized exactly as it is sent. */
export function toWire(p: RemotePlayerState): WireRemote {
  const q = new Array<number>(FIELD_COUNT)
  q[F_ID] = p.id & 0xffff
  q[F_X] = Math.fround(p.x)
  q[F_Z] = Math.fround(p.z)
  q[F_Y] = Math.fround(p.y)
  q[F_YAW] = encodeYaw(p.yaw)
  q[F_PITCH] = encodePitch(p.pitch)
  q[F_CROUCH] = unit(p.crouch)
  q[F_FLAGS] =
    (p.grounded ? FLAG_GROUNDED : 0) |
    (p.alive ? 0 : FLAG_DEAD) |
    (p.protected ? FLAG_PROTECTED : 0) |
    (p.aiming ? FLAG_AIMING : 0) |
    (p.light ? FLAG_LIGHT : 0)
  q[F_WEAPON] = p.weapon & 0xff
  q[F_STRIDE] = Math.round((((p.stride % 1) + 1) % 1) * 255)
  q[F_SPEED] = Math.round(Math.max(0, Math.min(25.5, p.speed)) * 10)
  q[F_MOVE_DIR] = Math.round((((((p.moveDir ?? 0) / TAU) % 1) + 1) % 1) * 256) & 0xff
  q[F_VY] = Math.round(Math.max(-25.4, Math.min(25.4, p.vy ?? 0)) * 5) + 127
  q[F_LAND] = unit(p.land)
  q[F_ADS] = unit(p.ads)
  q[F_SHOT_AGE] = unit(p.shotAge, 1)
  q[F_PRONE] = unit(p.prone)
  q[F_SLIDE] = unit(p.slide)
  q[F_MANTLE] = unit(p.mantle)
  q[F_LEDGE] = Math.round(Math.max(-1, Math.min(4, p.ledge ?? 0)) * 50) + 50
  q[F_GEAR] = (p.gear ?? 0) & 0xffff
  q[F_WINDUP] = p.windup ? Math.max(1, Math.round(Math.min(1, p.windup) * 255)) : 0
  return q
}

/** Back from the wire form to a state to draw. */
export function fromWire(q: WireRemote): RemotePlayerState {
  const n = (i: number) => q[i] ?? 0
  const flags = n(F_FLAGS)
  const gear = n(F_GEAR)
  const windup = n(F_WINDUP) / 255
  return {
    stride: n(F_STRIDE) / 255,
    speed: n(F_SPEED) / 10,
    moveDir: (n(F_MOVE_DIR) / 256) * TAU,
    vy: (n(F_VY) - 127) / 5,
    land: n(F_LAND) / 255,
    ads: n(F_ADS) / 255,
    shotAge: n(F_SHOT_AGE) / 255,
    prone: n(F_PRONE) / 255,
    slide: n(F_SLIDE) / 255,
    mantle: n(F_MANTLE) / 255,
    ledge: (n(F_LEDGE) - 50) / 50,
    id: n(F_ID),
    x: n(F_X),
    y: n(F_Y),
    z: n(F_Z),
    yaw: decodeYaw(n(F_YAW)),
    pitch: decodePitch(n(F_PITCH)),
    crouch: n(F_CROUCH) / 255,
    grounded: (flags & FLAG_GROUNDED) !== 0,
    alive: (flags & FLAG_DEAD) === 0,
    protected: (flags & FLAG_PROTECTED) !== 0,
    aiming: (flags & FLAG_AIMING) !== 0,
    weapon: n(F_WEAPON) as WeaponId,
    ...(flags & FLAG_LIGHT ? { light: true } : {}),
    ...(gear ? { gear } : {}),
    ...(windup ? { windup } : {}),
  }
}

/** Which field groups differ between an entity and its baseline (FULL_MASK without one). */
export function changedMask(q: WireRemote, base: WireRemote | undefined): number {
  if (!base) return FULL_MASK
  let mask = 0
  for (const [i, , bit] of ORDER) if (q[i] !== base[i]) mask |= bit
  return mask
}

/** id, mask, then the groups in the mask. */
export function writeWireRemote(w: BinaryWriter, q: WireRemote, base?: WireRemote): void {
  const mask = changedMask(q, base)
  w.u16(q[F_ID] ?? 0).u16(mask)
  for (const [i, type, bit] of ORDER) {
    if (!(mask & bit)) continue
    const v = q[i] ?? 0
    if (type === 'f32') w.f32(v)
    else if (type === 'u16') w.u16(v)
    else if (type === 'i16') w.i16(v)
    else w.u8(v)
  }
}

/**
 * Reads one entity. `baseOf` gives what the client knew of an id at the snapshot's baseline;
 * a partial mask without one means the two ends disagree, which must never happen.
 */
export function readWireRemote(
  r: BinaryReader,
  baseOf: (id: number) => WireRemote | undefined,
): WireRemote {
  const id = r.u16()
  const mask = r.u16()
  const base = mask === FULL_MASK ? undefined : baseOf(id)
  if (mask !== FULL_MASK && !base) throw new Error(`snapshot delta for ${id} without a baseline`)
  const q = base ? [...base] : new Array<number>(FIELD_COUNT).fill(0)
  q[F_ID] = id
  for (const [i, type, bit] of ORDER) {
    if (!(mask & bit)) continue
    q[i] = type === 'f32' ? r.f32() : type === 'u16' ? r.u16() : type === 'i16' ? r.i16() : r.u8()
  }
  return q
}

/** How many past snapshots each end remembers (≈2 s at 30 Hz); older acks get full states. */
export const SNAPSHOT_HISTORY = 64

/**
 * One connection's record of what the client knows: after every snapshot, each entity it has
 * (sent and not removed since) in the exact wire form it last got. The server and the client
 * each keep one and update it the same way, so a delta written against snapshot N on one end
 * reads back against the same snapshot N on the other.
 */
export class SnapshotCodec {
  private current = new Map<number, WireRemote>()
  private readonly history: { tick: number; known: ReadonlyMap<number, WireRemote> }[] = []

  /** What the client knew right after snapshot `tick`, if still remembered. */
  knownAt(tick: number): ReadonlyMap<number, WireRemote> | undefined {
    if (tick <= 0) return undefined
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i]
      if (h && h.tick === tick) return h.known
      if (h && h.tick < tick) return undefined
    }
    return undefined
  }

  /** Entities the client has right now (after the last snapshot). */
  get known(): ReadonlyMap<number, WireRemote> {
    return this.current
  }

  /** Snapshot `tick` went out / came in with these entities and these removals. */
  record(tick: number, sent: readonly WireRemote[], removed: readonly number[]): void {
    const next = new Map(this.current)
    for (const q of sent) next.set(q[F_ID] ?? 0, q)
    for (const id of removed) next.delete(id)
    this.current = next
    this.history.push({ tick, known: next })
    if (this.history.length > SNAPSHOT_HISTORY) this.history.shift()
  }

  /** Back to knowing nothing (a new connection). */
  reset(): void {
    this.current = new Map()
    this.history.length = 0
  }
}
