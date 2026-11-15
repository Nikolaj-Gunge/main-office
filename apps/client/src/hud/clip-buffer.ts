import type { Notice } from '@office-fps/shared'
import { muxWebm, type WebmFrame } from './webm.ts'

/**
 * The clip buffer: the last ~20 s of the game, kept small and cheap, to save as a video.
 *
 * Every other frame or so, right after it is drawn, the canvas is copied down to at most
 * CLIP_ROWS rows and handed to a WebCodecs VP8 encoder (it runs off the main thread). The encoded
 * frames sit in a ring that drops whatever is older than the window, always starting at a
 * keyframe. Keeping a clip just copies the ring; saving it "develops" it: decodes the small
 * frames, doubles them with nearest-neighbour (hard pixels) and encodes those, then wraps them
 * in a WebM file (webm.ts). Browsers without WebCodecs' VP8 (older Safari) never see the feature.
 */

/** Rows the buffer records at (at most): the canvas is shrunk to this, then doubled on export. */
export const CLIP_ROWS = 360
/** Seconds kept. */
export const CLIP_SECONDS = 20
/** Frames a second recorded. */
export const CLIP_FPS = 24
/** A keyframe this often (s): the ring can only start a clip at one. */
const KEY_EVERY = 2
/** What it waits after a moment before keeping the clip (ms): the fall, the last shot. */
const AFTER_MS = 2000

/** Why a clip was kept: shown with it in the keepsakes panel. */
export type ClipMoment = 'kept' | 'death' | 'alpha' | 'red-night'

export const CLIP_CAPTIONS: Record<ClipMoment, string> = {
  kept: 'Kept.',
  death: 'Their last seconds.',
  alpha: 'An alpha goes down.',
  'red-night': 'Haven held.',
}

/** Notices that are worth a clip (alphas.ts' kill line, camp.ts' Red Night held). */
export function clipMoment(n: Notice): ClipMoment | null {
  if (n.kind === 'quest' && /^\S.* is dead\. (Word will get round|For now\.)/.test(n.text))
    return 'alpha'
  if (n.kind === 'story' && n.text.startsWith('Haven held.')) return 'red-night'
  return null
}

/**
 * How many frames at the front of the ring are older than the window and can go: everything
 * before the newest keyframe that is at least `window` older than the newest frame (so the kept
 * part still opens on a keyframe and covers the whole window).
 */
export function dropCount(
  frames: readonly { timestamp: number; key: boolean }[],
  window: number,
): number {
  const newest = frames[frames.length - 1]
  if (!newest) return 0
  let cut = 0
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (!f || f.timestamp > newest.timestamp - window) break
    if (f.key) cut = i
  }
  return cut
}

/** The recording size for a canvas: CLIP_ROWS tall (or less), the canvas's shape, even sides. */
export function clipSize(width: number, height: number): { width: number; height: number } {
  const h = Math.min(CLIP_ROWS, height)
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { width: even((width * h) / height), height: even(h) }
}

/** The VP8 setup at a size (bits a second scale with the pixels). */
const config = (width: number, height: number): VideoEncoderConfig => ({
  codec: 'vp8',
  width,
  height,
  bitrate: Math.round(width * height * CLIP_FPS * 0.12),
  framerate: CLIP_FPS,
  latencyMode: 'realtime',
})

/** Does this browser have what the clip buffer needs? (Resolves false rather than failing.) */
export async function clipsSupported(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return false
  if (typeof VideoFrame === 'undefined' || typeof OffscreenCanvas === 'undefined') return false
  try {
    const [enc, dec] = await Promise.all([
      VideoEncoder.isConfigSupported(config(640, 360)),
      VideoDecoder.isConfigSupported({ codec: 'vp8', codedWidth: 640, codedHeight: 360 }),
    ])
    return !!enc.supported && !!dec.supported
  } catch {
    return false
  }
}

/** A kept clip: the small frames as they were recorded. */
export interface Clip {
  moment: ClipMoment
  width: number
  height: number
  frames: WebmFrame[]
}

/** The small (as recorded) clip as a WebM, for the preview. */
export const previewBlob = (c: Clip): Blob =>
  new Blob([muxWebm(c, c.frames) as BlobPart], { type: 'video/webm' })

/** Until a codec takes the next item off its queue (not a timer: those crawl in a hidden tab). */
const dequeued = (codec: VideoEncoder | VideoDecoder) =>
  new Promise<void>((ok) => {
    codec.addEventListener('dequeue', () => ok(), { once: true })
  })

/**
 * Develops a clip at twice its size, pixel for pixel. Decodes the small frames, draws each
 * doubled with no smoothing and encodes it again, a few frames in flight at a time so a 20 s
 * clip takes a second or two and little memory.
 */
