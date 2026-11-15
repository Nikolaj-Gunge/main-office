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
  rng,
  type Signal,
  saturate,
  silence,
} from './dsp.ts'

/**
 * Sound as information (roadmap 6.2): birds taking off, birdsong that stops when the dead are
 * near, a car alarm, and glass crunching underfoot. Merged into SOUNDS (sounds.ts).
 */
export const ROT_SOUNDS = {
  /** A flock bursting up: wingbeats and cawing (heard from far off). */
  birds: { variants: 2, recipe: birdsUp },
  /** Daytime birdsong, looped under everything (rot-client.ts fades it). */
  birdsong: { variants: 1, recipe: birdsong },
  /** One second of car alarm: v0 a rising whoop, v1 hi-lo beeps (played back to back). */
  alarm: { variants: 2, recipe: carAlarm },
  /** Broken glass underfoot. */
  glass: { variants: 3, recipe: glassCrunch },
} satisfies Record<string, { variants: number; recipe: (rate: number, v: number) => Signal }>

function birdsUp(rate: number, v: number): Signal {
  const seconds = 1.85
  const r = rng(2100 + v)
  // Wings: dozens of soft thuds of air, thinning out as they climb away.
  const wings = silence(seconds, rate)
  for (let k = 0; k < 70; k++) {
    const t0 = Math.round(r() ** 1.6 * seconds * 0.85 * rate)
    const beat = envelope(
      bandpass(noise(0.05, rate, 2200 + k + v * 100), rate, 500 + r() * 900, 0.9),
      rate,
      0.004,
      0.015,
    )
    const level = (1 - t0 / (seconds * rate)) * (0.5 + r() * 0.5)
    for (let i = 0; i < beat.length && t0 + i < wings.length; i++)
      wings[t0 + i] = (wings[t0 + i] ?? 0) + (beat[i] ?? 0) * level
  }
  // Crows: three or four harsh caws.
  const caws: [Signal, number][] = []
  for (let c = 0; c < 3 + v; c++) {
    const len = 0.2 + r() * 0.1
    const out = silence(len, rate)
    let phase = 0
    const f0 = 520 + r() * 160
    for (let i = 0; i < out.length; i++) {
      const t = i / out.length
      const f = f0 * (1 - 0.25 * t) * (1 + 0.03 * Math.sin(i * 0.02))
      phase += f / rate
      out[i] = 2 * (phase - Math.floor(phase + 0.5)) * Math.min(1, t * 12) * (1 - t) ** 0.6
    }
    const rasp = mix(
      rate,
      gain(bandpass(out.slice(), rate, 1300, 2), 1),
      gain(bandpass(out, rate, 2400, 3), 0.6),
      gain(bandpass(noise(len, rate, 2300 + c), rate, 1800, 1), 0.25),
    )
    caws.push([saturate(rasp, 3), 0.1 + c * 0.38 + r() * 0.1])
  }
  const all = mix(rate, [normalize(highpass(wings, rate, 150), 0.7), 0], ...caws)
  return fadeEdges(normalize(all.slice(0, Math.round(seconds * rate)), 0.9), rate, 0.01)
}

function birdsong(rate: number): Signal {
  const seconds = 9
  const out = silence(seconds, rate)
  const r = rng(2500)
  // Chirps and little trills from a few birds, scattered (none across the loop's seam).
  for (let k = 0; k < 34; k++) {
    const at = 0.1 + r() * (seconds - 0.8)
    const notes = 1 + Math.floor(r() * 5)
    const f = 2600 + r() * 3200
    const level = 0.25 + r() * 0.6
    for (let n = 0; n < notes; n++) {
      const len = 0.04 + r() * 0.07
      const start = Math.round((at + n * (len + 0.03)) * rate)
      const up = r() < 0.5
      let phase = 0
      for (let i = 0; i < len * rate && start + i < out.length; i++) {
        const t = i / (len * rate)
        const ff = f * (up ? 0.85 + 0.3 * t : 1.15 - 0.3 * t)
        phase += ff / rate
        const env = Math.sin(Math.PI * t) ** 2
        out[start + i] = (out[start + i] ?? 0) + Math.sin(2 * Math.PI * phase) * env * level
      }
    }
  }
  return fadeEdges(normalize(lowpass(out, rate, 7000), 0.5), rate, 0.05)
}

function carAlarm(rate: number, v: number): Signal {
  const out = silence(1, rate)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    const f = v === 0 ? 650 + 900 * ((t * 2) % 1) : (t * 4) % 1 < 0.5 ? 1250 : 900
    phase += f / rate
    // A cheap horn speaker: a square wave, buzzy and band-limited.
    out[i] = phase % 1 < 0.5 ? 1 : -1
  }
  return fadeEdges(normalize(bandpass(saturate(out, 2), rate, 1400, 0.7), 0.85), rate, 0.004)
}

function glassCrunch(rate: number, v: number): Signal {
  const r = rng(2700 + v)
  const parts: [Signal, number][] = []
  for (let k = 0; k < 7; k++) {
    const click = envelope(
      bandpass(noise(0.03, rate, 2700 + v * 10 + k), rate, 3500 + r() * 4000, 2),
      rate,
      0,
      0.004,
    )
    parts.push([gain(click, 0.4 + r() * 0.6), r() * 0.1])
  }
  // A shard or two ringing.
  for (let k = 0; k < 2; k++) {
    const ping = envelope(
      bandpass(noise(0.12, rate, 2750 + v + k), rate, 5200 + r() * 2500, 30),
      rate,
      0,
      0.04,
    )
    parts.push([gain(ping, 0.6), 0.02 + r() * 0.06])
  }
  return fadeEdges(normalize(mix(rate, ...parts), 0.8), rate)
}
