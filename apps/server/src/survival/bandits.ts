import {
  ammoItem,
  BANDIT_COVER,
  BANDIT_PATROL,
  BANDIT_POSTS,
  chunkOf,
  chunkProps,
  createPlayerState,
  createWeaponState,
  DAY_SECONDS,
  type DayPhase,
  gearLooks,
  heightAt,
  MAX_PLAYERS,
  type MapSpawn,
  type Notice,
  type PlayerState,
  type Poi,
  PropKind,
  packAppearance,
  propSolid,
  randomAppearance,
  type SurvivalDef,
  WEAPONS,
  WeaponId,
  weaponItem,
} from '@office-fps/shared'
import type { Game, ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import { BanditBrain, type BanditView, type Threat } from './bandit-brain.ts'
import type { Prey } from './horde.ts'
import { inShield } from './newcomer.ts'

/**
 * Human threats (ROADMAP 6.10): bandit camps in the woods, and raiders who come for Haven's
 * stores now and then by day.
 *
 * Bandits are cheap: they only exist while somebody is near their camp (or a raid is on), at
 * most BANDIT_SLOTS at once, and they take their places from the dead's pool (which fills back
 * up when they go). Each one is a server-run person (Game.addNpc) whose input comes from a
 * BanditBrain, so their shots are real shots and the AOI snapshots carry them like anybody.
 * Their gunfire carries to the dead, and the dead go for them as for anybody.
 */

/** Most bandits about at once (camps and raiders together). */
export const BANDIT_SLOTS = 6
/** A camp's people come out when somebody is this close (m)… */
export const CAMP_WAKE = 170
/** …and go away again once everybody is further than this for a while. */
const CAMP_SLEEP = 240
const SLEEP_SECONDS = 25
/** A camp nobody is left alive in fills up again after this much of the world's time (s). */
export const CAMP_RESPAWN_DAYS = 1.5
/** How long a dead bandit lies there before the body goes (s). */
const BODY_SECONDS = 30
/** Camps keep their people within this of home (m). */
const LEASH = 45
/** Shouts carry this far (m). */
const SHOUT_REACH = 55
/** Camp-mates hear a gunshot this far off (m). */
const MATES_HEAR = 90
/** Chance of a raid on any one day. */
export const RAID_CHANCE = 0.3
/** Raiders give up and slink off after this long (s). */
const RAID_SECONDS = 6 * 60
/** Raiders who reach this close to Haven's gate get into the stores (m). */
const STORES_REACH = 6
const HEALTH = 100

/** Where raiders come from and the way they take to Haven's gate (along the east road). */
export const RAID_ROAD: readonly Point[] = [
  { x: 350, y: 0, z: 520 },
  { x: 220, y: 0, z: 455 },
  { x: 90, y: 0, z: 390 },
  { x: 30, y: 0, z: 414 },
  { x: 2, y: 0, z: 425 },
]

/** What they shout on seeing you. */
const SHOUTS = [
  'There! By the trees!',
  "Somebody's out there!",
  'Contact! Over there!',
  'Light them up!',
  'Movement, east side!',
  "Don't let them reach the crates!",
]
const RAID_SHOUTS = ["Haven's got company!", 'Go for the stores!', 'Shoot anybody in the way!']

/** What they carry: a gun (weighted), and the lookout gets the rifle with the glass. */
const CAMP_GUNS: [WeaponId, number][] = [
  [WeaponId.Sks, 3],
  [WeaponId.Shotgun, 3],
  [WeaponId.M1911, 2],
  [WeaponId.Revolver, 2],
  [WeaponId.DoubleBarrel, 2],
  [WeaponId.Uzi, 1],
  [WeaponId.Ak47, 1],
]
const FOOD = ['beans', 'jerky', 'tuna', 'chips', 'soup']

/** Bandanas and gas masks, flannel and camouflage: not dressed like anybody at Haven. */
const OUTFITS: readonly string[][] = [
  ['bandana', 'flannel', 'cargopants', 'boots'],
  ['gasmask', 'camojacket', 'camopants', 'militaryboots'],
  ['bandana', 'jacket', 'jeans', 'boots'],
  ['gasmask', 'hoodie', 'cargopants', 'sneakers'],
  ['bandana', 'camojacket', 'worktrousers', 'boots'],
]

export interface BanditHost {
  def(): SurvivalDef
  random(): number
  /** Seconds since the server started. */
  now(): number
  /** The world's own seconds (sleep passes it too): camps fill up again by it. */
  clock(): number
  /** 0 at night … 1 in daylight. */
  light(): number
  phase(): DayPhase
  /** The living, seen as somebody to shoot at. */
  people(): { player: ServerPlayer; threat: Threat }[]
  /** The dead walking about. */
  zombies(): ServerPlayer[]
  clear(a: Point, b: Point): boolean
  /** A gun went off at `at`, heard `metres` away: the dead come to look. */
  alarm(at: Point, metres: number): void
  /** Gives up one of the dead's places in the pool (false: none to spare). */
  makeRoom(): boolean
  drop(item: string, n: number, at: Point, ammo?: number): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string): void
  /** Everybody playing hears of it (the horn, the stores). */
  noticeAll(kind: Notice['kind'], text: string): void
  /** Everybody playing hears the lookout's horn, blown at `at` (a raid is coming). */
  horn?(at: Point): void
  /** Raiders got into Haven's stores: Gus has nothing extra until tomorrow. */
  steal(): void
  /** May raiders come today (not while Haven is under siege)? */
  raidable(): boolean
  /** Is Haven's gate shut (night, nobody on the winch)? Raiders can't get at the stores. */
  gateShut?(): boolean
}

