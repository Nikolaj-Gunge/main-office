import {
  CONTAINERS,
  type ContainerId,
  cellsUsed,
  type EquipSlot,
  fitsAt,
  footprint,
  gridOf,
  type Held,
  ITEMS,
  type ItemDef,
  type ItemDest,
  type ItemRef,
  infectionClock,
  infectionWord,
  type LootItem,
  maxStack,
  type SurvivalAction,
  type SurvivalSelf,
  sizeOf,
  slotFor,
  stackAt,
  WEAPONS,
  type WeaponId,
  weightOf,
} from '@office-fps/shared'
import { iconUrl } from './item-icons.ts'
import { bulkText, effectText } from './item-text.ts'

/** One grid cell on screen (CSS px). */
const CELL = 34
/** The vicinity panel is this many cells wide. */
const NEAR_COLS = 8
const NEAR_ROWS = 14

/** What the inventory needs to know besides your pockets: hands, the ground, the bite. */
export interface InventoryContext {
  carried: readonly { id: WeaponId; ammo: number }[]
  /** Things lying within reach (see VICINITY). */
  nearby: readonly LootItem[]
  infected: number | null
}

/** Something you can pick up with the mouse. */
interface Grab {
  ref: ItemRef
  item: string
  /** How many are in the stack. */
  n: number
  ammo?: number
  /** As it lies now. */
  r: 0 | 1
  stack?: Held
  slot?: EquipSlot
  ground?: boolean
}

/** A grab in progress: what, how many, which way round, and which of its cells is under the mouse. */
interface Drag extends Grab {
  move: number
  offX: number
  offY: number
  ghost: HTMLElement
  from: HTMLElement
}

/** Where a drop would land, and whether the server will take it. */
type Target = { to: ItemDest; ok: boolean; box?: { grid: HTMLElement; x: number; y: number } }

/** What the paper doll shows for an empty slot. */
const EMPTY: Record<EquipSlot, string> = {
  head: '—',
  body: 'Tank top',
  legs: 'Joggers',
  feet: 'Barefoot',
  pack: 'No backpack',
  primary: '—',
  sidearm: '—',
  melee: '—',
}
const SLOT_NAME: Record<EquipSlot, string> = {
  head: 'HEAD',
  body: 'BODY',
  legs: 'LEGS',
  feet: 'FEET',
  pack: 'BACKPACK',
  primary: 'PRIMARY',
  sidearm: 'SIDEARM',
  melee: 'MELEE',
}
const SLOT_KEY: Partial<Record<EquipSlot, string>> = { primary: '1', sidearm: '2', melee: '3' }
const CONTAINER_NAME: Record<ContainerId, string> = {
  body: 'Tank top',
  legs: 'Joggers',
  pack: 'Backpack',
}

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

/** What "use" does to it, as a verb (null: nothing). */
export function useVerb(def: ItemDef): string | null {
  if (def.weapon !== undefined) return 'Equip'
  if (def.kind === 'pack' || def.kind === 'wear') return 'Wear'
  if (def.kind === 'food') return 'Eat'
  if (def.kind === 'drink') return 'Drink'
  if (def.kind === 'med') return 'Use'
  if (def.battery) return 'Load torch'
  return null
}

/**
 * The inventory screen, DayZ style: VICINITY (what lies around you), EQUIPMENT (what you wear
 * and hold) and INVENTORY (the pocket grids of your clothes and backpack). Drag things between
 * them; R turns what you're dragging, Shift picks up half a stack; right-click for what you can
 * do with it, double-click to just do it. Everything is asked of the server, which says yes or no.
 */
export class InventoryScreen {
  readonly root: HTMLDivElement
  private readonly send: (action: SurvivalAction) => void
  private readonly sound: (cue: string) => void
  private self: SurvivalSelf | null = null
  private ctx: InventoryContext = { carried: [], nearby: [], infected: null }
  private ctxKey = ''
  private readonly tip: HTMLDivElement
  private readonly menu: HTMLDivElement
  private readonly preview: HTMLDivElement
  private press: { grab: Grab; x: number; y: number; el: HTMLElement; shift: boolean } | null = null
  private drag: Drag | null = null
  private stale = false
  private shown = false
  private readonly grabs = new WeakMap<HTMLElement, Grab>()

