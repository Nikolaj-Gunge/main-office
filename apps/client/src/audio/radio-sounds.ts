import {
  bandpass,
  envelope,
  fadeEdges,
  gain,
  lowpass,
  mix,
  noise,
  normalize,
  rng,
  type Signal,
  saturate,
  silence,
  sweep,
} from './dsp.ts'

/**
 * Radio Free Deadwood and the named alphas (roadmap 6.6, 6.7): the static and the little chime
 * before Wes speaks, and an alpha's roar as it charges or leaps. Merged into SOUNDS (sounds.ts).
 */
export const RADIO_SOUNDS = {
  /** A burst of static, a click, and two soft notes: somebody's on the air. */
  'radio.on': { variants: 2, recipe: radioOn },
  /** A huge, ragged bellow (an alpha charging or leaping). */
  roar: { variants: 2, recipe: roar },
} satisfies Record<string, { variants: number; recipe: (rate: number, v: number) => Signal }>

function radioOn(rate: number, v: number): Signal {
  const r = rng(5100 + v)
  // Static: band-limited hiss, crackling (gated in little bursts), swelling and dying away.
  const hiss = bandpass(noise(0.75, rate, 5100 + v), rate, 1800 + r() * 500, 0.6)
  for (let i = 0; i < hiss.length; i++) {
    const t = i / rate
    const crackle = Math.sin(t * 90 + v) > 0.6 ? 1.6 : 0.6
    const swell = Math.min(1, t / 0.08) * Math.max(0, 1 - t / 0.75)
    hiss[i] = (hiss[i] ?? 0) * crackle * swell
  }
  const click = envelope(bandpass(noise(0.02, rate, 5150 + v), rate, 3000, 1.2), rate, 0, 0.004)
  // The chime: two soft, slightly detuned notes, a fourth apart, like an old station ident.
  const note = (f: number, seconds: number) => {
    const out = silence(seconds, rate)
    for (let i = 0; i < out.length; i++) {
      const t = i / rate
      const wob = 1 + 0.003 * Math.sin(2 * Math.PI * 5 * t)
      out[i] =
        (Math.sin(2 * Math.PI * f * wob * t) + 0.3 * Math.sin(4 * Math.PI * f * wob * t)) *
        Math.min(1, t / 0.01) *
        Math.exp(-t * 4.5)
    }
    return lowpass(out, rate, 2400)
  }
  const base = v === 0 ? 660 : 587
  return fadeEdges(
    normalize(
      mix(
        rate,
        [gain(hiss, 0.45), 0],
        [gain(click, 0.7), 0.62],
        [gain(note(base, 0.5), 0.5), 0.68],
        [gain(note(base * 1.335, 0.7), 0.5), 0.86],
      ),
      0.7,
    ),
    rate,
    0.01,
  )
}

function roar(rate: number, v: number): Signal {
  const r = rng(5300 + v)
  const seconds = 1.3
  // A low throat: a falling, buzzy fundamental with a growl of noise through it.
  const throat = sweep(seconds, rate, 150 + r() * 30, 70)
  const growl = lowpass(noise(seconds, rate, 5300 + v), rate, 500)
  const out = silence(seconds, rate)
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const flutter = 0.6 + 0.4 * Math.sin(2 * Math.PI * (22 + 6 * v) * t)
    const swell = Math.min(1, t / 0.12) * Math.max(0, 1 - t / seconds) ** 0.7
    out[i] = ((throat[i] ?? 0) * 0.8 + (growl[i] ?? 0) * 1.2 * flutter) * swell
  }
  const rasp = envelope(bandpass(noise(seconds, rate, 5310 + v), rate, 900, 0.8), rate, 0.1, 0.6)
  return fadeEdges(
    normalize(saturate(mix(rate, [out, 0], [gain(rasp, 0.5), 0.05]), 3.2), 0.9),
    rate,
    0.02,
  )
}
