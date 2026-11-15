import type { MapBox } from '../maps/types.ts'
import { DAY_SECONDS } from './daytime.ts'
import { heightAt } from './terrain.ts'
import type { SurvivalDef } from './types.ts'

/**
 * Base building, light: plank walls, a door in a frame, spike traps and a stash crate, put up
 * out in the woods from kits made of planks, scrap and tape (crafting.ts). Everything placed is
 * the world's and decays slowly unless somebody nails fresh planks on; nothing here can be
 * raided by other people (only the dead batter it, and only the owner opens a stash). The Haven
 * locker (storage.ts) is the place for things you can't afford to lose.
 *
 * Pieces stand on the terrain, turned in eighths of a circle. Server and client build the same
 * solid blocks from the same list (physics/builds.ts), so prediction matches.
 */

export type PieceKind = 'wall' | 'door' | 'spikes' | 'stash'
/** On the wire, kinds go as their index here. */
export const PIECE_KINDS: readonly PieceKind[] = ['wall', 'door', 'spikes', 'stash']

export interface PieceDef {
  kind: PieceKind
  name: string
  /** The kit item it is built from (and given back when taken down sound). */
  item: string
  /** Battering it takes when new (zombie bash damage, like PLANK_HP). */
  hp: number
  /** Footprint along its own width (x) and depth (z), and height (m). */
  w: number
  d: number
  h: number
}

export const PIECES: Record<PieceKind, PieceDef> = {
  wall: { kind: 'wall', name: 'Plank wall', item: 'wallkit', hp: 600, w: 2, d: 0.18, h: 2.3 },
  door: { kind: 'door', name: 'Door', item: 'doorkit', hp: 700, w: 2, d: 0.18, h: 2.3 },
  spikes: { kind: 'spikes', name: 'Spike trap', item: 'spikekit', hp: 240, w: 1.6, d: 1.6, h: 0.5 },
  stash: { kind: 'stash', name: 'Stash crate', item: 'stashkit', hp: 500, w: 1.1, d: 0.7, h: 0.75 },
}

/** The kit item → what it builds. */
export const KIT_PIECES: Record<string, PieceKind> = {
  wallkit: 'wall',
  doorkit: 'door',
  spikekit: 'spikes',
  stashkit: 'stash',
}

/** Pieces one survivor may have standing, and the whole world. */
export const PLAYER_PIECES = 30
export const WORLD_PIECES = 300
/** How far from you a piece may go (m, to its middle). */
export const BUILD_REACH = 5
/** How many turns make a circle (R turns it one). */
export const BUILD_TURNS = 8
/** A new piece falls apart on its own after this many in-game days unless repaired. */
export const DECAY_DAYS = 4
/** Battering lost per second to the weather, for a piece of `max` hp. */
export const decayPerSecond = (max: number): number => max / (DECAY_DAYS * DAY_SECONDS)
/** One plank nailed on puts this much back. */
export const REPAIR_HP = 160
/** The door's opening (m wide, m high), in the middle of its frame. */
export const DOOR_GAP = 1.1
export const DOOR_HIGH = 2
/** A stash crate's grid. */
export const STASH_SIZE: [number, number] = [6, 4]
/** Spike traps: damage per stab to one of the dead, and how much each stab wears them. */
export const SPIKE_DAMAGE = 12
export const SPIKE_WEAR = 12
/** The dead on spikes move at this share of their speed. */
export const SPIKE_SLOW = 0.45
/** Keep this far from the edge of Haven, from roads' edges and from doorways (m). */
const HAVEN_MARGIN = 14
const ROAD_MARGIN = 1.2
const DOOR_MARGIN = 3.5

/** One piece as the world knows it (`owner` is the account; the server keeps it to itself). */
export interface Piece {
  id: number
  kind: PieceKind
  x: number
  z: number
  /** Turns (0 … BUILD_TURNS - 1). */
  rot: number
  hp: number
  /** Doors: standing open. */
  open?: boolean
}

export const pieceYaw = (rot: number): number => (rot * Math.PI * 2) / BUILD_TURNS

