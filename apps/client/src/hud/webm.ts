/**
 * A tiny WebM writer for the clip buffer (clip-buffer.ts): one VP8 video track, a cluster per
 * keyframe, the whole file built in memory (clips are a few MB). Enough for every browser that
 * plays WebM; no cues, so seeking is by scanning, which is instant at this size.
 */

/** One encoded frame (from WebCodecs' EncodedVideoChunk). */
export interface WebmFrame {
  data: Uint8Array
  /** Microseconds; any origin (the file starts at the first frame). */
  timestamp: number
  key: boolean
}

export interface WebmTrack {
  width: number
  height: number
  /** Matroska codec id. */
  codec?: string
}

/** An EBML variable-length size: the shortest form that holds `n`. */
export function vintSize(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    // All ones is reserved for "unknown size", so the largest value is one less.
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len)
      let v = n
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v % 256
        v = Math.floor(v / 256)
      }
      out[0] = (out[0] ?? 0) | (1 << (8 - len))
      return out
    }
  }
  throw new Error(`webm: size ${n} too big`)
}

/** An unsigned int in as few bytes as it needs (at least one). */
function uint(n: number): Uint8Array {
  const bytes: number[] = []
  let v = Math.max(0, Math.floor(n))
  do {
    bytes.unshift(v % 256)
    v = Math.floor(v / 256)
  } while (v > 0)
  return Uint8Array.from(bytes)
}

function float64(n: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setFloat64(0, n)
  return out
}

const text = (s: string) => new TextEncoder().encode(s)

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** An element: id bytes (written as they are), size, body. */
function el(id: number, ...body: Uint8Array[]): Uint8Array {
  const idBytes = uint(id)
  const payload = concat(body)
  return concat([idBytes, vintSize(payload.length), payload])
}

/** A SimpleBlock on track 1, `rel` ms after its cluster's start. */
function simpleBlock(frame: WebmFrame, rel: number): Uint8Array {
  const head = new Uint8Array(4)
  head[0] = 0x81 // track 1
  new DataView(head.buffer).setInt16(1, rel)
  head[3] = frame.key ? 0x80 : 0
  return el(0xa3, head, frame.data)
}

/**
 * The WebM file for `frames` (in order, the first one a keyframe). Times are written in
 * milliseconds; a new cluster starts at every keyframe (and before a block's offset would
 * overflow 16 bits).
 */
export function muxWebm(track: WebmTrack, frames: readonly WebmFrame[]): Uint8Array {
  const t0 = frames[0]?.timestamp ?? 0
  const ms = (f: WebmFrame) => Math.round((f.timestamp - t0) / 1000)
  const last = frames[frames.length - 1]
  // The last frame shows for about one frame's time.
  const duration = last ? ms(last) + 40 : 0

  const header = el(
    0x1a45dfa3,
    el(0x4286, uint(1)), // EBMLVersion
    el(0x42f7, uint(1)), // EBMLReadVersion
    el(0x42f2, uint(4)), // EBMLMaxIDLength
    el(0x42f3, uint(8)), // EBMLMaxSizeLength
    el(0x4282, text('webm')), // DocType
    el(0x4287, uint(2)), // DocTypeVersion
    el(0x4285, uint(2)), // DocTypeReadVersion
  )
  const info = el(
    0x1549a966,
    el(0x2ad7b1, uint(1_000_000)), // TimecodeScale: 1 ms
    el(0x4489, float64(duration)),
    el(0x4d80, text('deadwood')), // MuxingApp
    el(0x5741, text('deadwood')), // WritingApp
  )
  const tracks = el(
    0x1654ae6b,
    el(
      0xae, // TrackEntry
      el(0xd7, uint(1)), // TrackNumber
      el(0x73c5, uint(1)), // TrackUID
      el(0x83, uint(1)), // TrackType: video
      el(0x9c, uint(0)), // FlagLacing
      el(0x86, text(track.codec ?? 'V_VP8')),
      el(0xe0, el(0xb0, uint(track.width)), el(0xba, uint(track.height))),
    ),
  )

  const clusters: Uint8Array[] = []
  let start = -1
  let blocks: Uint8Array[] = []
  const flush = () => {
    if (start >= 0) clusters.push(el(0x1f43b675, el(0xe7, uint(start)), ...blocks))
    blocks = []
  }
  for (const f of frames) {
    const t = ms(f)
    if (start < 0 || f.key || t - start > 30_000) {
      flush()
      start = t
    }
    blocks.push(simpleBlock(f, t - start))
  }
  flush()

  return concat([header, el(0x18538067, info, tracks, ...clusters)])
}
