import { HitZone, MAX_PLAYERS, WEAPONS, WeaponId, type WeaponState } from '@office-fps/shared'

const KILLFEED_SECONDS = 6
const KILLFEED_MAX = 5
const DAMAGE_INDICATOR_SECONDS = 1.5

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
) {
  const node = document.createElement(tag)
  node.className = className
  parent?.append(node)
  return node
}

/**
 * In-game HUD (PLAN.md §6): your own health bar (nobody else's), ammo, dynamic crosshair, hit
 * markers, kill feed, damage direction, low-health vignette and the death screen.
 */
export class CombatHud {
  private readonly healthFill: HTMLDivElement
  private readonly healthText: HTMLSpanElement
  private readonly healthBox: HTMLDivElement
  private readonly ammo: HTMLDivElement
  private readonly ammoCount: HTMLSpanElement
  private readonly ammoReserve: HTMLSpanElement
  private readonly ammoNote: HTMLDivElement
  private readonly crosshair: HTMLDivElement
  private readonly hitmarkerEl: HTMLDivElement
  private readonly killfeed: HTMLDivElement
  private readonly damageRing: HTMLDivElement
  private readonly vignette: HTMLDivElement
  private readonly death: HTMLDivElement
  private readonly deathLoadout: HTMLDivElement
  private readonly slots: HTMLDivElement
  private readonly scope: HTMLDivElement
  private readonly breathFill: HTMLDivElement
  private readonly deathText: HTMLDivElement
  private readonly deathTimer: HTMLDivElement
  private readonly protectedLabel: HTMLDivElement
  private readonly indicators: {
    node: HTMLDivElement
    from: { x: number; z: number }
    life: number
  }[] = []

  constructor(root: HTMLElement) {
    this.vignette = el('div', 'hud-vignette', root)

    this.healthBox = el('div', 'hud-health', root)
    const bar = el('div', 'hud-health-bar', this.healthBox)
    this.healthFill = el('div', 'hud-health-fill', bar)
    this.healthText = el('span', 'hud-health-text', this.healthBox)

    this.ammo = el('div', 'hud-ammo', root)
    const counts = el('div', 'hud-ammo-counts', this.ammo)
    this.ammoCount = el('span', 'hud-ammo-mag', counts)
    this.ammoReserve = el('span', 'hud-ammo-reserve', counts)
    this.ammoNote = el('div', 'hud-ammo-note', this.ammo)

    this.crosshair = el('div', 'hud-crosshair', root)
    for (const side of ['top', 'bottom', 'left', 'right']) el('div', `line ${side}`, this.crosshair)
    el('div', 'dot', this.crosshair)

    this.hitmarkerEl = el('div', 'hud-hitmarker', root)
    for (let i = 0; i < 4; i++) el('div', `tick t${i}`, this.hitmarkerEl)

    this.killfeed = el('div', 'hud-killfeed', root)
    this.damageRing = el('div', 'hud-damage-ring', root)
    this.protectedLabel = el('div', 'hud-protected', root)
    this.protectedLabel.textContent = 'SPAWN PROTECTION'

    this.death = el('div', 'hud-death', root)
    this.deathText = el('div', 'hud-death-text', this.death)
    this.deathTimer = el('div', 'hud-death-timer', this.death)
    this.deathLoadout = el('div', 'hud-death-loadout', this.death)
    this.slots = el('div', 'hud-slots', this.ammo)
    this.scope = el('div', 'hud-scope', root)
    el('div', 'hud-scope-cross', this.scope)
    const breath = el('div', 'hud-scope-breath', this.scope)
    this.breathFill = el('div', 'hud-scope-breath-fill', breath)
    this.scope.hidden = true
    this.death.hidden = true

    this.setHealth(100)
  }

  setHealth(health: number): void {
    const h = Math.max(0, Math.min(100, health))
    this.healthFill.style.width = `${h}%`
    this.healthText.textContent = String(Math.ceil(h))
    this.healthBox.classList.toggle('low', h > 0 && h < 30)
    // Red vignette fades in below 50 HP.
    this.vignette.style.opacity = String(h <= 0 ? 0 : Math.max(0, (50 - h) / 50))
  }

  setWeapon(w: WeaponState, holstered: WeaponState): void {
    const def = WEAPONS[w.id]
    // "1 RIFLE · 2 HANDGUN" with the one in hand highlighted.
    const primary = w.id === WeaponId.Handgun ? holstered : w
    const slotText = `1 ${WEAPONS[primary.id].name.toUpperCase()}   2 HANDGUN`
    if (this.slots.dataset.text !== `${slotText}${w.id}`) {
      this.slots.dataset.text = `${slotText}${w.id}`
      this.slots.innerHTML = ''
      for (const [slot, weapon] of [
        ['1', primary.id],
        ['2', WeaponId.Handgun],
      ] as const) {
        const span = el('span', weapon === w.id ? 'slot active' : 'slot', this.slots)
        span.textContent = `${slot} ${WEAPONS[weapon].name.toUpperCase()}`
      }
    }
    this.ammoCount.textContent = String(w.ammo)
    this.ammoReserve.textContent = ` / ${w.reserve}`
    this.ammo.classList.toggle('empty', w.ammo === 0)
    this.ammoNote.textContent =
      w.reload > 0
        ? 'RELOADING'
        : w.ammo === 0 && w.reserve === 0
          ? 'NO AMMO'
          : w.ammo <= Math.ceil(def.magSize / 4)
            ? 'R TO RELOAD'
            : def.name.toUpperCase()
  }

