import type * as THREE from 'three'
import { distanceLowpass, falloff, GUN_VOICES, gunshotMix } from './mixing.ts'
import { SOUNDS, type SoundId } from './sounds.ts'

export interface PlayOptions {
  /** World position for 3D sounds; omit for sounds "in your head" (own gun, UI). */
  at?: { x: number; y: number; z: number }
  volume?: number
  /** Playback-rate multiplier (pitch). Defaults to a small random variation. */
  rate?: number
  /** Seconds from now. */
  delay?: number
  /** Low-pass cutoff (Hz) — distance and walls dull sounds. */
  lowpass?: number
  bus?: 'sfx' | 'ui'
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Web Audio mixer for the game. Sounds are synthesized once when audio is unlocked (browsers
 * only allow audio after a click), then played as cheap one-shot buffer sources.
 *
 *   sources → [panner] → [lowpass] → gain → sfx|ui bus → muffle (low health) → limiter → out
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private readonly buffers = new Map<SoundId, AudioBuffer[]>()
  private master: GainNode | null = null
  private sfx: GainNode | null = null
  private ui: GainNode | null = null
  private muffle: BiquadFilterNode | null = null
  private heartbeatGain: GainNode | null = null
  private readonly listener = { x: 0, y: 0, z: 0 }
  private volumes = { master: 0.8, sfx: 1 }
  /** 0 = clear, 1 = fully muffled. Combines low health and a short "ringing" after hits. */
  private lowHealthMuffle = 0
  private hitMuffle = 0

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  /** Call from a user gesture (the Play click). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) this.create()
    void this.ctx?.resume()
  }

  private create(): void {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor({ latencyHint: 'interactive' })
    this.ctx = ctx

    const limiter = new DynamicsCompressorNode(ctx, {
      threshold: -6,
      knee: 6,
      ratio: 12,
      attack: 0.002,
      release: 0.15,
    })
    limiter.connect(ctx.destination)
    this.master = new GainNode(ctx, { gain: this.volumes.master })
    this.master.connect(limiter)
    this.muffle = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.7 })
    this.muffle.connect(this.master)
    this.sfx = new GainNode(ctx, { gain: this.volumes.sfx })
    this.sfx.connect(this.muffle)
    // UI sounds (hit markers) skip the muffle so feedback stays crisp.
    this.ui = new GainNode(ctx, { gain: 0.7 })
    this.ui.connect(this.master)

    const rate = ctx.sampleRate
    for (const [id, def] of Object.entries(SOUNDS) as [SoundId, (typeof SOUNDS)[SoundId]][]) {
      const variants: AudioBuffer[] = []
      for (let v = 0; v < def.variants; v++) {
        const data = def.recipe(rate, v)
        const buffer = ctx.createBuffer(1, data.length, rate)
        buffer.copyToChannel(data, 0)
        variants.push(buffer)
      }
      this.buffers.set(id, variants)
    }

    // Heartbeat runs forever at zero volume; low health fades it in.
    const heart = this.buffers.get('heartbeat')?.[0]
    if (heart) {
      this.heartbeatGain = new GainNode(ctx, { gain: 0 })
      this.heartbeatGain.connect(this.ui)
      const src = new AudioBufferSourceNode(ctx, { buffer: heart, loop: true })
      src.connect(this.heartbeatGain)
      src.start()
    }
  }

  setVolumes(master: number, sfx: number): void {
    this.volumes = { master, sfx }
    if (this.master) this.master.gain.value = master
    if (this.sfx) this.sfx.gain.value = sfx
  }

  /** Moves the listener to the camera. Call once per frame. */
  setListener(camera: THREE.Camera): void {
    const ctx = this.ctx
    if (!ctx) return
    const e = camera.matrixWorld.elements
    const p = { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 }
    this.listener.x = p.x
    this.listener.y = p.y
    this.listener.z = p.z
    const fwd = { x: -(e[8] ?? 0), y: -(e[9] ?? 0), z: -(e[10] ?? 1) }
    const up = { x: e[4] ?? 0, y: e[5] ?? 1, z: e[6] ?? 0 }
    const l = ctx.listener
    if (l.positionX) {
      const t = ctx.currentTime
      l.positionX.setValueAtTime(p.x, t)
      l.positionY.setValueAtTime(p.y, t)
      l.positionZ.setValueAtTime(p.z, t)
      l.forwardX.setValueAtTime(fwd.x, t)
      l.forwardY.setValueAtTime(fwd.y, t)
      l.forwardZ.setValueAtTime(fwd.z, t)
      l.upX.setValueAtTime(up.x, t)
      l.upY.setValueAtTime(up.y, t)
      l.upZ.setValueAtTime(up.z, t)
    } else {
      // Firefox: only the older setter API.
      l.setPosition(p.x, p.y, p.z)
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z)
    }
  }

  distanceTo(at: { x: number; y: number; z: number }): number {
    return Math.hypot(at.x - this.listener.x, at.y - this.listener.y, at.z - this.listener.z)
  }

  play(id: SoundId, opts: PlayOptions = {}): void {
    const ctx = this.ctx
    if (ctx?.state !== 'running') return
    const variants = this.buffers.get(id)
    const buffer = variants?.[Math.floor(Math.random() * variants.length)]
    const bus = opts.bus === 'ui' ? this.ui : this.sfx
    if (!buffer || !bus) return
    const volume = opts.volume ?? 1
    if (volume <= 0.001) return

    const src = new AudioBufferSourceNode(ctx, {
      buffer,
      playbackRate: opts.rate ?? 0.96 + Math.random() * 0.08,
    })
    let node: AudioNode = src
    if (opts.lowpass !== undefined && opts.lowpass < 18000) {
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: opts.lowpass })
      node.connect(lp)
      node = lp
    }
    if (opts.at) {
      // Direction only: distance attenuation is ours (rolloff 0), tuned per sound type.
      const panner = new PannerNode(ctx, {
        panningModel: 'HRTF',
        distanceModel: 'linear',
        rolloffFactor: 0,
        positionX: opts.at.x,
        positionY: opts.at.y,
        positionZ: opts.at.z,
      })
      node.connect(panner)
      node = panner
    }
    const g = new GainNode(ctx, { gain: volume })
    node.connect(g)
    g.connect(bus)
    src.start(ctx.currentTime + (opts.delay ?? 0))
  }

  /**
   * A gunshot, mixed by distance: up close you hear the mechanical crack and punch; far away
   * mostly the echo, dulled and arriving late (sound travels 343 m/s).
   */
  gunshot(at: { x: number; y: number; z: number } | undefined, weapon: number): void {
    const m = gunshotMix(at ? this.distanceTo(at) : null)
    const voice = GUN_VOICES[weapon] ?? { rate: 1, volume: 1, tail: 1 }
    const rate = voice.rate * (0.97 + Math.random() * 0.06)
    const layer = (id: SoundId, level: number) =>
      this.play(id, {
        ...(at ? { at } : {}),
        volume: m.volume * voice.volume * level,
        delay: m.delay,
        lowpass: m.lowpass,
        rate,
      })
    layer('shot.close', m.close)
    layer('shot.body', m.body)
    layer('shot.tail', m.tail * voice.tail)
  }

  /**
   * Quieter world sounds (footsteps, impacts, casings): full volume within `ref` m, then falling
   * off steeply and getting duller, silent beyond `range` m.
   */
  playNear(
    id: SoundId,
    at: { x: number; y: number; z: number },
    volume: number,
    range: number,
    ref = 3,
  ): void {
    const d = this.distanceTo(at)
    this.play(id, { at, volume: volume * falloff(d, ref, range), lowpass: distanceLowpass(d) })
  }

  /** Health-driven heartbeat and muffled hearing. */
  setHealth(health: number, alive: boolean): void {
    const low = alive ? clamp01((35 - health) / 25) : 0
    this.lowHealthMuffle = low
    if (this.heartbeatGain && this.ctx) {
      this.heartbeatGain.gain.setTargetAtTime(low * 0.9, this.ctx.currentTime, 0.2)
    }
  }

  /** Brief dulled hearing after taking a hit. */
  onHurt(damage: number): void {
    this.hitMuffle = Math.min(1, this.hitMuffle + damage / 60)
  }

  update(dt: number): void {
    this.hitMuffle = Math.max(0, this.hitMuffle - dt * 1.5)
    if (!this.muffle || !this.ctx) return
    const m = Math.max(this.lowHealthMuffle * 0.8, this.hitMuffle)
    this.muffle.frequency.setTargetAtTime(20000 * (1 - m) + 700 * m, this.ctx.currentTime, 0.05)
  }
}
