import {
  AMMO_BOX,
  addStack,
  ammoItem,
  capacityOf,
  carried,
  countOf,
  createPlayerState,
  createWeaponState,
  type Dialog,
  heightAt,
  type InputCommand,
  type Interactable,
  ITEMS,
  type LootItem,
  type MapSpawn,
  type Notice,
  type Npc,
  type PlayerState,
  QUESTS,
  type QuestDef,
  type QuestState,
  questById,
  rollLoot,
  roomFor,
  SELL_RATE,
  ServerMsg,
  SMALL_TALK,
  type SurvivalAction,
  type SurvivalDef,
  type SurvivalSelf,
  type SurvivalShared,
  syncForest,
  TICK_RATE,
  TRADER_STOCK,
  takeStack,
  WEAPONS,
  WeaponId,
  type WeaponState,
  weaponItem,
  weightOf,
  ZombieKind,
} from '@office-fps/shared'
import type { Game, ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import { KINDS, kindFor, POOL, type Prey, Zed } from './horde.ts'

/** Loot is kept (and told to clients) in square cells this wide (m): yours and the 8 around. */
const LOOT_CELL = 96
/** Seconds from full to starving / parched, and a torch's battery life. */
const HUNGER_SECONDS = 45 * 60
const THIRST_SECONDS = 30 * 60
const BATTERY_SECONDS = 9 * 60
/** One night, from dark through the grey hour and back (s). */
const NIGHT_SECONDS = 24 * 60
const RESPAWN_SECONDS = 6
/** Seconds before the dead you killed at a place are replaced by others. */
const KILL_MEMORY = 14 * 60
/** Seconds a place stays picked clean before things turn up there again. */
const RESTOCK_SECONDS = 25 * 60
/** Things players dropped (or died with) lie this long (s). */
const DROPPED_SECONDS = 20 * 60
const REACH = 2.4
const TALK_REACH = 3
/** The dead exist only within this of somebody (m). */
const ZED_RANGE = 185

interface Survivor {
  player: ServerPlayer
  self: SurvivalSelf
  dirty: boolean
  /** The weapons carried when last seen alive (what you wake up with). */
  kit: { id: WeaponId; ammo: number }[]
  /** Loot cells this client has been told about. */
  cells: Set<number>
  /** How far their noise carries (m) until `noiseUntil`. */
  noise: number
  noiseUntil: number
  /** Who they're talking to, and the quest on offer. */
  talking: string | null
  warned: number
}

interface Loot extends LootItem {
  ammo?: number
  /** Index of the loot spot it came from, or -1 for something dropped. */
  spot: number
  /** Tick it disappears (dropped things), or 0 to stay. */
  until: number
}

interface PlaceState {
  /** Tick the loot here was last put out, or -1 for never. */
  stocked: number
  /** Ticks at which one of its dead was killed. */
  kills: number[]
  /** The story stirred it up: this many extra, all hunting. */
  woken: number
}

const START_KIT = [
  { id: WeaponId.Handgun, ammo: 12 },
  { id: WeaponId.Knife, ammo: 0 },
]

const freshSelf = (): SurvivalSelf => ({
  inv: [{ item: 'water', n: 1 }],
  pack: null,
  money: 0,
  hunger: 70,
  thirst: 70,
  bleeding: false,
  battery: 100,
  light: false,
  bed: null,
})

/**
 * Survival mode: runs the night. Who carries what and how hungry they are, what lies where, the
 * dead and where they roam, the people of Haven and the story. The Game asks it the same things
 * it asks the zombies-mode director, plus what E and the backpack do.
 */
export class SurvivalDirector {
  private readonly game: Game
  private def!: SurvivalDef
  private readonly random: () => number
  private readonly survivors = new Map<number, Survivor>()
  /** What people had when they left, by name: they get it back if they return. */
  private readonly profiles = new Map<string, { self: SurvivalSelf; kit: Survivor['kit'] }>()
  private readonly loot = new Map<number, Loot>()
  private readonly cells = new Map<number, Set<number>>()
  private nextLoot = 1
  private places: PlaceState[] = []
  private readonly zeds = new Map<number, Zed>()
  private pool: ServerPlayer[] = []
  private quests: QuestState[] = []
  private done: string[] = []
  private found = new Set<number>()
  private gates = 0
  private startTick = 0
  /** Seconds added to the night's clock by sleeping. */
  private slept = 0
  won = false

  constructor(game: Game, random: () => number = Math.random) {
    this.game = game
    this.random = random
  }

  private get now(): number {
    return this.game.tick / TICK_RATE
  }

  /** The night's clock, 0–1 (see SurvivalShared.time). */
  get time(): number {
    return (((this.game.tick - this.startTick) / TICK_RATE + this.slept) / NIGHT_SECONDS + 0.05) % 1
  }

  /** 0 in the dark, 1 in the middle of the grey hour. */
  private get grey(): number {
    const t = this.time
    return t < 0.8 ? 0 : Math.sin(((t - 0.8) / 0.2) * Math.PI)
  }

  // --- Life cycle --------------------------------------------------------------------------

  /** A new night from the beginning: the story, the loot, the dead, everybody's backpack. */
  start(): void {
    const def = this.game.world.map.survival
    if (!def) return
    this.def = def
    this.dispose()
    this.won = false
    this.startTick = this.game.tick
    this.slept = 0
    this.loot.clear()
    this.cells.clear()
    this.places = def.pois.map(() => ({ stocked: -1, kills: [], woken: 0 }))
    this.quests = []
    this.done = []
    this.found = new Set()
    this.gates = 0
    this.game.setGates(0)
    this.profiles.clear()
    this.survivors.clear()
    for (const p of this.game.players.values()) if (isPerson(p)) this.onJoin(p)
    this.begin('wake')
    for (let i = 0; i < POOL; i++) {
      const zombie = this.game.addZombie(new Zed(this.random))
      if (zombie) this.pool.push(zombie)
    }
    for (const z of this.pool) this.zeds.set(z.id, z.zombie as Zed)
  }

  dispose(): void {
    for (const z of this.pool) this.game.leave(z.id)
    this.pool = []
    this.zeds.clear()
  }

  onJoin(player: ServerPlayer): void {
    if (!isPerson(player)) return
    player.team = 1
    const saved = this.profiles.get(player.name)
    this.survivors.set(player.id, {
      player,
      self: saved ? saved.self : freshSelf(),
      dirty: true,
      kit: saved ? saved.kit : START_KIT.map((k) => ({ ...k })),
      cells: new Set(),
      noise: 0,
      noiseUntil: 0,
      talking: null,
      warned: 0,
    })
  }

  onLeave(player: ServerPlayer): void {
    const sv = this.survivors.get(player.id)
    if (!sv) return
    if (player.state.alive) sv.kit = kitOf(player.state)
    sv.self.light = false
    this.profiles.set(player.name, { self: sv.self, kit: sv.kit })
    this.survivors.delete(player.id)
  }

  // --- What the game asks -------------------------------------------------------------------

  spawnFor(player: ServerPlayer): MapSpawn | null {
    const sv = this.survivors.get(player.id)
    if (!sv) return null
    const bed = this.def.interactables.find((i) => i.key === sv.self.bed)
    if (bed) return { pos: [bed.pos[0], bed.pos[1] + 0.2, bed.pos[2]], yaw: 0 }
    return this.game.world.map.spawns[0] ?? null
  }

  /** What you wake up with: the weapons you carried, loaded as they were. */
  freshState(player: ServerPlayer, spawn: MapSpawn): PlayerState | null {
    const sv = this.survivors.get(player.id)
    if (!sv) return null
    const weapons = sv.kit.map((k) => {
      const w = createWeaponState(k.id, (this.random() * 0xffffffff) >>> 0)
      w.ammo = Math.min(k.ammo, WEAPONS[k.id].magSize)
      w.reserve = 0
      return w
    })
    const bySlot = (slot: string) => weapons.find((w) => WEAPONS[w.id].slot === slot)
    const order = [bySlot('sidearm'), bySlot('primary'), bySlot('melee')].filter(
      (w): w is WeaponState => w !== undefined,
    )
    const hand = order[0] ?? createWeaponState(WeaponId.Knife)
    const state = createPlayerState(spawn, hand, order[1] ?? null, order[2] ?? null)
    this.syncReserves(sv, state)
    return state
  }

  respawnSeconds(): number {
    return RESPAWN_SECONDS
  }

  speedFactor(player: ServerPlayer): number {
    return this.zeds.get(player.id)?.speedFactor ?? 1
  }

  clawDamage(zombie: ServerPlayer): number {
    return KINDS[this.zeds.get(zombie.id)?.kind ?? ZombieKind.Walker]?.claws ?? 14
  }

  /** A knife in the back kills outright only something that hasn't noticed you (never a brute). */
  unaware(zombie: ServerPlayer): boolean {
    const zed = this.zeds.get(zombie.id)
    return !!zed && zed.mood !== 'chase' && zed.kind !== ZombieKind.Brute && !zed.hunter
  }

  thinkZombie(zombie: ServerPlayer): InputCommand | null {
    const zed = this.zeds.get(zombie.id)
    if (!zed || !zombie.state.alive) return null
    const target = this.game.players.get(zed.targetId)
    const crowd: Point[] = []
    for (const other of this.pool) {
      if (other !== zombie && other.state.alive) crowd.push(other.state.pos)
    }
    const command = zed.think(zombie, {
      def: this.def,
      now: this.now,
      tick: this.game.tick,
      target: target?.state.alive ? target.state.pos : null,
      crowd,
      rooms: this.def.rooms,
    })
    if (zed.speedChanged()) this.game.applyRules(zombie)
    return command
  }

  /** A gun went off: everything in earshot comes to look. */
  onShot(player: ServerPlayer): void {
    const sv = this.survivors.get(player.id)
    if (!sv) return
    const noise = WEAPONS[player.state.weapon.id].noise
    if (noise > sv.noise || this.now > sv.noiseUntil) sv.noise = noise
    sv.noiseUntil = this.now + 1.2
    if (noise < 20) return
    for (const z of this.pool) {
      if (!z.state.alive) continue
      const d = Math.hypot(z.state.pos.x - player.state.pos.x, z.state.pos.z - player.state.pos.z)
      if (d < noise) this.zeds.get(z.id)?.alert(player.state.pos, this.now)
    }
  }

  onDamage(victim: ServerPlayer, attacker: ServerPlayer, amount: number): void {
    const zed = this.zeds.get(victim.id)
    // Shot from the dark: it comes for whoever did it.
    if (zed && isPerson(attacker)) zed.alert(attacker.state.pos, this.now)
    const sv = this.survivors.get(victim.id)
    if (sv && attacker.zombie && amount >= 8 && !sv.self.bleeding && this.random() < 0.3) {
      sv.self.bleeding = true
      sv.dirty = true
      this.notice(victim, 'warn', "You're bleeding. Bandage it.")
    }
  }

  onKill(victim: ServerPlayer, killer: ServerPlayer): void {
    const zed = this.zeds.get(victim.id)
    if (zed) {
      victim.respawnAt = Number.POSITIVE_INFINITY
      const place = this.places[zed.home]
      if (place && !zed.hunter) place.kills.push(this.game.tick)
      if (place && zed.hunter && place.woken > 0) place.woken--
      this.countKill(zed, victim.state.pos, killer)
      // Now and then one of them was carrying something.
      if (this.random() < 0.14) {
        const drop = rollLoot(this.random() < 0.5 ? 'bedroom' : 'medical', this.random)
        if (drop) this.dropAt(drop.item, drop.n, victim.state.pos, undefined, true)
      }
      return
    }
    const sv = this.survivors.get(victim.id)
    if (!sv) return
    // You keep what was in your hands; the backpack's contents lie where you fell.
    sv.kit = kitOf(victim.state)
    for (const stack of sv.self.inv) {
      if (ITEMS[stack.item]?.kind === 'quest') continue
      this.dropAt(stack.item, stack.n, victim.state.pos, stack.ammo, true)
    }
    sv.self.inv = sv.self.inv.filter((s) => ITEMS[s.item]?.kind === 'quest')
    sv.self.bleeding = false
    sv.self.light = false
    sv.self.hunger = Math.max(sv.self.hunger, 45)
    sv.self.thirst = Math.max(sv.self.thirst, 45)
    sv.talking = null
    sv.dirty = true
    this.send(victim, { type: ServerMsg.Dialog, dialog: null })
    this.notice(
      victim,
      'story',
      sv.self.bed
        ? 'You died.\nYour backpack lies where you fell.'
        : 'You died.\nSleep in a bed and you wake up there instead.',
    )
  }

  // --- Every tick ----------------------------------------------------------------------------

  step(): void {
    const tick = this.game.tick
    const people = [...this.survivors.values()]
    const alive = people.filter((sv) => sv.player.state.alive)

    // Reloads eat the ammunition in the backpack.
    for (const sv of alive) this.settleAmmo(sv)

    if (tick % 20 === 0) {
      // The forest is solid around the living (and where the dead walk near them).
      syncForest(
        this.game.world.physics,
        alive.map((sv) => sv.player.state.pos),
      )
    }
    if (tick % TICK_RATE === 0) {
      for (const sv of people) this.tickSurvivor(sv)
      this.discover(alive)
      this.stockPlaces(alive)
      this.expireLoot()
      this.tickQuests(alive)
    }
    if (tick % 30 === 7) for (const sv of people) this.subscribe(sv)
    if (tick % 30 === 15) this.populate(alive)
    this.senses(alive)

    for (const sv of people) {
      if (!sv.dirty) continue
      sv.dirty = false
      this.send(sv.player, { type: ServerMsg.Survival, self: sv.self })
    }
  }

  /** Hunger, thirst, bleeding, the torch's battery — once a second. */
  private tickSurvivor(sv: Survivor): void {
    const { self, player } = sv
    if (!player.state.alive) return
    const before = [Math.ceil(self.hunger), Math.ceil(self.thirst), Math.ceil(self.battery)]
    self.hunger = Math.max(0, self.hunger - 100 / HUNGER_SECONDS)
    self.thirst = Math.max(0, self.thirst - 100 / THIRST_SECONDS)
    if (self.light) {
      self.battery = Math.max(0, self.battery - 100 / BATTERY_SECONDS)
      if (self.battery === 0) {
        self.light = false
        this.notice(player, 'warn', 'Your torch is dead. Find batteries.')
      }
    }
    const second = Math.floor(this.now)
    let hurt = 0
    if (self.bleeding && second % 2 === 0) hurt += 1
    if (self.hunger === 0 && second % 4 === 0) hurt += 1
    if (self.thirst === 0 && second % 3 === 0) hurt += 1
    if (hurt > 0) {
      player.health -= hurt
      if (player.health <= 0) {
        this.game.killPlayer(player.id, player.id)
        return
      }
    } else if (!self.bleeding && self.hunger > 40 && self.thirst > 40 && second % 6 === 0) {
      // Fed and watered, you mend slowly.
      player.health = Math.min(player.maxHealth, player.health + 1)
    }
    const warn = (bit: number, low: boolean, text: string) => {
      if (low && !(sv.warned & bit)) this.notice(player, 'warn', text)
      sv.warned = low ? sv.warned | bit : sv.warned & ~bit
    }
    warn(1, self.hunger < 20, "You're starving. Eat something.")
    warn(2, self.thirst < 20, "You're parched. Find water.")
    warn(4, self.light && self.battery < 15, 'Your torch is flickering.')
    if (
      before[0] !== Math.ceil(self.hunger) ||
      before[1] !== Math.ceil(self.thirst) ||
      before[2] !== Math.ceil(self.battery)
    ) {
      sv.dirty = true
    }
  }

  // --- Ammunition ----------------------------------------------------------------------------

  /** Every carried gun's spare ammunition is what's in the backpack for it. */
  private syncReserves(sv: Survivor, state: PlayerState = sv.player.state): void {
    for (const w of carried(state)) {
      const type = WEAPONS[w.id].ammoType
      w.reserve = type ? Math.min(65535, countOf(sv.self.inv, ammoItem(type))) : 0
    }
  }

  /** The gun in hand reloaded since last tick: take those rounds out of the backpack. */
  private settleAmmo(sv: Survivor): void {
    const w = sv.player.state.weapon
    const type = WEAPONS[w.id].ammoType
    if (!type) return
    const item = ammoItem(type)
    const have = Math.min(65535, countOf(sv.self.inv, item))
    if (w.reserve >= have) return
    takeStack(sv.self.inv, item, have - w.reserve)
    this.touch(sv)
  }

  /** The backpack changed: guns see their ammunition, the client gets told. */
  private touch(sv: Survivor): void {
    sv.dirty = true
    if (sv.player.state.alive) this.syncReserves(sv)
  }

  // --- Loot -------------------------------------------------------------------------------

  private cellOf(x: number, z: number): number {
    return Math.floor((x + 4096) / LOOT_CELL) * 256 + Math.floor((z + 4096) / LOOT_CELL)
  }

  private addLoot(
    item: string,
    n: number,
    pos: Point,
    spot: number,
    ammo?: number,
    until = 0,
  ): void {
    const id = this.nextLoot++
    const loot: Loot = {
      id,
      item,
      n,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      spot,
      until,
      ...(ammo !== undefined ? { ammo } : {}),
    }
    this.loot.set(id, loot)
    const cell = this.cellOf(pos.x, pos.z)
    const set = this.cells.get(cell) ?? new Set()
    set.add(id)
    this.cells.set(cell, set)
    const msg = { type: ServerMsg.Loot, add: [loot as LootItem], remove: [] as number[] }
    for (const sv of this.survivors.values()) if (sv.cells.has(cell)) this.send(sv.player, msg)
  }

  private removeLoot(loot: Loot): void {
    this.loot.delete(loot.id)
    const cell = this.cellOf(loot.x, loot.z)
    this.cells.get(cell)?.delete(loot.id)
    const msg = { type: ServerMsg.Loot, add: [] as LootItem[], remove: [loot.id] }
    for (const sv of this.survivors.values()) if (sv.cells.has(cell)) this.send(sv.player, msg)
  }

  /** Drops something on the ground at (about) `at`. */
  private dropAt(item: string, n: number, at: Point, ammo?: number, scatter = false): void {
    const a = this.random() * Math.PI * 2
    const r = scatter ? 0.3 + this.random() * 0.7 : 0.5
    const x = at.x + Math.cos(a) * r
    const z = at.z + Math.sin(a) * r
    // On the floor you're standing on, or the ground if it's higher.
    const y = Math.max(at.y, heightAt(this.def.terrain, x, z)) + 0.05
    this.addLoot(item, n, { x, y, z }, -1, ammo, this.game.tick + DROPPED_SECONDS * TICK_RATE)
  }

  /** Tells a client about the loot around it (its cell and the 8 around), and only that. */
  private subscribe(sv: Survivor): void {
    const { x, z } = sv.player.state.pos
    const want = new Set<number>()
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) want.add(this.cellOf(x + dx * LOOT_CELL, z + dz * LOOT_CELL))
    }
    const add: LootItem[] = []
    const remove: number[] = []
    for (const cell of want) {
      if (sv.cells.has(cell)) continue
      for (const id of this.cells.get(cell) ?? []) {
        const loot = this.loot.get(id)
        if (loot) add.push(loot)
      }
    }
    for (const cell of sv.cells) {
      if (want.has(cell)) continue
      for (const id of this.cells.get(cell) ?? []) remove.push(id)
    }
    sv.cells = want
    if (add.length > 0 || remove.length > 0)
      this.send(sv.player, { type: ServerMsg.Loot, add, remove })
  }

  /** Puts out a place's loot when someone first comes near, and again long after it was emptied. */
  private stockPlaces(alive: readonly Survivor[]): void {
    const tick = this.game.tick
    this.def.pois.forEach((poi, i) => {
      const place = this.places[i] as PlaceState
      const near = alive.some((sv) => dist(sv.player.state.pos, poi) < poi.r + 130)
      if (!near) return
      const first = place.stocked < 0
      if (!first && tick - place.stocked < RESTOCK_SECONDS * TICK_RATE) return
      // Restocking only while nobody is actually there to see things appear.
      if (!first && alive.some((sv) => dist(sv.player.state.pos, poi) < poi.r + 60)) return
      place.stocked = tick
      const taken = new Set<number>()
      for (const l of this.loot.values()) if (l.spot >= 0) taken.add(l.spot)
      this.def.loot.forEach((spot, s) => {
        if (spot.poi !== i || taken.has(s)) return
        if (!first && this.random() < 0.5) return
        const roll = rollLoot(spot.table, this.random)
        if (!roll) return
        const [x, y, z] = spot.pos
        const weapon = ITEMS[roll.item]?.weapon
        // Guns are found with a few rounds in them, if any.
        const ammo =
          weapon === undefined
            ? undefined
            : Math.floor(this.random() * (WEAPONS[weapon].magSize + 1) * 0.6)
        this.addLoot(roll.item, roll.n, { x, y, z }, s, ammo)
      })
    })
  }

  private expireLoot(): void {
    for (const l of this.loot.values())
      if (l.until > 0 && this.game.tick >= l.until) this.removeLoot(l)
  }

  // --- E: take, talk, use ------------------------------------------------------------------

  /** E was pressed: talk to whoever is in front of you, use what's there, or pick something up. */
  onUse(player: ServerPlayer): void {
    const sv = this.survivors.get(player.id)
    if (!sv || !player.state.alive) return
    const s = player.state
    const eye = { x: s.pos.x, y: s.pos.y + 1.6, z: s.pos.z }
    const fx = -Math.sin(s.yaw) * Math.cos(s.pitch)
    const fy = Math.sin(s.pitch)
    const fz = -Math.cos(s.yaw) * Math.cos(s.pitch)
    /** How well you're looking at a point within `reach` (higher = better), or -1 if out of it. */
    const aimAt = (x: number, y: number, z: number, reach: number) => {
      const dx = x - eye.x
      const dy = y - eye.y
      const dz = z - eye.z
      const d = Math.hypot(dx, dy, dz)
      if (d > reach + 0.6 || Math.hypot(dx, dz) > reach) return -1
      return (dx * fx + dy * fy + dz * fz) / Math.max(d, 0.2) + (reach - d) * 0.05
    }

    let npc: Npc | null = null
    let best = 0.3
    for (const n of this.def.npcs) {
      const score = aimAt(n.pos[0], n.pos[1] + 1.4, n.pos[2], TALK_REACH)
      if (score > best) {
        best = score
        npc = n
      }
    }
    if (npc) return void this.talk(sv, npc)

    let thing: Interactable | null = null
    best = 0.2
    for (const t of this.def.interactables) {
      const score = aimAt(t.pos[0], t.pos[1], t.pos[2], REACH)
      if (score > best) {
        best = score
        thing = t
      }
    }
    let loot: Loot | null = null
    let lootScore = 0.2
    for (const cell of sv.cells) {
      for (const id of this.cells.get(cell) ?? []) {
        const l = this.loot.get(id)
        if (!l) continue
        const score = aimAt(l.x, l.y, l.z, REACH)
        if (score > lootScore) {
          lootScore = score
          loot = l
        }
      }
    }
    if (loot && (!thing || lootScore >= best)) return void this.take(sv, loot)
    if (thing) return void this.useThing(sv, thing)

    // Standing in the lake: drink.
    for (const lake of this.def.lakes) {
      if (Math.hypot(s.pos.x - lake.x, s.pos.z - lake.z) < lake.r && s.pos.y < lake.y + 0.1) {
        sv.self.thirst = Math.min(100, sv.self.thirst + 35)
        if (this.random() < 0.3) player.health = Math.max(1, player.health - 6)
        sv.dirty = true
        this.notice(player, 'info', 'You drink from the lake. It tastes of mud.')
        return
      }
    }
  }

  private take(sv: Survivor, loot: Loot): void {
    const def = ITEMS[loot.item]
    if (!def) return
    const player = sv.player
    if (def.kind === 'money') {
      sv.self.money += loot.n * (def.cash ?? 1)
      this.removeLoot(loot)
      this.notice(player, 'loot', `+ $${loot.n * (def.cash ?? 1)}`)
      sv.dirty = true
      return
    }
    // A weapon goes straight into an empty hand.
    if (def.weapon !== undefined && this.holdNew(sv, def.weapon, loot.ammo ?? 0)) {
      this.removeLoot(loot)
      this.notice(player, 'loot', `+ ${def.name}`)
      this.touch(sv)
      return
    }
    const fits = Math.min(loot.n, roomFor(sv.self, loot.item))
    if (fits <= 0) {
      this.notice(player, 'warn', `No room for ${def.name}. Your pack is full.`)
      return
    }
    addStack(sv.self.inv, loot.item, fits, loot.ammo)
    this.notice(player, 'loot', `+ ${def.name}${fits > 1 ? ` ×${fits}` : ''}`)
    if (fits === loot.n) this.removeLoot(loot)
    else {
      // Took what fits; the rest stays.
      this.removeLoot(loot)
      this.addLoot(loot.item, loot.n - fits, loot, loot.spot, loot.ammo, loot.until)
    }
    this.touch(sv)
  }

  /** Puts a weapon in the player's hands if nothing is in its slot yet. */
  private holdNew(sv: Survivor, id: WeaponId, ammo: number): boolean {
    const s = sv.player.state
    const slot = WEAPONS[id].slot
    if (carried(s).some((w) => WEAPONS[w.id].slot === slot)) return false
    const w = createWeaponState(id, (this.random() * 0xffffffff) >>> 0)
    w.ammo = Math.min(ammo, WEAPONS[id].magSize)
    if (!s.holstered) s.holstered = w
    else if (!s.pocket) s.pocket = w
    else return false
    return true
  }

  private useThing(sv: Survivor, thing: Interactable): void {
    const player = sv.player
    if (thing.kind === 'bed') return void this.sleep(sv, thing)
    if (thing.kind === 'water') {
      sv.self.thirst = 100
      sv.dirty = true
      this.notice(player, 'info', 'Clean water. You drink your fill.')
      return
    }
    // Everything else belongs to a quest: it does something only when a step asks for it.
    for (const q of this.quests) {
      const step = questById(q.id)?.steps[q.step]
      if (!step) continue
      if (step.kind === 'use' && step.target === thing.key) {
        const missing = (step.needs ?? []).find(([item, n]) => countOf(sv.self.inv, item) < n)
        if (missing) {
          this.notice(
            player,
            'warn',
            `You need ${ITEMS[missing[0]]?.name ?? missing[0]}${missing[1] > 1 ? ` ×${missing[1]}` : ''}.`,
          )
          return
        }
        if (!step.keeps) for (const [item, n] of step.needs ?? []) takeStack(sv.self.inv, item, n)
        for (const [item, n] of step.gives ?? []) addStack(sv.self.inv, item, n)
        if (step.opens !== undefined) {
          this.gates |= 1 << step.opens
          this.game.setGates(this.gates)
        }
        if (step.wakes) this.wake(step.wakes)
        if (step.say) this.noticeAll('story', step.say)
        this.touch(sv)
        this.advance(q, sv)
        return
      }
      if (step.kind === 'collect') {
        const i = step.targets.indexOf(thing.key)
        if (i < 0 || q.count & (1 << i)) continue
        q.count |= 1 << i
        for (const [item, n] of step.gives) addStack(sv.self.inv, item, n)
        this.touch(sv)
        this.notice(
          player,
          'loot',
          `+ ${step.gives.map(([item]) => ITEMS[item]?.name ?? item).join(', ')}`,
        )
        if (q.count === (1 << step.targets.length) - 1) this.advance(q, sv)
        else this.game.match.broadcast()
        return
      }
    }
    if (thing.kind === 'note' && thing.text) return void this.notice(player, 'story', thing.text)
    this.notice(player, 'info', 'Nothing here you need right now.')
  }

  private sleep(sv: Survivor, bed: Interactable): void {
    const player = sv.player
    const close = this.pool.some(
      (z) => z.state.alive && dist(z.state.pos, { x: bed.pos[0], z: bed.pos[2] }) < 35,
    )
    if (close) {
      this.notice(player, 'warn', "You can't sleep. Something is moving out there.")
      return
    }
    sv.self.bed = bed.key
    sv.self.bleeding = false
    sv.self.hunger = Math.max(0, sv.self.hunger - 12)
    sv.self.thirst = Math.max(0, sv.self.thirst - 16)
    player.health = player.maxHealth
    player.state.stamina = 1
    sv.dirty = true
    // Sleeping through the dark: wake in the grey hour.
    const t = this.time
    if (t < 0.8) this.slept += (0.8 - t) * NIGHT_SECONDS
    this.send(player, {
      type: ServerMsg.Notice,
      notice: { kind: 'story', text: 'You sleep.\n\nIf you die, this is where you wake up.' },
    })
    this.game.match.broadcast()
  }

  // --- The backpack, the shop -----------------------------------------------------------------

  onAction(player: ServerPlayer, action: SurvivalAction): void {
    const sv = this.survivors.get(player.id)
    if (!sv || !player.state.alive || typeof action !== 'object' || action === null) return
    const self = sv.self
    const s = player.state
    switch (action.a) {
      case 'light':
        self.light = action.on === true && self.battery > 0
        sv.dirty = true
        return
      case 'use': {
        const def = ITEMS[action.item]
        if (!def || countOf(self.inv, def.id) < 1) return
        if (def.kind === 'pack') {
          // Swap packs: the old one goes inside the new one, if everything still fits.
          const old = self.pack
          takeStack(self.inv, def.id, 1)
          if (old) addStack(self.inv, old, 1)
          self.pack = def.id
          if (weightOf(self.inv) > capacityOf(self) + 1e-6) {
            self.pack = old
            if (old) takeStack(self.inv, old, 1)
            addStack(self.inv, def.id, 1)
            this.notice(player, 'warn', "That pack won't hold what you're carrying.")
            return
          }
          this.notice(player, 'info', `You put on the ${def.name}.`)
          return void this.touch(sv)
        }
        if (def.battery) self.battery = Math.min(100, self.battery + def.battery)
        else if (def.kind === 'food' || def.kind === 'drink' || def.kind === 'med') {
          if (def.health)
            player.health = Math.max(1, Math.min(player.maxHealth, player.health + def.health))
          if (def.hunger) self.hunger = Math.max(0, Math.min(100, self.hunger + def.hunger))
          if (def.thirst) self.thirst = Math.max(0, Math.min(100, self.thirst + def.thirst))
          if (def.stamina) s.stamina = Math.min(1, s.stamina + def.stamina / 100)
          if (def.stamina) s.winded = false
          if (def.stopsBleeding) self.bleeding = false
        } else return
        takeStack(self.inv, def.id, 1)
        return void this.touch(sv)
      }
      case 'drop': {
        const def = ITEMS[action.item]
        const n = Math.floor(Number(action.n))
        if (!def || !(n >= 1) || def.kind === 'quest') return
        const stack = [...self.inv].reverse().find((st) => st.item === def.id)
        if (!stack) return
        const got = takeStack(self.inv, def.id, def.kind === 'weapon' ? 1 : n)
        if (got > 0) this.dropAt(def.id, got, s.pos, stack.ammo)
        return void this.touch(sv)
      }
      case 'equip': {
        const stack = self.inv[Math.floor(Number(action.index))]
        const weapon = stack ? ITEMS[stack.item]?.weapon : undefined
        if (!stack || weapon === undefined) return
        const slot = WEAPONS[weapon].slot
        const old = carried(s).find((w) => WEAPONS[w.id].slot === slot)
        self.inv.splice(self.inv.indexOf(stack), 1)
        if (old) {
          addStack(self.inv, weaponItem(old.id), 1, old.ammo)
          if (weightOf(self.inv) > capacityOf(self) + 1e-6) {
            // The one in your hands is too heavy for the pack: swap it onto the ground.
            takeStack(self.inv, weaponItem(old.id), 1)
            this.dropAt(weaponItem(old.id), 1, s.pos, old.ammo)
          }
        }
        const w = createWeaponState(weapon, (this.random() * 0xffffffff) >>> 0)
        w.ammo = Math.min(stack.ammo ?? 0, WEAPONS[weapon].magSize)
        if (!old) {
          if (!s.holstered) s.holstered = w
          else s.pocket = w
        } else if (s.weapon === old) s.weapon = w
        else if (s.holstered === old) s.holstered = w
        else s.pocket = w
        return void this.touch(sv)
      }
      case 'stow': {
        const all = carried(s)
        const w = all.find((c) => WEAPONS[c.id].slot === action.slot)
        if (!w || all.length < 2) return
        const item = weaponItem(w.id)
        if (roomFor(self, item) < 1)
          return void this.notice(player, 'warn', 'No room in your pack.')
        addStack(self.inv, item, 1, w.ammo)
        const rest = all.filter((c) => c !== w)
        const hand = s.weapon === w ? (rest[0] as WeaponState) : s.weapon
        if (hand !== s.weapon) hand.draw = WEAPONS[hand.id].drawTime
        const others = rest.filter((c) => c !== hand)
        s.weapon = hand
        s.holstered = others[0] ?? null
        s.pocket = others[1] ?? null
        return void this.touch(sv)
      }
      case 'buy':
      case 'sell': {
        const def = ITEMS[action.item]
        const n = Math.max(1, Math.min(99, Math.floor(Number(action.n)) || 1))
        const gus = this.def.npcs.find((p) => p.role === 'trader')
        if (!def || !gus || dist(s.pos, { x: gus.pos[0], z: gus.pos[2] }) > 6) return
        if (action.a === 'buy') {
          if (!TRADER_STOCK.includes(def.id)) return
          const each = def.kind === 'ammo' ? AMMO_BOX : 1
          const price = Math.ceil(def.value * each) * n
          if (self.money < price) return void this.notice(player, 'warn', "You can't afford that.")
          if (roomFor(self, def.id) < each * n)
            return void this.notice(player, 'warn', 'No room in your pack.')
          self.money -= price
          addStack(
            self.inv,
            def.id,
            each * n,
            def.weapon !== undefined ? WEAPONS[def.weapon].magSize : undefined,
          )
        } else {
          if (def.kind === 'quest' || def.kind === 'money') return
          const stack = [...self.inv].reverse().find((st) => st.item === def.id)
          if (!stack) return
          const got = takeStack(self.inv, def.id, def.kind === 'weapon' ? 1 : n)
          self.money += Math.floor(def.value * SELL_RATE * got)
        }
        return void this.touch(sv)
      }
      case 'choose':
        return void this.choose(sv, String(action.npc), String(action.option))
    }
  }

  // --- People and the story ---------------------------------------------------------------

  private begin(id: string): void {
    if (this.done.includes(id) || this.quests.some((q) => q.id === id)) return
    const def = questById(id)
    if (!def) return
    this.quests.push({ id, step: 0, count: 0 })
    this.noticeAll('quest', `${def.story ? 'Chapter' : 'New job'}: ${def.title}`)
  }

  /** Is this quest there to be offered: not begun, not done, and what it follows is done? */
  private open(def: QuestDef): boolean {
    if (this.done.includes(def.id) || this.quests.some((q) => q.id === def.id)) return false
    return !def.after || this.done.includes(def.after)
  }

  /** The step is done: on to the next, or the quest is finished (rewards go to whoever did it). */
  private advance(q: QuestState, by: Survivor | null): void {
    const def = questById(q.id)
    if (!def) return
    q.step++
    q.count = 0
    if (q.step < def.steps.length) {
      this.game.match.broadcast()
      return
    }
    this.quests = this.quests.filter((x) => x !== q)
    this.done.push(def.id)
    const reward = def.reward
    if (reward?.money) {
      for (const sv of this.survivors.values()) {
        sv.self.money += reward.money
        sv.dirty = true
      }
    }
    const to = by ?? [...this.survivors.values()][0]
    if (to) {
      for (const [item, n] of reward?.items ?? []) {
        const weapon = ITEMS[item]?.weapon
        const ammo = weapon === undefined ? undefined : WEAPONS[weapon].magSize
        if (roomFor(to.self, item) >= n) addStack(to.self.inv, item, n, ammo)
        else this.dropAt(item, n, to.player.state.pos, ammo)
      }
      this.touch(to)
    }
    if (reward?.reveals) {
      this.def.pois.forEach((p, i) => {
        if (p.hidden) this.found.add(i)
      })
    }
    const got = [
      ...(reward?.money ? [`$${reward.money}`] : []),
      ...(reward?.items ?? []).map(
        ([item, n]) => `${ITEMS[item]?.name ?? item}${n > 1 ? ` ×${n}` : ''}`,
      ),
    ]
    this.noticeAll('story', `${def.done}${got.length > 0 ? `\n\n+ ${got.join(', ')}` : ''}`)
    this.noticeAll('quest', `Done: ${def.title}`)
    // The story goes on by itself.
    const next = QUESTS.find((n) => n.story && n.after === def.id)
    if (next) this.begin(next.id)
    else if (def.story) this.won = true
    this.game.match.broadcast()
  }

  private talk(sv: Survivor, npc: Npc): void {
    sv.talking = npc.key
    // Somebody a step is waiting on: they say their piece, and the story moves.
    for (const q of [...this.quests]) {
      const step = questById(q.id)?.steps[q.step]
      if (!step || (step.kind !== 'talk' && step.kind !== 'fetch') || step.npc !== npc.key) continue
      if (step.kind === 'fetch') {
        const have = countOf(sv.self.inv, step.item)
        if (have < step.n) {
          const name = ITEMS[step.item]?.name ?? step.item
          this.say(
            sv,
            npc,
            `I still need ${name}${step.n > 1 ? ` — ${step.n} of them. You have ${have}.` : '.'}`,
            this.options(sv, npc),
          )
          return
        }
        takeStack(sv.self.inv, step.item, step.n)
        this.touch(sv)
      }
      this.say(sv, npc, step.say, this.options(sv, npc))
      this.advance(q, sv)
      return
    }
    const lines = SMALL_TALK[npc.key] ?? ['…']
    const offer = QUESTS.find((d) => d.giver === npc.key && this.open(d))
    const line = lines[Math.floor(this.random() * lines.length)] ?? '…'
    this.say(sv, npc, offer ? `${line}` : line, this.options(sv, npc))
  }

  private options(sv: Survivor, npc: Npc): Dialog['options'] {
    const out: Dialog['options'] = []
    const offer = QUESTS.find((d) => d.giver === npc.key && !d.story && this.open(d))
    if (offer) out.push({ id: `ask:${offer.id}`, label: 'Need a hand with anything?' })
    if (npc.role === 'trader') out.push({ id: 'shop', label: "Show me what you've got." })
    if (npc.role === 'medic' && sv.player.health < sv.player.maxHealth) {
      out.push({ id: 'heal', label: 'Patch me up. ($40)' })
    }
    out.push({ id: 'bye', label: 'Goodbye.' })
    return out
  }

  private say(
    sv: Survivor,
    npc: Npc,
    text: string,
    options: Dialog['options'],
    shop?: Dialog['shop'],
  ): void {
    this.send(sv.player, {
      type: ServerMsg.Dialog,
      dialog: { npc: npc.key, name: npc.name, text, options, ...(shop ? { shop } : {}) },
    })
  }

  private choose(sv: Survivor, npcKey: string, option: string): void {
    const npc = this.def.npcs.find((n) => n.key === npcKey)
    if (!npc || sv.talking !== npc.key) return
    const pos = sv.player.state.pos
    if (dist(pos, { x: npc.pos[0], z: npc.pos[2] }) > TALK_REACH + 3) return
    if (option === 'bye') {
      sv.talking = null
      this.send(sv.player, { type: ServerMsg.Dialog, dialog: null })
      return
    }
    if (option === 'shop' && npc.role === 'trader') {
      const stock = TRADER_STOCK.map((id): [string, number] => {
        const def = ITEMS[id]
        return [id, Math.ceil((def?.value ?? 0) * (def?.kind === 'ammo' ? AMMO_BOX : 1))]
      })
      this.say(
        sv,
        npc,
        'Cash only. No refunds. No haunted merchandise, probably.',
        [{ id: 'bye', label: 'Goodbye.' }],
        stock,
      )
      return
    }
    if (option === 'heal' && npc.role === 'medic') {
      if (sv.self.money < 40)
        return void this.say(
          sv,
          npc,
          "I can't work for nothing. Not any more.",
          this.options(sv, npc),
        )
      sv.self.money -= 40
      sv.self.bleeding = false
      sv.player.health = sv.player.maxHealth
      sv.dirty = true
      return void this.say(
        sv,
        npc,
        'Hold still… There. Try to keep the rest of your blood inside.',
        this.options(sv, npc),
      )
    }
    if (option.startsWith('ask:')) {
      const def = questById(option.slice(4))
      if (!def || def.giver !== npc.key || !this.open(def)) return
      this.say(sv, npc, def.offer ?? def.title, [
        { id: `take:${def.id}`, label: "I'll do it." },
        { id: 'bye', label: 'Not now.' },
      ])
      return
    }
    if (option.startsWith('take:')) {
      const def = questById(option.slice(5))
      if (!def || def.giver !== npc.key || !this.open(def)) return
      this.begin(def.id)
      this.game.match.broadcast()
      this.say(sv, npc, 'Good. Come back in one piece.', this.options(sv, npc))
    }
  }

  /** Places somebody walks into go on everyone's map. */
  private discover(alive: readonly Survivor[]): void {
    this.def.pois.forEach((poi, i) => {
      if (this.found.has(i)) return
      if (!alive.some((sv) => dist(sv.player.state.pos, poi) < poi.r + 12)) return
      this.found.add(i)
      if (poi.kind !== 'cabin' && poi.kind !== 'campsite' && poi.kind !== 'start') {
        this.noticeAll('quest', `Found: ${poi.name}`)
      }
      this.game.match.broadcast()
    })
  }

  /** Reach and hold steps, once a second. */
  private tickQuests(alive: readonly Survivor[]): void {
    for (const q of [...this.quests]) {
      const step = questById(q.id)?.steps[q.step]
      if (!step) continue
      if (step.kind !== 'reach' && step.kind !== 'hold') continue
      const poi = this.def.pois.find((p) => p.key === step.poi)
      if (!poi) continue
      const there = alive.filter(
        (sv) => dist(sv.player.state.pos, poi) < poi.r + (step.kind === 'hold' ? 14 : 4),
      )
      if (there.length === 0) continue
      if (step.kind === 'reach') {
        this.advance(q, there[0] ?? null)
        continue
      }
      q.count++
      // They keep coming for as long as it takes.
      const place = this.places[this.def.pois.indexOf(poi)]
      if (place) place.woken = Math.max(place.woken, step.horde)
      if (q.count >= step.seconds) {
        if (place) place.woken = 0
        this.advance(q, there[0] ?? null)
      }
    }
  }

  private countKill(zed: Zed, at: Point, killer: ServerPlayer): void {
    for (const q of [...this.quests]) {
      const step = questById(q.id)?.steps[q.step]
      if (step?.kind !== 'kill') continue
      if (step.zombie !== undefined && step.zombie !== zed.kind) continue
      const poi = this.def.pois.find((p) => p.key === step.poi)
      if (poi && dist(at, poi) > poi.r + 45) continue
      q.count++
      if (q.count >= step.n) this.advance(q, this.survivors.get(killer.id) ?? null)
    }
  }

  /** The story stirs a place up: its dead are back, and more, and they know where you are. */
  private wake(key: string): void {
    const i = this.def.pois.findIndex((p) => p.key === key)
    const place = this.places[i]
    const poi = this.def.pois[i]
    if (!place || !poi) return
    place.kills = []
    place.woken = Math.max(place.woken, Math.ceil(poi.danger * 0.8))
  }

  // --- The dead ----------------------------------------------------------------------------

  /** What the dead can perceive of each living person right now. */
  private prey(alive: readonly Survivor[]): Prey[] {
    const out: Prey[] = []
    for (const sv of alive) {
      const s = sv.player.state
      // Nobody is hunted inside a safe place.
      if (this.def.pois.some((p) => p.safe && dist(s.pos, p) < p.r + 4)) continue
      const speed = Math.hypot(s.vel.x, s.vel.z)
      const steps = s.crouched ? 2.5 : speed > 6 ? 16 : speed > 1 ? 7 : 0
      out.push({
        id: sv.player.id,
        pos: s.pos,
        yaw: s.yaw,
        pitch: s.pitch,
        crouched: s.crouched,
        noise: Math.max(steps, this.now < sv.noiseUntil ? sv.noise : 0),
        light: sv.self.light,
      })
    }
    return out
  }

  /** Each of the dead looks and listens a few times a second (spread over the ticks). */
  private senses(alive: readonly Survivor[]): void {
    const tick = this.game.tick
    let prey: Prey[] | null = null
    const clear = (a: Point, b: Point) => this.game.lineClear(a, b)
    for (const z of this.pool) {
      if (!z.state.alive) continue
      const zed = this.zeds.get(z.id)
      if (!zed) continue
      const stalker = zed.kind === ZombieKind.Stalker
      if (!stalker && (tick + z.id) % 15 !== 0) continue
      if (stalker && (tick + z.id) % 4 !== 0) continue
      prey ??= this.prey(alive)
      if (stalker) zed.watch(z, prey, clear)
      if ((tick + z.id) % 15 >= 4 && stalker) continue
      if (zed.sense(z, prey, this.now, this.grey, clear) === 'scream') this.scream(z)
    }
  }

  /** A screamer saw someone: everybody hears it, and everything nearby comes running. */
  private scream(screamer: ServerPlayer): void {
    const at = screamer.state.pos
    const target = this.game.players.get(this.zeds.get(screamer.id)?.targetId ?? 0)
    for (const z of this.pool) {
      if (z === screamer || !z.state.alive || dist(z.state.pos, at) > 95) continue
      this.zeds.get(z.id)?.alert(target?.state.pos ?? at, this.now)
    }
    for (const sv of this.survivors.values()) {
      if (dist(sv.player.state.pos, at) > 160) continue
      this.send(sv.player, {
        type: ServerMsg.Notice,
        notice: { kind: 'scream', text: '', at: { x: at.x, y: at.y + 1.5, z: at.z } },
      })
    }
  }

  /**
   * Twice a second: retires the dead nobody is near, and brings out the ones that belong where
   * people are — the dead of nearby places first, then a few roaming the woods around everyone.
   */
  private populate(alive: readonly Survivor[]): void {
    const tick = this.game.tick
    const people = alive.map((sv) => sv.player.state.pos)
    const nearest = (p: { x: number; z: number }) =>
      Math.min(...people.map((q) => dist(q, p)), Number.POSITIVE_INFINITY)

    for (const z of this.pool) {
      if (!z.state.alive) continue
      const zed = this.zeds.get(z.id)
      const far = nearest(z.state.pos) > ZED_RANGE
      const safe = this.def.pois.some((p) => p.safe && dist(z.state.pos, p) < p.r + 6)
      if (far || safe || !zed) this.game.retireZombie(z)
    }
    if (people.length === 0) return
    const free = () => this.pool.find((z) => !z.state.alive)
    const active = this.pool.filter((z) => z.state.alive)
    const dark = this.grey < 0.3
    // Fewer in the grey hour; a few more with more people about.
    const scale = (1 - this.grey * 0.4) * (1 + 0.15 * (people.length - 1))

    this.def.pois.forEach((poi, i) => {
      if (poi.danger <= 0 || nearest(poi) > poi.r + 120) return
      const place = this.places[i] as PlaceState
      place.kills = place.kills.filter((t) => tick - t < KILL_MEMORY * TICK_RATE)
      const here = active.filter((z) => this.zeds.get(z.id)?.home === i)
      const want = Math.max(0, Math.round(poi.danger * scale) - place.kills.length) + place.woken
      const hunters = here.filter((z) => this.zeds.get(z.id)?.hunter).length
      let missing = Math.min(want - here.length, 3)
      const spots = this.def.zombieSpots.filter((s) => s.poi === i)
      for (let n = 0; n < 40 && missing > 0; n++) {
        const zombie = free()
        if (!zombie) return
        const hunter = hunters + (3 - missing) < place.woken
        let pos: Point | null = null
        if (hunter) pos = this.ringSpot(poi, poi.r + 25 + this.random() * 25, people)
        else {
          const spot = spots[Math.floor(this.random() * spots.length)]
          if (!spot) break
          const p = { x: spot.pos[0], y: spot.pos[1], z: spot.pos[2] }
          const crowded = active.some((z) => dist(z.state.pos, p) < 1.5)
          // Never where somebody could watch it appear.
          if (!crowded && nearest(p) > 38) pos = p
        }
        if (!pos) continue
        const slot = here.length + (3 - missing)
        this.place(zombie, kindFor(poi, hunter ? 99 : slot, this.random(), dark), i, hunter, pos)
        active.push(zombie)
        missing--
      }
    })

    // The woods are never quite empty.
    for (const p of people) {
      const around = active.filter((z) => dist(z.state.pos, p) < 150).length
      const want = Math.round((dark ? 3 : 2) * scale)
      if (around >= want) continue
      const zombie = free()
      if (!zombie) return
      const pos = this.ringSpot(p, 70 + this.random() * 40, people)
      if (!pos) continue
      this.place(zombie, kindFor(undefined, 0, this.random(), dark), -1, false, pos)
      active.push(zombie)
    }
  }

  /** A spot on the ground about `radius` from `centre`: not near anybody, not in a place. */
  private ringSpot(
    centre: { x: number; z: number },
    radius: number,
    people: readonly Point[],
  ): Point | null {
    for (let n = 0; n < 6; n++) {
      const a = this.random() * Math.PI * 2
      const x = centre.x + Math.cos(a) * radius
      const z = centre.z + Math.sin(a) * radius
      if (Math.abs(x) > 1480 || Math.abs(z) > 1480) continue
      if (people.some((q) => dist(q, { x, z }) < 45)) continue
      if (this.def.pois.some((p) => dist(p, { x, z }) < p.r + (p.safe ? 30 : 2))) continue
      if (this.def.lakes.some((l) => dist(l, { x, z }) < l.r + 4)) continue
      return { x, y: heightAt(this.def.terrain, x, z), z }
    }
    return null
  }

  private place(
    zombie: ServerPlayer,
    kind: ZombieKind,
    home: number,
    hunter: boolean,
    pos: Point,
  ): void {
    const zed = this.zeds.get(zombie.id)
    if (!zed) return
    zed.reset(kind, home, hunter)
    const health = (KINDS[kind]?.health ?? 200) * (1 + 0.15 * Math.max(0, this.survivors.size - 1))
    this.game.placeZombie(
      zombie,
      { pos: [pos.x, pos.y + 0.1, pos.z], yaw: this.random() * Math.PI * 2 },
      Math.round(health),
    )
    zed.speedChanged()
    this.game.applyRules(zombie)
  }

  // --- Telling people ------------------------------------------------------------------------

  info(): SurvivalShared {
    return {
      time: this.time,
      gates: this.gates,
      quests: this.quests,
      done: this.done,
      found: [...this.found],
      won: this.won,
    }
  }

  /** Is this player's torch on (others see it, and so do the dead)? */
  lightOn(player: ServerPlayer): boolean {
    return this.survivors.get(player.id)?.self.light ?? false
  }

  private send(player: ServerPlayer, msg: Parameters<Game['sendTo']>[1]): void {
    this.game.sendTo(player, msg)
  }

  private notice(player: ServerPlayer, kind: Notice['kind'], text: string): void {
    this.send(player, { type: ServerMsg.Notice, notice: { kind, text } })
  }

  private noticeAll(kind: Notice['kind'], text: string): void {
    for (const sv of this.survivors.values()) this.notice(sv.player, kind, text)
  }
}

const isPerson = (p: ServerPlayer) => !p.zombie && !p.dummy

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

/** The weapons somebody carries, as what to give them back. */
function kitOf(state: PlayerState): Survivor['kit'] {
  return carried(state).map((w) => ({ id: w.id, ammo: w.ammo }))
}