/** Its own width axis and depth axis on the ground (as three.js turns a box by `yaw`). */
export function pieceAxes(rot: number): { ax: number; az: number; nx: number; nz: number } {
  const yaw = pieceYaw(rot)
  return { ax: Math.cos(yaw), az: -Math.sin(yaw), nx: Math.sin(yaw), nz: Math.cos(yaw) }
}

/** Where its floor is: the lowest ground under its corners (the high side sinks in a little). */
export function pieceBase(
  def: Pick<SurvivalDef, 'terrain'>,
  p: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'>,
): number {
  const { w, d } = PIECES[p.kind]
  const { ax, az, nx, nz } = pieceAxes(p.rot)
  let low = heightAt(def.terrain, p.x, p.z)
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const x = p.x + (ax * u * w) / 2 + (nx * v * d) / 2
    const z = p.z + (az * u * w) / 2 + (nz * v * d) / 2
    low = Math.min(low, heightAt(def.terrain, x, z))
  }
  return low - 0.05
}

/** A solid block of a piece: middle, half extents (in its own axes) and turn. */
export interface PieceBlock {
  center: [number, number, number]
  half: [number, number, number]
  yaw: number
}

/** Local (u along its width, v along its depth) → world x/z. */
function place(p: Pick<Piece, 'x' | 'z' | 'rot'>, u: number, v: number): [number, number] {
  const { ax, az, nx, nz } = pieceAxes(p.rot)
  return [p.x + ax * u + nx * v, p.z + az * u + nz * v]
}

/**
 * What is solid of a piece standing on `base`: a wall is one slab; a door frame is two posts and
 * a lintel, plus the door while it's shut; a stash crate is a box. Spikes are walked over.
 */
export function pieceBlocks(p: Piece, base: number): PieceBlock[] {
  const def = PIECES[p.kind]
  const yaw = pieceYaw(p.rot)
  const at = (u: number, y: number, v: number, hw: number, hh: number, hd: number) => {
    const [x, z] = place(p, u, v)
    return { center: [x, base + y, z], half: [hw, hh, hd], yaw } as PieceBlock
  }
  if (p.kind === 'wall') return [at(0, def.h / 2, 0, def.w / 2, def.h / 2, def.d / 2)]
  if (p.kind === 'stash') return [at(0, def.h / 2, 0, def.w / 2, def.h / 2, def.d / 2)]
  if (p.kind === 'spikes') return []
  // The door: posts either side of the gap, the lintel over it, the door itself when shut.
  const side = (def.w - DOOR_GAP) / 2
  const blocks = [
    at(-(DOOR_GAP + side) / 2, def.h / 2, 0, side / 2, def.h / 2, def.d / 2),
    at((DOOR_GAP + side) / 2, def.h / 2, 0, side / 2, def.h / 2, def.d / 2),
    at(0, (DOOR_HIGH + def.h) / 2, 0, DOOR_GAP / 2, (def.h - DOOR_HIGH) / 2, def.d / 2),
  ]
  if (!p.open) blocks.push(at(0, DOOR_HIGH / 2, 0, DOOR_GAP / 2, DOOR_HIGH / 2, 0.04))
  return blocks
}

