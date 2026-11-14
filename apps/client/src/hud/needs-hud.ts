import { EFFECTS, type EffectId, effectsOf, type SurvivalSelf } from '@office-fps/shared'

/**
 * Buffs and statuses under the vitals: a small square icon and a name for each, with a one-line
 * tooltip saying what it does and how to fix it (hover with the backpack open). Food poisoning
 * also blurs the edges of the screen.
 */
export class NeedsHud {
  private readonly row: HTMLDivElement
  private readonly chips = new Map<EffectId, { node: HTMLElement; name: HTMLElement }>()
  private readonly nausea: HTMLDivElement
  private shown = ''
  private seen: SurvivalSelf | null = null
  private effects: readonly EffectId[] = []

  /** `vitals`: where the chips go; `screen`: what the nausea overlay covers. */
  constructor(vitals: HTMLElement, screen: HTMLElement) {
    this.row = document.createElement('div')
    this.row.className = 'sv-effects'
    vitals.append(this.row)
    this.nausea = document.createElement('div')
    this.nausea.className = 'sv-nausea'
    this.nausea.hidden = true
    screen.prepend(this.nausea)
  }

  /** Every frame (cheap: works things out again only when the server sent something new). */
  update(self: SurvivalSelf): void {
    if (self !== this.seen) {
      this.seen = self
      this.effects = effectsOf(self)
    }
    const effects = this.effects
    const key = effects.join(',')
    if (key !== this.shown) {
      this.shown = key
      this.row.replaceChildren()
      for (const id of effects) this.row.append(this.chip(id).node)
      this.nausea.hidden = !effects.includes('sick')
    }
    // Rested counts down in minutes.
    const rested = this.chips.get('rested')
    if (rested && effects.includes('rested')) {
      const min = Math.ceil((self.needs?.rested ?? 0) / 60)
      const text = `${EFFECTS.rested.name} ${min}m`
      if (rested.name.textContent !== text) rested.name.textContent = text
    }
  }

  private chip(id: EffectId): { node: HTMLElement; name: HTMLElement } {
    const known = this.chips.get(id)
    if (known) return known
    const fx = EFFECTS[id]
    const node = document.createElement('div')
    node.className = `sv-effect ${fx.good ? 'good' : 'bad'}`
    node.dataset.effect = id
    node.dataset.tip = fx.tip
    node.title = fx.tip
    const icon = document.createElement('b')
    icon.className = 'sv-effect-icon'
    icon.textContent = fx.icon
    const name = document.createElement('span')
    name.textContent = fx.name
    node.append(icon, name)
    const chip = { node, name }
    this.chips.set(id, chip)
    return chip
  }
}
