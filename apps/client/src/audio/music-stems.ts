import { fadeEdges, highpass, lowpass, normalize, rng, type Signal } from './dsp.ts'

/**
 * The adaptive music (roadmap 6.3), synthesized: four loops in D minor at the same tempo that
 * the player fades in and out by how tense the night is (vertical layering), a warm theme for
 * Haven, and short stingers. Pure functions into Float32Arrays, like dsp.ts: testable, and
 * renderable to WAV outside the browser.
 *
 *   drone   — low pad under the chords: the night is out there (from low tension)
 *   pulse   — a heartbeat on every beat, a tick on the off-beats (something is near)
 *   strings — tremolo strings on the chord tones (they're coming)
 *   high    — dissonant high seconds and scrapes (the peak)
 */

export const MUSIC_RATE = 22050
/** 72 beats a minute, 8 bars of 4: every stem loops on the same 26.7 s. */
export const BPM = 72
export const BEAT = 60 / BPM
export const LOOP_BEATS = 32
export const LOOP_SECONDS = LOOP_BEATS * BEAT

export type StemId = 'drone' | 'pulse' | 'strings' | 'high'
export const STEMS: readonly StemId[] = ['drone', 'pulse', 'strings', 'high']
export type StingerId = 'spotted' | 'bitten' | 'dusk'

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)
/** Two bars each: Dm, B♭, Gm, A (MIDI notes of the root in octave 2, and the third's offset). */
const CHORDS: readonly { root: number; third: number }[] = [
  { root: 38, third: 3 }, // D minor
  { root: 34, third: 4 }, // B♭ major
  { root: 43, third: 3 }, // G minor
  { root: 45, third: 4 }, // A major
]
const CHORD_SECONDS = LOOP_SECONDS / CHORDS.length

/** Seconds of run-in rendered and thrown away, so the filters are settled where the loop starts. */
const PRE = 2

/**
 * Renders a loop: `voice(t)` is called for t in [0, LOOP) (wrapped), filtered by `post`, and the
 * run-in is cut off so the end flows back into the start without a click.
 */
function loop(
  rate: number,
  seconds: number,
  voice: (t: number) => number,
  post: (x: Signal) => Signal,
): Signal {
  const n = Math.round(seconds * rate)
  const pre = Math.round(PRE * rate)
  const x = new Float32Array(n + pre)
  for (let i = 0; i < x.length; i++) x[i] = voice(((i - pre + n) % n) / rate)
  return post(x).slice(pre)
}

/** Each chord's weight at time t: 1 inside its two bars, crossfading over `fade` s either side. */
function chordWeights(t: number, fade: number): number[] {
  return CHORDS.map((_, c) => {
    const start = c * CHORD_SECONDS
    // Distance into the chord, wrapped round the loop.
    const into = (t - start + LOOP_SECONDS) % LOOP_SECONDS
    if (into < CHORD_SECONDS) {
      return Math.min(1, (into + fade) / (2 * fade), (CHORD_SECONDS - into + fade) / (2 * fade))
    }
    const before = LOOP_SECONDS - into
    if (before < fade) return (fade - before) / (2 * fade)
    const after = into - CHORD_SECONDS
    if (after < fade) return (fade - after) / (2 * fade)
    return 0
  })
}

/** A band-limited-enough saw from a phase (cycles). */
const saw = (phase: number) => 2 * (phase - Math.floor(phase + 0.5))

/** An oscillator bank: notes by frequency, a few detuned saws per note, phase kept per voice. */
function sawAt(t: number, f: number, detune: number[]): number {
  let s = 0
  for (const d of detune) s += saw(t * f * (1 + d) + d * 37)
  return s / detune.length
}

function drone(rate: number): Signal {
  const voice = (t: number) => {
    const w = chordWeights(t, 1.2)
    let s = 0
    CHORDS.forEach((c, i) => {
      const g = w[i] ?? 0
      if (g <= 0) return
      const root = midi(c.root)
      s +=
        g *
        (sawAt(t, root, [-0.003, 0.004]) +
          0.7 * sawAt(t, root * 1.5, [0.002, -0.002]) +
          0.5 * sawAt(t, root * 2, [0.0015]) +
          0.6 * Math.sin(2 * Math.PI * (root / 2) * t))
    })
    // A slow breath: two swells per chord.
    const lfo = 0.75 + 0.25 * Math.sin((2 * Math.PI * t * 8) / LOOP_SECONDS)
    return s * lfo
  }
  return loop(rate, LOOP_SECONDS, voice, (x) =>
    normalize(lowpass(lowpass(x, rate, 520), rate, 700), 0.8),
  )
}

