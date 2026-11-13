import {
  bandpass,
  envelope,
  fadeEdges,
  gain,
  highpass,
  lowpass,
  mix,
  noise,
  normalize,
  reflections,
  rng,
  type Signal,
  saturate,
  sweep,
  tone,
} from './dsp.ts'

/**
 * Every sound in the game, synthesized at startup. Swappable for recorded samples later (same
 * ids). Gunshots come in three layers that the engine mixes by distance (PLAN.md §4.4):
 *   close — mechanical crack, only up close · body — the punch · tail — the room/echo.
 */
export const SOUNDS = {
  'shot.close': { variants: 3, recipe: shotClose },
  'shot.body': { variants: 3, recipe: shotBody },
  'shot.tail': { variants: 2, recipe: shotTail },
  step: { variants: 6, recipe: footstep },
  land: { variants: 2, recipe: land },
  'reload.out': { variants: 1, recipe: magOut },
  'reload.in': { variants: 1, recipe: magIn },
  'reload.slide': { variants: 1, recipe: slide },
  bolt: { variants: 1, recipe: boltCycle },
  pump: { variants: 1, recipe: pumpAction },
  swish: { variants: 3, recipe: knifeSwish },
  stab: { variants: 2, recipe: knifeStab },
  twang: { variants: 2, recipe: twang },
  dryfire: { variants: 1, recipe: dryFire },
  hit: { variants: 1, recipe: hitTick },
  'hit.head': { variants: 1, recipe: headTink },
  kill: { variants: 1, recipe: killDing },
  hurt: { variants: 2, recipe: hurt },
  crack: { variants: 3, recipe: crack },
  'impact.world': { variants: 4, recipe: impactWorld },
  'impact.flesh': { variants: 3, recipe: impactFlesh },
  casing: { variants: 4, recipe: casing },
  heartbeat: { variants: 1, recipe: heartbeat },
  groan: { variants: 4, recipe: zombieGroan },
  claw: { variants: 2, recipe: clawHit },
  // Survival: the forest at night.
  scream: { variants: 2, recipe: scream },
  wind: { variants: 3, recipe: windGust },
  dread: { variants: 2, recipe: dread },
  twig: { variants: 3, recipe: twigSnap },
  pickup: { variants: 2, recipe: pickup },
  // Kill jingles (game rules pick the set). Variant = streak: 0 kill, 1 double, 2 triple+.
  'jingle.arcade': { variants: 3, recipe: jingleArcade },
  'jingle.fanfare': { variants: 3, recipe: jingleFanfare },
  'jingle.airhorn': { variants: 3, recipe: jingleAirhorn },
} satisfies Record<string, { variants: number; recipe: (rate: number, v: number) => Signal }>

export type SoundId = keyof typeof SOUNDS

function shotClose(rate: number, v: number): Signal {
  const click = envelope(highpass(noise(0.006, rate, 10 + v), rate, 3000), rate, 0, 0.0012)
  const crackLayer = envelope(
    bandpass(noise(0.08, rate, 20 + v), rate, 3200 + v * 400, 0.9),
    rate,
    0.0005,
    0.018,
  )
  const mech = envelope(gain(tone(0.05, rate, 2600 + v * 150), 0.25), rate, 0, 0.01)
  return fadeEdges(normalize(saturate(mix(rate, gain(click, 1.4), crackLayer, mech), 2)), rate)
}

function shotBody(rate: number, v: number): Signal {
  const thump = envelope(sweep(0.18, rate, 170 + v * 10, 45), rate, 0.001, 0.05)
  const blast = envelope(lowpass(noise(0.2, rate, 30 + v), rate, 900), rate, 0.0008, 0.045)
  return fadeEdges(normalize(saturate(mix(rate, gain(thump, 1.2), gain(blast, 1.6)), 3)), rate)
}