interface Camp {
  poi: Poi
  /** How many live here when it's full. */
  size: number
  /** How many are still alive (the dead stay dead until it fills up again). */
  left: number
  /** World clock when the last one died (it fills up CAMP_RESPAWN_DAYS later). */
  clearedAt: number | null
  members: Bandit[]
  /** Seconds nobody has been near while its people are out. */
  alone: number
  lastShout: number
}

interface Bandit {
  player: ServerPlayer
  brain: BanditBrain
  /** Its camp, or null for a raider. */
  camp: Camp | null
  /** Which of the camp's posts it keeps (BANDIT_POSTS), or -1 walking the watch. */
  post: number
  /** Next stop on the watch (BANDIT_PATROL) or the raid's road (RAID_ROAD). */
  leg: number
  gear: number
  /** Last loud thing it did, and until when it's heard (m, s). */
  noise: number
  noiseUntil: number
  diedAt: number | null
}

interface Raid {
  members: Bandit[]
  startedAt: number
  /** They got into the stores and are leaving with it. */
  stole: boolean
  over: boolean
  /** They found the gate shut (said once). */
  barred?: boolean
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

export class Bandits {
  private readonly game: Game
  private readonly host: BanditHost
  private camps: Camp[] = []
  private readonly byId = new Map<number, Bandit>()
  private raid: Raid | null = null
  /** When today's raid comes (world clock), if one does. */
  private raidAt: number | null = null
  private phase: DayPhase | null = null
  /** Forest props by chunk (for cover), the same every time. */
  private readonly props = new Map<number, Point[]>()

  constructor(game: Game, host: BanditHost) {
    this.game = game
    this.host = host
  }

  /** A new world: every camp full, nobody out, no raid due. */
  reset(def: SurvivalDef): void {
    this.dispose()
    this.camps = def.pois
      .filter((p) => p.kind === 'bandits' && !inShield(def.pois, p) && !p.safe)
      .map((poi, i) => {
        const size = 3 + (i % 3)
        return { poi, size, left: size, clearedAt: null, members: [], alone: 0, lastShout: 0 }
      })
    this.raid = null
    this.raidAt = null
    this.phase = null
  }

  /** Everybody out goes away (their places go back to the dead). */
  dispose(): void {
    for (const b of [...this.byId.values()]) this.game.leave(b.player.id)
    this.byId.clear()
    for (const c of this.camps) c.members = []
  }

  /** Is this one of ours? */
  has(player: ServerPlayer): boolean {
    return this.byId.has(player.id)
  }

  /** Where the living bandits are (the forest is made solid round them too). */
  positions(): Point[] {
    const out: Point[] = []
    for (const b of this.byId.values()) if (b.player.state.alive) out.push(b.player.state.pos)
    return out
  }

  /** How many are out right now (alive). */
  get active(): number {
    let n = 0
    for (const b of this.byId.values()) if (b.player.state.alive) n++
    return n
  }

  /** The raid going on, for tests and the admin. */
  get raiding(): { members: number; stole: boolean } | null {
    if (!this.raid || this.raid.over) return null
    return {
      members: this.raid.members.filter((b) => b.player.state.alive).length,
      stole: this.raid.stole,
    }
  }

