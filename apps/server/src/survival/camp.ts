import {
  type CampSave,
  type CampShared,
  campStock,
  DAWN,
  DAY_SECONDS,
  DIG_REACH,
  DONATION,
  DONATION_BOX_KEY,
  dawnsBetween,
  daysToRed,
  freshCamp,
  GRAVE_STASH,
  GREENHOUSE_PRICE,
  HAVEN_FIRE,
  HAVEN_MAX_LEVEL,
  healPrice,
  heightAt,
  ITEMS,
  MAX_GRAVES,
  MORALE,
  MORALE_BOARD_KEY,
  MORALE_LOW,
  moraleTier,
  moraleWord,
  NIGHTFALL,
  nextToLeave,
  PROJECT_BOARD_KEY,
  priceFactor,
  RED_AT_FIRE,
  RED_HP,
  RED_INSIDE,
  RED_MOST,
  RED_NIGHT_EVERY,
  RED_WAVE_GAP,
  RED_WAVES,
  type RedPhase,
  type RemainsShared,
  readCamp,
  redPhase,
  SHOVEL,
  type SiegeState,
  WALL_INSIDE,
  WATCHTOWER_WAVE_GAP,
  WELL_DAY_TOLL,
  ZombieKind,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import { Projects } from './projects.ts'
import type { Person, StoryHost } from './story.ts'

/** Haven's palisade runs this far either side of the camp's middle (m); the gate is north. */
const WALL = 29
/** Within this of Haven (beyond its radius) a death costs the camp, and defenders count (m). */
const NEAR = 90
/** One of the dead this close to the fire has reached it (m). */
const AT_FIRE = 3.5
/** The dead of a Red Night come out of the trees this far north of the gate (m). */
const SPAWN_NEAR = 70
const SPAWN_FAR = 110
/** Bodies of strangers stay buriable this long; the named ones a whole day (s). */
const REMAINS_STRANGER = 15 * 60
const REMAINS_NAMED = 32 * 60
const MOST_REMAINS = 40
/** What everyone on the wall gets for holding a Red Night. */
const PAY = 40
/** How many of Haven's people are taken when a Red Night is lost. */
const TAKEN = 2

/** What the camp gets to do in the world (the director: see director.ts). */
export interface CampHost
  extends Pick<
    StoryHost,
    | 'def'
    | 'now'
    | 'random'
    | 'people'
    | 'count'
    | 'take'
    | 'give'
    | 'touch'
    | 'notice'
    | 'dialog'
    | 'broadcast'
    | 'spawnZed'
    | 'steer'
    | 'unsiege'
  > {
  /** The world's clock in whole and part days, never going back while the server runs. */
  days(): number
  /** The day's clock, 0–1 (SurvivalShared.time). */
  time(): number
  /** Another siege is on at Haven (the story's): the Red Night waits a day. */
  busy(): boolean
  /** Who owns what somebody buries (their account, or their name without one). */
  owner(p: Person): string
  /** Their stack of `item` last put in the pockets or pack (to bury), taken out; null if none. */
  takeLast(p: Person): { item: string; n: number; ammo?: number } | null
  /** Crouching. */
  crouched(p: Person): boolean
}

interface RedNight {
  hp: number
  wave: number
  nextWave: number
  zeds: Set<ServerPlayer>
  /** Those that reached the fire (they cost the camp once). */
  atFire: Set<ServerPlayer>
}

interface Remains {
  name: string
  x: number
  y: number
  z: number
  until: number
}

/**
 * Haven as a living place (shared/survival/camp.ts): the day count and the Red Night every
 * week, the camp's morale and what it does, the people who leave, and graves.
 */
export class Camp {
  private readonly host: CampHost
  /** What the world remembers (WorldSave.camp). */
  state: CampSave = freshCamp()
  private red: RedNight | null = null
  /** The clock (days) when it was last looked at. */
  private seen: number | null = null
  /** What was last announced ("eve:12"), so each is said once. */
  private told = ''
  /** The day whose night has had its Red Night (or was put off). */
  private fought = -1
  /** The day whose night had one of the gone walk the woods. */
  private haunted = -1
  private remains: Remains[] = []
  /** What Haven is building together (projects.ts). */
  readonly projects: Projects

  constructor(host: CampHost) {
    this.host = host
    this.projects = new Projects({
      people: () => host.people(),
      count: (p, item) => host.count(p, item),
      take: (p, item, n) => host.take(p, item, n),
      touch: (p) => host.touch(p),
      notice: (player, kind, text, title) => host.notice(player, kind, text, title),
      dialog: (player, dialog) => host.dialog(player, dialog),
      broadcast: () => host.broadcast(),
      cheer: (n) => this.cheer(n),
      day: () => this.state.day,
    })
  }

  /** The world as saved (or a fresh one). */
  restore(raw: unknown): void {
    this.end()
    this.state = readCamp(raw)
    this.projects.restore(this.state.projects)
    this.seen = null
    this.told = ''
    this.remains = []
  }

  reset(): void {
    this.restore(undefined)
  }

  /** For the world save. */
  save(): CampSave {
    return JSON.parse(JSON.stringify({ ...this.state, projects: this.projects.save() })) as CampSave
  }

  get morale(): number {
    return this.state.morale
  }

  /** The world's day (counted from dawn to dawn). */
  get day(): number {
    return this.state.day
  }

  /** The Red Night's phase now, or null. */
  get phase(): RedPhase | null {
    return redPhase(this.state.day, this.state.nextRed, this.host.time())
  }

  /** Raises (or lowers) the camp's morale, within 0–100. */
  cheer(n: number): void {
    const before = Math.round(this.state.morale)
    this.state.morale = Math.max(0, Math.min(100, this.state.morale + n))
    if (Math.round(this.state.morale) !== before) this.host.broadcast()
  }

  /** Something delivered, somebody brought home, a job done: the camp hears of it. */
  noted(event: 'deliver' | 'rescue' | 'quest'): void {
    this.cheer(MORALE[event])
  }

  // --- Prices and services (story.ts asks) -------------------------------------------------------

  /** What Haven's morale does to its traders and its medic. */
  terms(): { price: number; heal: number; stock: [string, number][] } {
    const m = this.state.morale
    // The greenhouse (projects.ts): food grown at home takes a little off.
    const grown = this.projects.has('greenhouse') ? GREENHOUSE_PRICE : 1
    return { price: priceFactor(m) * grown, heal: healPrice(m), stock: campStock(m) }
  }

  // --- Every second ----------------------------------------------------------------------------

  tick(): void {
    const days = this.host.days()
    const passed = this.seen === null ? 0 : dawnsBetween(this.seen, days)
    this.seen = days
    if (passed > 0) {
      // Dawn: whatever is left of the Red Night slinks off. Haven held.
      if (this.red) this.finish(true)
      for (let i = 0; i < Math.min(passed, 30); i++) this.dawn()
    }
    const now = this.host.now()
    this.remains = this.remains.filter((r) => r.until > now)
    const s = this.state
    const phase = this.phase
    const key = `${phase}:${s.nextRed}`
    if (phase && key !== this.told) {
      this.told = key
      if (phase === 'eve') this.warn()
      if (phase === 'dusk') this.horn()
      this.host.broadcast()
    }
    if (phase === 'night' && this.fought !== s.day) this.begin()
    if (this.red) this.press()
    this.haunt()
  }

  /** A new day: the days wear on people, and at low morale somebody walks out. */
  private dawn(): void {
    const s = this.state
    s.day++
    // A Red Night that never came (put off, or slept through somehow): the next is a week on.
    if (s.day > s.nextRed) s.nextRed = s.day + RED_NIGHT_EVERY - 1
    // The well (projects.ts) makes the days a little easier.
    this.cheer(MORALE.day + (this.projects.has('well') ? WELL_DAY_TOLL : 0))
    if (s.morale < MORALE_LOW) {
      const who = nextToLeave(s.gone.map((g) => g.name))
      if (who) {
        s.gone.push({ name: who, why: 'left', day: s.day })
        this.all(
          'warn',
          `${who} packed a bag in the night and walked out of Haven. Nobody stopped them.`,
        )
      }
    }
    this.host.broadcast()
  }

  /** The day before: Ortiz on the radio. */
  private warn(): void {
    const tomorrow = this.state.day === this.state.nextRed - 1
    this.all(
      'warn',
      tomorrow
        ? `Haven's radio, Ortiz: "They're massing north of the road. Tomorrow night they come for the walls. Red Night. Every gun to Haven by dusk."`
        : `Haven's radio, Ortiz: "Tonight. Red Night. Every gun to the gate by dusk."`,
    )
  }

  /** Dusk on the day: the horn, and the sky going red. */
  private horn(): void {
    this.all('warn', 'A horn from Haven, long and low. The sky is going red. Get to the walls.')
  }

  /** Nightfall on the day: they come. */
  private begin(): void {
    const s = this.state
    this.fought = s.day
    if (this.host.busy()) {
      // The story's own siege is on at the gate: they come tomorrow instead.
      s.nextRed = s.day + 1
      return
    }
    const haven = this.haven()
    if (!haven) return
    const now = this.host.now()
    if (this.host.people().length === 0) {
      // Nobody here to stand on the wall: the camp holds or not on its own spirit.
      return void this.settle(s.morale >= 40)
    }
    this.red = { hp: RED_HP, wave: 0, nextWave: now + 5, zeds: new Set(), atFire: new Set() }
    this.all(
      'warn',
      'RED NIGHT. They are coming down the road for the gate. Every gun to Haven: hold till dawn.',
    )
    this.host.broadcast()
  }

  /** Once a second of a Red Night: the waves, the dead walking in, what it costs the camp. */
  private press(): void {
    const r = this.red
    const haven = this.haven()
    if (!r || !haven) return
    const now = this.host.now()
    if (r.wave < RED_WAVES && now >= r.nextWave) {
      r.wave++
      // The watchtower (projects.ts) sees each wave coming: a little more time between them.
      r.nextWave = now + RED_WAVE_GAP + (this.projects.has('watchtower') ? WATCHTOWER_WAVE_GAP : 0)
      const near = this.host.people().filter((p) => this.near(p, haven)).length
      const n = Math.min(RED_MOST - r.zeds.size, 4 + r.wave * 2 + 2 * near)
      for (let i = 0; i < n; i++) this.spawn(haven, r)
    }
    const gate = { x: haven.x, y: haven.y, z: haven.z - WALL - 4 }
    const fire = { x: haven.x + HAVEN_FIRE[0], y: haven.y, z: haven.z + HAVEN_FIRE[1] }
    for (const z of [...r.zeds]) {
      if (!z.state.alive) {
        r.zeds.delete(z)
        continue
      }
      const at = z.state.pos
      const inside = Math.abs(at.x - haven.x) < WALL && Math.abs(at.z - haven.z) < WALL
      // The outer wall (projects.ts) slows the ones that get in.
      if (inside) r.hp -= RED_INSIDE * (this.projects.has('wall') ? WALL_INSIDE : 1)
      if (Math.hypot(at.x - fire.x, at.z - fire.z) < AT_FIRE && !r.atFire.has(z)) {
        r.atFire.add(z)
        r.hp -= RED_AT_FIRE
      }
      this.host.steer(z, at.z < haven.z - WALL - 2 ? gate : fire)
    }
    if (r.hp <= 0) return void this.finish(false)
    // Every last one of them down: Haven held, whatever the hour.
    if (r.wave >= RED_WAVES && r.zeds.size === 0) this.finish(true)
  }

  /** One of the dead, out of the trees north of the gate. */
  private spawn(haven: { x: number; z: number }, r: RedNight): void {
    const x = haven.x + (this.host.random() - 0.5) * 80
    const z = haven.z - WALL - SPAWN_NEAR - this.host.random() * (SPAWN_FAR - SPAWN_NEAR)
    const kind = this.host.random() < 0.2 + r.wave * 0.06 ? ZombieKind.Runner : ZombieKind.Walker
    const zed = this.host.spawnZed({ x, y: heightAt(this.host.def().terrain, x, z), z }, kind, {
      siege: true,
    })
    if (zed) r.zeds.add(zed)
  }

  /** The Red Night is over, one way or the other. */
  private finish(held: boolean): void {
    const r = this.red
    if (!r) return
    this.end()
    this.settle(held)
  }

  /** The siege's dead are ordinary dead again. */
  private end(): void {
    const r = this.red
    if (!r) return
    for (const z of r.zeds) this.host.unsiege(z)
    this.red = null
  }

  /** What holding or losing does to Haven. */
  settle(held: boolean): void {
    const s = this.state
    const haven = this.haven()
    const near = haven ? this.host.people().filter((p) => this.near(p, haven)) : []
    s.nextRed = s.day + RED_NIGHT_EVERY
    if (held) {
      s.wins++
      this.cheer(MORALE.held)
      // Haven grows: a boarded stall opens again, or somebody who walked out comes back, or a
      // new stall and lamps go up.
      const back = s.gone.findIndex((g) => g.why === 'left')
      let grew: string
      if (s.shut) {
        s.shut = false
        grew = 'The boarded-up stall is open again by morning.'
      } else if (back >= 0) {
        const [who] = s.gone.splice(back, 1)
        grew = `${who?.name ?? 'Somebody'} walks back in at first light. Heard Haven held.`
      } else if (s.level < HAVEN_MAX_LEVEL) {
        s.level++
        grew = 'By morning there is a new stall by the square, and more lamps on the walk.'
      } else grew = 'Somebody chalks another mark on the banner over the gate.'
      for (const p of near) {
        p.self.money += PAY
        this.host.touch(p)
      }
      this.all(
        'story',
        `Haven held.\n\nThe last of them go down in the gateway. Somebody starts laughing and can't stop. Another mark on the banner over the gate: ${s.wins}.\n\n${grew}${near.length ? `\n\n($${PAY} to everyone on the wall.)` : ''}`,
      )
    } else {
      s.losses++
      this.cheer(MORALE.fell)
      s.shut = true
      s.level = Math.max(0, s.level - 1)
      const taken: string[] = []
      for (let i = 0; i < TAKEN; i++) {
        const who = nextToLeave(s.gone.map((g) => g.name))
        if (!who) break
        s.gone.push({ name: who, why: 'taken', day: s.day })
        taken.push(who)
      }
      // They lie by the fire till somebody buries them.
      if (haven) {
        const now = this.host.now()
        taken.forEach((name, i) => {
          const x = haven.x + HAVEN_FIRE[0] - 3 + i * 6
          const z = haven.z + HAVEN_FIRE[1] + 7
          this.remains.push({ name, x, y: haven.y, z, until: now + REMAINS_NAMED })
        })
      }
      this.all(
        'story',
        `They're inside.\n\nIt takes till dawn to drive them back out through the gate. ${taken.length ? `${taken.join(' and ')} didn't see the morning.` : ''} A stall stands boarded up.\n\nNobody talks much at breakfast.`,
      )
    }
    this.host.broadcast()
  }

  /** At night, now and then, one of Haven's gone walks the woods with their name. */
  private haunt(): void {
    const s = this.state
    const u = this.host.time() % 1
    if (s.gone.length === 0 || this.haunted === s.day || !(u >= NIGHTFALL || u < DAWN - 0.1)) return
    this.haunted = s.day
    const people = this.host.people()
    if (people.length === 0 || this.host.random() < 0.5) return
    const g = s.gone[Math.floor(this.host.random() * s.gone.length)]
    const p = people[Math.floor(this.host.random() * people.length)]
    const haven = this.haven()
    if (!g || !p || !haven) return
    const at = p.player.state.pos
    // Out in the woods, never in Haven.
    if (Math.hypot(at.x - haven.x, at.z - haven.z) < haven.r + 120) return
    const a = this.host.random() * Math.PI * 2
    const x = at.x + Math.cos(a) * 70
    const z = at.z + Math.sin(a) * 70
    this.host.spawnZed({ x, y: heightAt(this.host.def().terrain, x, z), z }, ZombieKind.Walker, {
      name: `${g.name} (turned)`,
    })
  }

  // --- Deaths and bodies -----------------------------------------------------------------------

  /** Somebody died: near Haven it weighs on everyone; their body can be buried. */
  died(name: string, at: { x: number; y: number; z: number }): void {
    const haven = this.haven()
    if (haven && Math.hypot(at.x - haven.x, at.z - haven.z) < haven.r + NEAR)
      this.cheer(MORALE.death)
    this.lies(name, at, REMAINS_NAMED)
  }

  /** One of the dead is down: `name` if they were somebody (one of you, or one of Haven's). */
  downed(name: string, at: { x: number; y: number; z: number }): void {
    this.lies(name, at, name ? REMAINS_NAMED : REMAINS_STRANGER)
  }

  private lies(name: string, at: { x: number; y: number; z: number }, keep: number): void {
    this.remains.push({ name, x: at.x, y: at.y, z: at.z, until: this.host.now() + keep })
    if (this.remains.length > MOST_REMAINS) this.remains.shift()
  }

  // --- E: the board, the box, the shovel --------------------------------------------------------

  /** E on the morale board or the donation box. */
  use(p: Person, key: string): void {
    const s = this.state
    if (key === DONATION_BOX_KEY) {
      if (p.self.money < DONATION)
        return void this.host.notice(p.player, 'info', `You don't have $${DONATION} to give.`)
      p.self.money -= DONATION
      this.host.touch(p)
      this.cheer(MORALE.donate)
      return void this.host.notice(
        p.player,
        'info',
        `$${DONATION} through the slot. Somebody by the fire nods at you. (Morale ${Math.round(s.morale)})`,
      )
    }
    if (key === PROJECT_BOARD_KEY) return void this.projects.use(p)
    if (key !== MORALE_BOARD_KEY) return
    this.host.dialog(p.player, {
      npc: MORALE_BOARD_KEY,
      name: 'How we fare',
      text: this.boardText(),
      options: [{ id: 'bye', label: 'Leave it.' }],
    })
  }

  /** What the morale board says (chalk on a plank). */
  boardText(): string {
    const s = this.state
    const m = Math.round(s.morale)
    const days = daysToRed(s.day, s.nextRed)
    const red =
      this.red !== null
        ? 'RED NIGHT. NOW.'
        : days === 0
          ? 'Red Night: TONIGHT.'
          : days === 1
            ? 'Red Night: TOMORROW.'
            : `Red Night in ${days} days.`
    const tier = moraleTier(m)
    const effect =
      tier === 'high'
        ? 'Gus is generous and Lena patches people up cheap.'
        : tier === 'low'
          ? 'Prices are up. People are talking about leaving.'
          : 'Getting by.'
    const gone = s.gone.slice(-6).map((g) => `${g.name} (${g.why === 'left' ? 'left' : 'taken'})`)
    return [
      `Day ${s.day + 1}. Spirits: ${moraleWord(m)} (${m}/100). ${effect}`,
      `Nights held: ${s.wins}. Nights lost: ${s.losses}.`,
      red,
      gone.length > 0 ? `Gone: ${gone.join(', ')}.` : 'Nobody has left yet.',
      `Graves: ${s.graves.length}.`,
    ].join('\n\n')
  }

  /**
   * Crouch + E with a shovel: bury whoever lies at your feet, or at a grave, bury your latest
   * find with them or dig your things back up. False if there's nothing here for a shovel.
   */
  dig(p: Person): boolean {
    if (this.host.count(p, SHOVEL) <= 0 || !this.host.crouched(p)) return false
    const at = p.player.state.pos
    const s = this.state
    const close = (o: { x: number; z: number }) => Math.hypot(o.x - at.x, o.z - at.z) < DIG_REACH
    const body = this.remains
      .filter(close)
      .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0]
    if (body) {
      this.bury(p, body)
      return true
    }
    const grave = s.graves.find(close)
    if (!grave) return false
    const owner = this.host.owner(p)
    if (grave.stash.length > 0) {
      if (grave.owner !== owner) {
        this.host.notice(p.player, 'info', `Not yours to dig up. Let ${grave.name} rest.`)
        return true
      }
      for (const st of grave.stash) this.host.give(p, st.item, st.n)
      grave.stash = []
      this.host.notice(p.player, 'info', `You dig down to the bundle by ${grave.name}'s feet.`)
      this.host.broadcast()
      return true
    }
    if (grave.owner !== owner) {
      this.host.notice(p.player, 'info', `${grave.name} rests here.`)
      return true
    }
    const st = this.host.takeLast(p)
    if (!st) {
      this.host.notice(p.player, 'info', 'Nothing on you to leave with them.')
      return true
    }
    grave.stash.push(st)
    this.host.touch(p)
    const what = ITEMS[st.item]?.name ?? st.item
    this.host.notice(
      p.player,
      'info',
      `You bury the ${what.toLowerCase()} with ${grave.name}. Only you know it's there.${grave.stash.length >= GRAVE_STASH ? ' (No room for more.)' : ''}`,
    )
    this.host.broadcast()
    return true
  }

  private bury(p: Person, body: Remains): void {
    const s = this.state
    this.remains = this.remains.filter((r) => r !== body)
    const name = body.name || 'Unknown'
    const at = p.player.state.pos
    s.graves.push({
      id: s.nextGrave++,
      name,
      x: Math.round(body.x * 100) / 100,
      y: Math.round(body.y * 100) / 100,
      z: Math.round(body.z * 100) / 100,
      // The cross faces whoever dug it.
      yaw: Math.round(Math.atan2(-(at.x - body.x), -(at.z - body.z)) * 100) / 100,
      owner: this.host.owner(p),
      stash: [],
      day: s.day,
    })
    while (s.graves.length > MAX_GRAVES) s.graves.shift()
    this.cheer(MORALE.grave)
    this.host.notice(
      p.player,
      'info',
      `You dig, and lay ${body.name || 'them'} in it, and fill it in. Two sticks for a cross. ${body.name ? `You scratch the name: ${body.name}.` : 'You never knew the name.'}\n\n(Crouch + E at the grave to bury something with them.)`,
    )
    this.host.broadcast()
  }

  // --- What the director asks -------------------------------------------------------------------

  /** A Red Night is on at this place (its defenders are fair game). */
  besieged(poi: { x: number; z: number }): boolean {
    const h = this.red && this.haven()
    return !!h && h.x === poi.x && h.z === poi.z
  }

  /** Nobody sleeps through a Red Night. */
  noSleep(): boolean {
    const phase = this.phase
    return phase === 'dusk' || phase === 'night' || this.red !== null
  }

  /** The camp's bar for the HUD (SurvivalShared.siege) while a Red Night is on. */
  siege(): SiegeState | undefined {
    const r = this.red
    if (!r) return undefined
    // Till dawn.
    const u = ((this.host.time() % 1) + 1) % 1
    const left = Math.max(0, Math.ceil(((((DAWN - u) % 1) + 1) % 1) * DAY_SECONDS))
    return { poi: 'haven', left, hp: Math.max(0, Math.round(r.hp)) }
  }

  /** What everybody sees (SurvivalShared.camp). */
  shared(): CampShared {
    const s = this.state
    const red: RedPhase | null = this.red ? 'night' : this.phase
    const remains: RemainsShared[] = this.remains.map((r) => ({
      name: r.name,
      x: Math.round(r.x * 100) / 100,
      y: Math.round(r.y * 100) / 100,
      z: Math.round(r.z * 100) / 100,
    }))
    return {
      day: s.day,
      redIn: daysToRed(s.day, s.nextRed),
      ...(red ? { red } : {}),
      morale: Math.round(s.morale),
      wins: s.wins,
      losses: s.losses,
      level: s.level,
      ...(s.shut ? { shut: true } : {}),
      gone: s.gone.map((g) => g.name),
      projects: this.projects.shared(),
      graves: s.graves.map((g) => ({
        id: g.id,
        name: g.name,
        x: g.x,
        y: g.y,
        z: g.z,
        yaw: g.yaw,
        ...(g.stash.length > 0 ? { stash: true } : {}),
      })),
      ...(remains.length > 0 ? { remains } : {}),
    }
  }

  /** For the admin and tests: tonight is a Red Night. */
  redTonight(): void {
    this.state.nextRed = this.state.day
    this.fought = -1
  }

  /** Is a Red Night being fought right now? */
  get fighting(): boolean {
    return this.red !== null
  }

  private haven() {
    return this.host.def().pois.find((p) => p.key === 'haven')
  }

  private near(p: Person, haven: { x: number; z: number; r: number }): boolean {
    const at = p.player.state.pos
    return Math.hypot(at.x - haven.x, at.z - haven.z) < haven.r + NEAR
  }

  private all(kind: 'warn' | 'story' | 'info', text: string): void {
    for (const p of this.host.people()) this.host.notice(p.player, kind, text)
  }
}