export async function developClip(c: Clip, scale = 2): Promise<Blob> {
  const width = c.width * scale
  const height = c.height * scale
  const big = new OffscreenCanvas(width, height)
  // Kept in main memory: the encoder reads every frame back, and a GPU canvas makes each read
  // wait on the game's own drawing.
  const ctx = big.getContext('2d', { willReadFrequently: true, alpha: false })
  if (!ctx) throw new Error('clip: no 2d context')
  ctx.imageSmoothingEnabled = false
  const out: WebmFrame[] = []
  let failed: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      out.push({ data, timestamp: chunk.timestamp, key: chunk.type === 'key' })
    },
    error: (e) => {
      failed = e
    },
  })
  encoder.configure({ ...config(width, height), latencyMode: 'quality' })
  const t0 = c.frames[0]?.timestamp ?? 0
  let lastKey = -Infinity
  const decoder = new VideoDecoder({
    output: (frame) => {
      ctx.drawImage(frame, 0, 0, width, height)
      const ts = frame.timestamp
      frame.close()
      const doubled = new VideoFrame(big, { timestamp: ts })
      const key = ts - lastKey >= KEY_EVERY * 1e6
      if (key) lastKey = ts
      encoder.encode(doubled, { keyFrame: key })
      doubled.close()
    },
    error: (e) => {
      failed = e
    },
  })
  decoder.configure({ codec: 'vp8', codedWidth: c.width, codedHeight: c.height })
  for (const f of c.frames) {
    if (failed) break
    decoder.decode(
      new EncodedVideoChunk({
        type: f.key ? 'key' : 'delta',
        timestamp: f.timestamp - t0,
        data: f.data,
      }),
    )
    while (!failed && (decoder.decodeQueueSize > 3 || encoder.encodeQueueSize > 3))
      await dequeued(decoder.decodeQueueSize > 3 ? decoder : encoder)
  }
  await decoder.flush()
  await encoder.flush()
  decoder.close()
  encoder.close()
  if (failed) throw failed
  return new Blob([muxWebm({ width, height }, out) as BlobPart], { type: 'video/webm' })
}

export class ClipBuffer {
  /** Recording (the setting is on and the browser can). */
  enabled = false
  /** A clip was kept (the keepsakes panel shows it). */
  onClip: (clip: Clip) => void = () => {}

  private encoder: VideoEncoder | null = null
  private small: OffscreenCanvas | null = null
  private ctx: OffscreenCanvasRenderingContext2D | null = null
  private width = 0
  private height = 0
  private ring: WebmFrame[] = []
  private nextFrame = 0
  private lastKey = -Infinity
  private wasAlive = true
  /** A moment waiting for its aftermath before the clip is kept. */
  private pending: { moment: ClipMoment; at: number } | null = null
  /** Main-thread ms spent copying frames, for the stats line (smoothed). */
  costMs = 0

  /**
   * Once a frame, right after it is drawn (the canvas still holds it). Records one frame at
   * CLIP_FPS and notices the player dying.
   */
  capture(canvas: HTMLCanvasElement, alive: boolean, now: number): void {
    if (!this.enabled) return
    if (this.wasAlive && !alive) this.mark('death', now)
    this.wasAlive = alive
    if (this.pending && now >= this.pending.at) {
      this.keep(this.pending.moment)
      this.pending = null
    }
    if (now < this.nextFrame || canvas.width === 0 || canvas.height === 0) return
    // Never fall behind: skip a frame rather than queue them (a slow machine just gets fewer).
    this.nextFrame = Math.max(this.nextFrame + 1000 / CLIP_FPS, now - 1000 / CLIP_FPS)
    if (this.encoder && this.encoder.encodeQueueSize > 2) return
    const t = performance.now()
    const size = clipSize(canvas.width, canvas.height)
    // A new shape (the window resized): a new stream; what was recorded can't join it.
    if (size.width !== this.width || size.height !== this.height || !this.encoder) {
      if (!this.setup(size.width, size.height)) return
    }
    const ctx = this.ctx
    const encoder = this.encoder
    if (!ctx || !encoder || !this.small) return
    // Crisp pixels when the canvas is a whole number of recorded rows, smoothing otherwise.
    ctx.imageSmoothingEnabled = canvas.height % this.height !== 0
    ctx.drawImage(canvas, 0, 0, this.width, this.height)
    const ts = Math.round(now * 1000)
    const frame = new VideoFrame(this.small, { timestamp: ts })
    const key = ts - this.lastKey >= KEY_EVERY * 1e6
    if (key) this.lastKey = ts
    try {
      encoder.encode(frame, { keyFrame: key })
    } catch {
      this.stop()
    }
    frame.close()
    this.costMs += (performance.now() - t - this.costMs) * 0.05
  }

  /** Keep a clip a moment from now (the aftermath goes in it too). */
  mark(moment: ClipMoment, now: number): void {
    if (!this.enabled) return
    // A death outranks a hotkey press just before it.
    if (this.pending && this.pending.moment === 'death') return
    this.pending = { moment, at: now + AFTER_MS }
  }

  /** Keep the clip now (the hotkey). False when there is nothing yet. */
  keep(moment: ClipMoment = 'kept'): boolean {
    const start = this.ring.findIndex((f) => f.key)
    if (start < 0) return false
    this.onClip({
      moment,
      width: this.width,
      height: this.height,
      frames: this.ring.slice(start),
    })
    return true
  }

  /** Stops recording and lets the buffer go. */
  stop(): void {
    try {
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close()
    } catch {
      // Already gone.
    }
    this.encoder = null
    this.ring = []
    this.width = 0
    this.height = 0
    this.pending = null
  }

  private setup(width: number, height: number): boolean {
    this.stop()
    this.width = width
    this.height = height
    this.small = new OffscreenCanvas(width, height)
    this.ctx = this.small.getContext('2d', { alpha: false })
    this.lastKey = -Infinity
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        this.ring.push({ data, timestamp: chunk.timestamp, key: chunk.type === 'key' })
        const drop = dropCount(this.ring, CLIP_SECONDS * 1e6)
        if (drop > 0) this.ring.splice(0, drop)
      },
      error: () => {
        // The encoder died (GPU lost, out of memory): stop; the next frame tries a fresh one.
        this.encoder = null
        this.width = 0
      },
    })
    try {
      encoder.configure(config(width, height))
    } catch {
      return false
    }
    this.encoder = encoder
    return true
  }
}