function shotTail(rate: number, v: number): Signal {
  const r = rng(40 + v)
  const tail = envelope(lowpass(noise(1.4, rate, 50 + v), rate, 700 + r() * 200), rate, 0.01, 0.35)
  return fadeEdges(normalize(reflections(tail, rate, 60 + v, 6, 0.25), 0.8), rate, 0.02)
}

function footstep(rate: number, v: number): Signal {
  const r = rng(100 + v)
  const heel = envelope(sweep(0.06, rate, 110 + r() * 30, 60), rate, 0.001, 0.012)
  const scuff = envelope(
    bandpass(noise(0.09, rate, 110 + v), rate, 1200 + r() * 900, 1.2),
    rate,
    0.004,
    0.018,
  )
  const grit = envelope(highpass(noise(0.05, rate, 120 + v), rate, 4000), rate, 0.002, 0.008)
  return fadeEdges(
    normalize(mix(rate, gain(heel, 1), [gain(scuff, 0.8), 0.006], [gain(grit, 0.25), 0.01]), 0.7),
    rate,
  )
}

function land(rate: number, v: number): Signal {
  const thud = envelope(sweep(0.15, rate, 90, 40), rate, 0.002, 0.04)
  const cloth = envelope(lowpass(noise(0.15, rate, 130 + v), rate, 1500), rate, 0.005, 0.03)
  return fadeEdges(normalize(mix(rate, gain(thud, 1.2), [cloth, 0.004]), 0.8), rate)
}

/** Metal click with a short resonant ping. */
function metalClick(rate: number, seed: number, pitch: number, length = 0.06): Signal {
  const click = envelope(highpass(noise(0.01, rate, seed), rate, 2500), rate, 0, 0.002)
  const ping = envelope(
    mix(rate, tone(length, rate, pitch), gain(tone(length, rate, pitch * 2.7), 0.4)),
    rate,
    0,
    length / 4,
  )
  return mix(rate, gain(click, 1.2), gain(ping, 0.5))
}

function magOut(rate: number): Signal {
  const release = metalClick(rate, 200, 1900)
  const slideOut = envelope(bandpass(noise(0.12, rate, 201), rate, 2200, 2), rate, 0.03, 0.04)
  return fadeEdges(normalize(mix(rate, release, [gain(slideOut, 0.6), 0.02]), 0.6), rate)
}

function magIn(rate: number): Signal {
  const slideIn = envelope(bandpass(noise(0.08, rate, 210), rate, 1800, 2), rate, 0.02, 0.025)
  const seat = metalClick(rate, 211, 1500, 0.08)
  return fadeEdges(normalize(mix(rate, gain(slideIn, 0.5), [seat, 0.07]), 0.65), rate)
}

function slide(rate: number): Signal {
  const back = metalClick(rate, 220, 2100)
  const rack = envelope(bandpass(noise(0.1, rate, 221), rate, 3000, 1.5), rate, 0.01, 0.03)
  const forward = metalClick(rate, 222, 1700, 0.09)
  return fadeEdges(normalize(mix(rate, back, [gain(rack, 0.5), 0.02], [forward, 0.11]), 0.65), rate)
}

/** Bolt-action cycle: lift, pull back, push forward, lock down. */
function boltCycle(rate: number): Signal {
  const lift = metalClick(rate, 240, 1300, 0.05)
  const back = envelope(bandpass(noise(0.14, rate, 241), rate, 2400, 1.6), rate, 0.02, 0.05)
  const forward = envelope(bandpass(noise(0.12, rate, 242), rate, 2000, 1.6), rate, 0.02, 0.04)
  const lock = metalClick(rate, 243, 1100, 0.08)
  return fadeEdges(
    normalize(
      mix(rate, lift, [gain(back, 0.6), 0.08], [gain(forward, 0.6), 0.3], [lock, 0.45]),
      0.65,
    ),
    rate,
  )
}