  campsInfo(): { key: string; left: number; out: number }[] {
    return this.camps.map((c) => ({
      key: c.poi.key,
      left: c.left,
      out: c.members.filter((b) => b.player.state.alive).length,
    }))
  }

  // --- Once a second ----------------------------------------------------------------------

  tick(): void {
    const now = this.host.now()
    const clock = this.host.clock()
    const people = this.host.people().map((p) => p.player.state.pos)
    const nearest = (p: { x: number; z: number }) =>
      Math.min(Number.POSITIVE_INFINITY, ...people.map((q) => dist(p, q)))

    // The dead lie a while, then go.
    for (const b of [...this.byId.values()]) {
      if (b.diedAt !== null && now - b.diedAt > BODY_SECONDS) this.remove(b)
    }

    for (const camp of this.camps) {
      if (camp.left === 0 && camp.clearedAt !== null) {
        if (clock - camp.clearedAt >= CAMP_RESPAWN_DAYS * DAY_SECONDS) {
          camp.left = camp.size
          camp.clearedAt = null
        }
      }
      const near = nearest(camp.poi)
      const out = camp.members.filter((b) => b.player.state.alive)
      if (out.length === 0 && near < CAMP_WAKE && camp.left > 0) this.wakeCamp(camp)
      else if (out.length > 0 && near > CAMP_SLEEP) {
        camp.alone++
        if (camp.alone > SLEEP_SECONDS) this.sleepCamp(camp)
      } else camp.alone = 0
    }

    this.tickRaid(now, clock, people.length > 0)
  }

  /** Everybody still alive at the camp comes out, at their posts. */
  private wakeCamp(camp: Camp): void {
    camp.alone = 0
    const want = Math.min(camp.left, BANDIT_POSTS.length)
    for (let i = 0; i < want; i++) {
      const [px, pz, py] = BANDIT_POSTS[i] as readonly [number, number, number]
      const at = { x: camp.poi.x + px, y: camp.poi.y + py, z: camp.poi.z + pz }
      // The lookout gets the hunting rifle; one walks the watch.
      const gun = i === 1 ? WeaponId.HuntingRifle : this.pickGun()
      const b = this.spawn('Bandit', at, gun, camp)
      if (!b) break
      b.post = i === 2 ? -1 : i
      camp.members.push(b)
    }
  }

  /** Nobody near any more: the camp's living go back in (they keep count of who's left). */
  private sleepCamp(camp: Camp): void {
    for (const b of camp.members) this.remove(b)
    camp.members = []
    camp.alone = 0
  }

  private pickGun(): WeaponId {
    const total = CAMP_GUNS.reduce((s, [, w]) => s + w, 0)
    let roll = this.host.random() * total
    for (const [id, w] of CAMP_GUNS) {
      roll -= w
      if (roll < 0) return id
    }
    return WeaponId.Shotgun
  }

  /** Brings one out (null if there's no room for another). */
  private spawn(name: string, at: Point, gun: WeaponId, camp: Camp | null): Bandit | null {
    if (this.active >= BANDIT_SLOTS) return null
    // Keep two places free for people joining; the dead give theirs up first.
    if (this.game.players.size >= MAX_PLAYERS - 2 && !this.host.makeRoom()) return null
    const random = () => this.host.random()
    const brain = new BanditBrain(random)
    const look = packAppearance(randomAppearance(random))
    const outfit = OUTFITS[Math.floor(random() * OUTFITS.length)] ?? []
    const b: Bandit = {
      player: null as unknown as ServerPlayer,
      brain,
      camp,
      post: 0,
      leg: 0,
      gear: gearLooks(outfit),
      noise: 0,
      noiseUntil: 0,
      diedAt: null,
    }
    const player = this.game.addNpc(name, look, { think: () => this.think(b) })
    if (!player) return null
    b.player = player
    this.byId.set(player.id, b)
    this.loadouts.set(player.id, gun)
    const yaw = random() * Math.PI * 2
    this.game.placeNpc(player, { pos: [at.x, at.y + 0.1, at.z], yaw }, HEALTH)
    brain.reset(yaw)
    return b
  }

  private readonly loadouts = new Map<number, WeaponId>()

  /** What a bandit wakes up holding (the director asks, as for anybody's freshState). */
  loadout(player: ServerPlayer, spawn: MapSpawn): PlayerState | null {
    const gun = this.loadouts.get(player.id)
    if (gun === undefined) return null
    const w = createWeaponState(gun, (this.host.random() * 0xffffffff) >>> 0)
    w.reserve = WEAPONS[gun].magSize * 4
    return createPlayerState(spawn, w, null, null)
  }