  /** Scope overlay while looking through a scope; the bar shows held breath (Shift). */
  setScope(on: boolean, breath01: number, steady: boolean): void {
    this.scope.hidden = !on
    if (!on) return
    this.breathFill.style.width = `${Math.round(breath01 * 100)}%`
    this.scope.classList.toggle('steady', steady)
  }

  /** Death screen: which primary you'll spawn with (press 1 or 2 to change). */
  setLoadoutChoice(primary: WeaponId): void {
    this.deathLoadout.innerHTML = ''
    el('span', 'label', this.deathLoadout).textContent = 'Next spawn: '
    for (const [key, id] of [
      ['1', WeaponId.Rifle],
      ['2', WeaponId.Sniper],
    ] as const) {
      const option = el('span', id === primary ? 'option chosen' : 'option', this.deathLoadout)
      option.textContent = `[${key}] ${WEAPONS[id].name.toUpperCase()}`
    }
  }

  /** Crosshair gap in CSS pixels from the current spread cone (degrees) and vertical FOV. */
  setSpread(spreadDeg: number, vfovDeg: number, aiming: boolean): void {
    const half =
      (Math.tan((spreadDeg * Math.PI) / 360) / Math.tan((vfovDeg * Math.PI) / 360)) *
      window.innerHeight
    this.crosshair.style.setProperty('--gap', `${Math.max(3, Math.round(half))}px`)
    this.crosshair.classList.toggle('aiming', aiming)
  }

  hitmarker(zone: HitZone, killed: boolean): void {
    const node = this.hitmarkerEl
    node.classList.remove('show', 'head', 'kill')
    void node.offsetWidth // restart the CSS animation
    node.classList.add('show')
    if (zone === HitZone.Head) node.classList.add('head')
    if (killed) node.classList.add('kill')
  }

  /** Shows a red arc pointing towards where the damage came from. */
  damageFrom(from: { x: number; z: number }): void {
    if (this.indicators.length >= MAX_PLAYERS) this.indicators.shift()?.node.remove()
    const node = el('div', 'hud-damage-arc', this.damageRing)
    this.indicators.push({ node, from, life: DAMAGE_INDICATOR_SECONDS })
  }

  kill(
    killer: string,
    victim: string,
    weapon: string,
    headshot: boolean,
    involvesMe: boolean,
  ): void {
    const row = el('div', `hud-kill${involvesMe ? ' me' : ''}`, this.killfeed)
    const k = el('span', 'name', row)
    k.textContent = killer
    el('span', 'weapon', row).textContent = ` [${weapon}${headshot ? ' ✛' : ''}] `
    const v = el('span', 'name', row)
    v.textContent = victim
    while (this.killfeed.children.length > KILLFEED_MAX) this.killfeed.firstElementChild?.remove()
    setTimeout(() => row.remove(), KILLFEED_SECONDS * 1000)
  }

  showDeath(killer: string | null, weapon: string, headshot: boolean): void {
    this.death.hidden = false
    this.deathText.textContent = killer
      ? `Killed by ${killer} — ${weapon}${headshot ? ' (headshot)' : ''}`
      : 'You died'
  }

  setDeathTimer(seconds: number): void {
    this.deathTimer.textContent = seconds > 0 ? `Respawn in ${Math.ceil(seconds)}` : ''
  }

  hideDeath(): void {
    this.death.hidden = true
  }

  setProtected(on: boolean): void {
    this.protectedLabel.hidden = !on
  }

  setVisible(visible: boolean): void {
    for (const node of [this.healthBox, this.ammo, this.crosshair]) node.hidden = !visible
  }

  /** Re-aims the damage arcs as you turn, and fades them. */
  update(dt: number, me: { x: number; z: number }, yaw: number): void {
    for (let i = this.indicators.length - 1; i >= 0; i--) {
      const ind = this.indicators[i]
      if (!ind) continue
      ind.life -= dt
      if (ind.life <= 0) {
        ind.node.remove()
        this.indicators.splice(i, 1)
        continue
      }
      // Attacker direction in view space: CSS rotation, 0 = straight ahead, clockwise positive.
      const dx = ind.from.x - me.x
      const dz = ind.from.z - me.z
      const ahead = -dx * Math.sin(yaw) - dz * Math.cos(yaw)
      const right = dx * Math.cos(yaw) - dz * Math.sin(yaw)
      ind.node.style.transform = `rotate(${Math.atan2(right, ahead)}rad) translateY(-130px)`
      ind.node.style.opacity = String(Math.min(1, ind.life / 0.5))
    }
  }
}
