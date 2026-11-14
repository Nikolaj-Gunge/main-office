/*
 * Area of interest (survival's big world): each client is only sent who is around them.
 *
 * - Anyone within NEAR (zombies included) goes into every snapshot.
 * - People (not zombies) further out, up to FAR, go in every FAR_EVERY-th snapshot (~5 Hz):
 *   enough for distant gunfire, footsteps and torches far off in the dark.
 * - Nobody beyond that is sent at all, and someone leaving gets an explicit removal so the
 *   client hides them instead of leaving a frozen ghost.
 * Leaving takes a few metres more than entering, so someone walking along the edge doesn't
 * flicker in and out.
 */

export const INTEREST_NEAR = 200
export const INTEREST_FAR = 500
/** Extra distance before someone already known is dropped (hysteresis). */
const LEAVE_MARGIN = 20
/** Far people go in one snapshot in this many (30 Hz / 6 = 5 Hz). */
export const FAR_EVERY = 6
/** Grid cell size (m). */
const CELL = 64

export interface InterestEntity {
  id: number
  x: number
  z: number
  /** A person (or bot), not a zombie: still sent, now and then, from further away. */
  person: boolean
}

/** A coarse grid over the world so a client's neighbours are found without checking everyone. */
export class SpatialGrid {
  private readonly cells = new Map<number, InterestEntity[]>()

  constructor(entities: Iterable<InterestEntity>) {
    for (const e of entities) {
      const key = cellKey(Math.floor(e.x / CELL), Math.floor(e.z / CELL))
      const cell = this.cells.get(key)
      if (cell) cell.push(e)
      else this.cells.set(key, [e])
    }
  }

  /** Calls `visit` for everyone in the cells touching a circle (the caller checks distance). */
  near(x: number, z: number, radius: number, visit: (e: InterestEntity) => void): void {
    const x0 = Math.floor((x - radius) / CELL)
    const x1 = Math.floor((x + radius) / CELL)
    const z0 = Math.floor((z - radius) / CELL)
    const z1 = Math.floor((z + radius) / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.cells.get(cellKey(cx, cz))
        if (cell) for (const e of cell) visit(e)
      }
    }
  }
}

/** Unique for any cell within ±32 km. */
function cellKey(cx: number, cz: number): number {
  return (cx + 512) * 1024 + (cz + 512)
}

export interface InterestPick {
  /** Ids to put in this snapshot. */
  send: number[]
  /** Ids the client knew that are now out of range (or gone). */
  removed: number[]
}

/**
 * Who goes into one client's snapshot.
 *
 * @param viewer the client's player (its own id is never sent back as another player)
 * @param known ids the client currently has (sent and not removed)
 * @param people every person in the world (for the far ring; zombies are only ever near)
 * @param snapshot running snapshot count, so far people take turns
 */
export function pickInterest(
  viewer: { id: number; x: number; z: number },
  grid: SpatialGrid,
  people: readonly InterestEntity[],
  known: { has(id: number): boolean; keys(): Iterable<number> },
  snapshot: number,
): InterestPick {
  const send: number[] = []
  const kept = new Set<number>()
  const within = (e: InterestEntity, radius: number) => {
    const d2 = (e.x - viewer.x) ** 2 + (e.z - viewer.z) ** 2
    const r = known.has(e.id) ? radius + LEAVE_MARGIN : radius
    return d2 <= r * r
  }
  grid.near(viewer.x, viewer.z, INTEREST_NEAR + LEAVE_MARGIN, (e) => {
    if (e.id === viewer.id || !within(e, INTEREST_NEAR)) return
    kept.add(e.id)
    send.push(e.id)
  })
  for (const p of people) {
    if (p.id === viewer.id || kept.has(p.id) || !within(p, INTEREST_FAR)) continue
    kept.add(p.id)
    // Someone coming into range shows up straight away; after that they take their turn.
    if (!known.has(p.id) || (snapshot + p.id) % FAR_EVERY === 0) send.push(p.id)
  }
  const removed: number[] = []
  for (const id of known.keys()) if (!kept.has(id)) removed.push(id)
  return { send, removed }
}
