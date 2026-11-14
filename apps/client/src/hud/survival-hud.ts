import {
  AMMO_BOX,
  countOf,
  type Dialog,
  dayPhase,
  ITEMS,
  type ItemDef,
  type ItemKind,
  infectionClock,
  infectionStage,
  infectionWord,
  type LootItem,
  type Notice,
  PEOPLE,
  type Poi,
  poiAt,
  QUESTS,
  type QuestState,
  type QuestStep,
  questById,
  roomFor,
  SELL_RATE,
  type Stack,
  type SurvivalAction,
  type SurvivalDef,
  type SurvivalSelf,
  type SurvivalShared,
  stepGoal,
  WEAPONS,
  type WeaponId,
  WORLD_HALF,
  WORLD_SIZE,
} from '@office-fps/shared'
import { InventoryScreen } from './inventory-screen.ts'
import { effectText } from './item-text.ts'
import { markerSpot } from './objective-marker.ts'
import { QuestJournal } from './quest-journal.ts'

export { effectText }

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
  text?: string,
) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  parent?.append(node)
  return node
}

export interface SurvivalHudContext {
  /** 0–100. */
  health: number
  /** 0–1. */
  stamina: number
  winded: boolean
  pos: { x: number; y: number; z: number }
  /** Radians: 0 looks north (−z), positive turns left (west). */
  yaw: number
  /** Weapons in your hands and holsters, the one in hand first. */
  carried: readonly { id: WeaponId; ammo: number }[]
  /** Bitten: seconds until you turn (counted on between the server's updates), or null. */
  infected?: number | null
  /** Things lying within reach (the inventory's vicinity panel). */
  nearby?: readonly LootItem[]
  /** Where a world point lands on screen (CSS px), and whether it is behind you. */
  project?: (x: number, y: number, z: number) => { x: number; y: number; behind: boolean }
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** "Pinewatch · NW · 640 m": where a target is, said the way you'd say it. */
export function whereText(
  def: SurvivalDef,
  from: { x: number; z: number },
  to: { x: number; z: number },
): string {
  const d = Math.hypot(to.x - from.x, to.z - from.z)
  const i = poiAt(def, to.x, to.z, 6)
  const place = i === null ? null : (def.pois[i]?.name ?? null)
  if (d < 25) return place ? `${place} · here` : 'right here'
  const dir = POINTS[Math.round(bearingTo(from, to) / 45) % 8] as string
  const far = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`
  return [place, dir, far].filter(Boolean).join(' · ')
}

const KIND_ORDER: ItemKind[] = [
  'weapon',
  'ammo',
  'food',
  'drink',
  'med',
  'pack',
  'wear',
  'tool',
  'junk',
  'quest',
  'money',
]
const KIND_TITLE: Record<ItemKind, string> = {
  weapon: 'Weapons',
  ammo: 'Ammunition',
  food: 'Food',
  drink: 'Drink',
  med: 'Medical',
  pack: 'Backpacks',
  wear: 'Clothes & gear',
  tool: 'Tools',
  junk: 'Valuables',
  quest: 'Quest',
  money: 'Cash',
}

/** Degrees clockwise from north that `yaw` looks. */
export function headingOf(yaw: number): number {
  return ((((-yaw * 180) / Math.PI) % 360) + 360) % 360
}

/** Degrees clockwise from north from `from` to `to` (x east, z south). */
export function bearingTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return ((Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI + 360) % 360
}

/** Smallest signed difference a − b in degrees (−180…180). */
export function turnBetween(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180
}

/** One line for a quest step, with how far along it is. */
export function stepLine(step: QuestStep, state: QuestState, inv: readonly Stack[]): string {
  switch (step.kind) {
    case 'kill':
      return `${step.text} (${state.count}/${step.n})`
    case 'hold':
      return `${step.text} (${Math.max(0, step.seconds - state.count)} s)`
    case 'collect': {
      let done = 0
      for (let i = 0; i < step.targets.length; i++) if (state.count & (1 << i)) done++
      return `${step.text} (${done}/${step.targets.length})`
    }
    case 'fetch':
      return step.n > 1
        ? `${step.text} (${Math.min(step.n, countOf(inv, step.item))}/${step.n})`
        : step.text
    default:
      return step.text
  }
}

/**
 * Everything survival mode puts on screen: how you're doing, what the story wants, what people
 * say, your backpack, the shop and the map. The game tells it what the server said and which
 * keys went down; it tells the game what the player wants done.
 */
export class SurvivalHud {
  onModalChange?: (open: boolean) => void
  /** A sound to play: 'open' | 'close' | 'use' | 'deny' | 'quest' | 'story' | 'coin'. */
  onSound?: (cue: string) => void

  private readonly def: SurvivalDef
  private readonly send: (action: SurvivalAction) => void
  private readonly root: HTMLDivElement
  private self: SurvivalSelf | null = null
  private shared: SurvivalShared | null = null
  private ctx: SurvivalHudContext | null = null

  // Vitals
  private readonly food: HTMLElement
  private readonly water: HTMLElement
  private readonly breath: HTMLElement
  private readonly battery: HTMLElement
  private readonly bleeding: HTMLElement
  private readonly infected: HTMLElement
  private readonly money: HTMLElement
  // Story and jobs
  private readonly tracker: HTMLDivElement
  private trackerKey = ''
  private readonly feed: HTMLDivElement
  private readonly feedLines: { node: HTMLElement; until: number }[] = []
  private readonly story: HTMLDivElement
  private readonly storyText: HTMLDivElement
  private readonly storyTitle: HTMLDivElement
  private readonly storyQueue: { text: string; title?: string }[] = []
  private storyNow: { text: string; shown: number; age: number } | null = null
  /** A siege on: the camp's bar under the compass. */
  private readonly siege: HTMLDivElement
  // Compass
  private readonly compass: HTMLDivElement
  private readonly points: { node: HTMLElement; bearing: number }[] = []
  private readonly marker: HTMLElement
  /** Smaller marks for the side jobs' targets. */
  private readonly sideMarkers: HTMLElement[] = []
  /** Distance to the main quest's target, shown in its panel. */
  private mainDistance: HTMLElement | null = null
  private mainKey = ''
  /** Side jobs' "where" lines, in tracker order. */
  private sideWhere: HTMLElement[] = []
  /** Markers over the targets themselves, out in the world: the story's first, then the jobs'. */
  private readonly waypoints: { node: HTMLElement; text: HTMLElement }[] = []
  /** Supply drops: a red mark on the compass and over the crate. */
  private readonly dropMarker: HTMLElement
  private readonly dropWay: { node: HTMLElement; text: HTMLElement }
  private readonly hour: HTMLElement
  // Talking
  private readonly talk: HTMLDivElement
  private talking: Dialog | null = null
  private talkShown = 0
  // Screens
  private readonly panel: HTMLDivElement
  private screen: 'none' | 'pack' | 'shop' | 'journal' = 'none'
  private readonly journal: QuestJournal
  /** Your player id (whom the people walking with somebody follow). */
  me: () => number = () => 0
  private shop: Dialog | null = null
  /** The inventory grid (Tab / I). */
  private readonly inventory: InventoryScreen
  private selected = 0
  /** Scroll the selected row into view on the next draw (only after W/S, never on a refresh). */
  private revealPick = false
  /** Which screen the lists' scroll positions belong to. */
  private scrolledScreen = ''
  private rows: Stack[] = []
  private shift = false
  private readonly map: HTMLCanvasElement
  private mapBase: HTMLCanvasElement | null = null
  private mapOpen = false
  private sinceMap = 1
  private visible = false
  private clock = 0

  constructor(parent: HTMLElement, def: SurvivalDef, send: (action: SurvivalAction) => void) {
    this.def = def
    this.send = send
    this.root = el('div', 'sv', parent)
    this.root.hidden = true

    const vitals = el('div', 'sv-vitals', this.root)
    const bar = (label: string) => {
      const row = el('div', 'sv-bar', vitals)
      el('span', '', row, label)
      return el('i', '', el('div', '', row))
    }
    this.food = bar('FOOD')
    this.water = bar('WATER')
    this.breath = bar('BREATH')
    this.battery = el('div', 'sv-battery', vitals)
    this.bleeding = el('div', 'sv-bleeding', vitals, 'BLEEDING')
    this.infected = el('div', 'sv-infected', vitals)
    this.infected.hidden = true
    this.money = el('div', 'sv-money', vitals)

    this.tracker = el('div', 'sv-tracker', this.root)
    this.feed = el('div', 'sv-feed', this.root)
    this.story = el('div', 'sv-story', this.root)
    this.storyTitle = el('div', 'sv-story-title', this.story)
    this.storyText = el('div', '', this.story)
    this.story.hidden = true
    this.siege = el('div', 'sv-siege', this.root)
    this.siege.hidden = true
    this.journal = new QuestJournal(def)

    this.compass = el('div', 'sv-compass', this.root)
    for (const [i, name] of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].entries()) {
      this.points.push({
        node: el('span', i % 2 === 0 ? 'main' : '', this.compass, name),
        bearing: i * 45,
      })
    }
    for (let i = 0; i < 3; i++) this.sideMarkers.push(el('b', 'sv-compass-side', this.compass))
    this.dropMarker = el('b', 'sv-compass-drop', this.compass)
    const dropNode = el('div', 'sv-way drop', this.root)
    el('b', '', dropNode, '✚')
    this.dropWay = { node: dropNode, text: el('span', '', dropNode) }
    for (let i = 0; i < 4; i++) {
      const node = el('div', i === 0 ? 'sv-way main' : 'sv-way side', this.root)
      el('b', '', node, i === 0 ? '◆' : '◇')
      this.waypoints.push({ node, text: el('span', '', node) })
      node.hidden = true
    }
    this.marker = el('b', 'sv-compass-goal', this.compass)
    this.hour = el('div', 'sv-hour', this.root)

    this.talk = el('div', 'sv-talk', this.root)
    this.talk.hidden = true
    this.panel = el('div', 'sv-panel', this.root)
    this.panel.hidden = true
    this.inventory = new InventoryScreen(this.root, send, (cue) => this.onSound?.(cue))
    this.map = el('canvas', 'sv-map', this.root)
    this.map.hidden = true
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.shift = true
    })
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shift = false
    })
  }

  /** True while a screen that needs the mouse is open (backpack or shop). */
  get modal(): boolean {
    return this.screen !== 'none'
  }

  /** Somebody is talking to you (digits answer; they shouldn't also switch weapons). */
  get inDialog(): boolean {
    return this.talking !== null
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return
    this.visible = on
    this.root.hidden = !on
    if (!on) {
      this.setScreen('none')
      this.mapOpen = false
      this.map.hidden = true
      this.dialog(null)
    }
  }

  setSelf(self: SurvivalSelf): void {
    this.self = self
    this.refreshTracker()
    this.inventory.setSelf(self)
    if (this.screen === 'shop') this.drawScreen()
    if (this.screen === 'journal') this.drawJournal()
  }

  setShared(shared: SurvivalShared): void {
    this.shared = shared
    this.refreshTracker()
  }

  /** Takes a story card down, showing or still waiting (the bite's, once you're clean or dead). */
  dropStory(text: string): void {
    for (let i = this.storyQueue.length - 1; i >= 0; i--)
      if (this.storyQueue[i]?.text === text) this.storyQueue.splice(i, 1)
    if (this.storyNow?.text === text) {
      this.storyNow = null
      this.story.hidden = true
    }
  }

  notice(n: Notice): void {
    if (n.kind === 'scream') return
    if (n.kind === 'story' || n.kind === 'note') {
      this.storyQueue.push({
        text: n.text,
        ...(n.kind === 'note' ? { title: n.title ?? 'A note' } : {}),
      })
      return
    }
    const node = el('div', `sv-note ${n.kind}`, this.feed, n.text)
    this.feedLines.push({ node, until: this.clock + 4.5 })
    while (this.feedLines.length > 6) this.feedLines.shift()?.node.remove()
    if (n.kind === 'quest') this.onSound?.('quest')
    if (n.kind === 'warn') this.onSound?.('deny')
  }

  dialog(d: Dialog | null): void {
    if (d?.shop) {
      this.shop = d
      this.talking = null
      this.talk.hidden = true
      this.selected = 0
      this.setScreen('shop')
      return
    }
    if (this.screen === 'shop') this.setScreen('none')
    this.talking = d
    this.talkShown = 0
    this.talk.hidden = d === null
    this.talk.replaceChildren()
    if (!d) return
    const head = el('div', 'sv-talk-name', this.talk, d.name)
    const full = PEOPLE[d.npc]?.name
    if (full && full !== d.name) el('span', 'sv-talk-who', head, full)
    el('div', 'sv-talk-text', this.talk)
    const list = el('div', 'sv-talk-options', this.talk)
    d.options.forEach((o, i) => {
      el('div', '', list, `[${i + 1}] ${o.label}`)
    })
  }

  toggleBackpack(): void {
    if (!this.visible) return
    this.selected = 0
    this.setScreen(this.screen === 'pack' ? 'none' : 'pack')
  }

  /** J: the journal (quests, notes read, the people of Haven). */
  toggleJournal(): void {
    if (!this.visible) return
    this.setScreen(this.screen === 'journal' ? 'none' : 'journal')
  }

  toggleMap(): void {
    if (!this.visible) return
    this.mapOpen = !this.mapOpen
    this.map.hidden = !this.mapOpen
    this.sinceMap = 1
    if (this.mapOpen) this.setScreen('none')
    this.onSound?.(this.mapOpen ? 'open' : 'close')
  }

  /** Esc: closes whatever is open; true if something was. */
  close(): boolean {
    if (this.screen === 'pack' && this.inventory.key('Escape')) return true
    if (this.screen !== 'none') {
      this.setScreen('none')
      return true
    }
    if (this.mapOpen) {
      this.toggleMap()
      return true
    }
    if (this.talking) {
      this.send({ a: 'choose', npc: this.talking.npc, option: 'bye' })
      this.dialog(null)
      return true
    }
    return false
  }

  /** A key went down; true if the HUD used it. */
  key(code: string): boolean {
    if (!this.visible) return false
    if (
      this.storyNow &&
      (code === 'Space' || code === 'Enter') &&
      this.screen === 'none' &&
      !this.talking
    ) {
      this.storyNow.age = Number.POSITIVE_INFINITY
      return true
    }
    if (this.talking && code.startsWith('Digit')) {
      const option = this.talking.options[Number(code.slice(5)) - 1]
      if (option) {
        this.send({ a: 'choose', npc: this.talking.npc, option: option.id })
        if (option.id === 'bye') this.dialog(null)
        this.onSound?.('use')
      }
      return true
    }
    if (this.screen === 'none') return false
    if (this.screen === 'journal') {
      if (code === 'KeyJ') this.setScreen('none')
      else if (this.journal.key(code)) this.drawJournal()
      return true
    }
    if (this.screen === 'pack') {
      this.inventory.key(code)
      return true // everything else is swallowed while a screen is open
    }
    const n = this.rows.length
    if (code === 'ArrowDown' || code === 'KeyS') this.selected = Math.min(n - 1, this.selected + 1)
    else if (code === 'ArrowUp' || code === 'KeyW') this.selected = Math.max(0, this.selected - 1)
    else if (code === 'Enter' || code === 'KeyE') this.sell(this.rows[this.selected])
    else return true
    this.revealPick = true
    this.drawScreen()
    return true
  }

  update(dt: number, ctx: SurvivalHudContext): void {
    if (!this.visible) return
    this.ctx = ctx
    this.clock += dt
    if (this.screen === 'pack') {
      this.inventory.setContext({
        carried: ctx.carried,
        nearby: ctx.nearby ?? [],
        infected: ctx.infected ?? this.self?.infected ?? null,
      })
    }
    const self = this.self
    if (self) {
      this.setBar(this.food, self.hunger)
      this.setBar(this.water, self.thirst)
      this.setBar(this.breath, ctx.stamina * 100, ctx.winded)
      const showBattery = self.light || self.battery < 30
      this.battery.hidden = !showBattery
      if (showBattery) {
        const text = `TORCH ${'▮'.repeat(Math.ceil(self.battery / 20))}${'▯'.repeat(5 - Math.ceil(self.battery / 20))}`
        if (this.battery.textContent !== text) this.battery.textContent = text
        this.battery.classList.toggle('low', self.battery < 20)
      }
      this.bleeding.hidden = !self.bleeding
      const left = ctx.infected ?? null
      this.infected.hidden = left === null
      const word = infectionWord(left)
      const status = word ? `INFECTED · ${word.toUpperCase()} · ${infectionClock(left)}` : ''
      if (this.infected.textContent !== status) this.infected.textContent = status
      const stage = String(Math.max(0, infectionStage(left)))
      if (this.infected.dataset.stage !== stage) this.infected.dataset.stage = stage
      const money = `$${self.money}`
      if (this.money.textContent !== money) this.money.textContent = money
    }

    // Notices fade out; story cards type themselves out one after another.
    while (this.feedLines[0] && this.feedLines[0].until < this.clock)
      this.feedLines.shift()?.node.remove()
    if (!this.storyNow && this.storyQueue.length > 0) {
      const next = this.storyQueue.shift() ?? { text: '' }
      this.storyNow = { text: next.text, shown: 0, age: 0 }
      // A note is read on paper, with what it is over it.
      this.story.classList.toggle('paper', next.title !== undefined)
      this.storyTitle.hidden = next.title === undefined
      this.storyTitle.textContent = next.title ?? ''
      this.story.hidden = false
      this.onSound?.('story')
    }
    const card = this.storyNow
    if (card) {
      card.age += dt
      const shown = Math.min(card.text.length, Math.floor(card.age * 60))
      if (shown !== card.shown) {
        card.shown = shown
        this.storyText.textContent = card.text.slice(0, shown)
      }
      const life = 2.5 + card.text.length * 0.055 + card.text.length / 60
      this.story.style.opacity = String(Math.max(0, Math.min(1, life - card.age)))
      if (card.age > life) {
        this.storyNow = null
        this.story.hidden = true
      }
    }
    if (this.talking) {
      const text = this.talk.querySelector('.sv-talk-text')
      const shown = Math.min(this.talking.text.length, this.talkShown + Math.ceil(dt * 90))
      if (text && shown !== this.talkShown) {
        this.talkShown = shown
        text.textContent = this.talking.text.slice(0, shown)
      }
    }

    this.drawCompass(ctx)
    // Dawn and dusk are called out under the compass.
    const phase = dayPhase(this.shared?.time ?? 0)
    const label = phase === 'dawn' ? 'DAWN' : phase === 'dusk' ? 'DUSK' : ''
    this.hour.hidden = label === ''
    if (this.hour.textContent !== label) this.hour.textContent = label
    this.hour.classList.toggle('dusk', phase === 'dusk')
    this.drawSiege()
    if (this.mapOpen) {
      this.sinceMap += dt
      if (this.sinceMap > 0.2) {
        this.sinceMap = 0
        this.drawMap(ctx)
      }
    }
  }

  // --- Pieces --------------------------------------------------------------------------------

  /** A place under attack: its name, how much it can still take, and how long to hold. */
  private drawSiege(): void {
    const s = this.shared?.siege
    this.siege.hidden = !s
    if (!s) return
    const name = this.def.pois.find((p) => p.key === s.poi)?.name ?? 'The camp'
    const key = `${name}|${s.hp}|${s.left}`
    if (this.siege.dataset.key === key) return
    this.siege.dataset.key = key
    this.siege.replaceChildren()
    el('b', 'sv-siege-name', this.siege, `${name.toUpperCase()} UNDER ATTACK`)
    const bar = el('div', 'sv-siege-bar', this.siege)
    const fill = el('i', s.hp < 35 ? 'sv-siege-fill low' : 'sv-siege-fill', bar)
    fill.style.width = `${s.hp}%`
    el(
      'span',
      '',
      this.siege,
      `Hold ${Math.floor(s.left / 60)}:${String(s.left % 60).padStart(2, '0')}`,
    )
  }

  private setBar(fill: HTMLElement, value: number, bad = false): void {
    const width = `${Math.round(Math.max(0, Math.min(100, value)))}%`
    if (fill.style.width !== width) fill.style.width = width
    const state = bad || value < 20 ? 'low' : value < 35 ? 'warn' : ''
    if (fill.className !== state) fill.className = state
  }

  /** The story chapter first, then side jobs. */
  private quests(): { state: QuestState; story: boolean }[] {
    const all = (this.self?.journal?.quests ?? []).map((state) => ({
      state,
      story: questById(state.id)?.story === true,
    }))
    return [...all.filter((q) => q.story), ...all.filter((q) => !q.story).slice(0, 3)]
  }

  private refreshTracker(): void {
    const lines: [string, string, boolean][] = []
    for (const { state, story } of this.quests()) {
      const def = questById(state.id)
      const step = def?.steps[state.step]
      if (def && step) lines.push([def.title, stepLine(step, state, this.self?.inv ?? []), story])
    }
    const key = JSON.stringify(lines)
    if (key === this.trackerKey) return
    this.trackerKey = key
    this.tracker.replaceChildren()
    this.mainDistance = null
    this.sideWhere = []
    for (const [title, text, story] of lines) {
      if (story) {
        // The story: big, gold, impossible to miss; it flashes when the objective changes.
        const q = el('div', 'sv-quest story', this.tracker)
        el('i', '', q, '★ MAIN QUEST')
        el('b', '', q, title)
        el('span', '', q, text)
        this.mainDistance = el('em', '', q)
        const mainKey = `${title}|${text}`
        if (this.mainKey && mainKey !== this.mainKey) q.classList.add('fresh')
        this.mainKey = mainKey
      } else {
        const q = el('div', 'sv-quest side', this.tracker)
        el('i', '', q, 'SIDE JOB')
        el('b', '', q, title)
        el('span', '', q, text)
        this.sideWhere.push(el('em', '', q))
      }
    }
  }

  /**
   * The nearest target of a quest's current step, or null: `area` > 0 when it's only a search
   * area (you're inside it once within that), `hidden` when there's no clue to it yet.
   */
  private targetOf(
    state: QuestState,
    pos: { x: number; z: number },
  ): { x: number; y: number; z: number; area: number } | null {
    const goal = this.goalOf(state)
    if (!goal) return null
    let best: { x: number; y: number; z: number; area: number } | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const [x, y, z] of goal.points) {
      const d = Math.hypot(x - pos.x, z - pos.z)
      if (d < bestD) {
        bestD = d
        best = { x, y, z, area: goal.area }
      }
    }
    return best
  }

  private goalOf(state: QuestState) {
    const step = questById(state.id)?.steps[state.step]
    const journal = this.self?.journal
    if (!step || !journal) return null
    return stepGoal(this.def, step, state, journal, this.shared?.walkers ?? [], this.me())
  }

  /** Where the story wants you now: the nearest target of its current step. */
  private goal(pos: {
    x: number
    z: number
  }): { x: number; y: number; z: number; area: number } | null {
    const story = this.quests().find((q) => q.story)
    return story ? this.targetOf(story.state, pos) : null
  }

  /** Under a quest in the tracker: where its target is, a search area, or no lead yet. */
  private whereLine(
    state: QuestState,
    target: { x: number; y: number; z: number; area: number } | null,
    pos: { x: number; z: number },
  ): string {
    if (this.goalOf(state)?.hidden) return 'No marker · find a lead'
    if (!target) return ''
    if (target.area > 0) {
      const d = Math.hypot(target.x - pos.x, target.z - pos.z)
      return d < target.area
        ? 'Search the area'
        : `Search area · ${whereText(this.def, pos, target)}`
    }
    return whereText(this.def, pos, target)
  }

  private drawCompass(ctx: SurvivalHudContext): void {
    const heading = headingOf(ctx.yaw)
    const width = this.compass.clientWidth || 360
    const place = (node: HTMLElement, bearing: number, clamp: boolean) => {
      let turn = turnBetween(bearing, heading)
      if (clamp) turn = Math.max(-88, Math.min(88, turn))
      node.hidden = Math.abs(turn) > 90
      if (!node.hidden) node.style.left = `${(0.5 + turn / 180) * width}px`
    }
    for (const p of this.points) place(p.node, p.bearing, false)
    let goal = this.goal(ctx.pos)
    const story = this.quests().find((q) => q.story)
    // Inside a search area there's nothing more to point at: look around.
    const searching =
      goal !== null &&
      goal.area > 0 &&
      Math.hypot(goal.x - ctx.pos.x, goal.z - ctx.pos.z) < goal.area
    const main = story ? this.whereLine(story.state, goal, ctx.pos) : ''
    if (this.mainDistance && this.mainDistance.textContent !== main)
      this.mainDistance.textContent = main
    if (searching) goal = null
    this.marker.hidden = goal === null
    if (goal) {
      place(this.marker, bearingTo(ctx.pos, goal), true)
      const text = `${Math.round(Math.hypot(goal.x - ctx.pos.x, goal.z - ctx.pos.z))} m`
      if (this.marker.textContent !== text) this.marker.textContent = text
    }
    const sides = this.quests().filter((q) => !q.story)
    const targets: ({ x: number; y: number; z: number } | null)[] = [goal]
    this.sideMarkers.forEach((node, i) => {
      const side = sides[i]
      let target = side ? this.targetOf(side.state, ctx.pos) : null
      const where = side ? this.whereLine(side.state, target, ctx.pos) : ''
      if (
        target &&
        target.area > 0 &&
        Math.hypot(target.x - ctx.pos.x, target.z - ctx.pos.z) < target.area
      )
        target = null
      targets.push(target)
      node.hidden = target === null
      if (target) place(node, bearingTo(ctx.pos, target), true)
      const line = this.sideWhere[i]
      if (line && line.textContent !== where) line.textContent = where
    })
    this.drawWaypoints(ctx, targets)

    // The nearest supply drop nobody has opened yet.
    let drop: { x: number; y: number; z: number; landed: boolean } | null = null
    for (const d of this.shared?.drops ?? []) {
      if (d.opened) continue
      if (
        !drop ||
        Math.hypot(d.x - ctx.pos.x, d.z - ctx.pos.z) <
          Math.hypot(drop.x - ctx.pos.x, drop.z - ctx.pos.z)
      )
        drop = d
    }
    this.dropMarker.hidden = drop === null
    if (drop) place(this.dropMarker, bearingTo(ctx.pos, drop), true)
    const way = this.dropWay
    const p = drop && ctx.project ? ctx.project(drop.x, drop.y + 2, drop.z) : null
    way.node.hidden = !drop || !p || this.modal
    if (drop && p) {
      const w = window.innerWidth
      const h = window.innerHeight
      const { x, y } = markerSpot(p.x, p.y, p.behind, w, h)
      way.node.style.transform = `translate(${x}px, ${y}px)`
      const d = Math.round(Math.hypot(drop.x - ctx.pos.x, drop.z - ctx.pos.z))
      const label = drop.landed ? `SUPPLY DROP ${d} m` : `INCOMING ${d} m`
      if (way.text.textContent !== label) way.text.textContent = label
    }
  }

  /**
   * A marker floating over each target out in the world, with how far it is; at the edge of the
   * screen (pointing the way) when it's off to the side or behind you.
   */
  private drawWaypoints(
    ctx: SurvivalHudContext,
    targets: readonly ({ x: number; y: number; z: number } | null)[],
  ): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.waypoints.forEach(({ node, text }, i) => {
      const t = targets[i] ?? null
      const d = t ? Math.hypot(t.x - ctx.pos.x, t.y - ctx.pos.y, t.z - ctx.pos.z) : 0
      const shown = t !== null && ctx.project !== undefined && d > 3 && !this.modal
      node.hidden = !shown
      if (!shown || !t || !ctx.project) return
      const p = ctx.project(t.x, t.y + 2.2, t.z)
      // Off screen: pinned to the edge (to the side when behind you), clear of the bottom HUD.
      const { x, y, off } = markerSpot(p.x, p.y, p.behind, w, h)
      node.style.transform = `translate(${x}px, ${y}px)`
      node.classList.toggle('off', off)
      const label = `${Math.round(d)} m`
      if (text.textContent !== label) text.textContent = label
    })
  }

  private setScreen(screen: 'none' | 'pack' | 'shop' | 'journal'): void {
    const was = this.modal
    if (this.screen === 'shop' && screen !== 'shop' && this.shop) {
      this.send({ a: 'choose', npc: this.shop.npc, option: 'bye' })
      this.shop = null
    }
    this.screen = screen
    this.panel.hidden = screen !== 'shop' && screen !== 'journal'
    if (screen !== 'none') {
      this.mapOpen = false
      this.map.hidden = true
    }
    if (screen === 'shop') this.drawScreen()
    if (screen === 'journal') this.drawJournal()
    if (screen === 'pack' && this.ctx) {
      this.inventory.setContext({
        carried: this.ctx.carried,
        nearby: this.ctx.nearby ?? [],
        infected: this.ctx.infected ?? null,
      })
    }
    if (this.inventory.open !== (screen === 'pack')) this.inventory.setOpen(screen === 'pack')
    if (was !== this.modal) {
      this.onSound?.(this.modal ? 'open' : 'close')
      this.onModalChange?.(this.modal)
    }
  }

  /** The journal, in the panel (see quest-journal.ts). */
  private drawJournal(): void {
    const self = this.self
    if (!self) return
    this.journal.draw(this.panel, self.journal, this.shared?.unlocks ?? [], () =>
      this.drawJournal(),
    )
  }

  /** Sells one (Shift: the lot) to the trader. */
  private sell(stack: Stack | undefined): void {
    const def = stack ? ITEMS[stack.item] : undefined
    if (!stack || !def || def.kind === 'quest' || def.kind === 'money') return
    this.send({ a: 'sell', item: def.id, n: this.shift ? stack.n : 1 })
    this.onSound?.('coin')
  }

  private button(parent: HTMLElement, label: string, onClick: () => void, enabled = true): void {
    const b = el('button', 'sv-button', parent, label)
    b.disabled = !enabled
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
  }

  /** What you could sell, one line per thing (stacks of it added up): by kind, then by name. */
  private sellable(inv: readonly Stack[]): Stack[] {
    const out: Stack[] = []
    for (const s of inv) {
      const def = ITEMS[s.item]
      if (!def || def.kind === 'quest' || def.kind === 'money') continue
      const same = def.kind !== 'weapon' && out.find((o) => o.item === s.item)
      if (same) same.n += s.n
      else out.push({ item: s.item, n: s.n })
    }
    return out.sort((a, b) => {
      const da = ITEMS[a.item] as ItemDef
      const db = ITEMS[b.item] as ItemDef
      return (
        KIND_ORDER.indexOf(da.kind) - KIND_ORDER.indexOf(db.kind) || da.name.localeCompare(db.name)
      )
    })
  }

  /** The trader's stall: what he has, and what you could sell him. */
  private drawScreen(): void {
    const self = this.self
    const shop = this.shop
    if (!self || !shop) return
    // Redraws come with every change to what you have (hunger ticking down, too): keep every list
    // where it was scrolled to.
    const key = `${this.screen}:${shop.name}`
    const scrolls =
      key === this.scrolledScreen
        ? [...this.panel.querySelectorAll('.sv-list')].map((l) => l.scrollTop)
        : []
    this.scrolledScreen = key
    this.panel.replaceChildren()
    const head = el('div', 'sv-panel-head', this.panel)
    el('b', '', head, `${shop.name.toUpperCase()}'S STALL`)
    el('span', 'sv-panel-money', head, `$${self.money}`)
    const body = el('div', 'sv-panel-body', this.panel)
    const left = el('div', 'sv-col', body)
    const right = el('div', 'sv-col', body)

    el('div', 'sv-shop-say', left, shop.text)
    el('div', 'sv-group', left, 'For sale')
    const stall = el('div', 'sv-list', left)
    // Rounds for the guns you carry come first, and say which gun they're for.
    const carried = this.ctx?.carried ?? []
    const forYours = (id: string) => {
      const ammo = ITEMS[id]?.ammo
      if (!ammo) return []
      return carried.filter((c) => WEAPONS[c.id].ammoType === ammo).map((c) => WEAPONS[c.id].name)
    }
    const stock = [...(shop.shop ?? [])].sort(
      (a, b) => Number(forYours(b[0]).length > 0) - Number(forYours(a[0]).length > 0),
    )
    for (const [id, price] of stock) {
      const def = ITEMS[id]
      if (!def) continue
      const each = def.kind === 'ammo' ? AMMO_BOX : 1
      const row = el('div', 'sv-row', stall)
      const yours = forYours(id)
      el(
        'span',
        'sv-row-name',
        row,
        `${def.name}${each > 1 ? ` ×${each}` : ''}${yours.length ? ` · for your ${yours.join(', ')}` : ''}`,
      )
      el('span', 'sv-row-info', row, `$${price}`)
      const room = roomFor(self, id) >= each
      const can = self.money >= price && room
      this.button(row, 'Buy', () => this.send({ a: 'buy', item: id, n: 1 }), can)
      row.title = `${def.desc} ${effectText(def)}${room ? '' : ' (no room for it)'}`
    }

    // Your things, to sell.
    this.rows = this.sellable(self.inv)
    this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected))
    el('div', 'sv-group', right, 'You sell')
    const list = el('div', 'sv-list', right)
    if (this.rows.length === 0) el('div', 'sv-row-name empty', list, 'Nothing to sell.')
    let lastKind: ItemKind | null = null
    this.rows.forEach((stack, i) => {
      const def = ITEMS[stack.item] as ItemDef
      if (def.kind !== lastKind) {
        lastKind = def.kind
        el('div', 'sv-kind', list, KIND_TITLE[def.kind])
      }
      const node = el('div', i === this.selected ? 'sv-row selected' : 'sv-row', list)
      node.addEventListener('click', () => {
        this.selected = i
        this.drawScreen()
      })
      el('span', 'sv-row-name', node, `${def.name}${stack.n > 1 ? ` ×${stack.n}` : ''}`)
      el('span', 'sv-row-info', node, `$${Math.floor(def.value * SELL_RATE)}`)
      this.button(node, 'Sell', () => this.sell(stack))
      if (i === this.selected) {
        const detail = el('div', 'sv-detail', list)
        el('div', '', detail, def.desc)
        const effect = effectText(def)
        if (effect) el('div', 'effect', detail, effect)
      }
    })
    el('div', 'sv-help', right, 'W/S select · E sell one (Shift: all) · Esc close')
    this.panel.querySelectorAll('.sv-list').forEach((l, i) => {
      l.scrollTop = scrolls[i] ?? 0
    })
    const picked = this.revealPick ? list.querySelector('.selected') : null
    this.revealPick = false
    if (picked instanceof HTMLElement) {
      if (picked.offsetTop < list.scrollTop) list.scrollTop = picked.offsetTop - 30
      else if (picked.offsetTop + 60 > list.scrollTop + list.clientHeight)
        list.scrollTop = picked.offsetTop + 90 - list.clientHeight
    }
  }

  // --- The map -------------------------------------------------------------------------------

  /** Roads and lakes never change: painted once. */
  private paintBase(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const g = canvas.getContext('2d')
    if (!g) return canvas
    const s = size / WORLD_SIZE
    const at = (v: number) => (v + WORLD_HALF) * s
    g.fillStyle = '#14180f'
    g.fillRect(0, 0, size, size)
    // Paper grain.
    for (let i = 0; i < 2400; i++) {
      g.fillStyle = i % 2 ? 'rgba(60,70,40,0.25)' : 'rgba(0,0,0,0.25)'
      g.fillRect((i * 7919) % size, (i * 104729) % size, 2, 2)
    }
    g.fillStyle = '#1d3a4f'
    for (const lake of this.def.lakes) {
      g.beginPath()
      g.arc(at(lake.x), at(lake.z), (lake.r + 8) * s, 0, Math.PI * 2)
      g.fill()
    }
    g.lineJoin = 'round'
    for (const road of this.def.roads) {
      g.strokeStyle = road.kind === 'asphalt' ? '#8c8676' : '#5e5340'
      g.lineWidth = road.kind === 'asphalt' ? 3 : 1.5
      g.setLineDash(road.kind === 'asphalt' ? [] : [5, 4])
      g.beginPath()
      road.line.forEach((p, i) => {
        if (i === 0) g.moveTo(at(p.x), at(p.z))
        else g.lineTo(at(p.x), at(p.z))
      })
      g.stroke()
    }
    g.setLineDash([])
    return canvas
  }

  private drawMap(ctx: SurvivalHudContext): void {
    const size = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.84)
    if (this.map.width !== size) {
      this.map.width = this.map.height = size
      this.mapBase = null
    }
    this.mapBase ??= this.paintBase(size)
    const g = this.map.getContext('2d')
    if (!g) return
    const s = size / WORLD_SIZE
    const at = (v: number) => (v + WORLD_HALF) * s
    g.drawImage(this.mapBase, 0, 0)
    g.textAlign = 'center'
    const found = new Set(this.shared?.found ?? [])
    this.def.pois.forEach((poi, i) => {
      if (!found.has(i)) return
      this.drawPlace(g, poi, at(poi.x), at(poi.z))
    })
    // A dashed line from you to the story's next stop.
    const goal = this.goal(ctx.pos)
    if (goal) {
      g.save()
      g.setLineDash([6, 6])
      g.strokeStyle = 'rgb(255 176 48 / 0.7)'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(at(ctx.pos.x), at(ctx.pos.z))
      g.lineTo(at(goal.x), at(goal.z))
      g.stroke()
      g.restore()
    }
    // Where the story (gold rings) and the jobs (teal) want you.
    for (const { state, story } of this.quests()) {
      const goal = this.goalOf(state)
      if (!goal) continue
      for (const [x, , z] of goal.points) {
        g.strokeStyle = story ? '#ffb030' : '#6cc6d8'
        g.lineWidth = 2
        g.beginPath()
        if (goal.area > 0) {
          // A search area: a dashed circle as big as the place.
          g.setLineDash([4, 4])
          g.arc(at(x), at(z), Math.max(8, goal.area * s), 0, Math.PI * 2)
          g.stroke()
          g.setLineDash([])
          continue
        }
        g.arc(at(x), at(z), story ? 9 + 2 * Math.sin(this.clock * 4) : 5, 0, Math.PI * 2)
        g.stroke()
      }
    }
    // Supply drops nobody has opened: a red cross.
    for (const d of this.shared?.drops ?? []) {
      if (d.opened) continue
      g.fillStyle = '#ff4030'
      g.font = 'bold 18px "Pixelify Sans", monospace'
      g.textAlign = 'center'
      g.fillText('✚', at(d.x), at(d.z) + 6)
    }
    // You: an arrow pointing where you look.
    g.save()
    g.translate(at(ctx.pos.x), at(ctx.pos.z))
    g.rotate(-ctx.yaw)
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#000'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(0, -9)
    g.lineTo(6, 7)
    g.lineTo(0, 3)
    g.lineTo(-6, 7)
    g.closePath()
    g.fill()
    g.stroke()
    g.restore()
    // North and a scale.
    g.fillStyle = '#c8c0a0'
    g.font = 'bold 14px "Pixelify Sans", monospace'
    g.fillText('N ▲', size - 34, 26)
    g.fillRect(20, size - 22, 500 * s, 3)
    g.textAlign = 'left'
    g.fillText('500 m', 20, size - 28)
    g.fillText('DEADWOOD COUNTY', 20, 26)
  }

  private drawPlace(g: CanvasRenderingContext2D, poi: Poi, x: number, y: number): void {
    const small =
      poi.kind === 'cabin' ||
      poi.kind === 'campsite' ||
      poi.kind === 'cache' ||
      poi.kind === 'start' ||
      poi.kind === 'house' ||
      poi.kind === 'camper' ||
      poi.kind === 'shed' ||
      poi.kind === 'treehouse' ||
      poi.kind === 'stand'
    g.fillStyle = poi.safe
      ? '#ffb030'
      : poi.kind === 'town'
        ? '#d8d0b0'
        : poi.kind === 'cache'
          ? '#9ad06a'
          : '#a8a088'
    const r = poi.kind === 'town' ? 5 : small ? 2 : 3.5
    if (poi.kind === 'campsite' || poi.kind === 'cache') {
      g.beginPath()
      g.moveTo(x, y - r - 2)
      g.lineTo(x + r + 2, y + r)
      g.lineTo(x - r - 2, y + r)
      g.closePath()
      g.fill()
    } else if (poi.kind === 'treehouse' || poi.kind === 'stand') {
      // Up in the trees: a small mark on a stalk.
      g.fillRect(x - 0.5, y - r, 1, r + 3)
      g.fillRect(x - r, y - r - 3, r * 2, r * 2)
    } else g.fillRect(x - r, y - r, r * 2, r * 2)
    if (poi.kind === 'church') {
      g.fillRect(x - 1, y - r - 7, 2, 7)
      g.fillRect(x - 3, y - r - 5, 6, 2)
    }
    if (small && poi.kind !== 'cache') return
    g.font = `${poi.kind === 'town' || poi.safe ? 'bold 14px' : '11px'} "Pixelify Sans", monospace`
    g.fillStyle = poi.safe ? '#ffb030' : '#c8c0a0'
    g.fillText(poi.name, x, y - r - 5)
  }
}

/** Every quest id there is (for tests). */
export const QUEST_IDS = QUESTS.map((q) => q.id)
