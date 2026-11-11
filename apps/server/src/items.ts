import { canReach, type MapPickup, TICK_RATE, type WeaponId } from '@office-fps/shared'

export interface Point {
  x: number
  y: number
  z: number
}

/** A weapon lying on the floor. Always full ammo when picked up. */
export interface WorldItem {
  id: number
  weapon: WeaponId
  pos: Point
  yaw: number
  /** Index of the map pickup spot it belongs to, or null for thrown/dropped weapons. */
  spawner: number | null
  /** Tick it disappears (thrown/dropped weapons), or null to stay. */
  despawnAt: number | null
}

interface Spawner {
  pickup: MapPickup
  itemId: number | null
  /** Tick it may spawn again after being taken. */
  readyAt: number
}

/** How long thrown or dropped weapons stay on the floor (s). */
export const DROPPED_LIFETIME = 30

/**
 * Weapons on the floor: map pickup spots (respawning after `respawn` s) and weapons players
 * threw away or dropped when they died. Knows nothing about the network; `onSpawn` / `onRemove`
 * let the game tell clients.
 */
export class WorldItems {
  readonly items = new Map<number, WorldItem>()
  private readonly spawners: Spawner[]
  private nextId = 1
  private readonly onSpawn: (item: WorldItem) => void
  private readonly onRemove: (id: number) => void

  constructor(
    pickups: MapPickup[],
    onSpawn: (item: WorldItem) => void,
    onRemove: (id: number) => void,
  ) {
    this.spawners = pickups.map((pickup) => ({ pickup, itemId: null, readyAt: 0 }))
    this.onSpawn = onSpawn
    this.onRemove = onRemove
  }

  /** Respawns taken map weapons and clears out expired dropped ones. */
  step(tick: number): void {
    this.spawners.forEach((s, index) => {
      if (s.itemId !== null || tick < s.readyAt) return
      const [x, y, z] = s.pickup.pos
      s.itemId = this.add({
        weapon: s.pickup.weapon as WeaponId,
        pos: { x, y, z },
        yaw: index * 2.4, // fixed but varied, so the same spot always looks the same
        spawner: index,
        despawnAt: null,
      }).id
    })
    for (const item of this.items.values()) {
      if (item.despawnAt !== null && tick >= item.despawnAt) this.remove(item.id)
    }
  }

  /** A weapon thrown away or dropped on death. */
  drop(weapon: WeaponId, pos: Point, yaw: number, tick: number): WorldItem {
    return this.add({
      weapon,
      pos,
      yaw,
      spawner: null,
      despawnAt: tick + DROPPED_LIFETIME * TICK_RATE,
    })
  }

  /** Takes an item off the floor; its map spot starts counting down to respawn. */
  take(id: number, tick: number): WorldItem | null {
    const item = this.items.get(id)
    if (!item) return null
    this.remove(id)
    if (item.spawner !== null) {
      const s = this.spawners[item.spawner]
      if (s) {
        s.itemId = null
        s.readyAt = tick + s.pickup.respawn * TICK_RATE
      }
    }
    return item
  }

  /**
   * Closest item a player at `feet` can reach: within `radius` horizontally and from just
   * below the feet up to about chest height (weapons on desks count).
   */
  nearest(feet: Point, radius: number): WorldItem | null {
    let best: WorldItem | null = null
    let bestDistance = radius
    for (const item of this.items.values()) {
      if (!canReach(feet, item.pos, radius)) continue
      const d = Math.hypot(item.pos.x - feet.x, item.pos.z - feet.z)
      if (d <= bestDistance) {
        bestDistance = d
        best = item
      }
    }
    return best
  }

  private add(fields: Omit<WorldItem, 'id'>): WorldItem {
    const item = { id: this.nextId, ...fields }
    this.nextId = (this.nextId % 0xffff) + 1
    this.items.set(item.id, item)
    this.onSpawn(item)
    return item
  }

  private remove(id: number): void {
    if (this.items.delete(id)) this.onRemove(id)
  }
}
