import { EVAC_HOLD, EVAC_TOTAL, type EvacShared, evacHeliPos, evacPhase } from '@office-fps/shared'
import * as THREE from 'three'
import type { AudioEngine } from '../audio/audio-engine.ts'
import { rumble } from '../game/game-feel.ts'
import { buildHeli } from './heli.ts'

/** The rotors are heard this far off (m). */
const HEARD = 1100
/** The hold's countdown shows this close to the pad (m). */
const BANNER_RANGE = 260

const now = () => performance.now() / 1000

/**
 * The evacuation as everybody sees it (shared/survival/evac.ts): the red flare burning on the
 * helipad through the hold, the countdown for whoever is near, the helicopter coming in over
 * the trees and settling on the pad with its rotors turning, and up and away again. Flown from
 * the replicated SurvivalShared.evac, so every client sees the same flight. Also the card you
 * get for getting out.
 */
export class EvacView {
  private readonly audio: AudioEngine
  private readonly heli = buildHeli()
  private readonly flare = new THREE.PointLight(0xff3a1a, 0, 40, 1.6)
  private readonly banner: HTMLElement
  private readonly card: HTMLElement
  private evac: EvacShared | null = null
  /** Client time (s) the evacuation was called in. */
  private t0 = 0
  private nextRotor = 0
  private rotorVariant = 0
  private cardUntil = 0

  constructor(scene: THREE.Scene, audio: AudioEngine, hudRoot: HTMLElement) {
    this.audio = audio
    this.heli.root.visible = false
    scene.add(this.heli.root, this.flare)
    this.banner = document.createElement('div')
    this.banner.className = 'evac-banner'
    this.banner.hidden = true
    this.card = document.createElement('div')
    this.card.className = 'evac-card'
    this.card.hidden = true
    hudRoot.append(this.banner, this.card)
  }

  /** What the server says (once a second, and when it changes). */
  apply(evac: EvacShared | undefined): void {
    if (!evac) {
      this.evac = null
      return
    }
    const t0 = now() - evac.age
    if (!this.evac || Math.abs(this.t0 - t0) > 0.75) this.t0 = t0
    this.evac = evac
  }

  clear(): void {
    this.evac = null
  }

  /** The "you got out" card: a title and what happened. */
  showCard(title: string, text: string): void {
    this.card.replaceChildren()
    const h = document.createElement('h2')
    h.textContent = title
    const p = document.createElement('p')
    p.textContent = text
    this.card.append(h, p)
    this.card.hidden = false
    this.cardUntil = now() + 14
  }

  update(dt: number, eye: THREE.Vector3): void {
    const t = now()
    if (!this.card.hidden && t > this.cardUntil) this.card.hidden = true
    const e = this.evac
    const age = e ? t - this.t0 : -1
    if (!e || age > EVAC_TOTAL) {
      this.heli.root.visible = false
      this.flare.intensity = 0
      this.banner.hidden = true
      return
    }
    const phase = evacPhase(age)

    // The flare on the pad burns through the hold and until it's down.
    const burning = phase === 'hold' || phase === 'inbound'
    this.flare.position.set(e.x, e.y + 0.6, e.z)
    this.flare.intensity = burning ? 30 * (0.75 + 0.25 * Math.sin(t * 29) * Math.sin(t * 13.7)) : 0

    // The countdown, for whoever is near enough to be holding it.
    const near = Math.hypot(eye.x - e.x, eye.z - e.z) < BANNER_RANGE
    this.banner.hidden = !near
    if (near) {
      const left = Math.max(0, Math.ceil(EVAC_HOLD - age))
      const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
      this.banner.textContent =
        phase === 'hold'
          ? `Hold the pad · ${clock}`
          : phase === 'inbound'
            ? 'Helicopter inbound'
            : phase === 'landed'
              ? `On the pad — ${e.by} gets aboard`
              : e.boarded
                ? `${e.by} got out`
                : 'The helicopter leaves'
    }

    const p = evacHeliPos(e, age)
    const root = this.heli.root
    root.visible = p !== null
    if (!p) return
    // Skids on the pad: the model's origin sits 1.8 m above them.
    root.position.set(p.x, p.y + 1.85, p.z)
    root.rotation.order = 'YXZ'
    root.rotation.set(0, Math.atan2(-Math.cos(e.heading), -Math.sin(e.heading)), 0)
    if (phase === 'inbound') root.rotation.x = 0.12
    if (phase === 'outbound') root.rotation.x = -0.18
    this.heli.rotor.rotation.y += dt * 28
    this.heli.tail.rotation.x += dt * 45
    for (const b of this.heli.blink) b.sprite.visible = ((t + b.phase) % 1.1) / 1.1 < b.on

    // The rotors: a thwop a beat, as loud as it is close.
    if (t >= this.nextRotor - 0.1) {
      const d = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z)
      const loud = Math.max(0, 1 - d / HEARD) ** 1.6
      if (loud > 0.005)
        this.audio.play('heli', {
          at: p,
          volume: 0.9 * loud,
          lowpass: Math.max(500, 9000 * Math.exp(-d / 220)),
          variant: this.rotorVariant,
          delay: Math.max(0, this.nextRotor - t),
        })
      rumble(p, 0.2, 70)
      this.rotorVariant = 1 - this.rotorVariant
      this.nextRotor = (Math.abs(t - this.nextRotor) < 0.5 ? this.nextRotor : t) + 1
    }
  }
}
