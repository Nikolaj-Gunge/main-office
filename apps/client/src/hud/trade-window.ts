import {
  countOf,
  ITEMS,
  type Stack,
  TRADE_MAX_LINES,
  type TradeLine,
  type TradeOffer,
  type TradeView,
  tradeable,
} from '@office-fps/shared'
import { iconUrl } from './item-icons.ts'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  parent?.append(node)
  return node
}

/** Everything carried, one line per item (stacks added up), in the order first found. */
export function pocketLines(inv: readonly Stack[]): TradeLine[] {
  const out: TradeLine[] = []
  for (const s of inv) {
    if (!tradeable(s.item)) continue
    const line = out.find((l) => l.item === s.item)
    if (line) line.n += s.n
    else out.push({ item: s.item, n: s.n })
  }
  return out
}

/** `offer` with `n` more (or, negative, fewer) of `item`, kept within what is carried. */
export function adjustOffer(
  offer: TradeOffer,
  inv: readonly Stack[],
  item: string,
  n: number,
): TradeOffer {
  const items = offer.items.map((l) => ({ ...l }))
  const have = countOf(inv, item)
  const line = items.find((l) => l.item === item)
  const next = Math.max(0, Math.min(have, (line?.n ?? 0) + n))
  if (line) line.n = next
  else if (next > 0 && items.length < TRADE_MAX_LINES) items.push({ item, n: next })
  return { items: items.filter((l) => l.n > 0), money: offer.money }
}

/**
 * The trade window: your pockets on the left (click to put one on the table, shift-click for
 * all), the table in the middle — what you offer and what they offer — and both confirmations.
 * Any change takes both confirmations back (the server does that too).
 */
export class TradeWindow {
  private readonly root: HTMLDivElement
  private readonly title: HTMLElement
  private readonly pockets: HTMLDivElement
  private readonly mine: HTMLDivElement
  private readonly theirs: HTMLDivElement
  private readonly theirName: HTMLElement
  private readonly mineState: HTMLElement
  private readonly theirState: HTMLElement
  private readonly money: HTMLInputElement
  private readonly theirMoney: HTMLElement
  private readonly confirm: HTMLButtonElement
  private view: TradeView | null = null
  private inv: readonly Stack[] = []
  private wallet = 0
  /** Sends what you offer now. */
  onOffer: (offer: TradeOffer) => void = () => {}
  onConfirm: () => void = () => {}
  onCancel: () => void = () => {}

  constructor(parent: HTMLElement) {
    this.root = el('div', 'trade', parent)
    this.root.hidden = true
    const head = el('div', 'trade-head', this.root)
    this.title = el('span', '', head, 'TRADE')
    el('span', 'trade-hint', head, 'Click: one · Shift-click: all · Esc: walk away')
    const body = el('div', 'trade-body', this.root)

    const left = el('div', 'trade-col', body)
    el('div', 'trade-label', left, 'YOUR POCKETS')
    this.pockets = el('div', 'trade-list', left)

    const middle = el('div', 'trade-col', body)
    const mineHead = el('div', 'trade-label', middle)
    el('span', '', mineHead, 'YOU OFFER')
    this.mineState = el('b', 'trade-ok', mineHead)
    this.mine = el('div', 'trade-list table', middle)
    const cash = el('label', 'trade-cash', middle, '$ ')
    this.money = el('input', '', cash)
    this.money.type = 'number'
    this.money.min = '0'
    this.money.step = '1'
    this.money.value = '0'
    this.money.addEventListener('change', () => this.send({ ...this.offer(), money: this.cash() }))

    const right = el('div', 'trade-col', body)
    const theirHead = el('div', 'trade-label', right)
    this.theirName = el('span', '', theirHead, 'THEY OFFER')
    this.theirState = el('b', 'trade-ok', theirHead)
    this.theirs = el('div', 'trade-list table', right)
    this.theirMoney = el('div', 'trade-cash', right)

    const foot = el('div', 'trade-foot', this.root)
    const cancel = el('button', 'trade-cancel', foot, 'WALK AWAY')
    cancel.type = 'button'
    cancel.addEventListener('click', () => this.onCancel())
    this.confirm = el('button', 'trade-confirm', foot, 'CONFIRM')
    this.confirm.type = 'button'
    this.confirm.addEventListener('click', () => this.onConfirm())
  }

  get open(): boolean {
    return this.view !== null
  }

  /** The trade as the server has it now (null: closed). */
  show(view: TradeView | null): void {
    this.view = view
    this.root.hidden = view === null
    if (view && document.activeElement !== this.money) this.money.value = String(view.mine.money)
    this.draw()
  }

  /** What you carry (to pick from), and your money. */
  setPockets(inv: readonly Stack[], money: number): void {
    if (inv === this.inv && money === this.wallet) return
    this.inv = inv
    this.wallet = money
    this.money.max = String(money)
    if (this.view) this.draw()
  }

  private offer(): TradeOffer {
    return this.view?.mine ?? { items: [], money: 0 }
  }

  private cash(): number {
    const n = Math.floor(Number(this.money.value))
    return Number.isFinite(n) ? Math.max(0, Math.min(this.wallet, n)) : 0
  }

  private send(offer: TradeOffer): void {
    this.onOffer(offer)
  }

  private draw(): void {
    const v = this.view
    if (!v) return
    this.title.textContent = `TRADE WITH ${v.name.toUpperCase()}`
    this.theirName.textContent = `${v.name.toUpperCase()} OFFERS`
    const offered = new Map(v.mine.items.map((l) => [l.item, l.n]))
    this.pockets.replaceChildren(
      ...pocketLines(this.inv).map((line) => {
        const left = line.n - (offered.get(line.item) ?? 0)
        const row = this.row(line.item, left)
        row.classList.toggle('spent', left <= 0)
        row.addEventListener('click', (e) => {
          if (left <= 0) return
          this.send(adjustOffer(this.offer(), this.inv, line.item, e.shiftKey ? left : 1))
        })
        return row
      }),
    )
    if (this.pockets.childElementCount === 0)
      el('div', 'trade-empty', this.pockets, 'Nothing you could hand over.')
    this.mine.replaceChildren(
      ...v.mine.items.map((line) => {
        const row = this.row(line.item, line.n)
        row.title = 'Click to take one back'
        row.addEventListener('click', (e) =>
          this.send(adjustOffer(this.offer(), this.inv, line.item, e.shiftKey ? -line.n : -1)),
        )
        return row
      }),
    )
    if (v.mine.items.length === 0) el('div', 'trade-empty', this.mine, 'Nothing yet.')
    this.theirs.replaceChildren(...v.theirs.items.map((line) => this.row(line.item, line.n)))
    if (v.theirs.items.length === 0) el('div', 'trade-empty', this.theirs, 'Nothing yet.')
    this.theirMoney.textContent = `$ ${v.theirs.money}`
    this.mineState.textContent = v.mineOk ? '✓ READY' : ''
    this.theirState.textContent = v.theirsOk ? '✓ READY' : ''
    this.confirm.disabled = v.mineOk
    this.confirm.textContent = v.mineOk ? `WAITING FOR ${v.name.toUpperCase()}` : 'CONFIRM'
  }

  private row(item: string, n: number): HTMLDivElement {
    const row = el('div', 'trade-row')
    const icon = el('img', '', row)
    icon.src = iconUrl(item)
    icon.alt = ''
    el('span', '', row, ITEMS[item]?.name ?? item)
    el('b', '', row, `×${n}`)
    return row
  }
}