function pulse(rate: number): Signal {
  const r = rng(77)
  const ticks = Array.from({ length: LOOP_BEATS * 2 }, () => 0.6 + r() * 0.4)
  const voice = (t: number) => {
    const beat = t / BEAT
    const b = Math.floor(beat)
    const into = (beat - b) * BEAT
    // Lub (on the beat) and dub (a little after), each a falling low thump.
    const thump = (at: number, level: number) => {
      const u = into - at
      if (u < 0 || u > 0.35) return 0
      const f = 48 + 40 * Math.exp(-u * 30)
      return level * Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 11) * Math.min(1, u * 400)
    }
    let s = thump(0, 1) + thump(0.22, 0.65)
    // Off-beat ticks (filtered later): a clock you can't stop.
    const half = Math.floor(beat * 2)
    const tu = (beat * 2 - half) * (BEAT / 2)
    if (half % 2 === 1 && tu < 0.03)
      s += (ticks[half] ?? 1) * 0.25 * (r() * 2 - 1) * (1 - tu / 0.03)
    return s
  }
  return loop(rate, LOOP_SECONDS, voice, (x) => normalize(x, 0.85))
}

function strings(rate: number): Signal {
  const voice = (t: number) => {
    const w = chordWeights(t, 0.9)
    const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t)
    let s = 0
    CHORDS.forEach((c, i) => {
      const g = w[i] ?? 0
      if (g <= 0) return
      const base = c.root + 24
      for (const n of [base, base + c.third, base + 7, base + 12]) {
        s += g * sawAt(t, midi(n) * vib, [-0.004, 0.003, 0.007])
      }
    })
    // Bowed sixteenths: tremolo at the tempo.
    const trem = 0.55 + 0.45 * Math.abs(Math.sin((Math.PI * t * 4) / BEAT))
    return s * trem
  }
  return loop(rate, LOOP_SECONDS, voice, (x) =>
    normalize(highpass(lowpass(lowpass(x, rate, 2400), rate, 3200), rate, 180), 0.75),
  )
}

function high(rate: number): Signal {
  const r = rng(91)
  // Scrapes: a few high glissandi at fixed places in the loop.
  const scrapes = Array.from({ length: 5 }, (_, k) => ({
    at: (k * LOOP_SECONDS) / 5 + r() * 3,
    from: 1800 + r() * 900,
    to: 900 + r() * 500,
  }))
  const voice = (t: number) => {
    const w = chordWeights(t, 1.5)
    let s = 0
    CHORDS.forEach((c, i) => {
      const g = w[i] ?? 0
      if (g <= 0) return
      // A minor second rubbing against the chord's fifth, three octaves up.
      const top = midi(c.root + 43)
      s += g * (Math.sin(2 * Math.PI * top * t) + Math.sin(2 * Math.PI * top * 1.0595 * t))
    })
    for (const sc of scrapes) {
      const u = (t - sc.at + LOOP_SECONDS) % LOOP_SECONDS
      if (u > 1.6) continue
      const f = sc.from + (sc.to - sc.from) * (u / 1.6)
      s += 0.6 * saw(f * u) * Math.sin((Math.PI * u) / 1.6)
    }
    return s * (0.7 + 0.3 * Math.sin((2 * Math.PI * t * 3) / LOOP_SECONDS))
  }
  return loop(rate, LOOP_SECONDS, voice, (x) => normalize(lowpass(x, rate, 5000), 0.6))
}

/** One stem's loop (mono, `rate` Hz). */
export function renderStem(id: StemId, rate = MUSIC_RATE): Signal {
  switch (id) {
    case 'drone':
      return drone(rate)
    case 'pulse':
      return pulse(rate)
    case 'strings':
      return strings(rate)
    case 'high':
      return high(rate)
  }
}

// --- Haven ---------------------------------------------------------------------------------

/** Haven's theme: 66 a minute, D major, a slow plucked guitar over a soft pad. */
export const HAVEN_BPM = 66
export const HAVEN_SECONDS = (32 * 60) / HAVEN_BPM

/** A plucked string (Karplus–Strong) at `f` Hz, `seconds` long. */
function pluck(rate: number, f: number, seconds: number, seed: number): Signal {
  const out = new Float32Array(Math.round(seconds * rate))
  const period = Math.max(2, Math.round(rate / f))
  const r = rng(seed)
  const line = Float32Array.from({ length: period }, () => r() * 2 - 1)
  let k = 0
  for (let i = 0; i < out.length; i++) {
    const next = (k + 1) % period
    const v = 0.5 * ((line[k] ?? 0) + (line[next] ?? 0)) * 0.996
    out[i] = line[k] ?? 0
    line[k] = v
    k = next
  }
  return lowpass(out, rate, 2600)
}