  constructor(
    parent: HTMLElement,
    send: (action: SurvivalAction) => void,
    sound: (cue: string) => void,
  ) {
    this.send = send
    this.sound = sound
    this.root = el('div', 'sv-inv', parent)
    this.root.hidden = true
    this.tip = el('div', 'sv-tip', parent)
    this.tip.hidden = true
    this.menu = el('div', 'sv-ctx', parent)
    this.menu.hidden = true
    this.preview = el('div', 'sv-drop')
    this.root.addEventListener('contextmenu', (e) => e.preventDefault())
    this.menu.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('pointermove', (e) => this.onMove(e))
    window.addEventListener('pointerup', (e) => this.onUp(e))
    window.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.closeMenu()
    })
  }

  get open(): boolean {
    return this.shown
  }

  setOpen(on: boolean): void {
    this.shown = on
    this.root.hidden = !on
    if (!on) {
      this.cancelDrag()
      this.closeMenu()
      this.tip.hidden = true
    } else this.draw()
  }

  setSelf(self: SurvivalSelf): void {
    this.self = self
    this.redraw()
  }

  /** Hands, the ground and the bite, every frame: redrawn only when something changed. */
  setContext(ctx: InventoryContext): void {
    const key = JSON.stringify([
      ctx.carried.map((w) => [w.id, w.ammo]),
      ctx.nearby.map((l) => [l.id, l.n]),
      infectionWord(ctx.infected),
    ])
    this.ctx = ctx
    if (key === this.ctxKey) return
    this.ctxKey = key
    this.redraw()
  }

  /** A key while open: R turns what you're dragging. True if it was used. */
  key(code: string): boolean {
    if (code === 'KeyR' && this.drag) {
      this.rotate()
      return true
    }
    if (code === 'Escape' && (this.drag || !this.menu.hidden)) {
      this.cancelDrag()
      this.closeMenu()
      return true
    }
    return false
  }

  private redraw(): void {
    if (!this.shown) return
    // Never pull the floor out from under a drag: draw when it's over.
    if (this.drag || this.press) this.stale = true
    else this.draw()
  }

  // --- Drawing ---------------------------------------------------------------------------------

  private draw(): void {
    const self = this.self
    if (!self) return
    this.stale = false
    const scroll = [...this.root.querySelectorAll('.sv-inv-col')].map((c) => c.scrollTop)
    this.root.replaceChildren()
    this.tip.hidden = true
    const head = el('div', 'sv-panel-head', this.root)
    el('b', '', head, 'INVENTORY')
    el('span', 'sv-panel-money', head, `$${self.money}`)
    const body = el('div', 'sv-inv-body', this.root)
    this.drawVicinity(el('div', 'sv-inv-col near', body))
    this.drawEquipment(el('div', 'sv-inv-col equip', body))
    this.drawPockets(el('div', 'sv-inv-col pockets', body))
    el(
      'div',
      'sv-help',
      this.root,
      'Drag to move · R turn · Shift-drag half a stack · Right-click: actions · Double-click: use · Tab close',
    )
    ;[...this.root.querySelectorAll('.sv-inv-col')].forEach((c, i) => {
      c.scrollTop = scroll[i] ?? 0
    })
  }

  private drawVicinity(col: HTMLElement): void {
    el('div', 'sv-inv-title', col, 'VICINITY')
    const grid = el('div', 'sv-grid near', col)
    grid.dataset.ground = '1'
    // Laid out first-fit, the way they'd lie if you spread them out in front of you.
    const taken: boolean[][] = []
    const free = (x: number, y: number, w: number, h: number) => {
      if (x + w > NEAR_COLS) return false
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) if (taken[j]?.[i]) return false
      return true
    }
    let rows = NEAR_ROWS
    const placed: { loot: LootItem; x: number; y: number; r: 0 | 1 }[] = []
    for (const loot of [...this.ctx.nearby].sort((a, b) => a.id - b.id)) {
      const [w0, h0] = sizeOf(loot.item)
      const r: 0 | 1 = w0 > NEAR_COLS ? 1 : 0
      const [w, h] = r ? [h0, w0] : [w0, h0]
      let spot: [number, number] | null = null
      for (let y = 0; !spot; y++) {
        for (let x = 0; x + w <= NEAR_COLS && !spot; x++) if (free(x, y, w, h)) spot = [x, y]
      }
      const [x, y] = spot
      for (let j = y; j < y + h; j++) {
        taken[j] ??= []
        for (let i = x; i < x + w; i++) (taken[j] as boolean[])[i] = true
      }
      rows = Math.max(rows, y + h)
      placed.push({ loot, x, y, r })
    }
    this.sizeGrid(grid, NEAR_COLS, rows)
    for (const { loot, x, y, r } of placed) {
      const grab: Grab = { ref: { g: loot.id }, item: loot.item, n: loot.n, r, ground: true }
      this.itemEl(grid, grab, { x, y })
    }
    if (placed.length === 0) el('div', 'sv-grid-empty', grid, 'Nothing on the ground here.')
  }

  private drawEquipment(col: HTMLElement): void {
    const self = this.self as SurvivalSelf
    el('div', 'sv-inv-title', col, 'EQUIPMENT')
    const doll = el('div', 'sv-doll', col)
    const slot = (s: EquipSlot) => {
      const box = el('div', `sv-eq ${s}`, doll)
      box.dataset.slot = s
      el('span', 'sv-eq-name', box, SLOT_NAME[s])
      const key = SLOT_KEY[s]
      if (key) el('span', 'sv-eq-key', box, key)
      let item: string | null = null
      let info = ''
      let grab: Grab | null = null
      const weapon = this.ctx.carried.find((w) => WEAPONS[w.id].slot === s)
      if (weapon) {
        item = Object.values(ITEMS).find((d) => d.weapon === weapon.id)?.id ?? null
        const def = WEAPONS[weapon.id]
        if (def.slot !== 'melee') info = `${weapon.ammo}/${def.magSize}`
        if (item) grab = { ref: { slot: s }, item, n: 1, ammo: weapon.ammo, r: 0, slot: s }
      } else {
        const worn = s === 'pack' ? self.pack : s in self.wear ? self.wear[s as 'head'] : undefined
        if (worn) {
          item = worn
          grab = { ref: { slot: s }, item, n: 1, r: 0, slot: s }
        }
      }
      if (s === 'body' || s === 'legs' || s === 'pack') {
        const { used, total } = cellsUsed(self, s)
        if (total > 0) info = `${used}/${total}`
      }
      if (grab && item) this.itemEl(box, grab, { fill: true })
      else el('span', 'sv-eq-empty', box, EMPTY[s])
      el('span', 'sv-eq-title', box, item ? (ITEMS[item]?.name ?? item) : '')
      if (info) el('span', 'sv-eq-info', box, info)
    }
    for (const s of [
      'head',
      'body',
      'pack',
      'primary',
      'melee',
      'legs',
      'sidearm',
      'feet',
    ] as const)
      slot(s)
    const stats = el('div', 'sv-eq stats', doll)
    const kg = weightOf(self.inv)
    el('div', '', stats, `Carrying ${kg >= 10 ? kg.toFixed(0) : kg.toFixed(1)} kg`)
    el('div', 'money', stats, `$${self.money}`)
    // Bitten: how it's going, and roughly how long you have (only ever said here).
    const turnIn = this.ctx.infected ?? self.infected ?? null
    if (turnIn !== null) {
      el('div', 'sv-condition', stats, `Infected — ${infectionWord(turnIn).toLowerCase()}.`)
      el('div', 'sv-condition-help', stats, `${infectionClock(turnIn)} left.`)
    }
  }

  private drawPockets(col: HTMLElement): void {
    const self = this.self as SurvivalSelf
    el('div', 'sv-inv-title', col, 'INVENTORY')
    for (const c of CONTAINERS) {
      const wearing = c === 'pack' ? self.pack : self.wear[c]
      const grid = gridOf(self, c)
      const head = el('div', 'sv-cont-head', col)
      el('span', '', head, wearing ? (ITEMS[wearing]?.name ?? wearing) : CONTAINER_NAME[c])
      if (!grid) {
        el('div', 'sv-cont-none', col, 'No backpack. Find one to carry more.')
        continue
      }
      const { used, total } = cellsUsed(self, c)
      el('span', 'sv-cont-cap', head, `${used}/${total}`)
      const node = el('div', 'sv-grid', col)
      node.dataset.c = c
      this.sizeGrid(node, grid[0], grid[1])
      for (const s of self.inv) {
        if (s.c !== c) continue
        const grab: Grab = {
          ref: { c, x: s.x, y: s.y },
          item: s.item,
          n: s.n,
          r: s.r ?? 0,
          stack: s,
          ...(s.ammo !== undefined ? { ammo: s.ammo } : {}),
        }
        this.itemEl(node, grab, { x: s.x, y: s.y })
      }
    }
  }

  private sizeGrid(node: HTMLElement, w: number, h: number): void {
    node.style.width = `${w * CELL}px`
    node.style.height = `${h * CELL}px`
    node.style.backgroundSize = `${CELL}px ${CELL}px`
  }

  /** One thing, in a grid cell (at x, y) or filling an equipment slot. */
  private itemEl(parent: HTMLElement, grab: Grab, at: { x?: number; y?: number; fill?: boolean }) {
    const def = ITEMS[grab.item]
    const node = el('div', at.fill ? 'sv-item fill' : 'sv-item', parent)
    if (!at.fill) {
      const [w, h] = footprint(grab.item, grab.r)
      node.style.left = `${(at.x ?? 0) * CELL}px`
      node.style.top = `${(at.y ?? 0) * CELL}px`
      node.style.width = `${w * CELL}px`
      node.style.height = `${h * CELL}px`
    }
    const img = el('img', '', node)
    img.src = iconUrl(grab.item, at.fill ? 0 : grab.r)
    img.draggable = false
    if (grab.n > 1) el('span', 'sv-item-n', node, `${grab.n}`)
    if (!at.fill && def?.weapon !== undefined && WEAPONS[def.weapon].slot !== 'melee') {
      el('span', 'sv-item-ammo', node, `${grab.ammo ?? 0}`)
    }
    if (def?.kind === 'quest') node.classList.add('quest')
    this.grabs.set(node, grab)
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      this.closeMenu()
      this.press = { grab, x: e.clientX, y: e.clientY, el: node, shift: e.shiftKey }
    })
    node.addEventListener('dblclick', () => this.quick(grab))
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.openMenu(grab, e.clientX, e.clientY)
    })
    node.addEventListener('pointerenter', (e) => this.showTip(grab, e.clientX, e.clientY))
    node.addEventListener('pointermove', (e) => {
      if (!this.drag) this.placeTip(e.clientX, e.clientY)
    })
    node.addEventListener('pointerleave', () => {
      this.tip.hidden = true
    })
    return node
  }

  // --- Tooltip and menu ------------------------------------------------------------------------

  private showTip(grab: Grab, x: number, y: number): void {
    if (this.drag || !this.menu.hidden) return
    const def = ITEMS[grab.item]
    if (!def) return
    this.tip.replaceChildren()
    el('b', 'sv-tip-name', this.tip, `${def.name}${grab.n > 1 ? ` ×${grab.n}` : ''}`)
    el('div', '', this.tip, def.desc)
    const effect = effectText(def)
    if (effect) el('div', 'effect', this.tip, effect)
    const loaded =
      def.weapon !== undefined && WEAPONS[def.weapon].slot !== 'melee'
        ? ` · ${grab.ammo ?? 0}/${WEAPONS[def.weapon].magSize} loaded`
        : ''
    el('div', 'bulk', this.tip, `${bulkText(def, grab.n)}${loaded}`)
    this.tip.hidden = false
    this.placeTip(x, y)
  }

  private placeTip(x: number, y: number): void {
    if (this.tip.hidden) return
    const w = this.tip.offsetWidth
    const h = this.tip.offsetHeight
    const left = x + 16 + w > window.innerWidth ? x - w - 12 : x + 16
    const top = Math.min(window.innerHeight - h - 6, y + 12)
    this.tip.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`
  }

  /** What right-clicking it offers. */
  private actions(grab: Grab): [string, () => void][] {
    const def = ITEMS[grab.item]
    if (!def) return []
    const out: [string, () => void][] = []
    const use = () => this.act({ a: 'use', from: grab.ref })
    const move = (to: ItemDest, n?: number) =>
      this.act({ a: 'move', from: grab.ref, to, ...(n !== undefined ? { n } : {}) })
    if (grab.slot) {
      const hand = grab.slot === 'primary' || grab.slot === 'sidearm' || grab.slot === 'melee'
      out.push([hand ? 'Put away' : 'Take off', () => move({ auto: true })])
      out.push(['Drop', () => move({ ground: true })])
      return out
    }
    const verb = useVerb(def)
    if (grab.ground) {
      out.push([def.kind === 'money' ? `Take $${grab.n}` : 'Take', () => move({ auto: true })])
      if (verb) out.push([verb, use])
      return out
    }
    if (verb) out.push([verb, use])
    if (grab.n > 1) out.push(['Drop one', () => move({ ground: true }, 1)])
    out.push([grab.n > 1 ? 'Drop all' : 'Drop', () => move({ ground: true })])
    return out
  }

  private openMenu(grab: Grab, x: number, y: number): void {
    this.cancelDrag()
    this.tip.hidden = true
    const actions = this.actions(grab)
    if (actions.length === 0) return
    this.menu.replaceChildren()
    el('div', 'sv-ctx-title', this.menu, ITEMS[grab.item]?.name ?? grab.item)
    for (const [label, run] of actions) {
      const b = el('button', 'sv-ctx-item', this.menu, label)
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.closeMenu()
        run()
      })
    }
    this.menu.hidden = false
    const w = this.menu.offsetWidth
    const h = this.menu.offsetHeight
    this.menu.style.left = `${Math.min(x, window.innerWidth - w - 4)}px`
    this.menu.style.top = `${Math.min(y, window.innerHeight - h - 4)}px`
  }

  private closeMenu(): void {
    this.menu.hidden = true
  }

  /** Double-click: the obvious thing (take from the ground, use, put on, take off). */
  private quick(grab: Grab): void {
    const def = ITEMS[grab.item]
    if (!def) return
    if (grab.ground && !useVerb(def)) this.act({ a: 'move', from: grab.ref, to: { auto: true } })
    else if (grab.slot || useVerb(def)) this.act({ a: 'use', from: grab.ref })
    else this.sound('deny')
  }

  private act(action: SurvivalAction): void {
    this.send(action)
    this.sound('use')
  }

  // --- Drag and drop ---------------------------------------------------------------------------

  private onMove(e: PointerEvent): void {
    if (this.press && !this.drag) {
      if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < 5) return
      this.startDrag(e)
    }
    const drag = this.drag
    if (!drag) return
    const [w, h] = footprint(drag.item, drag.r)
    drag.ghost.style.width = `${w * CELL}px`
    drag.ghost.style.height = `${h * CELL}px`
    drag.ghost.style.transform = `translate(${e.clientX - (drag.offX + 0.5) * CELL}px, ${e.clientY - (drag.offY + 0.5) * CELL}px)`
    this.showTarget(this.targetAt(e.clientX, e.clientY))
    this.last = { x: e.clientX, y: e.clientY }
  }

  private last = { x: 0, y: 0 }

  private startDrag(e: PointerEvent): void {
    const press = this.press
    if (!press) return
    const { grab, el: from } = press
    const half = press.shift && grab.n > 1 && !grab.slot
    // Which of its cells you grabbed it by (the middle, from a slot).
    const [w, h] = footprint(grab.item, grab.r)
    let offX = Math.floor(w / 2)
    let offY = Math.floor(h / 2)
    if (!from.classList.contains('fill')) {
      const rect = from.getBoundingClientRect()
      offX = Math.max(0, Math.min(w - 1, Math.floor((press.x - rect.left) / CELL)))
      offY = Math.max(0, Math.min(h - 1, Math.floor((press.y - rect.top) / CELL)))
    }
    const ghost = el('div', 'sv-item ghost', this.root.parentElement ?? this.root)
    const img = el('img', '', ghost)
    img.src = iconUrl(grab.item, grab.r)
    const move = half ? Math.ceil(grab.n / 2) : grab.n
    if (grab.n > 1) el('span', 'sv-item-n', ghost, `${move}`)
    from.classList.add('lifted')
    this.tip.hidden = true
    this.drag = { ...grab, move, offX, offY, ghost, from }
    this.last = { x: e.clientX, y: e.clientY }
  }

  private rotate(): void {
    const drag = this.drag
    if (!drag) return
    drag.r = drag.r ? 0 : 1
    const [w, h] = footprint(drag.item, drag.r)
    drag.offX = Math.floor(w / 2)
    drag.offY = Math.floor(h / 2)
    const img = drag.ghost.querySelector('img')
    if (img) img.src = iconUrl(drag.item, drag.r)
    this.onMove(new PointerEvent('pointermove', { clientX: this.last.x, clientY: this.last.y }))
  }

  /** What's under the mouse, and would the drop work there? */
  private targetAt(x: number, y: number): Target | null {
    const drag = this.drag
    const self = this.self
    if (!drag || !self) return null
    const under = document.elementFromPoint(x, y)
    if (!(under instanceof HTMLElement)) return null
    const slotNode = under.closest<HTMLElement>('[data-slot]')
    if (slotNode) {
      const slot = slotNode.dataset.slot as EquipSlot
      return { to: { slot }, ok: drag.slot !== slot && slotFor(drag.item) === slot }
    }
    if (under.closest('[data-ground]')) return { to: { ground: true }, ok: !drag.ground }
    const grid = under.closest<HTMLElement>('[data-c]')
    if (!grid) return null
    const c = grid.dataset.c as ContainerId
    const rect = grid.getBoundingClientRect()
    const cx = Math.floor((x - rect.left) / CELL)
    const cy = Math.floor((y - rect.top) / CELL)
    // Onto the same thing: top it up.
    const onto = stackAt(self.inv, c, cx, cy)
    if (onto && onto !== drag.stack && onto.item === drag.item && maxStack(drag.item) > 1) {
      return {
        to: { c, x: onto.x, y: onto.y },
        ok: onto.n < maxStack(drag.item),
        box: { grid, x: onto.x, y: onto.y },
      }
    }
    const tx = cx - drag.offX
    const ty = cy - drag.offY
    const [w, h] = footprint(drag.item, drag.r)
    // The stack being moved doesn't get in its own way (unless half of it stays behind).
    const skip = drag.stack && drag.move === drag.n ? drag.stack : undefined
    const ok = fitsAt(self, c, tx, ty, w, h, skip)
    return { to: { c, x: tx, y: ty, ...(drag.r ? { r: 1 } : {}) }, ok, box: { grid, x: tx, y: ty } }
  }

  private showTarget(t: Target | null): void {
    for (const n of this.root.querySelectorAll('.hover-ok, .hover-bad'))
      n.classList.remove('hover-ok', 'hover-bad')
    const drag = this.drag
    if (!t || !drag) {
      this.preview.remove()
      return
    }
    if (t.box) {
      const [w, h] = footprint(drag.item, drag.r)
      this.preview.className = t.ok ? 'sv-drop ok' : 'sv-drop bad'
      this.preview.style.left = `${t.box.x * CELL}px`
      this.preview.style.top = `${t.box.y * CELL}px`
      this.preview.style.width = `${w * CELL}px`
      this.preview.style.height = `${h * CELL}px`
      if (this.preview.parentElement !== t.box.grid) t.box.grid.append(this.preview)
      return
    }
    this.preview.remove()
    const node =
      'slot' in t.to
        ? this.root.querySelector(`[data-slot="${t.to.slot}"]`)
        : this.root.querySelector('[data-ground]')
    node?.classList.add(t.ok ? 'hover-ok' : 'hover-bad')
  }

  private onUp(e: PointerEvent): void {
    const drag = this.drag
    this.press = null
    if (drag) {
      const t = this.targetAt(e.clientX, e.clientY)
      this.cancelDrag()
      if (t?.ok) {
        const n = drag.move < drag.n ? { n: drag.move } : {}
        this.act({ a: 'move', from: drag.ref, to: t.to, ...n })
      } else if (t) this.sound('deny')
    }
    if (this.stale) this.draw()
  }

  private cancelDrag(): void {
    const drag = this.drag
    this.drag = null
    this.press = null
    this.preview.remove()
    if (!drag) return
    drag.ghost.remove()
    drag.from.classList.remove('lifted')
    this.showTarget(null)
  }
}
