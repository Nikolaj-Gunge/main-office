import {
  MOODS,
  type Notice,
  type RotMood,
  type SurvivalDef,
  type WeatherKind,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'

/**
 * Radio Free Deadwood (roadmap 6.6): Wes Harlan, in his tin booth at Haven, reads out what
 * really happened out there — supply drops, the names of the dead, who got out on the
 * helicopter, a camp that held, an alpha put down, what kind of night it will be (the Rot's
 * mood), the weather. Only some hear him: everybody in Haven, anybody near a radio set (the
 * booth, the tower, the field radio), sitting in a car, or carrying a two-way radio.
 *
 * He never talks over himself: a line at most every RADIO_GAP seconds, each kind of news has
 * its own cooldown, and news that waited too long to get on the air is dropped.
 */

export const DJ = 'Wes Harlan'

/** What can make the news. */
export type RadioEvent =
  | { kind: 'death'; who: string; turned?: boolean }
  | { kind: 'drop'; near: string }
  | { kind: 'evac'; who: string }
  | { kind: 'siege'; place: string; held: boolean }
  | { kind: 'alpha'; alpha: string; by: string; place: string }
  | { kind: 'alphaBack'; alpha: string; place: string }
  | { kind: 'mood'; mood: RotMood }
  | { kind: 'weather'; weather: WeatherKind }
  | { kind: 'bounty'; who: string; by: string; reward: number }

export type RadioKind = RadioEvent['kind']

/** Seconds between two lines on the air. */
export const RADIO_GAP = 18
/** Seconds before the same kind of news is taken again (more of it in between is let go). */
export const RADIO_COOLDOWN: Record<RadioKind, number> = {
  death: 8,
  drop: 90,
  evac: 0,
  siege: 0,
  alpha: 0,
  alphaBack: 60,
  mood: 0,
  weather: 300,
  bounty: 0,
}
/** Higher goes on the air first, and is the last to be dropped from a full queue. */
const PRIORITY: Record<RadioKind, number> = {
  alpha: 4,
  evac: 3,
  siege: 3,
  mood: 2,
  alphaBack: 2,
  death: 1,
  drop: 1,
  bounty: 2,
  weather: 0,
}
/** News this old (s) that never got on the air is dropped; at most this much waits. */
export const RADIO_STALE = 90
export const RADIO_QUEUE = 4
/** You hear a radio set this far off (m). */
export const RADIO_NEAR = 25

/** What Wes says, by kind: {who}, {near}, {place}, {alpha}, {by} are filled in. */
export const RADIO_LINES: Record<Exclude<RadioKind, 'mood' | 'weather'>, string[]> = {
  death: [
    "{who} didn't make it.",
    'Another name for the board tonight. {who}.',
    "{who} went out and didn't come back. Keep your heads down.",
    "We lost {who}. If you were with them, you know where they fell. Don't go alone for their things.",
    "That's {who} gone. I knew the voice. That's all I've got.",
  ],
  drop: [
    'Rotors over {near}. Something came down on a chute, and every dead thing for a mile heard it.',
    "Supply drop, out by {near}. Red flare. You won't be the only ones going.",
    "Crate's down near {near}. If you go, go fast, and don't stand in the flare's light.",
  ],
  evac: [
    '{who} got out on the helicopter. One less mouth. One less gun. Good luck to them.',
    'Bird lifted off the radio hill with {who} aboard. Somebody made it. Remember that.',
    '{who} is out of the valley. First one this week. Hold onto that.',
  ],
  siege: [
    "{place} held. The ground's black with what's left of them, but it held.",
    "They hit {place} and {place} didn't break. Get some sleep if you can.",
  ],
  alpha: [
    '{alpha} is dead. {by} put it down at {place}. First good news in a while.',
    "Word from {place}: {alpha} is down. {by} did it. Drinks are on Gus, he says. He doesn't mean it.",
    "{by} killed {alpha}. I'll say it again so I believe it. {alpha} is dead.",
  ],
  alphaBack: [
    'Something big moving at {place} again. Sounds like {alpha}. They never stay dead long.',
    '{alpha} is back at {place}. Or something that wants the name. Stay clear.',
  ],
  bounty: [
    '{who} is at rest. {by} saw to it and took the {reward} dollars off the board. Somebody had to.',
    "The slip for {who} came down today. {by} collected. Don't ask them about it.",
  ],
}

/** The siege that broke is said differently. */
const SIEGE_LOST = [
  "They got inside {place}. We're still counting.",
  "{place} didn't hold. I won't read the names tonight. Tomorrow.",
]
const TURNED = [
  "{who} turned out there. If you see them, it isn't {who} any more.",
  "{who} didn't make it, and didn't stay down. Mind who you shoot at.",
]

/** What the weather is doing, as Wes would put it. */
export const WEATHER_LINES: Record<WeatherKind, string[]> = {
  clear: [
    "Sky's clearing. You'll see them coming. They'll see you.",
    'Clear skies over Deadwood. Long sight lines. Use them.',
  ],
  overcast: [
    'Cloud coming in low over the ridge. Gets dark early under that.',
    'Grey all the way across. Light will go before you expect it.',
  ],
  fog: [
    "Fog's settling in the low ground. They hear you before you see them.",
    "Can't see the gate from the booth for fog. Walk slow and listen.",
  ],
  drizzle: [
    'Drizzle. Soft ground, quiet feet. Keep a dry pair of socks.',
    'Light rain. Covers your footsteps. Covers theirs too.',
  ],
  rain: [
    'Rain coming down hard. Covers your footsteps. Covers theirs too.',
    'Proper rain now. Wet and cold kills slower than teeth, but it kills. Find a roof.',
  ],
  snow: [
    'Snow coming down over Deadwood. Pretty, till you see the tracks in it. Theirs and yours.',
    'Snow on the ridge and settling. Everything you walk leaves a trail. So does everything else.',
  ],
  storm: [
    "Storm's on top of us. Stay indoors if you've got a door.",
    'Thunder over the valley. Every flash, look round. Every time.',
  ],
}

const fill = (text: string, e: RadioEvent): string =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String((e as Record<string, unknown>)[k] ?? ''))

