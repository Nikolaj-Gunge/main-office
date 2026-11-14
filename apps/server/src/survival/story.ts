import {
  AMMO_BOX,
  BOSSES,
  bossSpot,
  DAY_SECONDS,
  type Dialog,
  endingOf,
  freshJournal,
  heightAt,
  type Interactable,
  ITEMS,
  type Journal,
  LORE,
  type Notice,
  nextStep,
  noteText,
  noteTitle,
  QUESTS,
  type QuestDef,
  type QuestState,
  type QuestStep,
  questById,
  RARE_STOCK,
  type Reward,
  SHOPS,
  type SiegeState,
  type SurvivalDef,
  type SurvivalSelf,
  smallTalk,
  TRADER_STOCK,
  UNLOCKS,
  WALKERS,
  type WalkerState,
  walkerHideout,
  walkerHome,
  ZombieKind,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'

/** How close you stand to somebody to talk (m), and how far you may wander mid-conversation. */
const TALK_REACH = 3
/** A walker you rescue: how fast they walk and hurry (m/s), and how close they keep. */
const WALK = 4.2
const HURRY = 7
const KEEP = 2.4
/** Further than this from them and they stop and wait for you (m). */
const LOST = 55
/** What one of the dead next to a walker does to them (hp/s). */
const BITE = 9
/** A siege: the dead come in this many waves; this much of the camp's hp goes each second per
 * one of them inside; and after it fails, this long before it can be tried again (s). */
const WAVES = 4
const BREACH = 3
const SIEGE_COOLDOWN = 20
/** A boss turns up when somebody after it is within this of its place (m). */
const BOSS_RANGE = 90
/** Fellow survivors this close share kill and hold progress (m). */
const TOGETHER = 60
/** Dot feeds you once a day. */
const MEAL_EVERY = DAY_SECONDS

/** A survivor, as far as the story is concerned. */
export interface Person {
  player: ServerPlayer
  self: SurvivalSelf
}

/** What the story gets to do in the world (the director, see director.ts). */
export interface StoryHost {
  def(): SurvivalDef
  now(): number
  random(): number
  people(): Person[]
  /** How many of an item somebody carries; takes some; gives some (on the ground if no room). */
  count(p: Person, item: string): number
  take(p: Person, item: string, n: number): void
  give(p: Person, item: string, n: number): void
  /** Their backpack or money changed: tell them. */
  touch(p: Person): void
  notice(player: ServerPlayer, kind: Notice['kind'], text: string, title?: string): void
  dialog(player: ServerPlayer, dialog: Dialog | null): void
  broadcast(): void
  wake(poi: string): void
  openGate(i: number): void
  reveal(): void
  /** Keeps `n` of the dead hunting around a place (0 lets it calm down). */
  horde(poi: string, n: number): void
  /** One of the dead, out of the pool: a boss (named), or one of a siege. */
  spawnZed(
    at: Point,
    kind: number,
    o: { name?: string; hunter?: boolean; siege?: boolean },
  ): ServerPlayer | null
  /** Sends one of the dead towards a point (unless it's chasing someone). */
  steer(zombie: ServerPlayer, goal: Point): void
  /** A siege's dead are ordinary dead again. */
  unsiege(zombie: ServerPlayer): void
  /** Where the living dead are. */
  zombies(): ServerPlayer[]
  /** What Gus has today besides his usual stock. */
  rare(): Map<string, number>
}

interface Walker {
  key: string
  who: string
  /** The player rescuing them (0 for one who lives at Haven). */
  owner: number
  x: number
  y: number
  z: number
  yaw: number
  hp: number
  follow: number
  /** Where the one they follow has been: they walk the same way (through the same doors). */
  trail: Point[]
  /** Told the one they follow to wait for them. */
  waiting: boolean
}

interface Siege {
  poi: string
  quest: string
  ends: number
  hp: number
  wave: number
  nextWave: number
  zeds: Set<ServerPlayer>
}

/**
 * The quests: each survivor's journal, what people say to them, and the world events the story
 * sets off (people to escort, sieges, bosses). The director tells it what happens; it tells the
 * director what to do about it through the StoryHost.
 */
export class Story {
  private readonly host: StoryHost
  /** Quests somebody in this world has finished (supply drops follow it). */
  readonly done: string[] = []
  readonly unlocks: string[] = []
  private readonly walkers = new Map<string, Walker>()
  private siege: Siege | null = null
  private siegeAgain = 0
  private readonly bosses = new Map<string, ServerPlayer>()
  /** Who each person is talking to (npc or walker key). */
  private readonly talking = new Map<number, string>()
  /** When Dot last fed each person (by player id). */
  private readonly fed = new Map<number, number>()
  /** Somebody finished the story: how it ended for them (the round's headline). */
  headline: string | null = null

  constructor(host: StoryHost) {
    this.host = host
  }

  private get def(): SurvivalDef {
    return this.host.def()
  }

  /** A new night: nobody has done anything yet. */
  reset(): void {
    this.done.length = 0
    this.unlocks.length = 0
    this.walkers.clear()
    this.siege = null
    this.siegeAgain = 0
    this.bosses.clear()
    this.talking.clear()
    this.fed.clear()
    this.headline = null
  }

  /** Everybody here has seen the story through. */
  get won(): boolean {
    const people = this.host.people()
    return people.length > 0 && people.every((p) => p.self.journal.done.includes('lastlight'))
  }

  /** Somebody (new) arrives: a fresh journal starts the story, at Haven if they woke there. */
  join(p: Person, reborn: boolean): void {
    const j = p.self.journal
    if (j.quests.length === 0 && j.done.length === 0) this.begin(p, reborn ? 'keep' : 'wake')
  }

  /** Somebody died: their journal is gone with them, and whoever they were rescuing waits. */
  died(p: Person): void {
    for (const w of [...this.walkers.values()])
      if (w.owner === p.player.id) this.walkers.delete(w.key)
    for (const w of this.walkers.values()) if (w.follow === p.player.id) w.follow = 0
    this.talking.delete(p.player.id)
    p.self.journal = freshJournal()
    this.begin(p, 'keep')
  }

  left(player: ServerPlayer): void {
    for (const w of this.walkers.values()) if (w.follow === player.id) w.follow = 0
    this.talking.delete(player.id)
  }

  /** A siege is on at this safe place (its defenders are fair game). */
  besieged(poi: { x: number; z: number }): boolean {
    const s = this.siege
    const at = s && this.def.pois.find((p) => p.key === s.poi)
    return !!at && at.x === poi.x && at.z === poi.z
  }

  /** What everyone is told (part of SurvivalShared). */
  shared(): {
    done: string[]
    unlocks: string[]
    siege?: SiegeState
    walkers?: WalkerState[]
  } {
    const walkers = [...this.walkers.values()].map((w) => ({
      key: w.key,
      who: w.who,
      x: Math.round(w.x * 100) / 100,
      y: Math.round(w.y * 100) / 100,
      z: Math.round(w.z * 100) / 100,
      yaw: Math.round(w.yaw * 100) / 100,
      follow: w.follow,
      hp: Math.round(w.hp),
    }))
    const s = this.siege
    return {
      done: this.done,
      unlocks: this.unlocks,
      ...(s
        ? {
            siege: {
              poi: s.poi,
              left: Math.max(0, Math.ceil(s.ends - this.host.now())),
              hp: Math.max(0, Math.round(s.hp)),
            },
          }
        : {}),
      ...(walkers.length > 0 ? { walkers } : {}),
    }
  }

  /** People who walk, to talk to (the director looks for who you face). */
  talkables(): { key: string; name: string; pos: [number, number, number] }[] {
    return [...this.walkers.values()].map((w) => ({
      key: w.key,
      name: WALKERS[w.who]?.name ?? w.who,
      pos: [w.x, w.y, w.z],
    }))
  }

  /** Someone walking is with somebody (the director keeps the clients up to date often). */
  get moving(): boolean {
    for (const w of this.walkers.values()) if (w.follow !== 0) return true
    return false
  }

  // --- Journal --------------------------------------------------------------------------

  private begin(p: Person, id: string): void {
    const j = p.self.journal
    if (j.done.includes(id) || j.quests.some((q) => q.id === id)) return
    const def = questById(id)
    if (!def) return
    j.quests.push({ id, step: nextStep(def, 0, undefined), count: 0 })
    this.host.notice(p.player, 'quest', `${def.story ? 'Chapter' : 'New job'}: ${def.title}`)
    this.host.touch(p)
  }

  /** Is this quest there to be offered to them: not begun, not done, what it follows done? */
  private open(p: Person, def: QuestDef): boolean {
    const j = p.self.journal
    if (j.done.includes(def.id) || j.quests.some((q) => q.id === def.id)) return false
    return !def.after || j.done.includes(def.after)
  }

  private current(q: QuestState): QuestStep | undefined {
    return questById(q.id)?.steps[q.step]
  }

  /** A clue or note goes in their journal (once). */
  private learn(p: Person, key: string): void {
    const j = p.self.journal
    if (j.notes.includes(key)) return
    j.notes.push(key)
    this.host.touch(p)
  }

  /** The step is done: on to the next on their branch, or the quest is finished. */
  private advance(p: Person, q: QuestState): void {
    const def = questById(q.id)
    if (!def) return
    const step = def.steps[q.step]
    if (step?.learn) {
      this.learn(p, step.learn)
      const lore = LORE[step.learn]
      if (lore?.text) this.host.notice(p.player, 'note', lore.text, lore.title)
    }
    q.step = nextStep(def, q.step + 1, q.pick)
    q.count = 0
    this.host.touch(p)
    if (q.step < def.steps.length) {
      this.host.broadcast()
      return
    }
    this.finish(p, q, def)
  }

  private finish(p: Person, q: QuestState, def: QuestDef): void {
    const j = p.self.journal
    j.quests = j.quests.filter((x) => x !== q)
    j.done.push(def.id)
    if (q.pick !== undefined) j.flags.push(`${def.id}:${q.pick}`)
    if (!this.done.includes(def.id)) this.done.push(def.id)
    const { done, reward } = endingOf(def, q.pick)
    const got = this.pay(p, reward)
    this.host.notice(p.player, 'story', `${done}${got.length > 0 ? `\n\n+ ${got.join(', ')}` : ''}`)
    this.host.notice(p.player, 'quest', `Done: ${def.title}`)
    // The story goes on by itself.
    const next = QUESTS.find((n) => n.story && n.after === def.id)
    if (next) this.begin(p, next.id)
    else if (def.story)
      this.headline = q.pick === 'haven' ? 'Haven has a cure' : 'You made it out of Deadwood'
    this.host.touch(p)
    this.host.broadcast()
  }

  /** Hands over a reward; returns what it was, said short. */
  private pay(p: Person, reward: Reward | undefined): string[] {
    if (!reward) return []
    const got: string[] = []
    if (reward.money) {
      p.self.money += reward.money
      got.push(`$${reward.money}`)
    }
    for (const [item, n] of reward.items ?? []) {
      this.host.give(p, item, n)
      got.push(`${ITEMS[item]?.name ?? item}${n > 1 ? ` ×${n}` : ''}`)
    }
    if (reward.reveals) this.host.reveal()
    if (reward.perk && !p.self.journal.flags.includes(reward.perk)) {
      p.self.journal.flags.push(reward.perk)
    }
    if (reward.unlock && !this.unlocks.includes(reward.unlock)) {
      this.unlocks.push(reward.unlock)
      if (reward.unlock === 'nell') this.settle('nell')
    }
    this.host.touch(p)
    return got
  }

  // --- Talking ----------------------------------------------------------------------------

  /** E on somebody: they say their piece for whatever step waits on them, or pass the time. */
  talk(p: Person, key: string): void {
    const name = this.nameOf(key)
    if (!name) return
    this.talking.set(p.player.id, key)
    const walker = this.walkers.get(key)
    const who = walker?.who ?? key
    const j = p.self.journal
    for (const q of [...j.quests]) {
      const step = this.current(q)
      if (!step) continue
      if (
        step.kind === 'meet' &&
        walker &&
        walker.who === step.who &&
        walker.owner === p.player.id
      ) {
        walker.follow = p.player.id
        walker.trail = []
        this.say(p, key, step.say, [{ id: 'bye', label: "Stay close. Let's go." }])
        this.advance(p, q)
        return
      }
      if (step.kind === 'escort' && walker && walker.owner === p.player.id) {
        walker.follow = p.player.id
        walker.trail = []
        walker.waiting = false
        this.say(p, key, "I'm right behind you.", [{ id: 'bye', label: 'Move.' }])
        return
      }
      if (step.kind === 'choose' && step.npc === who) {
        this.say(p, key, step.say, [
          ...step.options.map((o) => ({ id: `pick:${q.id}:${o.id}`, label: o.label })),
          { id: 'bye', label: 'Not yet.' },
        ])
        return
      }
      if (step.kind === 'defend' && step.npc === who) {
        if (this.siege) {
          this.say(p, key, "They're at the gate! Get up there!", [{ id: 'bye', label: 'Going.' }])
          return
        }
        const wait = Math.ceil(this.siegeAgain - this.host.now())
        this.say(
          p,
          key,
          wait > 0
            ? `Give us a minute to drag the dead out of the gateway. (${wait} s)`
            : 'Everyone who can hold a gun is on the wall. You say when.',
          [
            ...(wait > 0 ? [] : [{ id: `defend:${q.id}`, label: step.ready }]),
            { id: 'bye', label: 'Not yet.' },
          ],
        )
        return
      }
      if ((step.kind !== 'talk' && step.kind !== 'fetch') || step.npc !== who) continue
      if (step.kind === 'fetch') {
        const have = this.host.count(p, step.item)
        if (have < step.n) {
          const item = ITEMS[step.item]?.name ?? step.item
          this.say(
            p,
            key,
            `I still need ${item}${step.n > 1 ? ` — ${step.n} of them. You have ${have}.` : '.'}`,
            this.options(p, key),
          )
          return
        }
        this.host.take(p, step.item, step.n)
      }
      if (step.kind === 'talk') for (const [item, n] of step.gives ?? []) this.host.give(p, item, n)
      this.say(p, key, step.say, this.options(p, key))
      this.advance(p, q)
      return
    }
    if (walker && walker.owner !== 0) {
      const line =
        walker.owner === p.player.id ? 'Lead the way.' : "You're not the one I'm waiting for."
      return void this.say(p, key, line, [{ id: 'bye', label: 'Goodbye.' }])
    }
    this.say(p, key, smallTalk(who, j, this.unlocks, this.host.random), this.options(p, key))
  }

  private nameOf(key: string): string | null {
    const npc = this.def.npcs.find((n) => n.key === key)
    if (npc) return npc.name
    const w = this.walkers.get(key)
    return w ? (WALKERS[w.who]?.name ?? w.who) : null
  }

  private options(p: Person, key: string): Dialog['options'] {
    const out: Dialog['options'] = []
    const self = p.self
    const offer = QUESTS.find((d) => d.giver === key && !d.story && this.open(p, d))
    if (offer) out.push({ id: `ask:${offer.id}`, label: 'Need a hand with anything?' })
    if (this.stock(p, key).length > 0) out.push({ id: 'shop', label: "Show me what you've got." })
    if (key === 'lena' && p.player.health < p.player.maxHealth) {
      const free = self.journal.flags.includes('lena_free')
      out.push({ id: 'heal', label: free ? 'Patch me up.' : 'Patch me up. ($40)' })
    }
    if (key === 'dot' && self.journal.flags.includes('dot_meals')) {
      out.push({ id: 'meal', label: 'Anything in the pot?' })
    }
    out.push({ id: 'bye', label: 'Goodbye.' })
    return out
  }

  private say(
    p: Person,
    key: string,
    text: string,
    options: Dialog['options'],
    shop?: Dialog['shop'],
  ): void {
    const name = this.nameOf(key) ?? key
    this.host.dialog(p.player, { npc: key, name, text, options, ...(shop ? { shop } : {}) })
  }

  /** An answer in a conversation. */
  choose(p: Person, key: string, option: string): void {
    if (this.talking.get(p.player.id) !== key) return
    const at = this.where(key)
    const pos = p.player.state.pos
    if (!at || Math.hypot(pos.x - at[0], pos.z - at[2]) > TALK_REACH + 3) return
    const j = p.self.journal
    if (option === 'bye') {
      this.talking.delete(p.player.id)
      this.host.dialog(p.player, null)
      return
    }
    if (option === 'shop') {
      const stock = this.stock(p, key)
      if (stock.length === 0) return
      const rare = key === 'gus' && RARE_STOCK.some((r) => (this.host.rare().get(r.item) ?? 0) > 0)
      const line =
        key === 'gus'
          ? rare
            ? 'Got something special today. Cash only. And no, I will not haggle.'
            : 'Cash only. No refunds. No haunted merchandise, probably.'
          : (SHOPS[key]?.find((s) => this.unlocks.includes(s.unlock))?.say ?? 'Cash.')
      this.say(p, key, line, [{ id: 'bye', label: 'Goodbye.' }], stock)
      return
    }
    if (option === 'heal' && key === 'lena') {
      const free = j.flags.includes('lena_free')
      if (!free && p.self.money < 40)
        return void this.say(
          p,
          key,
          "I can't work for nothing. Not any more.",
          this.options(p, key),
        )
      if (!free) p.self.money -= 40
      p.self.bleeding = false
      p.player.health = p.player.maxHealth
      this.host.touch(p)
      return void this.say(
        p,
        key,
        'Hold still… There. Try to keep the rest of your blood inside.',
        this.options(p, key),
      )
    }
    if (option === 'meal' && key === 'dot' && j.flags.includes('dot_meals')) {
      const last = this.fed.get(p.player.id) ?? Number.NEGATIVE_INFINITY
      if (this.host.now() - last < MEAL_EVERY)
        return void this.say(
          p,
          key,
          "You've had yours today, dear. Come back tomorrow.",
          this.options(p, key),
        )
      this.fed.set(p.player.id, this.host.now())
      p.self.hunger = Math.min(100, p.self.hunger + 45)
      p.self.thirst = Math.min(100, p.self.thirst + 25)
      this.host.touch(p)
      return void this.say(p, key, "Sit. Eat. Don't ask what it is.", this.options(p, key))
    }
    if (option.startsWith('ask:')) {
      const def = questById(option.slice(4))
      if (!def || def.giver !== key || !this.open(p, def)) return
      this.say(p, key, def.offer ?? def.title, [
        { id: `take:${def.id}`, label: "I'll do it." },
        { id: 'bye', label: 'Not now.' },
      ])
      return
    }
    if (option.startsWith('take:')) {
      const def = questById(option.slice(5))
      if (!def || def.giver !== key || !this.open(p, def)) return
      this.begin(p, def.id)
      this.host.broadcast()
      this.say(p, key, 'Good. Come back in one piece.', this.options(p, key))
      return
    }
    if (option.startsWith('pick:')) {
      const [, id, pick] = option.split(':')
      const q = j.quests.find((x) => x.id === id)
      const step = q && this.current(q)
      if (!q || step?.kind !== 'choose' || step.npc !== key) return
      const o = step.options.find((x) => x.id === pick)
      if (!o) return
      q.pick = o.id
      this.say(p, key, o.reply, [{ id: 'bye', label: 'Goodbye.' }])
      this.advance(p, q)
      return
    }
    if (option.startsWith('defend:')) {
      const q = j.quests.find((x) => x.id === option.slice(7))
      const step = q && this.current(q)
      if (!q || step?.kind !== 'defend' || step.npc !== key) return
      if (this.siege || this.host.now() < this.siegeAgain) return
      this.host.give(p, 'ammo9', 30)
      this.say(p, key, step.go, [{ id: 'bye', label: 'Go.' }])
      this.startSiege(step.poi, q.id, step.seconds)
    }
  }

  /** Where somebody to talk to stands. */
  private where(key: string): readonly [number, number, number] | null {
    const npc = this.def.npcs.find((n) => n.key === key)
    if (npc) return npc.pos
    const w = this.walkers.get(key)
    return w ? [w.x, w.y, w.z] : null
  }

  // --- Shops --------------------------------------------------------------------------------

  /** What somebody sells you, at your price. */
  private stock(p: Person, key: string): [string, number][] {
    const out: [string, number][] = []
    if (key === 'gus') {
      // Today's rare things first.
      for (const r of RARE_STOCK)
        if ((this.host.rare().get(r.item) ?? 0) > 0) out.push([r.item, r.price])
      for (const id of TRADER_STOCK) out.push([id, 0])
    }
    for (const s of SHOPS[key] ?? []) if (this.unlocks.includes(s.unlock)) out.push(...s.stock)
    return out.map(([id, price]) => [id, this.price(p, key, id, price)])
  }

  private price(p: Person, key: string, id: string, fixed: number): number {
    const def = ITEMS[id]
    const base =
      fixed > 0 ? fixed : Math.ceil((def?.value ?? 0) * (def?.kind === 'ammo' ? AMMO_BOX : 1))
    const off = key === 'gus' && p.self.journal.flags.includes('gus_discount') ? 0.8 : 1
    return Math.ceil(base * off)
  }

  /**
   * Somebody wants to buy: who within reach sells it, and for how much each; null if nobody does.
   * (Gus' rare things: `rare` is set, and the director takes one out of today's stock.)
   */
  quote(p: Person, item: string): { price: number; seller: string; rare: boolean } | null {
    const pos = p.player.state.pos
    for (const npc of this.def.npcs) {
      if (Math.hypot(pos.x - npc.pos[0], pos.z - npc.pos[2]) > 6) continue
      const hit = this.stock(p, npc.key).find(([id]) => id === item)
      if (!hit) continue
      const rare =
        npc.key === 'gus' && RARE_STOCK.some((r) => r.item === item) && !TRADER_STOCK.includes(item)
      return { price: hit[1], seller: npc.key, rare }
    }
    return null
  }

  // --- Using things -----------------------------------------------------------------------

  /** E on something: what a quest step wants done with it. False if nothing (the director decides). */
  use(p: Person, thing: Interactable): boolean {
    const j = p.self.journal
    for (const q of j.quests) {
      const step = this.current(q)
      if (!step) continue
      if (step.kind === 'use' && step.target === thing.key) {
        const missing = (step.needs ?? []).find(([item, n]) => this.host.count(p, item) < n)
        if (missing) {
          const [item, n] = missing
          this.host.notice(
            p.player,
            'warn',
            `You need ${ITEMS[item]?.name ?? item}${n > 1 ? ` ×${n}` : ''}.`,
          )
          return true
        }
        if (!step.keeps) for (const [item, n] of step.needs ?? []) this.host.take(p, item, n)
        for (const [item, n] of step.gives ?? []) this.host.give(p, item, n)
        if (step.opens !== undefined) this.host.openGate(step.opens)
        if (step.wakes) this.host.wake(step.wakes)
        if (step.say) {
          if (LORE[thing.key]) {
            this.learn(p, thing.key)
            this.host.notice(p.player, 'note', step.say, LORE[thing.key]?.title)
          } else this.host.notice(p.player, 'story', step.say)
        }
        this.advance(p, q)
        return true
      }
      if (step.kind === 'read' && step.note === thing.key) {
        this.read(p, thing)
        this.advance(p, q)
        return true
      }
      if (step.kind === 'collect') {
        const i = step.targets.indexOf(thing.key)
        if (i < 0 || q.count & (1 << i)) continue
        q.count |= 1 << i
        for (const [item, n] of step.gives) this.host.give(p, item, n)
        this.host.notice(
          p.player,
          'loot',
          `+ ${step.gives.map(([item]) => ITEMS[item]?.name ?? item).join(', ')}`,
        )
        if (q.count === (1 << step.targets.length) - 1) this.advance(p, q)
        else this.host.touch(p)
        return true
      }
    }
    if (thing.kind === 'note') {
      this.read(p, thing)
      return true
    }
    return false
  }

  /** A note: on paper in front of you, and in your journal. */
  private read(p: Person, thing: Interactable): void {
    const text = noteText(this.def, thing.key)
    if (!text) return
    this.learn(p, thing.key)
    this.host.notice(p.player, 'note', text, noteTitle(this.def, thing.key))
  }

  // --- Every tick, every second -------------------------------------------------------------

  /** Every tick: the people walking with somebody walk. */
  step(dt: number): void {
    for (const w of this.walkers.values()) {
      if (w.follow === 0) continue
      const leader = this.host.people().find((p) => p.player.id === w.follow)
      const s = leader?.player.state
      if (!leader || !s?.alive) {
        w.follow = 0
        continue
      }
      // Breadcrumbs: where the leader walked (so they follow you through doors, not walls).
      const last = w.trail[w.trail.length - 1] ?? { x: w.x, y: w.y, z: w.z }
      if (Math.hypot(s.pos.x - last.x, s.pos.z - last.z) > 0.6 && s.grounded !== false)
        w.trail.push({ x: s.pos.x, y: s.pos.y, z: s.pos.z })
      const away = Math.hypot(s.pos.x - w.x, s.pos.z - w.z)
      if (away > LOST) {
        if (!w.waiting) {
          w.waiting = true
          this.host.notice(
            leader.player,
            'warn',
            `${WALKERS[w.who]?.name}: "Wait! I can't keep up — wait for me!"`,
          )
        }
        continue
      }
      w.waiting = false
      if (away < KEEP) continue
      let left = (away > 6 ? HURRY : WALK) * dt
      while (left > 0 && w.trail.length > 0) {
        const t = w.trail[0] as Point
        const d = Math.hypot(t.x - w.x, t.z - w.z)
        if (d <= left) {
          w.x = t.x
          w.y = t.y
          w.z = t.z
          w.trail.shift()
          left -= d
          continue
        }
        w.yaw = Math.atan2(-(t.x - w.x), -(t.z - w.z))
        w.x += ((t.x - w.x) / d) * left
        w.z += ((t.z - w.z) / d) * left
        w.y += (t.y - w.y) * Math.min(1, left / Math.max(d, 0.01))
        left = 0
      }
    }
  }

  /** Once a second: places reached and held, people found and delivered, sieges, bosses. */
  tick(alive: readonly Person[]): void {
    const now = this.host.now()
    for (const p of alive) {
      for (const q of [...p.self.journal.quests]) {
        const step = this.current(q)
        if (!step) continue
        if (step.kind === 'reach') {
          const poi = this.def.pois.find((x) => x.key === step.poi)
          if (poi && dist(p.player.state.pos, poi) < poi.r + 4) this.advance(p, q)
        } else if (step.kind === 'meet') this.hide(p, step.who)
        else if (step.kind === 'kill' && step.boss) this.summon(p, step.boss)
      }
    }
    this.tickHolds(alive)
    this.tickWalkers(alive)
    if (this.siege) this.tickSiege(alive, now)
  }

  /** Hold steps: everyone there with the step holds together. */
  private tickHolds(alive: readonly Person[]): void {
    const held = new Set<string>()
    for (const p of alive) {
      for (const q of [...p.self.journal.quests]) {
        const step = this.current(q)
        if (step?.kind !== 'hold') continue
        const poi = this.def.pois.find((x) => x.key === step.poi)
        if (!poi || dist(p.player.state.pos, poi) > poi.r + 14) continue
        held.add(step.poi)
        this.host.horde(step.poi, step.horde)
        q.count++
        if (q.count >= step.seconds) {
          this.advance(p, q)
          this.host.horde(step.poi, 0)
        } else if (q.count % 5 === 0) this.host.touch(p)
      }
    }
  }

  /** Somebody to rescue waits where they hide while their rescuer is on the way. */
  private hide(p: Person, who: string): void {
    const key = `${who}@${p.player.id}`
    if (this.walkers.has(key)) return
    const at = walkerHideout(this.def, who)
    const def = WALKERS[who]
    if (!at || !def) return
    if (Math.hypot(p.player.state.pos.x - at[0], p.player.state.pos.z - at[2]) > 160) return
    this.walkers.set(key, {
      key,
      who,
      owner: p.player.id,
      x: at[0],
      y: at[1],
      z: at[2],
      yaw: 0,
      hp: def.hp,
      follow: 0,
      trail: [],
      waiting: false,
    })
    this.host.broadcast()
  }

  /** Somebody who is safe now lives at their home (once the world has them). */
  private settle(who: string): void {
    if (this.walkers.has(who)) return
    const home = walkerHome(this.def, who)
    if (!home) return
    this.walkers.set(who, {
      key: who,
      who,
      owner: 0,
      x: home.pos[0],
      y: home.pos[1],
      z: home.pos[2],
      yaw: home.yaw,
      hp: 100,
      follow: 0,
      trail: [],
      waiting: false,
    })
  }

  /** Rescues: the dead hurt them, and getting them home finishes the step. */
  private tickWalkers(alive: readonly Person[]): void {
    const zeds = this.host.zombies()
    for (const w of [...this.walkers.values()]) {
      if (w.owner === 0) continue
      const owner = alive.find((p) => p.player.id === w.owner)
      const q = owner?.self.journal.quests.find((x) => {
        const s = this.current(x)
        return (s?.kind === 'escort' || s?.kind === 'meet') && s.who === w.who
      })
      const step = q && this.current(q)
      if (!owner || !q || !step) continue
      const bites = zeds.filter(
        (z) => Math.hypot(z.state.pos.x - w.x, z.state.pos.z - w.z) < 1.8,
      ).length
      if (bites > 0 && step.kind === 'escort') {
        w.hp -= bites * BITE
        if (w.hp <= 0) {
          this.walkers.delete(w.key)
          q.pick = step.fails.pick
          for (const [item, n] of step.fails.gives ?? []) this.host.give(owner, item, n)
          this.host.notice(owner.player, 'story', step.fails.say)
          this.advance(owner, q)
          continue
        }
      }
      if (step.kind !== 'escort') continue
      const to = this.def.pois.find((x) => x.key === step.to)
      if (to && dist(w, to) < to.r - 4) {
        // Safe: from now on they live there, for everyone.
        this.walkers.delete(w.key)
        if (UNLOCKS[w.who] && !this.unlocks.includes(w.who)) this.unlocks.push(w.who)
        this.settle(w.who)
        this.advance(owner, q)
      }
    }
  }

  // --- Sieges -----------------------------------------------------------------------------

  private startSiege(poiKey: string, quest: string, seconds: number): void {
    const now = this.host.now()
    this.siege = {
      poi: poiKey,
      quest,
      ends: now + seconds,
      hp: 100,
      wave: 0,
      nextWave: now + 3,
      zeds: new Set(),
    }
    const poi = this.def.pois.find((p) => p.key === poiKey)
    for (const p of this.host.people()) {
      if (poi && dist(p.player.state.pos, poi) < 400)
        this.host.notice(
          p.player,
          'warn',
          `The dead are coming for ${poi.name}! Every gun to the gate.`,
        )
    }
    this.host.broadcast()
  }

  private tickSiege(alive: readonly Person[], now: number): void {
    const s = this.siege
    const poi = s && this.def.pois.find((p) => p.key === s.poi)
    if (!s || !poi) return
    const near = alive.filter((p) => dist(p.player.state.pos, poi) < poi.r + 90)
    // The dead come down the road in waves, more for more defenders.
    if (s.wave < WAVES && now >= s.nextWave) {
      s.wave++
      s.nextWave = now + (s.ends - now) / Math.max(1, WAVES - s.wave + 1)
      const n = Math.min(10, 3 + 2 * Math.max(1, near.length) + s.wave)
      for (let i = 0; i < n; i++) {
        const x = poi.x + (this.host.random() - 0.5) * 30
        const z = poi.z - poi.r - 60 - this.host.random() * 40
        const kind =
          this.host.random() < 0.25 + s.wave * 0.05 ? ZombieKind.Runner : ZombieKind.Walker
        const zed = this.host.spawnZed({ x, y: heightAt(this.def.terrain, x, z), z }, kind, {
          siege: true,
        })
        if (zed) s.zeds.add(zed)
      }
    }
    // Through the gate (north), then for the fire. Every one inside the wall costs the camp.
    const gate = { x: poi.x, y: poi.y, z: poi.z - 33 }
    const fire = { x: poi.x, y: poi.y, z: poi.z + 2 }
    for (const z of [...s.zeds]) {
      if (!z.state.alive) {
        s.zeds.delete(z)
        continue
      }
      const at = z.state.pos
      const inside = Math.abs(at.x - poi.x) < 29 && Math.abs(at.z - poi.z) < 29
      if (inside) s.hp -= BREACH
      this.host.steer(z, at.z < poi.z - 31 ? gate : fire)
    }
    if (s.hp <= 0) this.endSiege(false, near)
    else if (now >= s.ends) this.endSiege(true, near)
  }

  private endSiege(held: boolean, near: readonly Person[]): void {
    const s = this.siege
    if (!s) return
    this.siege = null
    for (const z of s.zeds) this.host.unsiege(z)
    const poi = this.def.pois.find((p) => p.key === s.poi)
    if (!held) {
      this.siegeAgain = this.host.now() + SIEGE_COOLDOWN
      for (const p of near)
        this.host.notice(
          p.player,
          'story',
          `They're inside.\n\nOrtiz and Tom drive them out with axes and fire, but it costs. Two tents burn. Nobody says the names.\n\n(Talk to Ortiz to try again.)`,
        )
      this.host.broadcast()
      return
    }
    for (const p of near) {
      const q = p.self.journal.quests.find((x) => {
        const step = this.current(x)
        return step?.kind === 'defend' && step.poi === s.poi
      })
      if (q) this.advance(p, q)
      else {
        // Everyone who stood on the wall gets paid, quest or not.
        p.self.money += 40
        this.host.touch(p)
        this.host.notice(
          p.player,
          'info',
          `${poi?.name ?? 'The camp'} held. Mara pays everyone who stood at the gate: + $40`,
        )
      }
    }
    this.host.broadcast()
  }

  // --- The dead ------------------------------------------------------------------------------

  /** A boss turns up when somebody after it comes near (one at a time). */
  private summon(p: Person, key: string): void {
    const b = BOSSES[key]
    const poi = b && this.def.pois.find((x) => x.key === b.poi)
    if (!b || !poi || dist(p.player.state.pos, poi) > BOSS_RANGE) return
    const was = this.bosses.get(key)
    if (was?.state.alive && was.name === b.name) return
    const at = bossSpot(this.def, key)
    if (!at) return
    const zed = this.host.spawnZed({ x: at[0], y: at[1], z: at[2] }, b.kind, {
      name: b.name,
      hunter: true,
    })
    if (zed) this.bosses.set(key, zed)
  }

  /** One of the dead went down: kill steps of everyone near (or of whoever was after this boss). */
  killed(zombie: ServerPlayer, kind: number, at: Point, killer: ServerPlayer): void {
    const boss = [...this.bosses].find(([, z]) => z === zombie)?.[0]
    if (boss) this.bosses.delete(boss)
    for (const p of this.host.people()) {
      if (!p.player.state.alive) continue
      const close = p.player === killer || dist(p.player.state.pos, at) < TOGETHER
      for (const q of [...p.self.journal.quests]) {
        const step = this.current(q)
        if (step?.kind !== 'kill') continue
        if (step.boss) {
          if (step.boss === boss && dist(p.player.state.pos, at) < BOSS_RANGE + 40)
            this.advance(p, q)
          continue
        }
        if (!close) continue
        if (step.zombie !== undefined && step.zombie !== kind) continue
        const poi = this.def.pois.find((x) => x.key === step.poi)
        if (poi && dist(at, poi) > poi.r + 45) continue
        q.count++
        if (q.count >= step.n) this.advance(p, q)
        else this.host.touch(p)
      }
    }
  }

  /** The journal a person has (tests). */
  journalOf(p: Person): Journal {
    return p.self.journal
  }
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)