/** Planks, posts and crates: what you see of a piece (boxes, never solid by themselves). */
export function pieceBoxes(p: Piece, base: number): MapBox[] {
  const def = PIECES[p.kind]
  const yaw = pieceYaw(p.rot)
  const out: MapBox[] = []
  const box = (
    u: number,
    y: number,
    v: number,
    size: [number, number, number],
    material: MapBox['material'] = 'wood',
    tilt = 0,
    turn = 0,
  ) => {
    const [x, z] = place(p, u, v)
    out.push({
      center: [x, base + y, z],
      size,
      rotation: [0, yaw + turn, tilt],
      material,
      collide: false,
    })
  }
  // A little give in every board, the same every time for the same piece.
  const jitter = (k: number) => (((p.id * 31 + k * 17) % 7) - 3) * 0.012
  if (p.kind === 'wall') {
    for (const u of [-0.95, 0, 0.95]) box(u, 1.2, -0.12, [0.12, 2.5, 0.12])
    for (let k = 0; k < 6; k++)
      box(jitter(k), 0.2 + k * 0.38, 0, [2.08, 0.34, 0.06], 'wood', jitter(k + 3) * 0.5)
    box(0, 1.15, 0.06, [2.3, 0.14, 0.05], 'wood', 0.95)
  } else if (p.kind === 'door') {
    const side = (def.w - DOOR_GAP) / 2
    for (const s of [-1, 1]) {
      const u = (s * (DOOR_GAP + side)) / 2
      box(s * (DOOR_GAP / 2 + 0.06), 1.2, -0.1, [0.14, 2.5, 0.14])
      for (let k = 0; k < 6; k++) box(u, 0.2 + k * 0.38, 0, [side + 0.04, 0.34, 0.06])
    }
    box(0, def.h - 0.12, 0, [def.w + 0.1, 0.26, 0.16])
    // The door hangs on its left post and swings out of the way when open.
    const hinge = -DOOR_GAP / 2
    const swing = p.open ? Math.PI / 2 - 0.15 : 0
    const cu = hinge + (Math.cos(swing) * DOOR_GAP) / 2
    const cv = (Math.sin(swing) * DOOR_GAP) / 2
    for (let k = 0; k < 4; k++) {
      const off = (k - 1.5) * 0.27
      box(
        cu + Math.cos(swing) * off,
        1,
        cv + Math.sin(swing) * off,
        [0.25, 1.95, 0.05],
        'wood',
        0,
        swing,
      )
    }
    box(cu, 0.55, cv, [DOOR_GAP - 0.06, 0.12, 0.08], 'wood', 0, swing)
    box(cu, 1.5, cv, [DOOR_GAP - 0.06, 0.12, 0.08], 'wood', 0, swing)
    const hu = hinge + Math.cos(swing) * (DOOR_GAP - 0.18)
    const hv = Math.sin(swing) * (DOOR_GAP - 0.18) + 0.06
    box(hu, 1.05, hv, [0.06, 0.16, 0.06], 'metal', 0, swing)
  } else if (p.kind === 'spikes') {
    box(0, 0.04, -0.5, [def.w, 0.08, 0.2])
    box(0, 0.04, 0.5, [def.w, 0.08, 0.2])
    box(0, 0.04, 0, [0.2, 0.08, def.d])
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const u = -0.6 + i * 0.4 + jitter(i + j) * 2
        const v = -0.6 + j * 0.4
        box(
          u,
          0.25,
          v,
          [0.06, 0.45, 0.06],
          i % 2 === j % 2 ? 'wood' : 'metal',
          jitter(i * 4 + j) * 4,
        )
      }
  } else {
    box(0, def.h / 2, 0, [def.w, def.h, def.d])
    for (const y of [0.18, 0.4, 0.62]) box(0, y, def.d / 2 + 0.01, [def.w + 0.02, 0.05, 0.03])
    for (const u of [-def.w / 2 + 0.06, def.w / 2 - 0.06])
      box(u, def.h / 2, def.d / 2 + 0.02, [0.08, def.h + 0.02, 0.04])
    box(0, def.h + 0.02, 0, [def.w + 0.04, 0.05, def.d + 0.04])
    box(0, def.h - 0.12, def.d / 2 + 0.04, [0.12, 0.16, 0.04], 'metal')
  }
  return out
}

// --- Where things may go ---------------------------------------------------------------------

/** A piece's footprint on the ground, shrunk a little so neighbours may touch. */
function footprintOf(p: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'>) {
  const { w, d } = PIECES[p.kind]
  return {
    x: p.x,
    z: p.z,
    ...pieceAxes(p.rot),
    hw: Math.max(0.02, w / 2 - 0.1),
    hd: Math.max(0.02, d / 2 - 0.1),
  }
}

