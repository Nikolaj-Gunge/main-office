import {
  chunkOf,
  chunkProps,
  compassWord,
  coverAt,
  DROP_LAND,
  DROP_RELEASE,
  dropInterval,
  heightAt,
  ITEMS,
  type Notice,
  propSolid,
  rollLoot,
  type SupplyDrop,
  type SurvivalDef,
  WEAPONS,
  WORLD_HALF,
  ZombieKind,
} from '@office-fps/shared'
import type { Point } from '../items.ts'

/** The first drop comes this long after the radio starts working (s). */
const FIRST_DROP = 75
/** A drop lies this long before it (and what's left in it) is gone (s). */
const DROP_STAYS = 15 * 60
/** The crate comes down this far from somebody (m). */
const NEAR = 80
const FAR = 200
/** The rotors bring the dead from this far (m); the crash of the landing, from this far. */
const ROTOR_HEARD = 140
const LANDING_HEARD = 110
/** While its flare burns, the dead within this (m) keep coming back to the crate. */
const FLARE_DRAW = 75
/** The dead only exist this close to somebody (m): extra ones are put within it. */
const ZED_RANGE = 170

/** What the drops need from the director. */
export interface DropHost {
  def(): SurvivalDef
  readonly random: () => number
  /** Seconds since the server started. */
  now(): number
  /** Finished quest ids. */
  done(): readonly string[]
  /** Where the living are (feet). */
  people(): Point[]
  /** Puts something on the ground; returns its loot id. `until` is in seconds (see now). */
  addLoot(item: string, n: number, at: Point, ammo: number | undefined, until: number): number
  hasLoot(id: number): boolean
  /** The dead within `radius` of `at` hear something there and come to look. */
  alertNear(at: Point, radius: number): void
  /** Brings one more of the dead out at `at`, on its way to `goal`. False if none are free. */
  spawnZombie(at: Point, kind: ZombieKind, goal: Point): boolean
  /** Tells every survivor something (worded for where each of them stands). */
  tell(kind: Notice['kind'], text: (at: Point) => string): void
  /** Something everybody sees changed: send the shared state now. */
  broadcast(): void
}

interface Drop {
  id: number
  x: number
  y: number
  z: number
  heading: number
  /** Server time (s) the helicopter set out. */
  start: number
  released: boolean
  landed: boolean
  opened: boolean
  loot: number[]
  /** When the flare next draws the dead in. */
  pulseAt: number
}

/**
 * Supply drops: once the story has the radio working, every few minutes a helicopter comes over
 * low, drops a crate of military supplies on a parachute near somebody, and goes. It is loud:
 * the dead hear it come, more of them turn up, and the flare on the crate keeps drawing them in.
 */
export class Drops {
  private readonly host: DropHost
  private list: Drop[] = []
  private nextId = 1
  /** Server time (s) of the next drop, or -1: none due (the story isn't there yet). */
  nextAt = -1

  constructor(host: DropHost) {
    this.host = host
  }

  reset(): void {
    this.list = []
    this.nextAt = -1
  }

  /** Once a second. */
  step(): void {
    const now = this.host.now()
    for (const d of this.list) this.tick(d, now)
    const before = this.list.length
    this.list = this.list.filter((d) => now - d.start < DROP_STAYS)
    if (this.list.length !== before) this.host.broadcast()

    const every = dropInterval(this.host.done())
    if (every === null) {
      this.nextAt = -1
      return
    }
    if (this.nextAt < 0) this.nextAt = now + FIRST_DROP
    // Later in the story they come sooner.
    this.nextAt = Math.min(this.nextAt, now + every)
    if (now < this.nextAt) return
    // One at a time: not while the last is still coming down or lies unopened.
    if (this.list.some((d) => !d.opened)) {
      this.nextAt = now + 30
      return
    }
    this.nextAt = this.launch(now) ? now + every * (0.85 + this.host.random() * 0.3) : now + 20
  }

  /** What everybody is told: the drops in the air and on the ground. */
  shared(): SupplyDrop[] {
    const now = this.host.now()
    return this.list.map((d) => ({
      id: d.id,
      x: round(d.x),
      y: round(d.y),
      z: round(d.z),
      heading: Math.round(d.heading * 1000) / 1000,
      age: round(now - d.start),
      landed: d.landed,
      opened: d.opened,
    }))
  }

  private tick(d: Drop, now: number): void {
    const t = now - d.start
    const at = { x: d.x, y: d.y, z: d.z }
    if (!d.released && t >= DROP_RELEASE) {
      d.released = true
      // The rotors right overhead: everything around comes out to look.
      this.host.alertNear(at, ROTOR_HEARD)
    }
    if (!d.landed && t >= DROP_LAND) {
      d.landed = true
      this.land(d)
      this.host.broadcast()
    }
    if (d.landed && !d.opened) {
      if (d.loot.some((id) => !this.host.hasLoot(id))) {
        d.opened = true
        this.host.broadcast()
      } else if (now >= d.pulseAt) {
        d.pulseAt = now + 4
        this.host.alertNear(at, FLARE_DRAW)
      }
    }
  }

