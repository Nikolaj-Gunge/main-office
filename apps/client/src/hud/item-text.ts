import {
  GEAR,
  INFECTION_SECONDS,
  type ItemDef,
  pocketsOf,
  sizeOf,
  WEAPONS,
} from '@office-fps/shared'

/** What using an item does, in a few words. */
export function effectText(def: ItemDef): string {
  const parts: string[] = []
  const signed = (v: number, what: string) => parts.push(`${v > 0 ? '+' : ''}${v} ${what}`)
  if (def.hunger) signed(def.hunger, 'food')
  if (def.thirst) signed(def.thirst, 'water')
  if (def.health) signed(def.health, 'health')
  if (def.stamina) parts.push('restores breath')
  if (def.stopsBleeding) parts.push('stops bleeding')
  if (def.infection === 'delay')
    parts.push(`holds off the turn (${INFECTION_SECONDS / 60} min again)`)
  if (def.infection === 'cure') parts.push('cures the bite')
  const pockets = pocketsOf(def.id)
  if (pockets) parts.push(`${pockets[0]}×${pockets[1]} ${def.kind === 'pack' ? 'pack' : 'pockets'}`)
  const gear = GEAR[def.id]
  if (gear) {
    parts.push(`worn on the ${gear.slot}`)
    if (gear.armour) parts.push(`stops ${Math.round(gear.armour * 100)}% damage`)
    if (gear.stealth) parts.push(`${Math.round(gear.stealth * 100)}% harder to see`)
    if (gear.quiet && gear.quiet > 0) parts.push(`${Math.round(gear.quiet * 100)}% quieter`)
    if (gear.quiet && gear.quiet < 0) parts.push('a bit noisy')
  }
  if (def.battery) parts.push('recharges the torch')
  if (def.weapon !== undefined) {
    const w = WEAPONS[def.weapon]
    parts.push(
      w.slot === 'melee'
        ? `melee · ${w.damage} damage`
        : `${w.ammoType} · ${w.magSize} rounds · ${w.damage * (w.pellets ?? 1)} damage`,
    )
  }
  return parts.join(' · ')
}

/** "2×2 · 0.9 kg": how much room and weight something takes. */
export function bulkText(def: ItemDef, n = 1): string {
  const [w, h] = sizeOf(def.id)
  const kg = def.weight * n
  return `${w}×${h} · ${kg >= 10 ? kg.toFixed(0) : kg.toFixed(kg < 0.1 ? 2 : 1)} kg`
}