export function renderHaven(rate = MUSIC_RATE): Signal {
  const n = Math.round(HAVEN_SECONDS * rate)
  const out = new Float32Array(n)
  const beat = 60 / HAVEN_BPM
  // D, Bm, G, A: two bars each, twice round. Arpeggio in eighths: root, fifth, octave, third…
  const chords = [
    { root: 50, third: 4 },
    { root: 47, third: 3 },
    { root: 43, third: 4 },
    { root: 45, third: 4 },
  ]
  const pattern = [0, 7, 12, 16, 19, 16, 12, 7]
  for (let e = 0; e < 64; e++) {
    const bar = Math.floor(e / 8)
    const c = chords[Math.floor(bar / 2) % 4] ?? { root: 50, third: 4 }
    const step = pattern[e % 8] ?? 0
    const note = c.root + (step === 16 ? 12 + c.third : step === 19 ? 19 : step)
    const p = pluck(rate, midi(note), 2.2, 300 + e)
    const at = Math.round(((e * beat) / 2) * rate)
    const level = e % 8 === 0 ? 0.9 : 0.6
    for (let i = 0; i < p.length; i++) {
      const j = (at + i) % n
      out[j] = (out[j] ?? 0) + (p[i] ?? 0) * level
    }
  }
  // The pad: sines on the chord, slow in and out.
  const pad = loop(
    rate,
    HAVEN_SECONDS,
    (t) => {
      const chord = chords[Math.floor(t / (beat * 8)) % 4] ?? { root: 50, third: 4 }
      const into = (t % (beat * 8)) / (beat * 8)
      const env = Math.min(1, into * 6, (1 - into) * 6)
      let s = 0
      for (const m of [chord.root - 12, chord.root, chord.root + chord.third, chord.root + 7])
        s += Math.sin(2 * Math.PI * midi(m) * t)
      return s * env * 0.12
    },
    (x) => lowpass(x, rate, 1200),
  )
  for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) + (pad[i] ?? 0)
  return normalize(out, 0.7)
}

// --- Stingers ------------------------------------------------------------------------------

export function renderStinger(id: StingerId, rate = MUSIC_RATE): Signal {
  const seconds = id === 'spotted' ? 1.8 : id === 'bitten' ? 3.2 : 5.5
  const out = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    let s = 0
    if (id === 'spotted') {
      // A string stab on a cluster, and a low hit under it.
      for (const m of [62, 63, 69, 70]) s += sawAt(t, midi(m), [-0.005, 0.005])
      s *= Math.exp(-t * 2.2) * Math.min(1, t * 300) * 0.5
      s += Math.sin(2 * Math.PI * (40 + 50 * Math.exp(-t * 20)) * t) * Math.exp(-t * 3) * 1.4
    } else if (id === 'bitten') {
      // Everything slides down a fifth, out of tune.
      const fall = 2 ** ((-(t / seconds) * 7) / 12)
      for (const m of [57, 58, 64]) s += sawAt(t, midi(m) * fall, [-0.008, 0.006])
      s *= Math.min(1, t * 8) * Math.min(1, (seconds - t) * 1.2) * 0.5
    } else {
      // Dusk: a low swell, D and A and a minor third on top.
      for (const m of [38, 45, 53]) s += sawAt(t, midi(m), [-0.003, 0.004])
      s *= Math.min(1, t / 2) * Math.min(1, (seconds - t) / 2.5) * 0.5
    }
    out[i] = s
  }
  const cut = id === 'spotted' ? 3000 : id === 'bitten' ? 1800 : 600
  return fadeEdges(normalize(lowpass(lowpass(out, rate, cut), rate, cut * 1.4), 0.8), rate, 0.01)
}

// --- Mixing --------------------------------------------------------------------------------

const ramp = (lo: number, hi: number, v: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)))

/**
 * How loud each stem plays at a tension (0–1): near silence when nothing is going on (silence is
 * a weapon), the drone first, then the heartbeat, the strings, and the high layer at the peak.
 */
export function stemLevels(tension: number): Record<StemId, number> {
  return {
    drone: 0.55 * ramp(0.08, 0.35, tension),
    pulse: 0.6 * ramp(0.35, 0.6, tension),
    strings: 0.45 * ramp(0.5, 0.8, tension),
    high: 0.35 * ramp(0.72, 0.95, tension),
  }
}

/** Eases the music's tension towards the server's: up within seconds, down slowly. */
export function smoothTension(current: number, target: number, dt: number): number {
  const rate = target > current ? 0.45 : 0.07
  const step = rate * dt
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step)
}