/** Shotgun pump: ka-chunk — the slide back (shell out), then forward (shell in, locked). */
function pumpAction(rate: number): Signal {
  const back = envelope(bandpass(noise(0.1, rate, 251), rate, 1500, 1.2), rate, 0.01, 0.045)
  const clack = metalClick(rate, 252, 900, 0.06)
  const forward = envelope(bandpass(noise(0.09, rate, 253), rate, 1300, 1.2), rate, 0.01, 0.04)
  const lock = metalClick(rate, 254, 750, 0.09)
  return fadeEdges(
    normalize(mix(rate, back, [clack, 0.06], [forward, 0.2], [gain(lock, 1.2), 0.26]), 0.7),
    rate,
  )
}

/** A knife cutting the air: a quick band of noise sweeping up. */
function knifeSwish(rate: number, v: number): Signal {
  const air = envelope(
    bandpass(noise(0.18, rate, 260 + v), rate, 2200 + v * 500, 1.4),
    rate,
    0.05,
    0.05,
  )
  return fadeEdges(normalize(air, 0.5), rate)
}

/** The knife connecting: a dull thud with a wet edge. */
function knifeStab(rate: number, v: number): Signal {
  const thud = envelope(sweep(0.1, rate, 160, 70), rate, 0.002, 0.03)
  const flesh = envelope(lowpass(noise(0.12, rate, 270 + v), rate, 1800), rate, 0.001, 0.035)
  return fadeEdges(normalize(saturate(mix(rate, thud, gain(flesh, 0.9)), 2), 0.8), rate)
}

/** A crossbow loosing: the thrum of the string and the slap of the limbs. */
function twang(rate: number, v: number): Signal {
  const string = mix(rate, tone(0.3, rate, 150 + v * 14), gain(tone(0.3, rate, 304 + v * 26), 0.5))
  const thrum = envelope(string, rate, 0.001, 0.07)
  const slap = envelope(bandpass(noise(0.05, rate, 280 + v), rate, 1800, 1.5), rate, 0, 0.012)
  return fadeEdges(normalize(mix(rate, thrum, gain(slap, 0.8)), 0.6), rate)
}

function dryFire(rate: number): Signal {
  return fadeEdges(normalize(metalClick(rate, 230, 2400, 0.03), 0.4), rate)
}

function hitTick(rate: number): Signal {
  const tick = envelope(bandpass(noise(0.03, rate, 300), rate, 2800, 3), rate, 0, 0.006)
  const body = envelope(tone(0.04, rate, 1400), rate, 0, 0.008)
  return fadeEdges(normalize(mix(rate, tick, gain(body, 0.5)), 0.6), rate)
}

function headTink(rate: number): Signal {
  const ping = mix(
    rate,
    tone(0.25, rate, 2900),
    gain(tone(0.25, rate, 4650), 0.6),
    gain(tone(0.25, rate, 7300), 0.25),
  )
  return fadeEdges(normalize(mix(rate, envelope(ping, rate, 0, 0.06), hitTick(rate)), 0.7), rate)
}

function killDing(rate: number): Signal {
  const a = envelope(tone(0.18, rate, 880), rate, 0.002, 0.05)
  const b = envelope(
    mix(rate, tone(0.3, rate, 1320), gain(tone(0.3, rate, 2640), 0.3)),
    rate,
    0.002,
    0.09,
  )
  return fadeEdges(normalize(mix(rate, a, [b, 0.08]), 0.6), rate)
}

/** Frequency of the note `semitones` above A4. */
const pitch = (semitones: number) => 440 * 2 ** (semitones / 12)

/** Plays notes [semitones from A4, start s, length s] with the given voice. */
function melody(
  rate: number,
  notes: [number, number, number][],
  voice: (freq: number, seconds: number) => Signal,
): Signal {
  return mix(rate, ...notes.map(([n, at, len]): [Signal, number] => [voice(pitch(n), len), at]))
}