/** Do two turned rectangles on the ground overlap (separating axes)? */
function overlaps(a: ReturnType<typeof footprintOf>, b: ReturnType<typeof footprintOf>): boolean {
  const dx = b.x - a.x
  const dz = b.z - a.z
  for (const [ux, uz] of [
    [a.ax, a.az],
    [a.nx, a.nz],
    [b.ax, b.az],
    [b.nx, b.nz],
  ] as const) {
    const ra = a.hw * Math.abs(a.ax * ux + a.az * uz) + a.hd * Math.abs(a.nx * ux + a.nz * uz)
    const rb = b.hw * Math.abs(b.ax * ux + b.az * uz) + b.hd * Math.abs(b.nx * ux + b.nz * uz)
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false
  }
  return true
}

/** Is (x, z) inside the piece's footprint grown by `pad`? */
export function onPiece(p: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'>, x: number, z: number, pad = 0) {
  const { w, d } = PIECES[p.kind]
  const { ax, az, nx, nz } = pieceAxes(p.rot)
  const dx = x - p.x
  const dz = z - p.z
  return Math.abs(dx * ax + dz * az) <= w / 2 + pad && Math.abs(dx * nx + dz * nz) <= d / 2 + pad
}

const segDist = (
  px: number,
  pz: number,
  a: { x: number; z: number },
  b: { x: number; z: number },
) => {
  const vx = b.x - a.x
  const vz = b.z - a.z
  const len = vx * vx + vz * vz
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / len)) : 0
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t))
}

/**
 * Why a piece can't go here, or null if it can: not in Haven (the locker is for keeps), not on
 * a road, not indoors or close to a doorway, not in the lake, not on a steep slope, not on top
 * of another piece. `blocked` (physics) says whether the map (a house, a tree) is in the way.
 */
