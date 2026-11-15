import type { AudioEngine } from './audio-engine.ts'
import {
  MUSIC_RATE,
  renderHaven,
  renderStem,
  renderStinger,
  STEMS,
  type StemId,
  type StingerId,
  smoothTension,
  stemLevels,
} from './music-stems.ts'

/** Seconds a stinger of each kind stays quiet after playing (the dead see you often). */
const STINGER_REST: Record<StingerId, number> = { spotted: 25, bitten: 5, dusk: 60 }
const STINGER_LEVEL: Record<StingerId, number> = { spotted: 0.55, bitten: 0.7, dusk: 0.5 }
const HAVEN_LEVEL = 0.5

/**
 * The adaptive music (music-stems.ts): the four stems loop together from the moment they're
 * all made, each faded by the night's tension (sent by the server, smoothed here); inside Haven
 * at night they give way to Haven's theme. The loops are synthesized after audio unlocks, one
 * per frame-ish (setTimeout), so the game never stalls for them.
 */
export class Music {
  private readonly gains = new Map<StemId | 'haven', GainNode>()
  private readonly stingers = new Map<StingerId, AudioBuffer>()
  private readonly rested = new Map<StingerId, number>()
  private building = false
  private target = 0
  /** The music's tension (eased towards the server's). */
  tension = 0
  private haven = false

  constructor(private readonly audio: AudioEngine) {}

  /** The server's tension for you (0–1). */
  setTension(level: number): void {
    this.target = level
  }

  /** Inside Haven at night: its own theme instead. */
  setHaven(inside: boolean): void {
    this.haven = inside
  }

  /** A short sting over the top (rate-limited per kind). */
  sting(id: StingerId): void {
    const out = this.audio.musicOut()
    const buffer = this.stingers.get(id)
    if (!out || !buffer) return
    const now = out.ctx.currentTime
    if (now < (this.rested.get(id) ?? 0)) return
    this.rested.set(id, now + STINGER_REST[id])
    const g = new GainNode(out.ctx, { gain: STINGER_LEVEL[id] })
    const src = new AudioBufferSourceNode(out.ctx, { buffer })
    src.connect(g)
    g.connect(out.bus)
    src.start()
  }

  /** Every frame. */
  update(dt: number): void {
    const out = this.audio.musicOut()
    if (!out) return
    if (!this.building) {
      this.building = true
      this.build(out.ctx, out.bus)
      return
    }
    this.tension = smoothTension(this.tension, this.haven ? 0 : this.target, dt)
    const levels = stemLevels(this.tension)
    const t = out.ctx.currentTime
    for (const id of STEMS) this.gains.get(id)?.gain.setTargetAtTime(levels[id], t, 0.8)
    this.gains.get('haven')?.gain.setTargetAtTime(this.haven ? HAVEN_LEVEL : 0, t, 2)
  }

  /** Synthesizes everything, a piece at a time, then starts the loops on the same beat. */
  private build(ctx: AudioContext, bus: GainNode): void {
    const buffer = (data: Float32Array<ArrayBuffer>) => {
      const b = ctx.createBuffer(1, data.length, MUSIC_RATE)
      b.copyToChannel(data, 0)
      return b
    }
    const loops = new Map<StemId | 'haven', AudioBuffer>()
    const jobs: (() => void)[] = [
      ...STEMS.map((id) => () => loops.set(id, buffer(renderStem(id)))),
      () => loops.set('haven', buffer(renderHaven())),
      ...(['spotted', 'bitten', 'dusk'] as const).map(
        (id) => () => this.stingers.set(id, buffer(renderStinger(id))),
      ),
    ]
    const next = () => {
      const job = jobs.shift()
      if (job) {
        job()
        setTimeout(next, 30)
        return
      }
      const start = ctx.currentTime + 0.1
      for (const [id, b] of loops) {
        const g = new GainNode(ctx, { gain: 0 })
        g.connect(bus)
        const src = new AudioBufferSourceNode(ctx, { buffer: b, loop: true })
        src.connect(g)
        src.start(start)
        this.gains.set(id, g)
      }
    }
    setTimeout(next, 30)
  }
}