/** 8-bit arpeggio up the major chord; streaks climb higher and add a trill. */
function jingleArcade(rate: number, v: number): Signal {
  const square = (f: number, len: number) =>
    envelope(saturate(tone(len, rate, f), 6), rate, 0.002, len * 0.8)
  const root = 3 + v * 5 // C5, F5, A#5
  const notes: [number, number, number][] = [0, 4, 7, 12].map((n, i) => [root + n, i * 0.065, 0.09])
  if (v >= 1) notes.push([root + 16, 0.26, 0.09], [root + 19, 0.32, 0.16])
  if (v >= 2)
    for (let i = 0; i < 4; i++) notes.push([root + 24 - (i % 2) * 5, 0.42 + i * 0.05, 0.06])
  return fadeEdges(normalize(melody(rate, notes, square), 0.55), rate)
}

/** Short brass fanfare: ta-ta-taaa; streaks go up a step and get longer. */
function jingleFanfare(rate: number, v: number): Signal {
  const brass = (f: number, len: number) =>
    envelope(
      lowpass(
        mix(
          rate,
          tone(len, rate, f),
          gain(tone(len, rate, f * 2), 0.5),
          gain(tone(len, rate, f * 3), 0.3),
        ),
        rate,
        2400,
      ),
      rate,
      0.015,
      len * 0.9,
    )
  const k = -2 + v * 2
  const notes: [number, number, number][] = [
    [k, 0, 0.1],
    [k, 0.12, 0.1],
    [k + 5, 0.24, v >= 1 ? 0.18 : 0.38],
  ]
  if (v >= 1) notes.push([k + 9, 0.44, v >= 2 ? 0.18 : 0.4])
  if (v >= 2) notes.push([k + 12, 0.64, 0.45], [k + 16, 0.64, 0.45])
  return fadeEdges(normalize(saturate(melody(rate, notes, brass), 1.5), 0.6), rate)
}

/** The party airhorn: one blast per kill in the streak (BWAA, BWA-BWAA, BWA-BWA-BWAAA). */
function jingleAirhorn(rate: number, v: number): Signal {
  const horn = (f: number, len: number) => {
    const detuned = mix(
      rate,
      sweep(len, rate, f * 0.97, f),
      gain(sweep(len, rate, f * 1.5 * 0.98, f * 1.5), 0.6),
      gain(tone(len, rate, f * 2.01), 0.4),
    )
    return envelope(lowpass(saturate(detuned, 4), rate, 3200), rate, 0.01, len)
  }
  const blasts: [number, number, number][] = []
  let at = 0
  for (let i = 0; i <= v; i++) {
    const last = i === v
    blasts.push([-3, at, last ? 0.45 : 0.14])
    at += 0.18
  }
  return fadeEdges(normalize(melody(rate, blasts, horn), 0.5), rate)
}

function hurt(rate: number, v: number): Signal {
  const thump = envelope(sweep(0.12, rate, 95, 50), rate, 0.002, 0.03)
  const smack = envelope(lowpass(noise(0.1, rate, 310 + v), rate, 1200), rate, 0.001, 0.02)
  return fadeEdges(normalize(saturate(mix(rate, thump, gain(smack, 0.8)), 2), 0.8), rate)
}

/**
 * A zombie groan: a low, rough voice (a buzz of harmonics wobbling in pitch) through two vowel
 * formants, swelling in and dying away, with breath on top. Variants differ in pitch, length
 * and vowel.
 */
