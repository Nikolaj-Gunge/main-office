/**
 * The state the cars of Deadwood were left in. Every car is rolled a condition when it is
 * parked (and again when a fresh one is put back): about a third run but break down after a
 * short drive, the most won't start until somebody fits what is missing, and the rest run but
 * are worn out. All of them are low on fuel. The server owns all of it; the client shows it.
 */

/** What a car can be missing, as bits (a car's `needs`). */
export const CarPart = {
  Battery: 1,
  Plugs: 2,
  Tyre: 4,
  Fuel: 8,
  Hose: 16,
} as const
export type CarPart = (typeof CarPart)[keyof typeof CarPart]

/** Missing any of these, the engine won't run (a flat tyre only slows you down). */
export const ENGINE_PARTS = CarPart.Battery | CarPart.Plugs | CarPart.Fuel | CarPart.Hose

/** What the engine is doing. */
export const Engine = {
  /** Runs (or would, with somebody at the wheel). */
  Ok: 0,
  /** Coughing: about to die (overheating, or the tank all but dry). Half power. */
  Sputter: 1,
  /** Died hot: give it a while, then try it again (hold W). */
  Stalled: 2,
  /** Won't start until it gets what it needs. */
  Dead: 3,
} as const
export type Engine = (typeof Engine)[keyof typeof Engine]

/** How a car was left. */
export type CarKind = 'fragile' | 'dead' | 'worn'

/** Fuel (0–100, a full tank) burnt per metre driven, and per second the engine idles. */
export const FUEL_PER_METRE = 0.02
export const FUEL_IDLE = 0.01
/** Below this the engine starts to cough. */
export const FUEL_SPUTTER = 4
/** What a jerry can puts in the tank, and the tank has to be below this to take it. */
export const JERRYCAN_FUEL = 60
export const REFUEL_BELOW = 70
/** A fragile car's engine gives out after this many metres (random in between). */
export const FRAGILE_MIN = 150
export const FRAGILE_MAX = 600
/** Coughing for this long (s) before it dies: never without warning. */
export const SPUTTER_SECONDS = 5
/** A stalled engine needs this long (s) to cool before it will catch again… */
export const COOLDOWN_SECONDS = 15
/** …and catches on each try (hold W, one try every CRANK_SECONDS) with this chance. */
export const CRANK_CHANCE = 0.5
export const CRANK_SECONDS = 1.2
/** A breakdown splits the radiator hose this often (then it needs fixing). */
export const HOSE_SPLITS = 0.35

/** What a car is rolled when it's parked. */
export interface CarCondition {
  kind: CarKind
  needs: number
  fuel: number
  /** Share of the usual top speed it manages (1 = as new). */
  top: number
  /** Which way it pulls, −1 (right) … 1 (left); 0 = straight. */
  pull: number
  /** Fragile: metres until the engine gives out (Infinity for the others). */
  breakAt: number
}

/**
 * How a lot of `count` cars were left: three in ten fragile, four dead, the rest worn, in a
 * shuffled order (dealt rather than rolled, so every map gets the mix).
 */
export function dealKinds(count: number, random: () => number): CarKind[] {
  const fragile = Math.round(count * 0.3)
  const dead = Math.round(count * 0.4)
  const deck: CarKind[] = Array.from({ length: count }, (_, i) =>
    i < fragile ? 'fragile' : i < fragile + dead ? 'dead' : 'worn',
  )
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j] as CarKind, deck[i] as CarKind]
  }
  return deck
}

/**
 * Rolls a car's condition (`random`: the car's own seeded generator), of the `kind` given or
 * (without one) a kind of its own.
 */
export function rollCondition(random: () => number, kind?: CarKind): CarCondition {
  const r = random()
  kind ??= r < 0.3 ? 'fragile' : r < 0.7 ? 'dead' : 'worn'
  let needs = 0
  let top = 0.9 + random() * 0.1
  let pull = (random() - 0.5) * 0.3
  let breakAt = Number.POSITIVE_INFINITY
  if (kind === 'fragile') breakAt = FRAGILE_MIN + random() * (FRAGILE_MAX - FRAGILE_MIN)
  if (kind === 'dead') {
    // One thing the engine needs, and half the time a second (maybe a flat as well).
    const engine = pick(random, [CarPart.Battery, CarPart.Plugs, CarPart.Hose, CarPart.Fuel])
    needs |= engine
    if (random() < 0.5) {
      const rest = [CarPart.Battery, CarPart.Plugs, CarPart.Hose, CarPart.Tyre].filter(
        (p) => p !== engine,
      )
      needs |= pick(random, rest)
    }
  }
  if (kind === 'worn') {
    top = 0.72 + random() * 0.16
    pull = (random() < 0.5 ? -1 : 1) * (0.3 + random() * 0.5)
  }
  // Any of them may stand on a flat.
  if (kind !== 'dead' && random() < 0.15) needs |= CarPart.Tyre
  // Low on fuel, all of them (dry if that's what it needs).
  const fuel = needs & CarPart.Fuel ? 0 : Math.round(6 + random() * 24)
  return { kind, needs, fuel, top, pull, breakAt }
}

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length) % list.length] as T
}