/** Every way a piece of news can be said (moods: the Rot's own radio line). */
export function radioTemplates(e: RadioEvent): string[] {
  switch (e.kind) {
    case 'mood':
      return [MOODS[e.mood].news]
    case 'weather':
      return WEATHER_LINES[e.weather]
    case 'siege':
      return e.held ? RADIO_LINES.siege : SIEGE_LOST
    case 'death':
      return e.turned ? TURNED : RADIO_LINES.death
    default:
      return RADIO_LINES[e.kind]
  }
}

/**
 * What Wes says about `e`: a template picked at random, but not the one used last time for the
 * same kind of news (`last`, an index, if any). Returns the text and which template it was.
 */
export function radioLine(
  e: RadioEvent,
  random: () => number,
  last = -1,
): { text: string; index: number } {
  const lines = radioTemplates(e)
  let index = Math.floor(random() * lines.length) % Math.max(1, lines.length)
  if (lines.length > 1 && index === last) index = (index + 1) % lines.length
  return { text: fill(lines[index] ?? '', e), index }
}

/** Where a radio set plays: the booth's DJ, the radio tower, any radio you can use. */
export function radioStations(def: SurvivalDef): Point[] {
  const out: Point[] = []
  for (const p of def.pois) if (p.kind === 'radio') out.push({ x: p.x, y: p.y, z: p.z })
  for (const i of def.interactables)
    if (i.kind === 'radio') out.push({ x: i.pos[0], y: i.pos[1], z: i.pos[2] })
  for (const n of def.npcs)
    if (n.role === 'radio') out.push({ x: n.pos[0], y: n.pos[1], z: n.pos[2] })
  return out
}

