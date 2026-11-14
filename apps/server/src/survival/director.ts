import {
  AMMO_BOX,
  ammoBeside,
  ammoItem,
  BITTEN_STORY,
  BOARD_REACH,
  carried,
  cloneBag,
  containerOf,
  countOf,
  createPlayerState,
  createWeaponState,
  DAY_SECONDS,
  type DayPhase,
  daylight,
  dayPhase,
  type EquipSlot,
  fitsAt,
  flashAt,
  footprint,
  freshJournal,
  gearLooks,
  give,
  type Held,
  hearingScale,
  heightAt,
  INFECTION_SECONDS,
  type InputCommand,
  type Interactable,
  ITEMS,
  type ItemDef,
  type ItemDest,
  type ItemRef,
  infectionStage,
  isItemDest,
  isItemRef,
  type LootItem,
  loosen,
  MAX_PLANKS,
  MAX_PLAYERS,
  type MapSpawn,
  maxStack,
  type Notice,
  PLANK_HP,
  PLANK_ITEM,
  type PlayerState,
  type PoiKind,
  planksFor,
  regive,
  rollLoot,
  rollRareStock,
  roomFor,
  SELL_RATE,
  ServerMsg,
  START_TIME,
  type Stack,
  type SurvivalAction,
  type SurvivalDef,
  type SurvivalSelf,
  type SurvivalShared,
  setBarricades,
  sightScale,
  slotFor,
  spotBlock,
  spotCentre,
  stackAt,
  syncForest,
  TICK_DT,
  TICK_RATE,
  takeStack,
  type VehicleNet,
  VICINITY,
  VICINITY_UP,
  WEAPONS,
  WeaponId,
  type WeaponSlot,
  type WeaponState,
  type WearSlot,
  type Weather,
  type WeatherKind,
  wakeTime,
  weaponItem,
  weatherAt,
  wornStats,
  ZombieKind,
} from '@office-fps/shared'
import type { Game, ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { CharacterSave } from '../saves.ts'
import { type DropHost, Drops } from './drops.ts'
import { KINDS, kindFor, POOL, type Prey, Zed } from './horde.ts'
import { Story, type StoryHost } from './story.ts'
import { Vehicles } from './vehicles.ts'

/** Small places that go on the map without a "Found:" for everyone. */
const QUIET_FINDS: readonly PoiKind[] = ['cabin', 'campsite', 'start', 'shed', 'stand']

/** Loot is kept (and told to clients) in square cells this wide (m): yours and the 8 around. */
const LOOT_CELL = 96
/** Seconds from full to starving / parched, and a torch's battery life. */
const HUNGER_SECONDS = 45 * 60
const THIRST_SECONDS = 30 * 60
const BATTERY_SECONDS = 9 * 60
const RESPAWN_SECONDS = 6
/** Everybody playing is saved this often (s); the world is checked for changes this often. */
const SAVE_SECONDS = 120
const WORLD_SAVE_SECONDS = 5
/** Nobody resumes where they logged off with one of the dead closer than this (m). */
const UNSAFE_NEAR = 15
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
  warned: number
  /** When they may nail (or pull) the next plank. */
  boardAt: number
  /** Died (or turned) at least once: they come back as somebody new, at Haven. */
  reborn: boolean
  /** Dying right now is turning: what they carried walks off with what's left of them. */
  turning: boolean
  /** Which of the cabin's starter things (def.starter) this character hasn't taken yet. */
  waiting: number[]
  /** Back from a save: wake where they logged off (once), with the health they had. */
  resume?: MapSpawn
  health?: number
  /** Back from a save with nowhere safe to resume: they wake at Haven. */
  haven?: boolean
}

/** One of the dead that was one of you: everything they had on them, and how they looked. */
interface Turned {
  stuff: Stack[]
  look: number
}

interface Loot extends LootItem {
  ammo?: number
  /** Index of the loot spot it came from, or -1 for something dropped. */
  spot: number
  /** Tick it disappears (dropped things), or 0 to stay. */
  until: number
  /** Only this player sees it (and can take it): their own starter thing, def.starter[starter]. */
  owner?: number
  starter?: number
}

interface PlaceState {
  /** Tick the loot here was last put out, or -1 for never. */
  stocked: number
  /** Ticks at which one of its dead was killed. */
  kills: number[]
  /** The story stirred it up: this many extra, all hunting. */
  woken: number
}

/** What everyone is told as the light changes. */
const DAY_NEWS: Record<DayPhase, string> = {
  dawn: 'Dawn. Fewer of them walk by day, but now they can see you coming.',
  day: 'Full daylight. Use it.',
  dusk: 'The sun is going down. Find a door you can board up.',
  night: 'Night. Keep the torch off unless you have to.',
}

/** You wake with nothing in your hands: Hollis' pistol and knife lie on the cabin table. */
const START_KIT: Survivor['kit'] = []
/** Somebody new at Haven is a long walk from the cabin: the camp spares them a knife. */
const REBORN_KIT: Survivor['kit'] = [{ id: WeaponId.Knife, ammo: 0 }]
/** Cash in a new character's pocket: a box of rounds and a bottle of water at Gus's, no more. */
export const START_MONEY = 50

const freshSelf = (): SurvivalSelf => {
  const self: SurvivalSelf = {
    inv: [],
    pack: null,
    wear: {},
    money: START_MONEY,
    hunger: 70,
    thirst: 70,
    bleeding: false,
    battery: 100,
    light: false,
    infected: null,
    journal: freshJournal(),
  }
  give(self, 'water', 1)
  return self
}

/** A saved backpack, made safe to play with: anything that no longer exists is left out. */
function restoreSelf(saved: SurvivalSelf): SurvivalSelf {
  const self: SurvivalSelf = { ...freshSelf(), ...structuredClone(saved), light: false }
  self.inv = self.inv.filter((h) => ITEMS[h.item])
  if (self.pack && !ITEMS[self.pack]) self.pack = null
  for (const [slot, item] of Object.entries(self.wear))
    if (!ITEMS[item]) delete self.wear[slot as WearSlot]
  self.journal = { ...freshJournal(), ...self.journal }
  return self
}

const WEAPON_SLOTS: readonly EquipSlot[] = ['primary', 'sidearm', 'melee']

/** Where something being moved comes from (see SurvivalDirector.move). */
type Source = { item: string; n: number; ammo?: number | undefined } & (
  | { kind: 'grid'; stack: Held }
  | { kind: 'ground'; loot: Loot }
  | { kind: 'worn'; slot: WearSlot | 'pack' }
  | { kind: 'hand'; slot: WeaponSlot; weapon: WeaponState }
)

