import {
  cleanPartyCode,
  inviteLink,
  makePartyCode,
  PARTY_PARAM,
  type PartyInfo,
  type PartyRequest,
  type SocialEvent,
  type Stack,
  TRADE_RANGE,
  type TradeRequest,
} from '@office-fps/shared'
import type * as THREE from 'three'
import { CampMarkers, CampPanel } from '../hud/party-hud.ts'
import { TradeWindow } from '../hud/trade-window.ts'

/** The camp this device is in (its code), kept so a reconnect or reload goes back to it. */
const CAMP_KEY = 'office-fps.camp'

export interface PartyDeps {
  hudRoot: HTMLElement
  send: (req: PartyRequest | TradeRequest) => void
  myId: () => number
  headOf: (id: number) => THREE.Vector3 | null
  /** Says something in the chat log (only to you). */
  say: (text: string) => void
  /** The trade window opened (true) or closed: it needs the mouse. */
  onTradeOpen: (open: boolean) => void
}

/**
 * Camps and trading on the client: the code (from an invite link, or our own), the camp panel
 * in the menu, camp-mates' markers, and the trade window.
 */
export class PartyClient {
  party: PartyInfo | null = null
  readonly panel = new CampPanel()
  readonly trade: TradeWindow
  private readonly markers: CampMarkers
  private readonly deps: PartyDeps
  private code: string
  /** Who last asked us to trade, and when (performance.now ms). */
  private asked: { id: number; at: number } | null = null

  constructor(deps: PartyDeps) {
    this.deps = deps
    this.markers = new CampMarkers(deps.hudRoot)
    this.trade = new TradeWindow(deps.hudRoot)
    this.trade.onOffer = (offer) => deps.send({ kind: 'trade', op: 'offer', offer })
    this.trade.onConfirm = () => deps.send({ kind: 'trade', op: 'confirm' })
    this.trade.onCancel = () => deps.send({ kind: 'trade', op: 'cancel' })
    this.panel.onLeave = () => deps.send({ kind: 'party', op: 'leave' })
    // An invite link: that camp, from now on. Taken off the address so a reload doesn't rejoin
    // it after you left.
    const url = new URL(location.href)
    const invited = cleanPartyCode(url.searchParams.get(PARTY_PARAM))
    if (invited) {
      url.searchParams.delete(PARTY_PARAM)
      history.replaceState(null, '', url)
    }
    this.code = invited ?? cleanPartyCode(localStorage.getItem(CAMP_KEY)) ?? makePartyCode()
    localStorage.setItem(CAMP_KEY, this.code)
    this.drawPanel()
  }

  /** The "join my camp" link. */
  get link(): string {
    return inviteLink(location.origin, this.code)
  }

  /** Everyone in the camp but us. */
  mates(): PartyInfo['members'] {
    const me = this.deps.myId()
    return this.party?.members.filter((m) => m.id !== me) ?? []
  }

  /** Joined the game: back into our camp. */
  onWelcome(): void {
    this.deps.send({ kind: 'party', op: 'join', code: this.code })
  }

  /** Left the game. */
  reset(): void {
    this.party = null
    this.asked = null
    this.showTrade(null)
    this.drawPanel()
  }

  /** A camp or trade message (true), or something else for the social client (false). */
  onEvent(e: SocialEvent): boolean {
    switch (e.kind) {
      case 'party':
        this.party = e.party
        this.code = e.party.code
        localStorage.setItem(CAMP_KEY, this.code)
        this.drawPanel()
        return true
      case 'trade':
        this.showTrade(e.trade)
        return true
      case 'tradeAsk':
        this.asked = { id: e.from, at: performance.now() }
        this.deps.say(`${e.name} wants to trade. Look at them and press G.`)
        return true
      default:
        return false
    }
  }

  /**
   * G: ask whoever we're looking at (within reach) to trade, or answer whoever asked us.
   * @param facing the player in the crosshair, and how far they are
   */
  askTrade(facing: { id: number; distance: number } | null): void {
    if (this.trade.open) return
    const asked = this.asked && performance.now() - this.asked.at < 30_000 ? this.asked.id : null
    const id = facing && facing.distance <= TRADE_RANGE ? facing.id : asked
    if (id === null) return void this.deps.say('Nobody close enough to trade with.')
    this.deps.send({ kind: 'trade', op: 'ask', id })
  }

  /** Keeps the trade window's pockets current. */
  setPockets(inv: readonly Stack[], money: number): void {
    this.trade.setPockets(inv, money)
  }

  /** Esc while trading walks away from it. */
  cancelTrade(): boolean {
    if (!this.trade.open) return false
    this.deps.send({ kind: 'trade', op: 'cancel' })
    return true
  }

  /** Camp-mates' markers (survival only). */
  update(camera: THREE.Camera, show: boolean): void {
    this.markers.update(camera, this.mates(), this.deps.headOf, show)
  }

  private showTrade(view: Parameters<TradeWindow['show']>[0]): void {
    const was = this.trade.open
    this.trade.show(view)
    if (was !== this.trade.open) this.deps.onTradeOpen(this.trade.open)
  }

  private drawPanel(): void {
    this.panel.set(this.party, this.link, this.deps.myId())
  }
}