/** Somebody who might be listening. */
export interface Listener {
  player: ServerPlayer
  pos: Point
  /** Sitting in a car (the car radio). */
  seated: boolean
  /** Carrying a two-way radio. */
  carrying: boolean
}

/** Whether someone at `pos` hears the radio: in a safe place, by a set, in a car, or carrying one. */
export function hearsRadio(
  def: SurvivalDef,
  stations: readonly Point[],
  l: Omit<Listener, 'player'>,
): boolean {
  if (l.seated || l.carrying) return true
  const { x, z } = l.pos
  if (def.pois.some((p) => p.safe && Math.hypot(p.x - x, p.z - z) < p.r + 6)) return true
  return stations.some((s) => Math.hypot(s.x - x, s.z - z) < RADIO_NEAR)
}

export interface RadioHost {
  def(): SurvivalDef
  /** Seconds since the server started. */
  now(): number
  random(): number
  listeners(): Listener[]
  send(player: ServerPlayer, notice: Notice): void
  /** What the weather is doing right now (Wes mentions it when it changes). */
  weather(): WeatherKind
}

interface Queued {
  event: RadioEvent
  at: number
}

/** The DJ: takes the news, keeps it in order and on time, and puts it on the air. */
export class Radio {
  private queue: Queued[] = []
  /** When each kind of news was last taken, and the template it used last. */
  private readonly taken = new Map<RadioKind, number>()
  private readonly used = new Map<RadioKind, number>()
  private lastAir = Number.NEGATIVE_INFINITY
  private weatherWas: WeatherKind | null = null
  private stations: Point[] | null = null
  /** Every line put on the air (tests, the admin). */
  readonly log: string[] = []

  constructor(private readonly host: RadioHost) {}

  reset(): void {
    this.queue = []
    this.taken.clear()
    this.used.clear()
    this.lastAir = Number.NEGATIVE_INFINITY
    this.weatherWas = null
    this.stations = null
    this.log.length = 0
  }

  /** Something happened. False if it isn't news (that kind came in too recently). */
  say(event: RadioEvent): boolean {
    const now = this.host.now()
    const last = this.taken.get(event.kind)
    if (last !== undefined && now - last < RADIO_COOLDOWN[event.kind]) return false
    this.taken.set(event.kind, now)
    this.queue.push({ event, at: now })
    // Most important first; within that, oldest first.
    this.queue.sort((a, b) => PRIORITY[b.event.kind] - PRIORITY[a.event.kind] || a.at - b.at)
    while (this.queue.length > RADIO_QUEUE) this.queue.pop()
    return true
  }

  /** News waiting to go on the air (tests). */
  get waiting(): readonly RadioEvent[] {
    return this.queue.map((q) => q.event)
  }

  /** Once a second: the weather is watched, and the next line goes out if it's time. */
  tick(): string | null {
    const now = this.host.now()
    const weather = this.host.weather()
    if (this.weatherWas !== null && weather !== this.weatherWas)
      this.say({ kind: 'weather', weather })
    this.weatherWas = weather
    this.queue = this.queue.filter((q) => now - q.at <= RADIO_STALE)
    if (now - this.lastAir < RADIO_GAP) return null
    const next = this.queue.shift()
    if (!next) return null
    this.lastAir = now
    const { text, index } = radioLine(
      next.event,
      () => this.host.random(),
      this.used.get(next.event.kind),
    )
    this.used.set(next.event.kind, index)
    this.air(text)
    return text
  }

  /** Everyone listening hears it. */
  private air(text: string): void {
    const def = this.host.def()
    this.stations ??= radioStations(def)
    this.log.push(text)
    if (this.log.length > 50) this.log.shift()
    for (const l of this.host.listeners()) {
      if (!hearsRadio(def, this.stations, l)) continue
      this.host.send(l.player, { kind: 'radio', text, from: DJ })
    }
  }
}
