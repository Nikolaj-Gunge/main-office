import { infectionLevel, infectionStage } from '@office-fps/shared'
import type { AudioEngine } from '../audio/audio-engine.ts'

/** What the post pass draws for the bite (see PixelRenderer.setInfection). */
export interface InfectionFx {
  /** 0 = nothing … 1 = turning. */
  level: number
  /** The heartbeat on screen, 0–1 (peaks on each beat). */
  pulse: number
  /** Seconds, for the slow sway. */
  time: number
  /** 0 = hold the picture still (reduced motion), 1 = sway and drift. */
  motion: number
}

/** Seconds between heartbeats by stage (it races as you turn). */
const BEAT = [1.1, 1, 0.9, 0.78, 0.66]
/** Seconds between bouts of each symptom, by stage (min, max; 0 = not yet). */
const HEART_BOUTS: [number, number][] = [
  [0, 0],
  [26, 40],
  [16, 26],
  [10, 16],
  [0.1, 0.1],
]
const COUGHS: [number, number][] = [
  [0, 0],
  [28, 50],
  [20, 36],
  [16, 30],
  [14, 24],
]
const WHISPERS: [number, number][] = [
  [0, 0],
  [0, 0],
  [0, 0],
  [12, 22],
  [6, 10],
]
const GROANS: [number, number][] = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
  [5, 9],
]

const between = ([min, max]: [number, number]) => min + Math.random() * (max - min)

/**
 * The bite as you live it: counts the server's clock down between its updates, and turns the
 * stage into sounds (heartbeat, coughing, whispers, their groans in your own head) and into what
 * the post pass does to the picture.
 */
export class Infection {
  /** Seconds left when the server last said, and when that was (ms); null: not infected. */
  private told: number | null = null
  private toldAt = 0
  private time = 0
  private beat = 0
  /** Seconds the current heartbeat bout still runs. */
  private bout = 0
  private nextBout = 8
  private nextCough = 12
  private nextWhisper = 6
  private nextGroan = 4
  private readonly reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  constructor(private readonly audio: AudioEngine) {}

  set(left: number | null): void {
    if (left === null || this.told === null) this.restart()
    this.told = left
    this.toldAt = performance.now()
  }

  /** Seconds until you turn, counted on locally; null when you're clean. */
  get left(): number | null {
    if (this.told === null) return null
    return Math.max(0, this.told - (performance.now() - this.toldAt) / 1000)
  }

  private restart(): void {
    this.bout = 0
    this.nextBout = 8
    this.nextCough = 12
    this.nextWhisper = 6
    this.nextGroan = 4
  }

  /** Every frame: the symptoms you hear. Returns what the screen should show. */
  update(dt: number, alive: boolean): InfectionFx | null {
    const left = alive ? this.left : null
    const stage = infectionStage(left)
    if (stage < 0) return null
    this.time += dt
    const s = stage as 0 | 1 | 2 | 3 | 4

    // The heart: on screen from the shakes on, heard in bouts from the fever on.
    const period = BEAT[s] ?? 1
    this.beat += dt / period
    const beatNow = this.beat >= 1
    this.beat %= 1
    if (s >= 1) {
      this.nextBout -= dt
      if (this.nextBout <= 0) {
        this.bout = s === 4 ? 1 : 4 + s * 2
        this.nextBout = between(HEART_BOUTS[s] as [number, number]) + this.bout
      }
      this.bout = Math.max(0, this.bout - dt)
      if (beatNow && this.bout > 0)
        this.audio.play('heartbeat', { bus: 'ui', volume: 0.35 + s * 0.12, rate: 1 })
    }
    this.nextCough = this.symptom(this.nextCough, dt, COUGHS[s], () =>
      this.audio.play('cough', { bus: 'ui', volume: 0.5, lowpass: 3500 }),
    )
    this.nextWhisper = this.symptom(this.nextWhisper, dt, WHISPERS[s], () =>
      this.audio.play('whisper', { bus: 'ui', volume: 0.3 + (s - 3) * 0.15 }),
    )
    this.nextGroan = this.symptom(this.nextGroan, dt, GROANS[s], () =>
      this.audio.play('groan', { bus: 'ui', volume: 0.45, rate: 0.8, lowpass: 1400 }),
    )

    const level = infectionLevel(left)
    // A quick swell on the beat that ebbs away before the next one.
    const pulse = level > 0 ? Math.exp(-this.beat * 5) * Math.min(1, level * 2) : 0
    return { level, pulse, time: this.time, motion: this.reduceMotion ? 0 : 1 }
  }

  /** Counts down to the next of one symptom; plays it and picks the next time. */
  private symptom(
    next: number,
    dt: number,
    every: [number, number] | undefined,
    play: () => void,
  ): number {
    if (!every || every[1] <= 0) return Math.max(next, 4)
    const left = next - dt
    if (left > 0) return left
    play()
    return between(every)
  }
}