function zombieGroan(rate: number, v: number): Signal {
  const r = rng(900 + v)
  const seconds = 0.9 + r() * 0.7
  const base = 70 + r() * 45
  const out = new Float32Array(Math.round(seconds * rate))
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const wobble = 1 + 0.06 * Math.sin(t * 7 + v) + 0.04 * Math.sin(t * 2.3) - 0.12 * (t / seconds)
    phase += (2 * Math.PI * base * wobble) / rate
    let s = 0
    for (let h = 1; h <= 12; h++) s += Math.sin(phase * h) / h
    out[i] = s
  }
  const vowel = [
    [480, 950],
    [560, 1100],
    [400, 800],
    [620, 1250],
  ][v % 4] ?? [500, 1000]
  const voice = mix(
    rate,
    gain(bandpass(out.slice(), rate, vowel[0] ?? 500, 3), 1),
    gain(bandpass(out.slice(), rate, vowel[1] ?? 1000, 4), 0.6),
    gain(lowpass(out, rate, 300), 0.5),
  )
  const breath = bandpass(noise(seconds, rate, 950 + v), rate, 900, 0.8)
  const body = saturate(mix(rate, voice, gain(breath, 0.25)), 2.5)
  // Swell in, hold, fade.
  for (let i = 0; i < body.length; i++) {
    const t = i / body.length
    body[i] = (body[i] ?? 0) * Math.min(1, t * 5) * Math.min(1, (1 - t) * 2.5)
  }
  return fadeEdges(normalize(body, 0.7), rate)
}

/** Claws raking you: a wet slash. */
function clawHit(rate: number, v: number): Signal {
  const rake = envelope(bandpass(noise(0.16, rate, 970 + v), rate, 1500, 1.2), rate, 0.005, 0.05)
  const thud = envelope(sweep(0.1, rate, 140, 60), rate, 0.002, 0.03)
  return fadeEdges(normalize(saturate(mix(rate, rake, gain(thud, 0.8)), 2), 0.8), rate)
}

/** Supersonic crack + whoosh of a bullet passing close by. */
function crack(rate: number, v: number): Signal {
  const snap = envelope(highpass(noise(0.01, rate, 400 + v), rate, 2500), rate, 0, 0.0015)
  const whoosh = envelope(
    bandpass(noise(0.12, rate, 410 + v), rate, 2600 - v * 300, 1.2),
    rate,
    0.004,
    0.03,
  )
  return fadeEdges(normalize(mix(rate, gain(snap, 1.3), [gain(whoosh, 0.6), 0.003]), 0.8), rate)
}

function impactWorld(rate: number, v: number): Signal {
  const r = rng(500 + v)
  const hit = envelope(
    bandpass(noise(0.08, rate, 500 + v), rate, 900 + r() * 1200, 1),
    rate,
    0,
    0.012,
  )
  const debris = envelope(highpass(noise(0.18, rate, 510 + v), rate, 3000), rate, 0.01, 0.04)
  return fadeEdges(normalize(mix(rate, hit, [gain(debris, 0.35), 0.01]), 0.7), rate)
}

function impactFlesh(rate: number, v: number): Signal {
  const thud = envelope(lowpass(noise(0.08, rate, 600 + v), rate, 700), rate, 0.001, 0.015)
  const slap = envelope(bandpass(noise(0.04, rate, 610 + v), rate, 1800, 1.5), rate, 0, 0.006)
  return fadeEdges(normalize(mix(rate, gain(thud, 1.2), slap), 0.7), rate)
}

/** Brass casing bouncing: a few bright, fast-decaying pings. */
function casing(rate: number, v: number): Signal {
  const r = rng(700 + v)
  const pings: [Signal, number][] = []
  let t = 0
  for (let i = 0; i < 3; i++) {
    const f = 3800 + r() * 2500
    const p = mix(rate, tone(0.08, rate, f), gain(tone(0.08, rate, f * 1.58), 0.5))
    pings.push([gain(envelope(p, rate, 0, 0.012), 1 / (i + 1)), t])
    t += 0.05 + r() * 0.08
  }
  return fadeEdges(normalize(mix(rate, ...pings), 0.35), rate)
}

/** One lub-dub, padded to a ~0.85 s loop (≈70 bpm). */
function heartbeat(rate: number): Signal {
  const beat = (f: number, d: number) =>
    envelope(lowpass(sweep(0.18, rate, f, f * 0.6), rate, 200), rate, 0.01, d)
  const loop = mix(rate, gain(beat(60, 0.05), 1), [gain(beat(52, 0.06), 0.75), 0.17])
  const padded = new Float32Array(Math.round(0.85 * rate))
  padded.set(loop.subarray(0, Math.min(loop.length, padded.length)))
  return normalize(padded, 0.9)
}