  /** Sends a helicopter: picks where the crate comes down. False if there's nowhere to. */
  private launch(now: number): boolean {
    const { random } = this.host
    const people = this.host.people()
    if (people.length === 0) return false
    const who = people[Math.floor(random() * people.length)] as Point
    let spot: Point | null = null
    for (let n = 0; n < 40 && !spot; n++) {
      const a = random() * Math.PI * 2
      const r = NEAR + random() * (FAR - NEAR)
      const x = who.x + Math.cos(a) * r
      const z = who.z + Math.sin(a) * r
      // A clearing if there is one; any open bit of forest floor if not.
      if (openGround(this.host.def(), x, z, n < 25 ? 0.45 : 1)) {
        spot = { x, y: heightAt(this.host.def().terrain, x, z), z }
      }
    }
    if (!spot) return false
    const d: Drop = {
      id: this.nextId++,
      ...spot,
      heading: random() * Math.PI * 2,
      start: now,
      released: false,
      landed: false,
      opened: false,
      loot: [],
      pulseAt: 0,
    }
    this.list.push(d)
    this.host.tell('warn', (p) => {
      const from = { x: d.x - Math.cos(d.heading) * 600, z: d.z - Math.sin(d.heading) * 600 }
      return `Rotors. A helicopter is coming in low from the ${compassWord(p, from)}.`
    })
    this.host.broadcast()
    return true
  }

  /** The crate is down: its contents spill out round it, and the dead come for it. */
  private land(d: Drop): void {
    const { random } = this.host
    const def = this.host.def()
    const now = this.host.now()
    const late = this.host.done().includes('site7')
    const items: { item: string; n: number }[] = []
    // There's always a gun in it.
    for (let n = 0; n < 40; n++) {
      const roll = rollLoot('drop', random)
      if (roll && ITEMS[roll.item]?.kind === 'weapon') {
        items.push(roll)
        break
      }
    }
    while (items.length < (late ? 6 : 5)) {
      const roll = rollLoot('drop', random)
      if (roll) items.push(roll)
    }
    items.forEach((it, i) => {
      const a = d.heading + (i / items.length) * Math.PI * 2
      const x = d.x + Math.cos(a) * 1.05
      const z = d.z + Math.sin(a) * 1.05
      const weapon = ITEMS[it.item]?.weapon
      const ammo = weapon === undefined ? undefined : WEAPONS[weapon].magSize
      const y = heightAt(def.terrain, x, z) + 0.05
      d.loot.push(this.host.addLoot(it.item, it.n, { x, y, z }, ammo, d.start + DROP_STAYS))
    })
    d.pulseAt = now + 4

    const at = { x: d.x, y: d.y, z: d.z }
    this.host.alertNear(at, LANDING_HEARD)
    // And more of them, from the woods round about.
    const people = this.host.people()
    const extra = Math.min(7, 3 + people.length + (late ? 2 : 0))
    let placed = 0
    for (let n = 0; n < extra * 8 && placed < extra; n++) {
      const a = random() * Math.PI * 2
      const r = 35 + random() * 25
      const x = d.x + Math.cos(a) * r
      const z = d.z + Math.sin(a) * r
      const near = people.map((p) => Math.hypot(p.x - x, p.z - z))
      if (near.some((m) => m < 30) || !near.some((m) => m < ZED_RANGE)) continue
      if (!openGround(def, x, z, 1)) continue
      const roll = random()
      const kind =
        late && placed === 0
          ? ZombieKind.Brute
          : roll < 0.45
            ? ZombieKind.Runner
            : roll < 0.55
              ? ZombieKind.Screamer
              : ZombieKind.Walker
      const goal = { x: d.x + (random() - 0.5) * 6, y: d.y, z: d.z + (random() - 0.5) * 6 }
      if (!this.host.spawnZombie({ x, y: heightAt(def.terrain, x, z), z }, kind, goal)) break
      placed++
    }
    this.host.tell('quest', (p) => {
      const far = Math.hypot(p.x - d.x, p.z - d.z)
      const where = far < 40 ? 'right by you' : `to the ${compassWord(p, d)}`
      return `Something came down on a parachute ${where}. A red flare is burning there.`
    })
  }
}

/**
 * Somewhere a crate can come down: no place's buildings, no water, not on a slope, the world's
 * rim or a tree, and (with `maxCover` < 1) not in thick forest.
 */
export function openGround(def: SurvivalDef, x: number, z: number, maxCover = 1): boolean {
  if (Math.abs(x) > WORLD_HALF - 200 || Math.abs(z) > WORLD_HALF - 200) return false
  for (const p of def.pois) {
    if (Math.hypot(p.x - x, p.z - z) < p.r + (p.safe ? 70 : 15)) return false
  }
  for (const l of def.lakes) if (Math.hypot(l.x - x, l.z - z) < l.r + 8) return false
  const t = def.terrain
  if (coverAt(t, x, z) > maxCover) return false
  const h = heightAt(t, x, z)
  for (const [dx, dz] of [
    [2.5, 0],
    [-2.5, 0],
    [0, 2.5],
    [0, -2.5],
  ] as const) {
    if (Math.abs(heightAt(t, x + dx, z + dz) - h) > 1.2) return false
  }
  // Clear of trunks and rocks (looking into the chunks around, in case it's near an edge).
  const seen = new Set<number>()
  for (const [dx, dz] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ] as const) {
    const [cx, cz] = chunkOf(x + dx, z + dz)
    const key = cx * 4096 + cz
    if (seen.has(key)) continue
    seen.add(key)
    for (const prop of chunkProps(t, def.seed, cx, cz)) {
      const solid = propSolid(prop)
      if (solid && Math.hypot(prop.x - x, prop.z - z) < solid.radius + 2.2) return false
    }
  }
  return true
}

const round = (v: number) => Math.round(v * 10) / 10
