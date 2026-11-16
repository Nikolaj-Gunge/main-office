import {
  crunchAt,
  daylight,
  dayPhase,
  flocksOf,
  MOODS,
  type Notice,
  type RotMood,
  type SurvivalDef,
} from '@office-fps/shared'
import type * as THREE from 'three'
import type { AmbientLoop, AudioEngine } from '../audio/audio-engine.ts'
import { distanceLowpass, falloff } from '../audio/mixing.ts'
import { Music } from '../audio/music.ts'
import { BirdsView } from '../render/birds.ts'
import type { RemotePlayers } from './remote-players.ts'

/** Birdsong goes quiet with one of the dead this close (m). */
export const HUSH_NEAR = 35

/** How loud the birdsong is: by daylight, nothing with the dead near, muffled indoors. */
export function birdsongLevel(light: number, deadNear: boolean, indoors: boolean): number {
  if (deadNear) return 0
  return (0.04 + 0.2 * light) * (indoors ? 0.35 : 1)
}

/**
 * The Rot on the client: the music (by the tension the server sends), the birds you see and
 * hear take off, birdsong that stops when the dead are close, car alarms, and glass and twigs
 * cracking underfoot.
 */
export class RotClient {
  readonly birds: BirdsView
  readonly music: Music
  private song: AmbientLoop | null = null
  private alarms: {
    at: { x: number; y: number; z: number }
    until: number
    next: number
    v: number
  }[] = []
  private mood: RotMood | null = null
  private phase = ''
  private infected = false
  private clock = 0

  constructor(
    private readonly def: SurvivalDef,
    private readonly audio: AudioEngine,
    scene: THREE.Scene,
  ) {
    this.birds = new BirdsView(flocksOf(def), def.terrain)
    scene.add(this.birds.root)
    this.music = new Music(audio)
  }

  /** The sky glows tonight (glow.ts). */
  glow = false

  /** Tonight's extra fog (Fog Night), 0–1. */
  get fog(): number {
    return this.mood ? MOODS[this.mood].fog : 0
  }

  setShared(rot: { mood?: RotMood; birds: number[]; glow?: true } | undefined): void {
    this.mood = rot?.mood ?? null
    this.glow = rot?.glow === true
    this.birds.setAway(rot?.birds ?? [])
  }

  /** A 'sound' notice: birds taking off, or a car alarm. True if it was one. */
  onNotice(n: Notice): boolean {
    if (n.kind !== 'sound' || !n.at) return false
    if (n.sound === 'birds') {
      if (n.flock !== undefined) this.birds.scatter(n.flock)
      this.audio.playNear('birds', n.at, 1, 400, 18)
    } else if (n.sound === 'groan') {
      // Something out there answering your first shot (first-shot.ts): far, low, and a chill.
      this.audio.playNear('groan', n.at, 1, 160, 14)
      this.audio.play('dread', { volume: 0.4 })
    } else if (n.sound === 'alarm') {
      this.alarms.push({ at: n.at, until: this.clock + (n.seconds ?? 25), next: this.clock, v: 0 })
    }
    return true
  }

  onTension(level: number, spotted: boolean): void {
    this.music.setTension(level)
    if (spotted) this.music.sting('spotted')
  }

  /** Your bite status: the moment it takes, a sting. */
  setInfected(infected: boolean): void {
    if (infected && !this.infected) this.music.sting('bitten')
    this.infected = infected
  }

  /** A footstep of yours (or somebody's): glass or a dry branch there cracks. */
  footstep(at: { x: number; y: number; z: number }, mine: boolean, crouched: boolean): void {
    const what = crunchAt(this.def, at.x, at.z)
    if (!what) return
    const volume = (crouched ? 0.35 : 1) * (mine ? 0.5 : 0.9)
    if (mine) this.audio.play(what === 'glass' ? 'glass' : 'twig', { volume })
    else this.audio.playNear(what === 'glass' ? 'glass' : 'twig', at, volume, 40)
  }

  update(
    dt: number,
    time: number,
    eye: THREE.Vector3,
    remotes: RemotePlayers,
    indoors: boolean,
  ): void {
    this.clock += dt
    this.birds.update(dt, eye)
    const light = daylight(time)
    // In Haven at night: Haven's theme.
    const haven = this.def.pois.some(
      (p) => p.safe && Math.hypot(p.x - eye.x, p.z - eye.z) < p.r + 6,
    )
    this.music.setHaven(haven && light < 0.5)
    const phase = dayPhase(time)
    if (phase !== this.phase) {
      if (this.phase && phase === 'dusk') this.music.sting('dusk')
      this.phase = phase
    }
    this.music.update(dt)

    // Birdsong, hushed by the dead nearby.
    this.song ??= this.audio.loop('birdsong')
    if (this.song) {
      let deadNear = false
      for (const [id, pose] of remotes.visiblePoses()) {
        if (remotes.kindOf(id) === 0) continue
        if (Math.hypot(pose.x - eye.x, pose.z - eye.z) < HUSH_NEAR) {
          deadNear = true
          break
        }
      }
      this.song.set(
        birdsongLevel(light, deadNear, indoors),
        indoors ? 2500 : 20000,
        deadNear ? 1.2 : 4,
      )
    }

    // Car alarms, wailing on until they stop.
    this.alarms = this.alarms.filter((a) => this.clock < a.until)
    for (const a of this.alarms) {
      if (this.clock < a.next) continue
      a.next = this.clock + 1
      // The pattern changes every few seconds, as they do.
      if (Math.random() < 0.2) a.v = 1 - a.v
      const d = this.audio.distanceTo(a.at)
      this.audio.play('alarm', {
        at: a.at,
        variant: a.v,
        volume: 0.8 * falloff(d, 10, 300),
        lowpass: distanceLowpass(d),
        rate: 1,
      })
    }
  }
}
