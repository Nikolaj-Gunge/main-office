/**
 * Tiny offline DSP toolkit for synthesizing sound effects into Float32Arrays. Pure functions,
 * no Web Audio needed — so the recipes are testable and every client hears identical sounds.
 */

export type Signal = Float32Array<ArrayBuffer>

/** Deterministic noise source (same sound every load). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function silence(seconds: number, rate: number): Signal {
  return new Float32Array(Math.max(1, Math.round(seconds * rate)))
}

export function noise(seconds: number, rate: number, seed: number): Signal {
  const out = silence(seconds, rate)
  const r = rng(seed)
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1
  return out
}

/** Sine whose frequency glides exponentially from `f0` to `f1`. */
export function sweep(seconds: number, rate: number, f0: number, f1: number): Signal {
  const out = silence(seconds, rate)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length
    const f = f0 * (f1 / f0) ** t
    phase += (2 * Math.PI * f) / rate
    out[i] = Math.sin(phase)
  }
  return out
}

export function tone(seconds: number, rate: number, freq: number): Signal {
  return sweep(seconds, rate, freq, freq)
}

/** Multiplies by an attack/exponential-decay envelope (`decay` = seconds to fall to ~37%). */
export function envelope(x: Signal, rate: number, attack: number, decay: number): Signal {
  const a = Math.max(1, attack * rate)
  for (let i = 0; i < x.length; i++) {
    const t = i / rate
    const env = i < a ? i / a : Math.exp(-(t - attack) / decay)
    x[i] = (x[i] ?? 0) * env
  }
  return x
}

/** One-pole low-pass. */
export function lowpass(x: Signal, rate: number, cutoff: number): Signal {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / rate)
  let y = 0
  for (let i = 0; i < x.length; i++) {
    y += k * ((x[i] ?? 0) - y)
    x[i] = y
  }
  return x
}

/** One-pole high-pass. */
export function highpass(x: Signal, rate: number, cutoff: number): Signal {
  const rc = 1 / (2 * Math.PI * cutoff)
  const alpha = rc / (rc + 1 / rate)
  let prevX = 0
  let y = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] ?? 0
    y = alpha * (y + xi - prevX)
    prevX = xi
    x[i] = y
  }
  return x
}

/** RBJ biquad band-pass (constant 0 dB peak). */
export function bandpass(x: Signal, rate: number, center: number, q: number): Signal {
  const w = (2 * Math.PI * center) / rate
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  const b0 = alpha / a0
  const b2 = -alpha / a0
  const a1 = (-2 * Math.cos(w)) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] ?? 0
    const y = b0 * xi + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = xi
    y2 = y1
    y1 = y
    x[i] = y
  }
  return x
}

/** Soft clipping: adds punch and keeps peaks in range. */
export function saturate(x: Signal, drive: number): Signal {
  const norm = Math.tanh(drive)
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh((x[i] ?? 0) * drive) / norm
  return x
}

export function gain(x: Signal, g: number): Signal {
  for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) * g
  return x
}

/** Sums signals (each optionally delayed, in seconds) into a new buffer long enough for all. */
export function mix(rate: number, ...parts: (Signal | [Signal, number])[]): Signal {
  const items = parts.map((p) => (Array.isArray(p) ? p : ([p, 0] as [Signal, number])))
  const length = Math.max(...items.map(([s, d]) => s.length + Math.round(d * rate)))
  const out = new Float32Array(length)
  for (const [s, d] of items) {
    const offset = Math.round(d * rate)
    for (let i = 0; i < s.length; i++) out[i + offset] = (out[i + offset] ?? 0) + (s[i] ?? 0)
  }
  return out
}

/** Scales so the loudest sample hits `peak`. */
export function normalize(x: Signal, peak = 0.9): Signal {
  let max = 0
  for (const v of x) max = Math.max(max, Math.abs(v))
  return max > 0 ? gain(x, peak / max) : x
}

/** Short fade-in/out to avoid clicks at buffer edges. */
export function fadeEdges(x: Signal, rate: number, seconds = 0.003): Signal {
  const n = Math.min(Math.floor(seconds * rate), Math.floor(x.length / 2))
  for (let i = 0; i < n; i++) {
    const g = i / n
    x[i] = (x[i] ?? 0) * g
    x[x.length - 1 - i] = (x[x.length - 1 - i] ?? 0) * g
  }
  return x
}

/** Sparse early reflections — cheap "room" feel for tails. */
export function reflections(
  x: Signal,
  rate: number,
  seed: number,
  count: number,
  spread: number,
): Signal {
  const r = rng(seed)
  const parts: [Signal, number][] = [[x, 0]]
  for (let i = 0; i < count; i++) {
    const delay = 0.02 + r() * spread
    const copy = lowpass(Float32Array.from(x), rate, 3000 - i * 300)
    parts.push([gain(copy, 0.5 * (1 - i / count) * (0.6 + r() * 0.4)), delay])
  }
  return mix(rate, ...parts)
}