/** A screamer's shriek: a torn, rising voice with a rasp on top. */
function scream(rate: number, v: number): Signal {
  const seconds = 1.35 + v * 0.2
  const out = new Float32Array(Math.round(seconds * rate))
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const rise = 520 + 380 * Math.min(1, t * 3) + 60 * Math.sin(t * 31 + v) - 160 * (t / seconds) ** 3
    phase += (2 * Math.PI * rise) / rate
    let s = 0
    for (let h = 1; h <= 9; h++) s += Math.sin(phase * h * (1 + 0.004 * h)) / h
    out[i] = s * (1 + 0.5 * Math.sin(t * 73))
  }
  const voice = mix(
    rate,
    gain(bandpass(out.slice(), rate, 1500, 2), 1),
    gain(bandpass(out.slice(), rate, 2900, 3), 0.8),
    gain(bandpass(out, rate, 800, 2), 0.5),
  )
  const rasp = bandpass(noise(seconds, rate, 1300 + v), rate, 2400, 0.7)
  const body = saturate(mix(rate, voice, gain(rasp, 0.5)), 4)
  for (let i = 0; i < body.length; i++) {
    const t = i / body.length
    body[i] = (body[i] ?? 0) * Math.min(1, t * 14) * Math.min(1, (1 - t) * 3)
  }
  return fadeEdges(normalize(reflections(body, rate, 70 + v, 5, 0.3), 0.9), rate, 0.01)
}

/** Wind through the pines: a long, slow swell of dark noise. */
function windGust(rate: number, v: number): Signal {
  const seconds = 5 + v
  const hiss = lowpass(highpass(noise(seconds, rate, 1400 + v), rate, 180), rate, 520 + v * 120)
  for (let i = 0; i < hiss.length; i++) {
    const t = i / hiss.length
    const swell = Math.sin(Math.PI * t) ** 2 * (0.7 + 0.3 * Math.sin(t * 9 + v))
    hiss[i] = (hiss[i] ?? 0) * swell
  }
  return fadeEdges(normalize(hiss, 0.6), rate, 0.05)
}

/** Something has seen you: a low swell that ends in a thud. */
function dread(rate: number, v: number): Signal {
  const seconds = 1.6
  const out = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const f = 46 + v * 9
    out[i] =
      (Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * f * 1.498 * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.02 * t)) *
      (t / seconds) ** 2
  }
  const hit = envelope(sweep(0.5, rate, 90, 30), rate, 0.002, 0.16)
  return fadeEdges(normalize(saturate(mix(rate, out, [gain(hit, 1.6), seconds - 0.12]), 2), 0.9), rate, 0.01)
}

/** A twig snapping somewhere out in the dark. */
function twigSnap(rate: number, v: number): Signal {
  const r = rng(1500 + v)
  const snap = envelope(bandpass(noise(0.05, rate, 1500 + v), rate, 1800 + r() * 1400, 1.5), rate, 0, 0.006)
  const second = envelope(bandpass(noise(0.05, rate, 1510 + v), rate, 1200 + r() * 900, 1.2), rate, 0, 0.01)
  return fadeEdges(normalize(mix(rate, snap, [gain(second, 0.6), 0.04 + r() * 0.08]), 0.8), rate)
}

/** Taking something: a soft cloth rustle and a click. */
function pickup(rate: number, v: number): Signal {
  const rustle = envelope(bandpass(noise(0.12, rate, 1600 + v), rate, 2600, 0.8), rate, 0.01, 0.04)
  const click = envelope(tone(0.03, rate, 1300 + v * 300), rate, 0, 0.008)
  return fadeEdges(normalize(mix(rate, gain(rustle, 0.8), [gain(click, 0.5), 0.07]), 0.6), rate)
}