  private remove(b: Bandit): void {
    this.byId.delete(b.player.id)
    this.loadouts.delete(b.player.id)
    if (b.camp) b.camp.members = b.camp.members.filter((m) => m !== b)
    if (this.raid) this.raid.members = this.raid.members.filter((m) => m !== b)
    this.game.leave(b.player.id)
  }

  /** The game let one go (made room for somebody joining): forget it. */
  forget(player: ServerPlayer): void {
    const b = this.byId.get(player.id)
    if (!b) return
    this.byId.delete(player.id)
    this.loadouts.delete(player.id)
    if (b.camp) {
      b.camp.members = b.camp.members.filter((m) => m !== b)
    }
    if (this.raid) this.raid.members = this.raid.members.filter((m) => m !== b)
  }

  // --- Raids ------------------------------------------------------------------------------

  private tickRaid(now: number, clock: number, anybody: boolean): void {
    const phase = this.host.phase()
    if (phase !== this.phase) {
      // Each morning: will they come today, and when?
      if (phase === 'day' && this.host.random() < RAID_CHANCE) {
        this.raidAt = clock + this.host.random() * DAY_SECONDS * 0.25
      }
      if (phase !== 'day') this.raidAt = null
      this.phase = phase
    }
    if (this.raidAt !== null && clock >= this.raidAt && anybody && !this.raid) {
      this.raidAt = null
      if (this.host.raidable()) this.startRaid()
    }
    const raid = this.raid
    if (!raid || raid.over) return
    const alive = raid.members.filter((b) => b.player.state.alive)
    if (alive.length === 0) {
      raid.over = true
      if (!raid.stole) this.host.noticeAll('info', 'The raiders are dead. The stores are safe.')
      return
    }
    if (now - raid.startedAt > RAID_SECONDS) {
      raid.over = true
      for (const b of alive) this.remove(b)
      return
    }
    const gate = RAID_ROAD[RAID_ROAD.length - 1] as Point
    const atGate = alive.some((b) => dist(b.player.state.pos, gate) < STORES_REACH)
    // A shut gate keeps them out: they hang about outside it, shooting at whoever shows.
    if (atGate && !raid.stole && this.host.gateShut?.()) {
      if (!raid.barred) {
        raid.barred = true
        this.host.noticeAll('warn', "Raiders at Haven's gate. It's shut: don't wind it up now.")
      }
    } else if (!raid.stole && atGate) {
      raid.stole = true
      this.host.steal()
      this.host.noticeAll(
        'warn',
        "Raiders broke into Haven's stores and ran. Gus has nothing extra until tomorrow.",
      )
      for (const b of alive) b.leg = 0
    }
    // Got away with it: gone once they're back where they came from.
    if (raid.stole) {
      const start = RAID_ROAD[0] as Point
      for (const b of alive) if (dist(b.player.state.pos, start) < 8) this.remove(b)
      if (raid.members.length === 0) raid.over = true
    }
  }

  /** A raid comes up the east road now (tests and the admin; also the day's roll). */
  startRaid(): boolean {
    if (this.raid && !this.raid.over) return false
    const n = 3 + Math.floor(this.host.random() * 2)
    const raid: Raid = { members: [], startedAt: this.host.now(), stole: false, over: false }
    this.raid = raid
    const def = this.host.def()
    const start = RAID_ROAD[0] as Point
    for (let i = 0; i < n; i++) {
      const x = start.x + (i % 2) * 2.5
      const z = start.z + i * 1.8
      const at = { x, y: groundAt(def, x, z), z }
      const b = this.spawn('Raider', at, i === 0 ? WeaponId.Ak47 : this.pickGun(), null)
      if (!b) break
      b.leg = 1
      raid.members.push(b)
    }
    if (raid.members.length === 0) {
      this.raid = null
      return false
    }
    this.host.noticeAll(
      'warn',
      'A horn from the Haven lookout: raiders on the east road, coming for the stores.',
    )
    this.host.horn?.(RAID_ROAD[RAID_ROAD.length - 1] as Point)
    return true
  }

  // --- Every tick: one bandit's input --------------------------------------------------------