export function placeProblem(
  def: Pick<SurvivalDef, 'terrain' | 'pois' | 'roads' | 'rooms' | 'spots' | 'lakes'>,
  pieces: Iterable<Piece>,
  p: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'>,
  blocked?: (p: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'>, base: number) => boolean,
): string | null {
  const { x, z } = p
  const reach = Math.hypot(PIECES[p.kind].w, PIECES[p.kind].d) / 2
  for (const poi of def.pois)
    if (poi.safe && Math.hypot(x - poi.x, z - poi.z) < poi.r + HAVEN_MARGIN)
      return 'Not in Haven. Your locker is the safe place here.'
  for (const road of def.roads) {
    // Quick reject by the line's first point is unsafe (roads are long): check every stretch.
    const near = road.width / 2 + ROAD_MARGIN + reach
    for (let i = 1; i < road.line.length; i++) {
      const a = road.line[i - 1]
      const b = road.line[i]
      if (!a || !b) continue
      if (Math.abs(a.x - x) > 40 + near && Math.abs(b.x - x) > 40 + near) continue
      if (segDist(x, z, a, b) < near) return 'Not on the road.'
    }
  }
  for (const lake of def.lakes)
    if (Math.hypot(x - lake.x, z - lake.z) < lake.r + 1) return 'Too wet here.'
  for (const room of def.rooms) {
    if (x > room.min[0] - 1 && x < room.max[0] + 1 && z > room.min[1] - 1 && z < room.max[1] + 1)
      return 'Not indoors.'
    for (const door of room.doors)
      if (Math.hypot(x - door[0], z - door[2]) < DOOR_MARGIN + reach)
        return 'Too close to a doorway.'
  }
  for (const spot of def.spots)
    if (Math.hypot(x - spot.x, z - spot.z) < DOOR_MARGIN + reach) return 'Too close to a doorway.'
  // Level enough to stand on.
  const base = pieceBase(def, p)
  if (heightAt(def.terrain, x, z) - base > 0.75) return 'Too steep here.'
  const mine = footprintOf(p)
  for (const other of pieces) {
    if (Math.abs(other.x - x) > 4 || Math.abs(other.z - z) > 4) continue
    if (overlaps(mine, footprintOf(other))) return "Something's already there."
  }
  if (blocked?.(p, base)) return 'Something is in the way.'
  return null
}

/**
 * Walls and doors line up: near the end of one already standing, a new one snaps on (in line,
 * or round the corner). Anything else goes where you point.
 */
export function snapPiece(
  pieces: Iterable<Piece>,
  p: Pick<Piece, 'kind' | 'x' | 'z' | 'rot'>,
): { x: number; z: number; rot: number } {
  if (p.kind !== 'wall' && p.kind !== 'door') return { x: p.x, z: p.z, rot: p.rot }
  let best = { x: p.x, z: p.z, rot: p.rot }
  let bestD = 0.9
  const w = PIECES.wall.w
  for (const o of pieces) {
    if (o.kind !== 'wall' && o.kind !== 'door') continue
    if (Math.abs(o.x - p.x) > 4 || Math.abs(o.z - p.z) > 4) continue
    const turn = (((p.rot - o.rot) % 4) + 4) % 4
    const a = pieceAxes(o.rot)
    const candidates: [number, number][] = []
    if (turn === 0) {
      candidates.push([o.x + a.ax * w, o.z + a.az * w], [o.x - a.ax * w, o.z - a.az * w])
    } else if (turn === 2) {
      // Round the corner: one end of the old one, then out along its normal.
      for (const s of [-1, 1])
        for (const t of [-1, 1])
          candidates.push([
            o.x + (a.ax * s * w) / 2 + (a.nx * t * w) / 2,
            o.z + (a.az * s * w) / 2 + (a.nz * t * w) / 2,
          ])
    }
    for (const [cx, cz] of candidates) {
      const d = Math.hypot(cx - p.x, cz - p.z)
      if (d < bestD) {
        bestD = d
        best = { x: cx, z: cz, rot: p.rot }
      }
    }
  }
  return best
}

// --- On the wire -----------------------------------------------------------------------------

/** Numbers per piece in SurvivalShared.builds. */
export const PIECE_STRIDE = 7

/** id, kind, x×10, z×10, turns, battering left, flags (1 = open), … */
export function packPieces(pieces: Iterable<Piece>): number[] {
  const out: number[] = []
  for (const p of pieces)
    out.push(
      p.id,
      PIECE_KINDS.indexOf(p.kind),
      Math.round(p.x * 10),
      Math.round(p.z * 10),
      p.rot,
      Math.max(1, Math.round(p.hp)),
      p.open ? 1 : 0,
    )
  return out
}

export function unpackPieces(flat: readonly number[]): Piece[] {
  const out: Piece[] = []
  for (let k = 0; k + PIECE_STRIDE <= flat.length; k += PIECE_STRIDE) {
    const kind = PIECE_KINDS[flat[k + 1] as number]
    if (!kind) continue
    const p: Piece = {
      id: flat[k] as number,
      kind,
      x: (flat[k + 2] as number) / 10,
      z: (flat[k + 3] as number) / 10,
      rot: flat[k + 4] as number,
      hp: flat[k + 5] as number,
    }
    if ((flat[k + 6] as number) & 1) p.open = true
    out.push(p)
  }
  return out
}

/** The point you look at to use a piece (its middle, a little up). */
export function pieceCentre(p: Piece, base: number): { x: number; y: number; z: number } {
  const h = PIECES[p.kind].h
  return { x: p.x, y: base + Math.min(1.1, h * 0.6), z: p.z }
}

/**
 * How squarely `eye` looking along `f` aims at a piece within `reach` (higher = better), or -1.
 * A wall is long: it counts the nearest point along it, not just its middle.
 */
export function pieceAim(
  p: Piece,
  base: number,
  eye: { x: number; y: number; z: number },
  f: { x: number; y: number; z: number },
  reach = 2.6,
): number {
  const c = pieceCentre(p, base)
  const half = PIECES[p.kind].w / 2
  const { ax, az } = pieceAxes(p.rot)
  const along = Math.max(-half, Math.min(half, (eye.x - c.x) * ax + (eye.z - c.z) * az))
  const dx = c.x + ax * along - eye.x
  const dy = c.y - eye.y
  const dz = c.z + az * along - eye.z
  const d = Math.hypot(dx, dy, dz)
  if (d > reach + 0.6 || Math.hypot(dx, dz) > reach) return -1
  return (dx * f.x + dy * f.y + dz * f.z) / Math.max(d, 0.2) + (reach - d) * 0.05
}
