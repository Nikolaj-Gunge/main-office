/**
 * Bloodstain echoes (apps/server/src/survival/echoes.ts): the server keeps the last few seconds
 * of everybody's movement, cheaply, and when somebody dies those seconds stay where they fell (and
 * with their grave). E on the faint stain plays them back as a pale blocky ghost, with their last
 * words if they said any. Kept in the world save, a few dozen at most.
 */

/** Seconds of movement kept, and frames a second. */
export const ECHO_SECONDS = 6
export const ECHO_RATE = 5
export const ECHO_FRAMES = ECHO_SECONDS * ECHO_RATE
/** Numbers per frame: dx, dy, dz (decimetres from where they fell), yaw (centiradians), crouched. */
export const ECHO_STRIDE = 5
/** Echoes the world keeps (oldest go first). */
export const ECHO_MAX = 24
/** A stain shows on the ground for this many world days; at a grave the echo stays. */
export const ECHO_DAYS = 3
/** How close you stand (m) to play one. */
export const ECHO_REACH = 2.2
/** Words said this long (s) before dying still count as last words. */
export const ECHO_WORDS_SECONDS = 300

/** A death's echo, as it is played back (Notice.echo). */
export interface EchoReplay {
  id: number
  name: string
  /** Where they fell. */
  x: number
  y: number
  z: number
  /** ECHO_STRIDE numbers per frame, oldest first, 1 / ECHO_RATE s apart. */
  frames: number[]
  /** The last thing they said out loud, if anything. */
  words?: string
}

/** As the world keeps it (WorldSave.echoes). */
export interface EchoSave extends EchoReplay {
  /** World day they fell. */
  day: number
}

/** A stain on the ground, as everybody sees it (CampShared.stains). */
export interface StainShared {
  id: number
  x: number
  y: number
  z: number
}

/** A world-space pose from a frame of an echo. */
export function echoPose(
  e: Pick<EchoReplay, 'x' | 'y' | 'z' | 'frames'>,
  i: number,
): { x: number; y: number; z: number; yaw: number; crouched: boolean } | null {
  const o = i * ECHO_STRIDE
  if (o < 0 || o + ECHO_STRIDE > e.frames.length) return null
  const f = e.frames
  return {
    x: e.x + (f[o] ?? 0) / 10,
    y: e.y + (f[o + 1] ?? 0) / 10,
    z: e.z + (f[o + 2] ?? 0) / 10,
    yaw: (f[o + 3] ?? 0) / 100,
    crouched: f[o + 4] === 1,
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Echoes from a save, cleaned (older saves have none). */
export function readEchoes(raw: unknown): EchoSave[] {
  if (!Array.isArray(raw)) return []
  const out: EchoSave[] = []
  for (const r of raw.slice(-ECHO_MAX)) {
    if (!r || typeof r !== 'object') continue
    const e = r as Partial<EchoSave>
    const [id, x, y, z] = [num(e.id), num(e.x), num(e.y), num(e.z)]
    if (id === null || x === null || y === null || z === null || typeof e.name !== 'string')
      continue
    const frames = Array.isArray(e.frames)
      ? e.frames.slice(0, ECHO_FRAMES * ECHO_STRIDE).map((n) => Math.round(num(n) ?? 0))
      : []
    out.push({
      id,
      name: e.name.slice(0, 32),
      x,
      y,
      z,
      frames: frames.slice(0, frames.length - (frames.length % ECHO_STRIDE)),
      day: num(e.day) ?? 0,
      ...(typeof e.words === 'string' && e.words ? { words: e.words.slice(0, 120) } : {}),
    })
  }
  return out
}
