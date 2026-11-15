import {
  ARMBAND,
  groundAt,
  type StandingTag,
  type SurvivalDef,
  unpackStanding,
} from '@office-fps/shared'
import type { RemotePlayers } from './remote-players.ts'

/**
 * PvP by choice, as you see it (the rules are the server's, survival/pvp.ts): a small mark on
 * the HUD while you stand on Lawless ground, and everybody's armband and Oathbreaker mark put on
 * their bodies as the server tells them (SurvivalShared.standing).
 */
export class PvpView {
  private readonly def: SurvivalDef
  private readonly icon: HTMLDivElement
  private inside = false
  private packed: readonly number[] | undefined
  private tags = new Map<number, StandingTag>()

  constructor(hudRoot: HTMLElement, def: SurvivalDef) {
    this.def = def
    this.icon = document.createElement('div')
    this.icon.className = 'sv-lawless'
    this.icon.title = 'Lawless ground: anyone can shoot you'
    this.icon.innerHTML = '<i class="sv-lawless-mark">!</i><span>Lawless</span>'
    this.icon.hidden = true
    hudRoot.append(this.icon)
  }

  update(
    pos: { x: number; z: number },
    alive: boolean,
    remotes: RemotePlayers,
    standing: readonly number[] | undefined,
  ): void {
    const inside = alive && groundAt(this.def.pois, pos) === 'lawless'
    if (inside !== this.inside) {
      this.inside = inside
      this.icon.hidden = !inside
    }
    if (standing !== this.packed) {
      this.packed = standing
      this.tags = unpackStanding(standing)
    }
    // Cheap per avatar: setStanding only rebuilds anything when the look changes.
    remotes.forEachAvatar((id, avatar) => {
      const tag = remotes.kindOf(id) === 0 ? this.tags.get(id) : undefined
      avatar.setStanding(tag ? ARMBAND[tag.standing] : null, tag?.oathbreaker ?? false)
    })
  }
}