  private think(b: Bandit) {
    const player = b.player
    if (!player.state.alive) return null
    const now = this.host.now()
    const view: BanditView = {
      now,
      dt: 1 / 60,
      light: this.host.light(),
      threats: this.threats(player),
      clear: (a, c) => this.host.clear(a, c),
      cover: (near, from) => this.cover(b, near, from),
      goal: this.goal(b),
      leash: b.camp ? { x: b.camp.poi.x, z: b.camp.poi.z, r: LEASH } : null,
    }
    const command = b.brain.think(player.state, view)
    command.viewTick = this.game.tick
    if (b.brain.spotted) this.shout(b, b.brain.spotted)
    b.brain.spotted = null
    return command
  }

  /** Who it might shoot: the living, and the dead close by. */
  private threats(self: ServerPlayer): Threat[] {
    const out: Threat[] = []
    for (const { threat } of this.host.people()) out.push(threat)
    const me = self.state.pos
    for (const z of this.host.zombies()) {
      if (!z.state.alive || dist(z.state.pos, me) > 30) continue
      const pos = z.state.pos
      out.push({ id: z.id, pos, zombie: true, lit: false, crouched: false, hidden: 0 })
    }
    return out
  }

  /** Where it should be when nothing's happening. */
  private goal(b: Bandit): Point | null {
    const me = b.player.state.pos
    const camp = b.camp
    if (!camp) {
      // Raiders: up the road to the gate, or (with the goods) back down it.
      const road = this.raid?.stole ? [...RAID_ROAD].reverse() : RAID_ROAD
      let p = road[b.leg] ?? road[road.length - 1]
      if (p && dist(me, p) < 3 && b.leg < road.length - 1) p = road[++b.leg]
      return p ? { x: p.x, y: me.y, z: p.z } : null
    }
    if (b.post >= 0) {
      const [px, pz, py] = BANDIT_POSTS[b.post] as readonly [number, number, number]
      return { x: camp.poi.x + px, y: camp.poi.y + py, z: camp.poi.z + pz }
    }
    let [px, pz] = BANDIT_PATROL[b.leg % BANDIT_PATROL.length] as readonly [number, number]
    if (dist(me, { x: camp.poi.x + px, z: camp.poi.z + pz }) < 1.5) {
      b.leg++
      ;[px, pz] = BANDIT_PATROL[b.leg % BANDIT_PATROL.length] as readonly [number, number]
    }
    return { x: camp.poi.x + px, y: camp.poi.y, z: camp.poi.z + pz }
  }

  /** "There! By the trees!": everybody living near enough hears it (once in a while per camp). */
  private shout(b: Bandit, _seen: Threat): void {
    const now = this.host.now()
    const camp = b.camp
    const last = camp ? camp.lastShout : (this.raid?.startedAt ?? 0) - 10
    if (now - last < 6) return
    if (camp) camp.lastShout = now
    const lines = camp ? SHOUTS : RAID_SHOUTS
    const line = lines[Math.floor(this.host.random() * lines.length)] ?? SHOUTS[0]
    const at = b.player.state.pos
    for (const { player } of this.host.people()) {
      if (dist(player.state.pos, at) < SHOUT_REACH)
        this.host.notice(player, 'warn', `A shout from the trees: "${line}"`)
    }
    // And the rest of the camp hears it too.
    for (const m of camp?.members ?? this.raid?.members ?? []) {
      if (m !== b) m.brain.hear(at, now)
    }
  }

  /** Behind a tree, a rock or one of the camp's crates: near `near`, away from `from`. */
  private cover(b: Bandit, near: Point, from: Point): Point | null {
    const things: { x: number; z: number; r: number }[] = []
    if (b.camp) {
      for (const [x, z, half] of BANDIT_COVER) {
        things.push({ x: b.camp.poi.x + x, z: b.camp.poi.z + z, r: half })
      }
    }
    for (const t of this.trees(near)) things.push({ x: t.x, z: t.z, r: t.y })
    let best: Point | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const t of things) {
      const d = dist(t, near)
      if (d > 10) continue
      const ax = t.x - from.x
      const az = t.z - from.z
      const len = Math.hypot(ax, az)
      if (len < 5) continue
      const spot = {
        x: t.x + (ax / len) * (t.r + 0.55),
        y: near.y,
        z: t.z + (az / len) * (t.r + 0.55),
      }
      // Closer is better; so is a little closer in on a long shot.
      const score = dist(spot, near) + Math.max(0, len - 30) * 0.15
      if (score < bestScore) {
        bestScore = score
        best = spot
      }
    }
    if (best) best.y = groundAt(this.host.def(), best.x, best.z)
    return best
  }