/** Top speed and pull as the wire carries them (a byte each), so server and driver agree. */
export function quantizeTune(top: number, pull: number): { top: number; pull: number } {
  const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255) / 255
  return { top: byte(top), pull: byte((pull + 1) / 2) * 2 - 1 }
}

/** Top speed share and pull on a flat tyre. */
const FLAT_TOP = 0.45
const FLAT_PULL = 0.9

/** How a car drives: engine power (0–1), top speed share, pull. Server and driver agree on it. */
export interface CarTune {
  power: number
  top: number
  pull: number
}

/** The tune a car's condition gives it (what stepVehicle is given). */
export function carTune(c: { engine: number; needs: number; top: number; pull: number }): CarTune {
  const flat = (c.needs & CarPart.Tyre) !== 0
  const power = c.engine === Engine.Ok ? 1 : c.engine === Engine.Sputter ? 0.5 : 0
  return {
    power,
    top: c.top * (flat ? FLAT_TOP : 1),
    pull: flat ? (c.pull >= 0 ? FLAT_PULL : -FLAT_PULL) : c.pull,
  }
}

/** Fixing something: the part it fixes, what it takes, whether tools are needed, how long. */
export interface CarFix {
  part: CarPart
  item: string
  tool: boolean
  seconds: number
  /** What the prompt says (E …). */
  label: string
  /** What you're told when it's done. */
  done: string
  /** Duct tape: holds, for a while (the car stays fragile). */
  patch?: boolean
}

export const CAR_FIXES: readonly CarFix[] = [
  {
    part: CarPart.Battery,
    item: 'carbattery',
    tool: false,
    seconds: 2.5,
    label: 'Fit the battery',
    done: 'The battery is in.',
  },
  {
    part: CarPart.Plugs,
    item: 'sparkplugs',
    tool: true,
    seconds: 3.5,
    label: 'Change the spark plugs',
    done: 'New plugs in.',
  },
  {
    part: CarPart.Tyre,
    item: 'tyre',
    tool: false,
    seconds: 4,
    label: 'Change the tyre',
    done: 'The spare is on.',
  },
  {
    part: CarPart.Hose,
    item: 'radiatorhose',
    tool: true,
    seconds: 3.5,
    label: 'Fit the radiator hose',
    done: 'The new hose is on. It should run cool now.',
  },
  {
    part: CarPart.Hose,
    item: 'ducttape',
    tool: false,
    seconds: 2.5,
    label: 'Tape up the radiator hose',
    done: "Taped. It'll hold for a while.",
    patch: true,
  },
  {
    part: CarPart.Fuel,
    item: 'gasoline',
    tool: false,
    seconds: 3,
    label: 'Fill the tank',
    done: 'Fuel in the tank.',
  },
]

/** Either of these does as the tools for engine work (they're kept). */
export const CAR_TOOLS = ['toolkit', 'toolbox'] as const

/**
 * What you could fix on this car with what you carry: the first need you have the part (and
 * tools) for, or a jerry can for a tank that's low. Null if nothing. `needs`: what you know of.
 */
export function carFixFor(
  car: { needs: number; fuel: number },
  has: (item: string) => boolean,
): CarFix | null {
  const tools = CAR_TOOLS.some(has)
  for (const fix of CAR_FIXES) {
    const wanted =
      (car.needs & fix.part) !== 0 || (fix.part === CarPart.Fuel && car.fuel < REFUEL_BELOW)
    if (wanted && has(fix.item) && (!fix.tool || tools)) return fix
  }
  return null
}

const PART_NAMES: [CarPart, string][] = [
  [CarPart.Battery, 'battery'],
  [CarPart.Plugs, 'spark plugs'],
  [CarPart.Hose, 'radiator hose'],
  [CarPart.Fuel, 'fuel'],
  [CarPart.Tyre, 'tyre'],
]

/** "battery, spark plugs". */
export function needsText(needs: number): string {
  return PART_NAMES.filter(([part]) => needs & part)
    .map(([, name]) => name)
    .join(', ')
}

/**
 * A line about a car you're standing at, from what you know of it: "Won't start — needs:
 * battery", "Flat tyre — needs: tyre", or null when nothing's known to be wrong.
 */
export function carTrouble(car: { needs: number; engine: number; fuel: number }): string | null {
  if (car.needs & ENGINE_PARTS) return `Won't start — needs: ${needsText(car.needs)}`
  if (car.needs & CarPart.Tyre) return 'Flat tyre — needs: tyre'
  if (car.engine === Engine.Stalled) return 'Stalled — let it cool, then try it'
  return null
}