/** What you notice as the bite takes hold (by infection stage). */
const SYMPTOMS: Record<number, string> = {
  1: "You're burning up. The bite won't stop throbbing.",
  2: "Your hands won't stop shaking. The colours are going out of everything.",
  3: "You can't think straight. Something is whispering. You can't catch your breath.",
  4: "You're turning. A minute, maybe less. Adrenaline — or a cure — now.",
}
/** Running out of breath faster as you turn: extra drain while sprinting, by stage (× normal). */
const SHORT_OF_BREATH: Record<number, number> = { 3: 0.8, 4: 1.6 }

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
  /** The world as last saved (JSON), to save it again only when something changed. */
  private savedWorld = ''
  private readonly loot = new Map<number, Loot>()
  private readonly cells = new Map<number, Set<number>>()
  private nextLoot = 1
  private places: PlaceState[] = []
  private readonly zeds = new Map<number, Zed>()
  /** The dead who were survivors, by zombie id: what drops when they're put down. */
  private readonly turned = new Map<number, Turned>()
  /** What Gus has today besides his usual stock (RARE_STOCK): item → how many. */
  private rare = new Map<string, number>()
  private pool: ServerPlayer[] = []
  private found = new Set<number>()
  private gates = 0
  private phase: DayPhase = 'night'
  /** Boarded-up gaps: spot index → battering left before the last plank gives. */
  private readonly boards = new Map<number, number>()
  private boardsDirty = false
  private boardsSentAt = 0
  private startTick = 0
  /** Seconds added to the night's clock by sleeping. */
  private slept = 0
  /** This game's weather (see weather.ts): everything follows from it and the weather clock. */
  private weatherSeed = 1
  /** Weather held at one kind (admin, tests), or null: as the seed has it. */
  private weatherPin: WeatherKind | null = null
  /** Helicopter supply drops (once the story has the radio working). */
  private readonly drops: Drops
  /** The cars parked about the woods, and who sits in them. */
  private readonly vehicles: Vehicles

  constructor(game: Game, random: () => number = Math.random) {
    this.game = game
    this.random = random
    this.drops = new Drops(this.dropHost())
    this.vehicles = new Vehicles(game, (player, kind, text) => this.notice(player, kind, text))
    this.story = new Story(this.storyHost())
  }

  /** The story and everybody's quests (see story.ts). */
  readonly story: Story

  /** Everybody here has seen the story through. */
  get won(): boolean {
    return this.story.won
  }

  /** How it ended (the round's headline). */
  get headline(): string {
    return this.story.headline ?? 'You made it out of Deadwood'
  }

  private get now(): number {
    return this.game.tick / TICK_RATE
  }

  /** The night's clock, 0–1 (see SurvivalShared.time). */
  get time(): number {
    return (
      (((this.game.tick - this.startTick) / TICK_RATE + this.slept) / DAY_SECONDS + START_TIME) % 1
    )
  }

  /** 0 at night … 1 in daylight. */
  private get light(): number {
    return daylight(this.time)
  }

  /** Seconds of weather since the game began (sleeping lets it pass too). */
  get weatherClock(): number {
    return (this.game.tick - this.startTick) / TICK_RATE + this.slept
  }

  /** The weather right now (see weather.ts). */
  get weather(): Weather {
    return weatherAt(this.weatherSeed, this.weatherClock, this.weatherPin ?? undefined)
  }

  /** Holds the weather at one kind (null lets it change again); everybody sees it at once. */
  pinWeather(kind: WeatherKind | null): void {
    this.weatherPin = kind
    this.game.match.broadcast()
  }

  // --- Life cycle --------------------------------------------------------------------------

  /** A new night from the beginning: the story, the loot, the dead, everybody's backpack. */
  start(): void {
    const def = this.game.world.map.survival
    if (!def) return
    this.def = def
    this.dispose()
    this.startTick = this.game.tick
    this.slept = 0
    this.weatherSeed = Math.floor(this.random() * 0x7fffffff)
    this.phase = 'night'
    this.loot.clear()
    this.cells.clear()
    this.places = def.pois.map(() => ({ stocked: -1, kills: [], woken: 0 }))
    this.story.reset()
    this.found = new Set()
    this.gates = 0
    this.game.setGates(0)
    this.clearBoards()
    // A new world: the saved one starts over, and every character with it (saves.ts).
    this.game.saves.newWorld()
    this.savedWorld = ''
    this.survivors.clear()
    this.rare = rollRareStock(this.random)
    for (const p of this.game.players.values()) if (isPerson(p)) this.onJoin(p)
    this.drops.reset()
    this.vehicles.reset(def)
    for (let i = 0; i < POOL; i++) {
      const zombie = this.game.addZombie(new Zed(this.random))
      if (zombie) this.pool.push(zombie)
    }
    for (const z of this.pool) this.zeds.set(z.id, z.zombie as Zed)
    this.saveAll()
  }

  dispose(): void {
    for (const z of this.pool) this.game.leave(z.id)
    this.pool = []
    this.zeds.clear()
    this.turned.clear()
    this.clearBoards()
    this.vehicles.dispose()
  }

  private clearBoards(): void {
    this.boards.clear()
    if (this.def) setBarricades(this.game.world.physics, this.def.spots, () => 0)
  }

  onJoin(player: ServerPlayer): void {
    if (!isPerson(player)) return
    player.team = 1
    const saved = player.account ? this.game.saves.character(player.account) : undefined
    const sv: Survivor = {
      player,
      self: saved ? restoreSelf(saved.self) : freshSelf(),
      dirty: true,
      kit: saved ? saved.kit.filter((k) => WEAPONS[k.id]) : START_KIT.map((k) => ({ ...k })),
      cells: new Set(),
      noise: 0,
      noiseUntil: 0,
      boardAt: 0,
      warned: 0,
      reborn: saved?.reborn ?? false,
      turning: false,
      waiting: saved ? saved.waiting.filter((i) => this.def?.starter[i]) : this.allStarters(),
    }
    if (saved) this.resume(sv, saved)
    this.survivors.set(player.id, sv)
    this.layOut(sv)
    this.story.join(sv, sv.reborn)
  }

  onLeave(player: ServerPlayer): void {
    this.vehicles.leave(player)
    if (player.zombie) {
      // One of the dead gave up its place to somebody joining: forget it (its body is gone).
      this.pool = this.pool.filter((z) => z !== player)
      this.zeds.delete(player.id)
      this.turned.delete(player.id)
      return
    }
    const sv = this.survivors.get(player.id)
    if (!sv) return
    if (player.state.alive) sv.kit = kitOf(player.state)
    sv.self.light = false
    this.story.left(player)
    this.save(sv)
    void this.game.saves.flush()
    this.clearStarters(sv)
    this.survivors.delete(player.id)
  }

  /** Every starter thing (indices into def.starter). */
  private allStarters(): number[] {
    return (this.def?.starter ?? []).map((_, i) => i)
  }

  /** Puts out this character's own copies of the starter things they haven't taken yet. */
  private layOut(sv: Survivor): void {
    if (!this.def) return
    for (const i of sv.waiting) {
      const thing = this.def.starter[i]
      if (!thing) continue
      const [x, y, z] = thing.pos
      this.addLoot(thing.item, 1, { x, y, z }, -1, thing.ammo, 0, {
        owner: sv.player.id,
        starter: i,
      })
    }
  }

  /** Takes this player's own starter things off the table (they left, or start over). */
  private clearStarters(sv: Survivor): void {
    for (const l of [...this.loot.values()]) if (l.owner === sv.player.id) this.removeLoot(l)
  }

  // --- Saves (see saves.ts) -------------------------------------------------------------------

  /** Back from a save: where they wake (if that's still somewhere to stand) and how they are. */
  private resume(sv: Survivor, saved: CharacterSave): void {
    if (saved.health > 0) sv.health = saved.health
    const at = saved.pos
    const ground = at && this.def ? heightAt(this.def.terrain, at.x, at.z) : 0
    if (at && Number.isFinite(at.x + at.y + at.z) && at.y > ground - 1) {
      sv.resume = { pos: [at.x, at.y + 0.05, at.z], yaw: at.yaw }
    } else sv.haven = true
  }

  /** Puts one character into the saves (written on the next flush). Guests aren't kept. */
  private save(sv: Survivor): void {
    const player = sv.player
    if (!player.account) return
    const s = player.state
    const alive = s.alive && player.health > 0
    // Somewhere to come back to: alive, not turning, and none of the dead right there.
    const safe =
      alive &&
      !sv.turning &&
      !this.pool.some((z) => z.state.alive && dist(z.state.pos, s.pos) < UNSAFE_NEAR)
    this.game.saves.putCharacter(player.account, {
      name: player.name,
      self: { ...sv.self, light: false },
      kit: alive ? kitOf(s) : sv.kit,
      reborn: sv.reborn,
      waiting: [...sv.waiting],
      health: alive ? Math.ceil(player.health) : player.maxHealth,
      ...(safe ? { pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw } } : {}),
    })
  }

  /** Everybody playing, and the world, into the saves and written out. */
  saveAll(): void {
    for (const sv of this.survivors.values()) this.save(sv)
    this.saveWorld(true)
  }

  /** The world into the saves, if it changed since it was last saved (or `always`). */
  private saveWorld(always = false): void {
    if (!this.def) return
    const world = {
      done: [...this.story.done],
      unlocks: [...this.story.unlocks],
      found: [...this.found].map((i) => this.def.pois[i]?.key ?? '').filter(Boolean),
      gates: this.gates,
      boards: [...this.boards.keys()].map((i): [number, number] => [i, this.planksAt(i)]),
    }
    const json = JSON.stringify(world)
    if (json !== this.savedWorld) {
      this.savedWorld = json
      this.game.saves.putWorld(world)
    } else if (!always) return
    void this.game.saves.flush()
  }

  /** The world as it was saved: the story's progress, the map, the gates and the barricades. */
  restoreWorld(): void {
    if (!this.def) return
    const w = this.game.saves.world
    this.story.restore(w.done, w.unlocks)
    this.def.pois.forEach((poi, i) => {
      if (w.found.includes(poi.key)) this.found.add(i)
    })
    this.gates |= w.gates
    this.game.setGates(this.gates)
    for (const [i, planks] of w.boards)
      if (this.def.spots[i] && planks > 0)
        this.boards.set(i, Math.min(planks, MAX_PLANKS) * PLANK_HP)
    setBarricades(this.game.world.physics, this.def.spots, (j) => this.planksAt(j))
    this.boardsDirty = true
    this.savedWorld = ''
    this.saveWorld()
    this.game.match.broadcast()
  }

  // --- What the game asks -------------------------------------------------------------------

  spawnFor(player: ServerPlayer): MapSpawn | null {
    const sv = this.survivors.get(player.id)
    if (!sv) return null
    const start = this.game.world.map.spawns[0] ?? null
    // Back from a save: where they logged off, or Haven if that wasn't safe.
    const resume = sv.resume
    const toHaven = sv.reborn || sv.haven
    delete sv.resume
    delete sv.haven
    if (resume) return resume
    if (!toHaven) return start
    // Somebody new walks in at Haven: by the fire, facing it.
    const haven = this.def.pois.find((p) => p.key === 'haven')
    if (!haven) return start
    // Not inside somebody already standing there (people pass through each other): of a few
    // spots along the fire's south side, the one furthest from anyone, NPCs included.
    const others: Point[] = this.def.npcs.map((n) => ({ x: n.pos[0], y: n.pos[1], z: n.pos[2] }))
    for (const p of this.game.players.values())
      if (p !== player && p.state.alive) others.push(p.state.pos)
    let best = { x: haven.x, z: haven.z + 9, room: -1 }
    for (let i = 0; i < 8 && best.room < 1.5; i++) {
      const x = haven.x + (this.random() - 0.5) * 8
      const z = haven.z + 8 + this.random() * 2
      const room = Math.min(Infinity, ...others.map((o) => Math.hypot(o.x - x, o.z - z)))
      if (room > best.room) best = { x, z, room }
    }
    return { pos: [best.x, haven.y + 0.1, best.z], yaw: 0 }
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
    // No blade: bare fists in the melee slot (they never drop, and give way to the first blade).
    const melee = bySlot('melee') ?? createWeaponState(WeaponId.Fists)
    const order = [bySlot('sidearm'), bySlot('primary'), melee].filter(
      (w): w is WeaponState => w !== undefined,
    )
    const state = createPlayerState(spawn, order[0] ?? melee, order[1] ?? null, order[2] ?? null)
    this.syncReserves(sv, state)
    if (sv.health !== undefined) player.health = Math.min(player.maxHealth, sv.health)
    delete sv.health
    return state
  }

  /** One input of someone sitting in a car (see Vehicles.ride). */
  ride(player: ServerPlayer, command: InputCommand): boolean {
    return this.vehicles.ride(player, command)
  }

  vehiclesFor(player: ServerPlayer): VehicleNet[] {
    return this.vehicles.statesFor(player)
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
      boardedAt: (me, goal) => this.boardedAt(me, goal),
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
    // Rain drowns a shot out a little; the dead further off don't hear it.
    const carries = noise * hearingScale(this.weather, true)
    for (const z of this.pool) {
      if (!z.state.alive) continue
      const d = Math.hypot(z.state.pos.x - player.state.pos.x, z.state.pos.z - player.state.pos.z)
      if (d < carries) this.zeds.get(z.id)?.alert(player.state.pos, this.now)
    }
  }

  onDamage(victim: ServerPlayer, attacker: ServerPlayer, amount: number): void {
    const zed = this.zeds.get(victim.id)
    // Shot from the dark: it comes for whoever did it.
    if (zed && isPerson(attacker)) zed.alert(attacker.state.pos, this.now)
    const sv = this.survivors.get(victim.id)
    // One bite that draws blood is all it takes (and more bites don't make it faster).
    if (sv && attacker.zombie && amount > 0 && victim.health > 0 && sv.self.infected === null) {
      sv.self.infected = INFECTION_SECONDS
      sv.dirty = true
      this.notice(victim, 'story', BITTEN_STORY)
    }
    if (sv && attacker.zombie && amount >= 8 && !sv.self.bleeding && this.random() < 0.3) {
      sv.self.bleeding = true
      sv.dirty = true
      this.notice(victim, 'warn', "You're bleeding. Bandage it.")
    }
  }

  onKill(victim: ServerPlayer, killer: ServerPlayer): void {
    this.vehicles.leave(victim)
    const zed = this.zeds.get(victim.id)
    if (zed) {
      victim.respawnAt = Number.POSITIVE_INFINITY
      const was = this.turned.get(victim.id)
      if (was) {
        // One of you: everything they carried is still on them.
        this.turned.delete(victim.id)
        this.spill(was.stuff, victim.state.pos)
        if (isPerson(killer))
          this.notice(
            killer,
            'info',
            `You put ${victim.name} down. Their things lie where they fell.`,
          )
      }
      const place = this.places[zed.home]
      if (place && !zed.hunter) place.kills.push(this.game.tick)
      if (place && zed.hunter && place.woken > 0) place.woken--
      this.story.killed(victim, zed.kind, victim.state.pos, killer)
      // Now and then one of them was carrying something.
      if (this.random() < 0.14) {
        const drop = rollLoot(this.random() < 0.5 ? 'bedroom' : 'medical', this.random)
        if (drop) this.dropAt(drop.item, drop.n, victim.state.pos, undefined, true)
        const beside = drop && ammoBeside(drop.item, this.random)
        if (beside) this.dropAt(beside.item, beside.n, victim.state.pos, undefined, true)
      }
      return
    }
    const sv = this.survivors.get(victim.id)
    if (!sv) return
    // Everything goes: backpack, guns, clothes, the pack, the money. Somebody new wakes at Haven.
    const at = { ...victim.state.pos }
    const stuff = belongings(sv.self, victim.state)
    const look = gearOf(sv.self)
    const turning = sv.turning
    sv.self = freshSelf()
    sv.kit = REBORN_KIT.map((k) => ({ ...k }))
    sv.reborn = true
    // Hollis' pistol and knife are on the cabin table again, for somebody new.
    this.clearStarters(sv)
    sv.waiting = this.allStarters()
    this.layOut(sv)
    sv.turning = false
    sv.warned = 0
    sv.dirty = true
    this.story.died(sv)
    // The new character is who they are now, even if they close the tab before waking.
    this.save(sv)
    void this.game.saves.flush()
    this.send(victim, { type: ServerMsg.Dialog, dialog: null })
    if (turning) this.rise(victim, stuff, look, at)
    else this.spill(stuff, at)
    this.notice(
      victim,
      'story',
      turning
        ? 'You turned.\n\nWhat is left of you walks the woods with everything you carried.\n\nYou wake at Haven: somebody new.'
        : 'You died.\n\nEverything you carried lies where you fell.\n\nYou wake at Haven: somebody new.',
    )
  }

  /** Everything somebody had, on the ground around `at` (quest things stay there for good). */
  private spill(stuff: readonly Stack[], at: Point): void {
    for (const s of stuff) {
      const keep = ITEMS[s.item]?.kind === 'quest'
      for (let left = s.n; left > 0; left -= 65535) {
        this.dropAt(s.item, Math.min(left, 65535), at, s.ammo, true, keep)
      }
    }
  }

  /**
   * The clock ran out: what's left of them gets up where they stood, wearing what they wore and
   * carrying all they had. Inside Haven the guards see to it first.
   */
  private rise(victim: ServerPlayer, stuff: Stack[], look: number, at: Point): void {
    const safe = this.def.pois.some((p) => p.safe && dist(at, p) < p.r + 6)
    const zombie = safe ? null : this.freeZombie(at)
    const who = victim.name
    if (!zombie) {
      this.spill(stuff, at)
      for (const sv of this.survivors.values()) {
        if (sv.player === victim) continue
        this.notice(
          sv.player,
          'warn',
          `${who} turned. The guards put them down before they got up.`,
        )
      }
      return
    }
    this.place(zombie, ZombieKind.Walker, -1, false, at)
    zombie.zombie?.face(victim.state.yaw)
    this.turned.set(zombie.id, { stuff, look })
    this.game.nameZombie(zombie, `${who} (turned)`, victim.appearance)
    for (const sv of this.survivors.values()) {
      if (sv.player === victim) continue
      const near = dist(sv.player.state.pos, at) < 150
      this.notice(
        sv.player,
        near ? 'warn' : 'info',
        near
          ? `${who} turned, right here. Put them down: they still carry everything they had.`
          : `${who} turned out there. Whatever they carried walks with them now.`,
      )
    }
  }

  /** A zombie to bring out: a free one, or else the one furthest from everybody (not one of you). */
  private freeZombie(at: Point): ServerPlayer | null {
    const free = this.pool.find((z) => !z.state.alive)
    if (free) return free
    let best: ServerPlayer | null = null
    let far = -1
    for (const z of this.pool) {
      if (this.turned.has(z.id)) continue
      const d = Math.min(
        dist(z.state.pos, at),
        ...[...this.survivors.values()].map((sv) => dist(z.state.pos, sv.player.state.pos)),
      )
      if (d > far) {
        far = d
        best = z
      }
    }
    if (best) this.game.retireZombie(best)
    return best
  }

  // --- Every tick ----------------------------------------------------------------------------

  step(): void {
    const tick = this.game.tick
    const people = [...this.survivors.values()]
    const alive = people.filter((sv) => sv.player.state.alive)

    // Reloads eat the ammunition in the backpack.
    for (const sv of alive) this.settleAmmo(sv)
    for (const sv of alive) this.shortOfBreath(sv)

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
      this.story.tick(alive)
      this.drops.step()
      this.tickDay(people)
    }
    if (tick % (SAVE_SECONDS * TICK_RATE) === 0) this.saveAll()
    else if (tick % (WORLD_SAVE_SECONDS * TICK_RATE) === 0) this.saveWorld()
    if (tick % 30 === 7) for (const sv of people) this.subscribe(sv)
    if (tick % 30 === 15) this.populate(alive)
    this.vehicles.step()
    this.story.step(TICK_DT)
    // Somebody walking with you is kept up to date often enough to look like walking.
    if (this.story.moving && tick % 12 === 3) this.game.match.broadcast()
    this.senses(alive)
    this.batter()
    if (this.boardsDirty && this.now - this.boardsSentAt > 0.2) {
      this.boardsDirty = false
      this.boardsSentAt = this.now
      this.game.match.broadcast()
    }

    for (const sv of people) {
      if (!sv.dirty) continue
      sv.dirty = false
      this.send(sv.player, { type: ServerMsg.Survival, self: sv.self })
    }
  }

  /** Dawn and dusk: everyone is told the light is changing. Gus restocks at dawn. */
  private tickDay(people: readonly Survivor[]): void {
    const phase = dayPhase(this.time)
    if (phase === this.phase) return
    this.phase = phase
    if (phase === 'dawn') this.rare = rollRareStock(this.random)
    const text = DAY_NEWS[phase]
    for (const sv of people) this.notice(sv.player, phase === 'dusk' ? 'warn' : 'info', text)
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
    if (self.infected !== null) {
      const was = infectionStage(self.infected)
      self.infected = Math.max(0, self.infected - 1)
      if (self.infected === 0) return void this.turn(sv)
      const stage = infectionStage(self.infected)
      if (stage !== was && SYMPTOMS[stage]) this.notice(player, 'warn', SYMPTOMS[stage] as string)
      // Told now and then (the client counts down in between).
      if (stage !== was || self.infected % 5 === 0) sv.dirty = true
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

  /** The clock ran out. */
  private turn(sv: Survivor): void {
    sv.turning = true
    this.game.killPlayer(sv.player.id, sv.player.id)
    sv.turning = false
  }

  /** Late in the turn, sprinting runs you out of breath much sooner. */
  private shortOfBreath(sv: Survivor): void {
    const extra = SHORT_OF_BREATH[infectionStage(sv.self.infected)]
    const s = sv.player.state
    if (!extra || s.winded || Math.hypot(s.vel.x, s.vel.z) < 6.2) return
    s.stamina = Math.max(0, s.stamina - (TICK_DT / 9) * extra)
    if (s.stamina === 0) s.winded = true
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
    mine?: { owner: number; starter: number },
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
      ...mine,
    }
    this.loot.set(id, loot)
    const cell = this.cellOf(pos.x, pos.z)
    const set = this.cells.get(cell) ?? new Set()
    set.add(id)
    this.cells.set(cell, set)
    const msg = { type: ServerMsg.Loot, add: [lootItem(loot)], remove: [] as number[] }
    for (const sv of this.survivors.values())
      if (sv.cells.has(cell) && sees(sv, loot)) this.send(sv.player, msg)
  }

  private removeLoot(loot: Loot): void {
    this.loot.delete(loot.id)
    const cell = this.cellOf(loot.x, loot.z)
    this.cells.get(cell)?.delete(loot.id)
    const msg = { type: ServerMsg.Loot, add: [] as LootItem[], remove: [loot.id] }
    for (const sv of this.survivors.values())
      if (sv.cells.has(cell) && sees(sv, loot)) this.send(sv.player, msg)
  }

  /** Drops something on the ground at (about) `at` (`keep`: it never rots away). */
  private dropAt(
    item: string,
    n: number,
    at: Point,
    ammo?: number,
    scatter = false,
    keep = false,
  ): void {
    const a = this.random() * Math.PI * 2
    const r = scatter ? 0.3 + this.random() * 0.7 : 0.5
    const x = at.x + Math.cos(a) * r
    const z = at.z + Math.sin(a) * r
    // On the floor you're standing on, or the ground if it's higher.
    const y = Math.max(at.y, heightAt(this.def.terrain, x, z)) + 0.05
    const until = keep ? 0 : this.game.tick + DROPPED_SECONDS * TICK_RATE
    this.addLoot(item, n, { x, y, z }, -1, ammo, until)
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
        if (loot && sees(sv, loot)) add.push(lootItem(loot))
      }
    }
    for (const cell of sv.cells) {
      if (want.has(cell)) continue
      for (const id of this.cells.get(cell) ?? []) {
        const loot = this.loot.get(id)
        if (loot && sees(sv, loot)) remove.push(id)
      }
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
        if (!first && this.random() < 0.35) return
        const [x, y, z] = spot.pos
        // Often a second thing lies beside the first (but a home keeps only the one gun).
        const count = spot.table !== 'homegun' && this.random() < 0.35 ? 2 : 1
        for (let k = 0; k < count; k++) {
          const roll = rollLoot(spot.table, this.random)
          if (!roll) continue
          const weapon = ITEMS[roll.item]?.weapon
          // Guns are found with a few rounds in them, if any.
          const ammo =
            weapon === undefined
              ? undefined
              : Math.floor(this.random() * (WEAPONS[weapon].magSize + 1) * 0.6)
          const at = { x: x + k * 0.28, y, z: z + k * 0.12 }
          this.addLoot(roll.item, roll.n, at, s, ammo)
          // And a couple of loose rounds for it lie right next to it.
          const beside = ammoBeside(roll.item, this.random)
          if (beside) {
            const a = this.random() * Math.PI * 2
            const near = { x: at.x + Math.cos(a) * 0.3, y, z: at.z + Math.sin(a) * 0.3 }
            this.addLoot(beside.item, beside.n, near, s)
          }
        }
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
    // In a car, E gets you out.
    if (this.vehicles.seatOf(player)) return void this.vehicles.use(player)
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

    // Somebody to talk to: the people of Haven, or someone walking with you.
    let npc: string | null = null
    let best = 0.3
    for (const n of [...this.def.npcs, ...this.story.talkables()]) {
      const score = aimAt(n.pos[0], n.pos[1] + 1.4, n.pos[2], TALK_REACH)
      if (score > best) {
        best = score
        npc = n.key
      }
    }
    if (npc) return void this.story.talk(sv, npc)

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
        if (!l || !sees(sv, l)) continue
        const score = aimAt(l.x, l.y, l.z, REACH)
        if (score > lootScore) {
          lootScore = score
          loot = l
        }
      }
    }
    // A doorway or window to board up (or pull a plank off).
    let spot = -1
    let spotScore = 0.35
    this.def.spots.forEach((p, i) => {
      const c = spotCentre(p)
      const score = aimAt(c.x, c.y, c.z, BOARD_REACH)
      if (score > spotScore) {
        spotScore = score
        spot = i
      }
    })
    if (loot && (!thing || lootScore >= best) && (spot < 0 || lootScore >= spotScore)) {
      return void this.take(sv, loot)
    }
    if (spot >= 0 && (!thing || spotScore >= best)) return void this.board(sv, spot)
    if (thing) return void this.useThing(sv, thing)
    // Beside a car: fix it with what you carry, or get in.
    const pack = {
      has: (item: string) => countOf(sv.self.inv, item) > 0,
      take: (item: string) => {
        takeStack(sv.self.inv, item, 1)
        sv.dirty = true
      },
    }
    if (this.vehicles.use(player, pack)) return

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

  // --- Barricades ---------------------------------------------------------------------------

  /** Planks across gap i (0 = open). */
  planksAt(i: number): number {
    return planksFor(this.boards.get(i) ?? 0)
  }

  private setBoard(i: number, hp: number): void {
    const before = this.planksAt(i)
    if (hp > 0) this.boards.set(i, hp)
    else this.boards.delete(i)
    // Every blow is sent (the client hears it land); the colliders change only with the planks.
    this.boardsDirty = true
    if (this.planksAt(i) === before) return
    setBarricades(this.game.world.physics, this.def.spots, (j) => this.planksAt(j))
  }

  /**
   * E at a doorway or window: nail a plank across it, or (crouching) pull one off. Hammering
   * carries: everything nearby hears it.
   */
  private board(sv: Survivor, i: number): void {
    const { player, self } = sv
    const spot = this.def.spots[i]
    if (!spot || this.now < sv.boardAt) return
    sv.boardAt = this.now + 0.45
    const planks = this.planksAt(i)
    if (player.state.crouched) {
      if (planks === 0) return void this.notice(player, 'info', 'Nothing nailed up here.')
      if (give(self, PLANK_ITEM, 1) < 1) {
        return void this.notice(player, 'warn', 'No room in your pockets for the plank.')
      }
      sv.dirty = true
      this.setBoard(i, (planks - 1) * PLANK_HP)
      return
    }
    if (planks >= MAX_PLANKS) {
      return void this.notice(
        player,
        'info',
        'Boarded up as well as it gets. (Crouch and E to pull a plank off.)',
      )
    }
    if (countOf(self.inv, PLANK_ITEM) < 1) {
      return void this.notice(player, 'warn', 'You need planks to board this up.')
    }
    // Nobody standing in the gap (they'd be nailed into the wall).
    const { center, half } = spotBlock(spot)
    for (const p of this.game.players.values()) {
      if (!p.state.alive) continue
      const { x, y, z } = p.state.pos
      if (
        Math.abs(x - center[0]) < half[0] + 0.35 &&
        Math.abs(z - center[2]) < half[2] + 0.35 &&
        y < center[1] + half[1] &&
        y + 1.8 > center[1] - half[1]
      ) {
        return void this.notice(player, 'warn', "Something's in the way.")
      }
    }
    takeStack(self.inv, PLANK_ITEM, 1)
    sv.dirty = true
    sv.noise = Math.max(sv.noise, 24)
    sv.noiseUntil = this.now + 1.5
    this.setBoard(i, (planks + 1) * PLANK_HP)
  }

  /** The dead at a boarded door batter it, about once a second each. */
  private batter(): void {
    for (const zombie of this.pool) {
      const zed = this.zeds.get(zombie.id)
      if (!zed || !zombie.state.alive || zed.bashing < 0 || this.now < zed.nextBash) continue
      const hp = this.boards.get(zed.bashing) ?? 0
      if (hp <= 0) continue
      zed.nextBash = this.now + 0.9 + this.random() * 0.4
      this.setBoard(zed.bashing, hp - (KINDS[zed.kind]?.bash ?? 20))
    }
  }

  /** A boarded-up gap within arm's reach of `me` with `goal` on the other side of its wall. */
  private boardedAt(me: Point, goal: Point): { index: number; x: number; z: number } | null {
    for (const i of this.boards.keys()) {
      const spot = this.def.spots[i]
      if (!spot || me.y > spot.y + spot.h || me.y + 1.8 < spot.y) continue
      const dx = me.x - spot.x
      const dz = me.z - spot.z
      // Across the gap (along the wall's normal), and along it (within the opening).
      const [across, along] = spot.alongX ? [dz, dx] : [dx, dz]
      if (Math.abs(across) > 1.4 || Math.abs(along) > spot.w / 2 + 0.6) continue
      const goalAcross = spot.alongX ? goal.z - spot.z : goal.x - spot.x
      if (Math.sign(goalAcross) === Math.sign(across)) continue
      return { index: i, x: spot.x, z: spot.z }
    }
    return null
  }

  /** E on something lying about: into your hands, on you, or into your pockets. */
  private take(sv: Survivor, loot: Loot): void {
    this.move(sv, { g: loot.id }, { auto: true }, undefined, true)
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
    // Everything else belongs to a quest (or is a note to read).
    if (this.story.use(sv, thing)) return
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
    sv.self.bleeding = false
    sv.self.hunger = Math.max(0, sv.self.hunger - 12)
    sv.self.thirst = Math.max(0, sv.self.thirst - 16)
    player.health = player.maxHealth
    player.state.stamina = 1
    sv.dirty = true
    // Sleeping through the dark: wake at dawn.
    const t = this.time
    this.slept += (wakeTime(t) - t) * DAY_SECONDS
    this.send(player, {
      type: ServerMsg.Notice,
      notice: { kind: 'story', text: 'You sleep through the dark.\n\nYou wake at first light.' },
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
      case 'use':
        if (isItemRef(action.from)) this.use(sv, action.from)
        return
      case 'move':
        if (isItemRef(action.from) && isItemDest(action.to)) {
          this.move(sv, action.from, action.to, action.n)
        }
        return
      case 'buy':
      case 'sell': {
        const def = ITEMS[action.item]
        const n = Math.max(1, Math.min(99, Math.floor(Number(action.n)) || 1))
        if (!def) return
        if (action.a === 'buy') {
          // Whoever within reach sells it (Gus, or Ray and Lena once they do), at your price.
          const quote = this.story.quote(sv, def.id)
          if (!quote || (quote.rare && (this.rare.get(def.id) ?? 0) < n)) return
          const each = def.kind === 'ammo' ? AMMO_BOX : 1
          const price = quote.price * n
          if (self.money < price) return void this.notice(player, 'warn', "You can't afford that.")
          if (roomFor(self, def.id) < each * n)
            return void this.notice(player, 'warn', 'No room for it in your pockets or pack.')
          self.money -= price
          if (quote.rare) {
            this.rare.set(def.id, (this.rare.get(def.id) ?? 0) - n)
            if ((this.rare.get(def.id) ?? 0) <= 0) this.rare.delete(def.id)
          }
          give(
            self,
            def.id,
            each * n,
            def.weapon !== undefined ? WEAPONS[def.weapon].magSize : undefined,
          )
        } else {
          const gus = this.def.npcs.find((p) => p.role === 'trader')
          if (!gus || dist(s.pos, { x: gus.pos[0], z: gus.pos[2] }) > 6) return
          if (def.kind === 'quest' || def.kind === 'money') return
          const stack = [...self.inv].reverse().find((st) => st.item === def.id)
          if (!stack) return
          const got = takeStack(self.inv, def.id, def.kind === 'weapon' ? 1 : n)
          self.money += Math.floor(def.value * SELL_RATE * got)
        }
        return void this.touch(sv)
      }
      case 'choose':
        return void this.story.choose(sv, String(action.npc), String(action.option))
    }
  }

  // --- Pockets, the pack and what you hold (the grid: grid.ts) ---------------------------------

  /** Puts things in somebody's pockets; what doesn't fit lands at their feet. */
  private giveOrDrop(sv: Survivor, item: string, n: number, ammo?: number): void {
    const got = give(sv.self, item, n, ammo)
    if (got < n) {
      this.dropAt(item, n - got, sv.player.state.pos, ammo, false, ITEMS[item]?.kind === 'quest')
      this.notice(sv.player, 'warn', `No room for ${ITEMS[item]?.name ?? item}: it's at your feet.`)
    }
    this.touch(sv)
  }

  /** Is this lying close enough to reach from the inventory screen? */
  private within(sv: Survivor, loot: Loot): boolean {
    const p = sv.player.state.pos
    return (
      Math.hypot(loot.x - p.x, loot.z - p.z) <= VICINITY + 0.3 &&
      Math.abs(loot.y - p.y) <= VICINITY_UP
    )
  }

  /** What a reference points at, or null if there's nothing there (or it's out of reach). */
  private source(sv: Survivor, ref: ItemRef, reached: boolean): Source | null {
    const { self } = sv
    if ('g' in ref) {
      const loot = this.loot.get(ref.g)
      if (!loot || !sees(sv, loot) || (!reached && !this.within(sv, loot))) return null
      return { kind: 'ground', loot, item: loot.item, n: loot.n, ammo: loot.ammo }
    }
    if ('slot' in ref) {
      const slot = ref.slot
      if (WEAPON_SLOTS.includes(slot)) {
        const weapon = carried(sv.player.state).find((w) => WEAPONS[w.id].slot === slot)
        // Bare fists aren't a thing you can move anywhere.
        if (!weapon || weapon.id === WeaponId.Fists) return null
        return {
          kind: 'hand',
          slot: slot as WeaponSlot,
          weapon,
          item: weaponItem(weapon.id),
          n: 1,
          ammo: weapon.ammo,
        }
      }
      const item = slot === 'pack' ? self.pack : self.wear[slot as WearSlot]
      return item ? { kind: 'worn', slot: slot as WearSlot | 'pack', item, n: 1 } : null
    }
    const stack = self.inv.find((s) => s.c === ref.c && s.x === ref.x && s.y === ref.y)
    return stack ? { kind: 'grid', stack, item: stack.item, n: stack.n, ammo: stack.ammo } : null
  }

  /**
   * Right-click, or E in the world: the obvious thing. Eat it, drink it, use it; put it on or
   * take it in hand; take it off; pick it up.
   */
  private use(sv: Survivor, from: ItemRef): void {
    const src = this.source(sv, from, false)
    const def = src ? ITEMS[src.item] : undefined
    if (!src || !def) return
    if (src.kind === 'worn' || src.kind === 'hand') return void this.move(sv, from, { auto: true })
    const slot = slotFor(def.id)
    if (slot) return void this.move(sv, from, { slot })
    if (!this.consume(sv, def)) {
      // Nothing to do with it but carry it.
      if (src.kind === 'ground') this.move(sv, from, { auto: true })
      return
    }
    if (src.kind === 'grid') {
      src.stack.n--
      if (src.stack.n <= 0) sv.self.inv.splice(sv.self.inv.indexOf(src.stack), 1)
    } else if (src.kind === 'ground') this.takeFromGround(src.loot, 1)
    this.touch(sv)
  }

  /** Eats, drinks or uses one of something; false if it isn't that kind of thing (or not now). */
  private consume(sv: Survivor, def: ItemDef): boolean {
    const { self, player } = sv
    const s = player.state
    if (def.infection === 'cure' && self.infected === null) {
      this.notice(player, 'info', "You're not infected. Keep it: you will be.")
      return false
    }
    if (def.battery) {
      self.battery = Math.min(100, self.battery + def.battery)
      return true
    }
    if (def.kind !== 'food' && def.kind !== 'drink' && def.kind !== 'med') return false
    if (def.infection && self.infected !== null) {
      const cure = def.infection === 'cure'
      self.infected = cure ? null : INFECTION_SECONDS
      this.notice(
        player,
        cure ? 'story' : 'info',
        cure
          ? 'The serum goes in cold.\n\nThe fever breaks. Your hands are your own again.\n\nYou are clean.'
          : 'The adrenaline burns through you. The fever backs off. For now.',
      )
    }
    if (def.health)
      player.health = Math.max(1, Math.min(player.maxHealth, player.health + def.health))
    if (def.hunger) self.hunger = Math.max(0, Math.min(100, self.hunger + def.hunger))
    if (def.thirst) self.thirst = Math.max(0, Math.min(100, self.thirst + def.thirst))
    if (def.stamina) s.stamina = Math.min(1, s.stamina + def.stamina / 100)
    if (def.stamina) s.winded = false
    if (def.stopsBleeding) self.bleeding = false
    return true
  }

  /** Takes `n` off a pile on the ground (the rest stays where it was). */
  private takeFromGround(loot: Loot, n: number): void {
    this.removeLoot(loot)
    if (n < loot.n) this.addLoot(loot.item, loot.n - n, loot, loot.spot, loot.ammo, loot.until)
  }

  /**
   * Drag and drop, checked: moves (some of) something from a cell, a slot or the ground to a
   * cell, a slot, the ground or wherever it fits. Everything is tried on a copy first and only
   * happens if all of it works out. Taking off clothes or the pack moves what was in its pockets
   * elsewhere; if there's no room for that it stays on (dropped on the ground, it all goes with
   * it). Returns whether anything moved.
   * @param reached  the player is looking right at it (E): no need to check how far it is
   */
  private move(sv: Survivor, from: ItemRef, to: ItemDest, want?: number, reached = false): boolean {
    const { self, player } = sv
    const s = player.state
    const src = this.source(sv, from, reached)
    const def = src ? ITEMS[src.item] : undefined
    if (!src || !def) return false
    const fail = (text: string) => {
      this.notice(player, 'warn', text)
      return false
    }
    let n = want === undefined ? src.n : Math.floor(Number(want))
    if (!(n >= 1)) return false
    n = Math.min(n, src.n)
    const toGround = 'ground' in to

    // Cash goes straight in the wallet, wherever it's dragged.
    if (def.kind === 'money') {
      if (src.kind !== 'ground' || toGround) return false
      self.money += n * (def.cash ?? 1)
      this.takeFromGround(src.loot, n)
      this.notice(player, 'loot', `+ $${n * (def.cash ?? 1)}`)
      sv.dirty = true
      return true
    }
    if (src.kind === 'ground' && toGround) return false
    if ('slot' in to && (src.kind === 'worn' || src.kind === 'hand') && src.slot === to.slot) {
      return false
    }
    if (
      src.kind === 'hand' &&
      !('slot' in to) &&
      carried(s).length < 2 &&
      WEAPONS[src.weapon.id].slot !== 'melee'
    ) {
      return fail("You can't put away the last thing in your hands.")
    }

    const bag = cloneBag(self)
    const mine = src.kind === 'grid' ? (bag.inv[self.inv.indexOf(src.stack)] as Held) : null
    const max = maxStack(def.id)
    /** Onto a stack of the same thing: only as many as it has room for. */
    const onto =
      'c' in to && max > 1 ? stackAt(bag.inv, to.c, to.x, to.y) : (undefined as Held | undefined)
    const merge = onto && onto !== mine && onto.item === def.id ? onto : null
    if (merge) n = Math.min(n, max - merge.n)
    else if ('c' in to) n = Math.min(n, max)
    if (n <= 0) return false

    // 1. Out of where it was.
    let loose: Stack[] = []
    let hand: { slot: WeaponSlot; put: { id: WeaponId; ammo: number } | null } | null = null
    if (mine) {
      mine.n -= n
      if (mine.n <= 0) bag.inv.splice(bag.inv.indexOf(mine), 1)
    } else if (src.kind === 'worn') {
      if (src.slot === 'pack') bag.pack = null
      else delete bag.wear[src.slot]
      const c = containerOf(src.slot)
      if (c) loose = loosen(bag, c)
    } else if (src.kind === 'hand') hand = { slot: src.slot, put: null }

    // 2. Into where it goes.
    const drops: Stack[] = []
    const ammo = src.ammo
    let old: Stack | null = null
    let wore = false
    let into: EquipSlot | null = 'slot' in to ? to.slot : null
    if ('auto' in to && src.kind === 'ground') {
      // Picked up: a weapon into an empty hand, clothes or a pack straight on if that's bare.
      const slot = slotFor(def.id)
      const empty =
        slot === 'pack'
          ? !bag.pack
          : slot && WEAPON_SLOTS.includes(slot)
            ? !carried(s).some((w) => WEAPONS[w.id].slot === slot && w.id !== WeaponId.Fists)
            : slot
              ? !bag.wear[slot as WearSlot]
              : false
      if (slot && empty) into = slot
    }
    if (toGround) drops.push({ item: def.id, n, ...(ammo !== undefined ? { ammo } : {}) })
    else if (into) {
      if (slotFor(def.id) !== into) return fail(`The ${def.name} doesn't go there.`)
      n = 1
      if (WEAPON_SLOTS.includes(into)) {
        const was = carried(s).find((w) => WEAPONS[w.id].slot === into)
        if (was && was.id !== WeaponId.Fists)
          old = { item: weaponItem(was.id), n: 1, ammo: was.ammo }
        hand = { slot: into as WeaponSlot, put: { id: def.weapon as WeaponId, ammo: ammo ?? 0 } }
      } else {
        const was = into === 'pack' ? bag.pack : bag.wear[into as WearSlot]
        if (was) old = { item: was, n: 1 }
        if (into === 'pack') bag.pack = def.id
        else bag.wear[into as WearSlot] = def.id
        const c = containerOf(into)
        if (c) loose.push(...loosen(bag, c))
        wore = true
      }
    } else if ('auto' in to) {
      const got = give(bag, def.id, n, ammo)
      if (got === 0 || (got < n && src.kind !== 'ground')) {
        return fail(`No room for the ${def.name}.`)
      }
      n = got
    } else if (merge) merge.n += n
    else if ('c' in to) {
      const [w, h] = footprint(def.id, to.r)
      if (!fitsAt(bag, to.c, to.x, to.y, w, h)) return fail("It doesn't fit there.")
      const placed: Held = { item: def.id, n, c: to.c, x: to.x, y: to.y }
      if (to.r === 1) placed.r = 1
      if (ammo !== undefined) placed.ammo = ammo
      bag.inv.push(placed)
    } else return false

    // 3. What was in the pockets of clothes that came off goes back in (or with it, onto the
    // ground); then what was in the slot before.
    const left = regive(bag, loose)
    if (left.length > 0) {
      if (!toGround) return fail('No room for what was in its pockets. Make some first.')
      drops.push(...left)
    }
    if (old && give(bag, old.item, 1, old.ammo) < 1) drops.push(old)

    // It all works out: make it so.
    self.inv = bag.inv
    self.wear = bag.wear
    self.pack = bag.pack
    if (src.kind === 'ground') {
      // Your own starter thing: once it's off the table it isn't put out for you again.
      const starter = src.loot.starter
      if (starter !== undefined) sv.waiting = sv.waiting.filter((i) => i !== starter)
      this.takeFromGround(src.loot, n)
    }
    if (hand) this.setHand(s, hand.slot, hand.put)
    for (const d of drops) {
      this.dropAt(d.item, d.n, s.pos, d.ammo, false, ITEMS[d.item]?.kind === 'quest')
    }
    if (wore) this.notice(player, 'info', `You put on the ${def.name}.`)
    else if (src.kind === 'ground') {
      this.notice(player, 'loot', `+ ${def.name}${n > 1 ? ` ×${n}` : ''}`)
    }
    this.touch(sv)
    return true
  }

  /**
   * Puts a weapon in one of the three slots (or empties it), as the grid says. Bare fists fill
   * the melee slot whenever no blade does, and give way to the first; somebody holding up only
   * their fists takes a new weapon straight in hand.
   */
  private setHand(
    s: PlayerState,
    slot: WeaponSlot,
    put: { id: WeaponId; ammo: number } | null,
  ): void {
    const all = carried(s)
    const old = all.find((w) => WEAPONS[w.id].slot === slot)
    if (!put) {
      if (!old || old.id === WeaponId.Fists) return
      if (slot === 'melee') {
        const fists = createWeaponState(WeaponId.Fists)
        replaceCarried(s, old, fists)
        if (s.weapon === fists) fists.draw = WEAPONS[WeaponId.Fists].drawTime
        return
      }
      if (all.length < 2) return
      const rest = all.filter((c) => c !== old)
      const hand = s.weapon === old ? (rest[0] as WeaponState) : s.weapon
      if (hand !== s.weapon) hand.draw = WEAPONS[hand.id].drawTime
      const others = rest.filter((c) => c !== hand)
      s.weapon = hand
      s.holstered = others[0] ?? null
      s.pocket = others[1] ?? null
      return
    }
    const w = createWeaponState(put.id, (this.random() * 0xffffffff) >>> 0)
    w.ammo = Math.min(put.ammo, WEAPONS[put.id].magSize)
    if (old) replaceCarried(s, old, w)
    else if (s.weapon.id === WeaponId.Fists) {
      // Fists up: the new weapon goes in your hand, the fists to "last used".
      s.pocket = s.holstered
      s.holstered = s.weapon
      s.weapon = w
    } else if (!s.holstered) s.holstered = w
    else s.pocket = w
    if (s.weapon === w) w.draw = WEAPONS[put.id].drawTime
  }

  // --- People and the story ---------------------------------------------------------------

  /** Places somebody walks into go on everyone's map. */
  private discover(alive: readonly Survivor[]): void {
    this.def.pois.forEach((poi, i) => {
      if (this.found.has(i)) return
      if (!alive.some((sv) => dist(sv.player.state.pos, poi) < poi.r + 12)) return
      this.found.add(i)
      if (!QUIET_FINDS.includes(poi.kind)) {
        this.noticeAll('quest', `Found: ${poi.name}`)
      }
      this.game.match.broadcast()
    })
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
    const weather = this.weather
    for (const sv of alive) {
      const s = sv.player.state
      // Nobody is hunted inside a safe place.
      if (this.def.pois.some((p) => p.safe && !this.story.besieged(p) && dist(s.pos, p) < p.r + 4))
        continue
      const worn = wornStats(sv.self)
      out.push({
        id: sv.player.id,
        pos: s.pos,
        yaw: s.yaw,
        pitch: s.pitch,
        crouched: s.crouched,
        prone: s.prone,
        noise: this.noiseOf(sv, weather),
        light: sv.self.light,
        hidden: worn.stealth,
      })
    }
    return out
  }

  /**
   * How far someone can be heard right now (m): their steps (less in quiet clothes), or the
   * last loud thing they did. Rain on the leaves drowns out footsteps, and a shot a little.
   */
  private noiseOf(sv: Survivor, weather: Weather): number {
    const s = sv.player.state
    const speed = Math.hypot(s.vel.x, s.vel.z)
    const steps = s.prone ? 1 : s.crouched ? 2.5 : speed > 6 ? 16 : speed > 1 ? 7 : 0
    return Math.max(
      steps * (1 - wornStats(sv.self).quiet) * hearingScale(weather),
      this.now < sv.noiseUntil ? sv.noise * hearingScale(weather, true) : 0,
      // A running engine carries.
      this.vehicles.noiseOf(sv.player) * hearingScale(weather, true),
    )
  }

  /** How far the dead hear this person right now (m; 0 for nobody). */
  heardFrom(player: ServerPlayer): number {
    const sv = this.survivors.get(player.id)
    return sv ? this.noiseOf(sv, this.weather) : 0
  }

  /** Each of the dead looks and listens a few times a second (spread over the ticks). */
  private senses(alive: readonly Survivor[]): void {
    const tick = this.game.tick
    let prey: Prey[] | null = null
    let seeing = 1
    const clear = (a: Point, b: Point) => this.game.lineClear(a, b)
    for (const z of this.pool) {
      if (!z.state.alive) continue
      const zed = this.zeds.get(z.id)
      if (!zed) continue
      const stalker = zed.kind === ZombieKind.Stalker
      if (!stalker && (tick + z.id) % 15 !== 0) continue
      if (stalker && (tick + z.id) % 4 !== 0) continue
      if (!prey) {
        prey = this.prey(alive)
        // Fog and rain close in; lightning lights everything up for a moment.
        seeing = sightScale(
          this.weather,
          flashAt(this.weatherSeed, this.weatherClock, this.weatherPin ?? undefined),
        )
      }
      if (stalker) zed.watch(z, prey, clear)
      if ((tick + z.id) % 15 >= 4 && stalker) continue
      if (zed.sense(z, prey, this.now, this.light, clear, seeing) === 'scream') this.scream(z)
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
      const turned = this.turned.get(z.id)
      // One of you who turned stays out there (with their things) until somebody finds them.
      const far = !turned && nearest(z.state.pos) > ZED_RANGE
      const safe = this.def.pois.some((p) => p.safe && dist(z.state.pos, p) < p.r + 6)
      if (!(far || (safe && !zed?.siege) || !zed)) continue
      if (turned) {
        this.turned.delete(z.id)
        this.spill(turned.stuff, z.state.pos)
      }
      this.game.retireZombie(z)
    }
    if (people.length === 0) return
    // Places the dead gave up to people who have since left: take them back (keeping two free).
    while (this.pool.length < POOL && this.game.players.size < MAX_PLAYERS - 2) {
      const zombie = this.game.addZombie(new Zed(this.random))
      if (!zombie) break
      this.pool.push(zombie)
      this.zeds.set(zombie.id, zombie.zombie as Zed)
    }
    const free = () => this.pool.find((z) => !z.state.alive)
    const active = this.pool.filter((z) => z.state.alive)
    const dark = this.light < 0.3
    // Fewer by day, more at night; a few more with more people about.
    const scale = (dark ? 1.3 : 1.15 - this.light * 0.45) * (1 + 0.15 * (people.length - 1))

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
      const want = Math.round((dark ? 3.5 : 2) * scale)
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
    // Somebody's turned body back in the pool is just one of the dead again.
    this.turned.delete(zombie.id)
    this.game.nameZombie(zombie, 'Zombie')
    const health = (KINDS[kind]?.health ?? 200) * (1 + 0.15 * Math.max(0, this.survivors.size - 1))
    this.game.placeZombie(
      zombie,
      { pos: [pos.x, pos.y + 0.1, pos.z], yaw: this.random() * Math.PI * 2 },
      Math.round(health),
    )
    zed.speedChanged()
    this.game.applyRules(zombie)
  }

  /** What the story (story.ts) gets to do here. Items go through count/take/give alone. */
  private storyHost(): StoryHost {
    const sv = (p: { player: ServerPlayer }) => this.survivors.get(p.player.id)
    return {
      def: () => this.def,
      now: () => this.now,
      random: this.random,
      people: () => [...this.survivors.values()],
      count: (p, item) => countOf(p.self.inv, item),
      take: (p, item, n) => {
        takeStack(p.self.inv, item, n)
      },
      give: (p, item, n) => {
        const weapon = ITEMS[item]?.weapon
        const s = sv(p)
        if (s)
          this.giveOrDrop(s, item, n, weapon === undefined ? undefined : WEAPONS[weapon].magSize)
      },
      touch: (p) => {
        const s = sv(p)
        if (s) this.touch(s)
      },
      notice: (player, kind, text, title) =>
        this.send(player, {
          type: ServerMsg.Notice,
          notice: { kind, text, ...(title ? { title } : {}) },
        }),
      dialog: (player, dialog) => this.send(player, { type: ServerMsg.Dialog, dialog }),
      broadcast: () => this.game.match.broadcast(),
      wake: (key) => this.wake(key),
      openGate: (i) => {
        this.gates |= 1 << i
        this.game.setGates(this.gates)
      },
      reveal: () => {
        this.def.pois.forEach((p, i) => {
          if (p.hidden) this.found.add(i)
        })
      },
      horde: (key, n) => {
        const place = this.places[this.def.pois.findIndex((p) => p.key === key)]
        if (place) place.woken = n > 0 ? Math.max(place.woken, n) : 0
      },
      spawnZed: (at, kind, o) => {
        const zombie = this.freeZombie(at)
        const zed = zombie && this.zeds.get(zombie.id)
        if (!zombie || !zed) return null
        this.place(zombie, kind as ZombieKind, -1, o.hunter === true, at)
        zed.siege = o.siege === true
        if (o.name) this.game.nameZombie(zombie, o.name)
        return zombie
      },
      steer: (zombie, goal) => this.zeds.get(zombie.id)?.alert(goal, this.now),
      unsiege: (zombie) => {
        const zed = this.zeds.get(zombie.id)
        if (zed) zed.siege = false
      },
      zombies: () => this.pool.filter((z) => z.state.alive),
      rare: () => this.rare,
    }
  }

  /** What the supply drops (drops.ts) get to do here. */
  private dropHost(): DropHost {
    return {
      def: () => this.def,
      random: this.random,
      now: () => this.now,
      done: () => this.story.done,
      people: () =>
        [...this.survivors.values()]
          .filter((sv) => sv.player.state.alive)
          .map((sv) => sv.player.state.pos),
      addLoot: (item, n, at, ammo, until) => {
        const id = this.nextLoot
        this.addLoot(item, n, at, -1, ammo, Math.round(until * TICK_RATE))
        return id
      },
      hasLoot: (id) => this.loot.has(id),
      alertNear: (at, radius) => {
        for (const z of this.pool) {
          if (!z.state.alive || dist(z.state.pos, at) > radius) continue
          const r = () => (this.random() - 0.5) * 8
          this.zeds.get(z.id)?.alert({ x: at.x + r(), y: at.y, z: at.z + r() }, this.now)
        }
      },
      spawnZombie: (at, kind, goal) => {
        const zombie = this.pool.find((z) => !z.state.alive)
        if (!zombie) return false
        this.place(zombie, kind, -1, false, at)
        this.zeds.get(zombie.id)?.alert(goal, this.now)
        return true
      },
      tell: (kind, text) => {
        for (const sv of this.survivors.values())
          this.notice(sv.player, kind, text(sv.player.state.pos))
      },
      broadcast: () => this.game.match.broadcast(),
    }
  }

  // --- Admin (moderation.ts) and checks (soak test) -----------------------------------------

  /** Ids of the pooled dead. */
  get poolIds(): number[] {
    return this.pool.map((z) => z.id)
  }

  /** Winds the day's clock forward to `t` (0–1, see daytime.ts); everybody sees it at once. */
  setTime(t: number): void {
    this.slept += ((((t - this.time) % 1) + 1) % 1) * DAY_SECONDS
    this.game.match.broadcast()
  }

  /** Into someone's pockets (what doesn't fit lands at their feet). False: no such item or person. */
  adminGive(player: ServerPlayer, item: string, n: number): boolean {
    const sv = this.survivors.get(player.id)
    const def = ITEMS[item]
    if (!sv || !def) return false
    const ammo = def.weapon !== undefined ? WEAPONS[def.weapon].magSize : undefined
    this.giveOrDrop(sv, item, n, ammo)
    return true
  }

  /** Out of any car seat (before being moved somewhere else). */
  unseat(player: ServerPlayer): void {
    this.vehicles.leave(player)
  }

  /** Starts someone's character over: fresh pockets, kit and journal, back at the start. */
  resetCharacter(player: ServerPlayer): boolean {
    if (!this.survivors.has(player.id)) return false
    this.onLeave(player)
    if (player.account) this.game.saves.forgetCharacter(player.account)
    this.onJoin(player)
    this.game.respawnNow(player)
    return true
  }

  // --- Telling people ------------------------------------------------------------------------

  info(): SurvivalShared {
    return {
      time: this.time,
      gates: this.gates,
      ...this.story.shared(),
      found: [...this.found],
      won: this.won,
      boards: [...this.boards].flatMap(([i, hp]) => [i, Math.round(hp)]),
      drops: this.drops.shared(),
      weather: {
        seed: this.weatherSeed,
        clock: this.weatherClock,
        kind: this.weather.kind,
        ...(this.weatherPin ? { pin: this.weatherPin } : {}),
      },
    }
  }

  /** What someone wears that shows (gear.ts looks, packed for the wire). */
  gearOf(player: ServerPlayer): number {
    const sv = this.survivors.get(player.id)
    return sv ? gearOf(sv.self) : (this.turned.get(player.id)?.look ?? 0)
  }

  /** Damage after what someone wears: helmets take head hits, vests and jackets the rest. */
  armour(victim: ServerPlayer, head: boolean, amount: number): number {
    const sv = this.survivors.get(victim.id)
    if (!sv) return amount
    const worn = wornStats(sv.self)
    const stops = Math.min(0.8, head ? worn.headArmour : worn.bodyArmour)
    return Math.max(1, Math.round(amount * (1 - stops)))
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

const gearOf = (self: SurvivalSelf) => gearLooks(Object.values(self.wear))

/** Everything somebody has: the backpack, the guns in hand, what they wear, the pack and cash. */
function belongings(self: SurvivalSelf, state: PlayerState): Stack[] {
  // One pile per thing (weapons each their own: they keep their rounds).
  const out: Stack[] = []
  for (const { item, n, ammo } of self.inv) {
    const same = ITEMS[item]?.kind !== 'weapon' && out.find((s) => s.item === item)
    if (same) same.n += n
    else out.push({ item, n, ...(ammo !== undefined ? { ammo } : {}) })
  }
  for (const w of carried(state))
    if (w.id !== WeaponId.Fists) out.push({ item: weaponItem(w.id), n: 1, ammo: w.ammo })
  for (const id of Object.values(self.wear)) if (id) out.push({ item: id, n: 1 })
  if (self.pack) out.push({ item: self.pack, n: 1 })
  if (self.money > 0) out.push({ item: 'cash', n: self.money })
  return out
}

/** The weapons somebody carries, as what to give them back. */
function kitOf(state: PlayerState): Survivor['kit'] {
  return carried(state)
    .filter((w) => w.id !== WeaponId.Fists)
    .map((w) => ({ id: w.id, ammo: w.ammo }))
}

/** Whether a client is told about (and may take) a thing: everybody's, or their very own. */
function sees(sv: Survivor, loot: Loot): boolean {
  return loot.owner === undefined || loot.owner === sv.player.id
}

/** What a client is told about a thing on the ground (not whose it is). */
function lootItem(loot: Loot): LootItem {
  return { id: loot.id, item: loot.item, n: loot.n, x: loot.x, y: loot.y, z: loot.z }
}

/** Swaps one carried weapon for another in the same place (hand, holster or pocket). */
function replaceCarried(s: PlayerState, old: WeaponState, w: WeaponState): void {
  if (s.weapon === old) s.weapon = w
  else if (s.holstered === old) s.holstered = w
  else if (s.pocket === old) s.pocket = w
}