  /** Solid trees and rocks around a spot (x, z, and their radius as y). */
  private trees(at: Point): Point[] {
    const [cx, cz] = chunkOf(at.x, at.z)
    const out: Point[] = []
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const key = i * 4096 + j
        let list = this.props.get(key)
        if (!list) {
          list = []
          const def = this.host.def()
          for (const p of chunkProps(def.terrain, def.seed, i, j)) {
            if (p.kind === PropKind.Stump) continue
            const solid = propSolid(p)
            if (solid && solid.radius >= 0.2) list.push({ x: p.x, y: solid.radius, z: p.z })
          }
          this.props.set(key, list)
        }
        for (const p of list)
          if (Math.abs(p.x - at.x) < 12 && Math.abs(p.z - at.z) < 12) out.push(p)
      }
    }
    return out
  }

  // --- What the director tells us ----------------------------------------------------------

  /** A bandit fired: the dead hear it, and so does its camp. */
  onShot(player: ServerPlayer): void {
    const b = this.byId.get(player.id)
    if (!b) return
    const noise = WEAPONS[player.state.weapon.id].noise
    const now = this.host.now()
    if (noise > b.noise || now > b.noiseUntil) b.noise = noise
    b.noiseUntil = now + 1.2
    this.host.alarm(player.state.pos, noise)
    this.heard(player.state.pos, noise, b)
  }

  /** A gun went off somewhere (anybody's): bandits within earshot go and look. */
  heard(at: Point, noise: number, except?: Bandit): void {
    const now = this.host.now()
    for (const b of this.byId.values()) {
      if (b === except || !b.player.state.alive) continue
      const d = dist(b.player.state.pos, at)
      if (d < Math.min(noise, MATES_HEAR)) b.brain.hear(at, now)
    }
  }

  /** Hit: it knows roughly where from. */
  onDamage(victim: ServerPlayer, attacker: ServerPlayer): void {
    const b = this.byId.get(victim.id)
    if (b && attacker !== victim) b.brain.hurt(attacker.state.pos, this.host.now())
  }

  /** Down: what it carried lies there (its gun, some rounds, maybe food or its bandana). */
  onKill(victim: ServerPlayer): void {
    const b = this.byId.get(victim.id)
    if (!b) return
    victim.respawnAt = Number.POSITIVE_INFINITY
    b.diedAt = this.host.now()
    const at = victim.state.pos
    const random = () => this.host.random()
    const gun = victim.state.weapon
    this.host.drop(weaponItem(gun.id), 1, at, gun.ammo)
    const type = WEAPONS[gun.id].ammoType
    if (type) this.host.drop(ammoItem(type), 4 + Math.floor(random() * 10), at)
    if (random() < 0.6) this.host.drop(FOOD[Math.floor(random() * FOOD.length)] ?? 'beans', 1, at)
    if (random() < 0.25) this.host.drop(b.gear & 15 ? 'bandana' : 'cargopants', 1, at)
    const camp = b.camp
    if (camp) {
      camp.left = Math.max(0, camp.left - 1)
      if (camp.left === 0) camp.clearedAt = this.host.clock()
    }
  }

  /** What it wears (the bandana or gas mask, the jacket...). */
  gearOf(player: ServerPlayer): number | null {
    return this.byId.get(player.id)?.gear ?? null
  }

  /** The one walking the watch carries a torch at night. */
  lightOn(player: ServerPlayer): boolean {
    const b = this.byId.get(player.id)
    return !!b && b.post === -1 && b.brain.mood !== 'fight' && this.host.light() < 0.3
  }

  /** What the dead perceive of each living bandit (they hunt them like anybody). */
  prey(): Prey[] {
    const out: Prey[] = []
    const now = this.host.now()
    for (const b of this.byId.values()) {
      const s = b.player.state
      if (!s.alive) continue
      const speed = Math.hypot(s.vel.x, s.vel.z)
      const steps = s.crouched ? 2.5 : speed > 6 ? 16 : speed > 1 ? 7 : 0
      out.push({
        id: b.player.id,
        pos: s.pos,
        yaw: s.yaw,
        pitch: s.pitch,
        crouched: s.crouched,
        prone: false,
        noise: Math.max(steps, now < b.noiseUntil ? b.noise : 0),
        light: this.lightOn(b.player),
      })
    }
    return out
  }
}

const groundAt = (def: SurvivalDef, x: number, z: number) => heightAt(def.terrain, x, z)
