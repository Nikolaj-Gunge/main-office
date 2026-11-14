import { DAY_SECONDS } from './daytime.ts'

/**
 * Haven's townsfolk: the people who live in the camp besides the ones you talk to. They walk
 * between the tents, chop wood, saw at the bench, hang washing, carry crates in from the gate,
 * keep watch, and gather round the bonfire after dark; late at night most go to bed.
 *
 * Nothing here goes over the wire: where everybody is follows from the time of day alone (the
 * survival clock every client already has), so all clients see the same camp for free. They are
 * scenery only — the dead don't hunt them and bullets go through them.
 *
 * Everything is in Haven's own coordinates (x east, z south, from the camp's middle; the camp is
 * built unturned). People only walk along the lanes of a small hand-made graph that keeps clear
 * of the buildings, so nobody walks through a wall.
 */

/** Walking pace (m/s). */
export const FOLK_SPEED = 1.25

/** The bonfire, and the seats round it (x, z, facing in degrees: 0 = north, + turns left). */
export const CAMP_FIRE: [x: number, z: number] = [0, 2]

/**
 * Where people sit by the fire, and how high the seat is (m). Mirrors the logs and stumps Haven
 * puts round its bonfire (HAVEN_SEATS on p19-start): if those move, move these with them.
 */
export const CAMP_SEATS: [x: number, z: number, h: number][] = (() => {
  const r = Math.SQRT1_2 * 0.6
  return [
    [3.4, 1.4, 0.42],
    [3.4, 2.6, 0.42],
    [-3.4, 1.4, 0.42],
    [-3.4, 2.6, 0.42],
    [2.4 + r, 4.4 - r, 0.42],
    [2.4 - r, 4.4 + r, 0.42],
    [-2.4 - r, 4.4 - r, 0.42],
    [-2.4 + r, 4.4 + r, 0.42],
    [2.6, -0.4, 0.45],
    [-2.6, -0.4, 0.45],
  ]
})()

/** What somebody is doing (the client poses them for it). */
export type FolkDoing =
  | 'walk'
  | 'stand'
  | 'sit'
  | 'chop'
  | 'saw'
  | 'hammer'
  | 'laundry'
  | 'cook'
  | 'guard'
  | 'sleep'

/** A place somebody goes to do something: which way they face there, and what they do. */
export interface FolkSpot {
  /** Facing (radians, the game's yaw: 0 = north, + turns left). */
  yaw: number
  doing: FolkDoing
  /** Sitting: the seat's height (m). */
  seat?: number
}

/** A point of the lanes (y: height above the camp's ground, for the walkway over the gate). */
export interface FolkNode {
  x: number
  z: number
  y: number
}

const deg = (d: number) => (d * Math.PI) / 180
/** The yaw that faces from (x, z) towards (tx, tz). */
const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z))

const NODES: Record<string, FolkNode> = {}
const SPOTS: Record<string, FolkSpot> = {}
const EDGES: [string, string][] = []
const node = (id: string, x: number, z: number, y = 0) => {
  NODES[id] = { x, z, y }
}
const spot = (id: string, x: number, z: number, s: FolkSpot, from: string) => {
  node(id, x, z)
  SPOTS[id] = s
  EDGES.push([from, id])
}
const lane = (...ids: string[]) => {
  for (let i = 1; i < ids.length; i++) EDGES.push([ids[i - 1] as string, ids[i] as string])
}

// --- The lanes (edit here to re-route; the tests check they keep clear of everything solid) ---

// The gate, the road in, and the ring round the fire (5 m out).
node('gate', 0, -27)
node('road', 0, -16)
const RING: [string, number, number][] = [
  ['ringN', 0, -3.2],
  ['ringNE', 3.68, -1.68],
  ['ringE', 5.2, 2],
  ['ringSE', 3.68, 5.68],
  ['ringS', 0, 7.2],
  ['ringSW', -3.68, 5.68],
  ['ringW', -4.4, 3],
  ['ringNW', -3.68, -1.68],
]
for (const [id, x, z] of RING) node(id, x, z)
lane(...RING.map(([id]) => id), 'ringN')
lane('gate', 'road', 'ringN')
// North: the gate's east side (crates come in here) and the tents along the north wall.
node('gateE', 5, -25.5)
node('tents', 11, -19)
node('stallW', 13.4, -10)
lane('gate', 'gateE')
lane('road', 'tents', 'stallW', 'ringE')
lane('road', 'stallW')
// West: the kitchen, the long table, the army tent; the washing line and the bunkhouse.
node('west', -6, -13)
node('kitchen', -11.5, -14.5)
node('kitchenW', -16, -14.5)
node('armyTent', -20, -19.5)
lane('road', 'west', 'kitchen', 'kitchenW', 'armyTent')
lane('west', 'ringNW')
node('tableN', -10.2, -13.1)
node('tableNW', -11.8, -13.1)
node('tableS', -10.2, -9.9)
node('tableSW', -11.8, -9.9)
lane('west', 'tableN', 'tableNW')
lane('west', 'tableS', 'tableSW')
node('yard', -10, 7)
node('washing', -18, 9.6)
lane('ringW', 'yard', 'washing')
// East: past Tom to the workbench outside the workshop; round the south of the camp.
node('east', 9, 8.5)
node('bench', 21.4, 10.5)
node('benchS', 22, 12.4)
lane('ringE', 'east', 'bench', 'benchS')
node('southE', 8, 17)
node('southW', -5, 16)
lane('east', 'southE', 'southW', 'ringS')
lane('southW', 'yard')
// The walkway over the gate (only the watch goes up there; no lane leads to it).
node('walkW', -1.9, -30, 3.8)
node('walkE', 1.9, -30, 3.8)
lane('walkW', 'walkE')

// Where people do things.
CAMP_SEATS.forEach(([x, z, h], i) => {
  const [fx, fz] = CAMP_FIRE
  const d = Math.hypot(x - fx, z - fz)
  // They come up from behind the seat, along a short path out from the fire.
  const ax = x + ((x - fx) / d) * 0.8
  const az = z + ((z - fz) / d) * 0.8
  let ring = RING[0] as [string, number, number]
  for (const r of RING)
    if (Math.hypot(r[1] - ax, r[2] - az) < Math.hypot(ring[1] - ax, ring[2] - az)) ring = r
  node(`fire${i}Back`, ax, az)
  lane(ring[0], `fire${i}Back`)
  spot(`fire${i}`, x, z, { yaw: facing(x, z, fx, fz), doing: 'sit', seat: h }, `fire${i}Back`)
})
spot('table0', -11.8, -10.65, { yaw: 0, doing: 'sit', seat: 0.45 }, 'tableSW')
spot('table1', -10.2, -10.65, { yaw: 0, doing: 'sit', seat: 0.45 }, 'tableS')
spot('table2', -11.8, -12.35, { yaw: Math.PI, doing: 'sit', seat: 0.45 }, 'tableNW')
spot('table3', -10.2, -12.35, { yaw: Math.PI, doing: 'sit', seat: 0.45 }, 'tableN')
// The chopping block is at (-5.4, 1.2): stand west of it, swing east.
spot('chop', -6.15, 1.2, { yaw: deg(-90), doing: 'chop' }, 'ringW')
spot('cook', -10.9, -18.3, { yaw: 0, doing: 'cook' }, 'kitchen')
spot('wash1', -22.2, 9.1, { yaw: 0, doing: 'laundry' }, 'washing')
spot('wash2', -25, 9.1, { yaw: 0, doing: 'laundry' }, 'wash1')
spot('saw', 23.4, 10.45, { yaw: 0, doing: 'saw' }, 'bench')
spot('hammer', 23.6, 12.3, { yaw: 0, doing: 'hammer' }, 'benchS')
spot('notices', 6.5, -5.2, { yaw: 0, doing: 'stand' }, 'ringN')
spot('watchGate', -4.2, -27.4, { yaw: 0, doing: 'guard' }, 'gate')
// Crates: picked up inside the gate, set down behind Gus' stall.
spot('crates', 11.2, -26.4, { yaw: 0, doing: 'stand' }, 'gateE')
lane('crates', 'tents')
spot('stall', 13.6, -5.8, { yaw: deg(-90), doing: 'stand' }, 'stallW')
// Beds: the tents along the north wall, the army tent, the bunkhouse.
spot('tent1', 8, -19.4, { yaw: Math.PI, doing: 'sleep' }, 'road')
spot('tent2', 14, -19.4, { yaw: Math.PI, doing: 'sleep' }, 'tents')
spot('tent3', 20, -19.4, { yaw: Math.PI, doing: 'sleep' }, 'tent2')
spot('cots', -20, -21.4, { yaw: Math.PI, doing: 'sleep' }, 'armyTent')
spot('bunks', -14, 12.2, { yaw: Math.PI, doing: 'sleep' }, 'yard')

export const FOLK_NODES: Readonly<Record<string, FolkNode>> = NODES
export const FOLK_SPOTS: Readonly<Record<string, FolkSpot>> = SPOTS
export const FOLK_LANES: readonly (readonly [string, string])[] = EDGES

// --- The people ------------------------------------------------------------------------------

/** What somebody does from a time of day on: stay at a spot, or walk a round of lanes. */
export type FolkTask =
  | { at: string }
  | {
      /** Nodes visited in turn (back to the first after the last). */
      round: string[]
      /** Seconds they stop at each node of the round (to look about, pick up, put down). */
      dwell?: number
      /** Carrying something on the way from the first node to the second (crates). */
      carry?: boolean
      /** Which way they look while they stop (yaw; default: on along the way they came). */
      look?: number
    }

export interface FolkDef {
  name: string
  /** What they wear (survival gear ids). */
  gear: string[]
  /** Carries a rifle (the watch). */
  rifle?: boolean
  /** Their day: [time of day 0–1, task], in order; the last runs on round to the first. */
  day: [number, FolkTask][]
}

const R = (round: string[], dwell = 4, carry = false, look?: number): FolkTask => ({
  round,
  dwell,
  carry,
  ...(look === undefined ? {} : { look }),
})
const STROLL = ['ringS', 'east', 'stallW', 'road', 'west', 'yard', 'southW']
const PATROL = ['gate', 'tents', 'stallW', 'east', 'southE', 'southW', 'yard', 'west', 'road']

/**
 * Who lives here and their day. Night is 0–0.4 and 0.96–1, the day 0.48–0.88: after dark most
 * of them are round the fire; late at night they go to bed and only the watch is up.
 */
export const CAMP_FOLK: FolkDef[] = [
  {
    name: 'Hank',
    gear: ['cap', 'flannel', 'worktrousers', 'boots'],
    day: [
      [0.22, { at: 'bunks' }],
      [0.42, { at: 'chop' }],
      [0.62, { at: 'table0' }],
      [0.68, { at: 'chop' }],
      [0.88, { at: 'fire0' }],
    ],
  },
  {
    name: 'Rosa',
    gear: ['bandana', 'hoodie', 'jeans', 'sneakers'],
    day: [
      [0.25, { at: 'bunks' }],
      [0.45, { at: 'wash1' }],
      [0.6, { at: 'table1' }],
      [0.66, { at: 'wash1' }],
      [0.85, { at: 'fire1' }],
    ],
  },
  {
    name: 'Jun',
    gear: ['beanie', 'jacket', 'cargopants', 'boots'],
    day: [
      [0.3, { at: 'tent3' }],
      [0.44, { at: 'saw' }],
      [0.62, { at: 'table2' }],
      [0.67, { at: 'saw' }],
      [0.9, { at: 'fire2' }],
    ],
  },
  {
    name: 'Ada',
    gear: ['hardhat', 'flannel', 'worktrousers', 'boots'],
    day: [
      [0.18, { at: 'tent2' }],
      [0.46, { at: 'hammer' }],
      [0.75, R(STROLL)],
      [0.87, { at: 'fire3' }],
    ],
  },
  {
    name: 'Pete',
    gear: ['hoodie', 'cargopants', 'sneakers'],
    day: [
      [0.2, { at: 'tent1' }],
      [0.43, R(['crates', 'stall'], 3, true)],
      [0.64, { at: 'fire4' }],
      [0.7, R(['crates', 'stall'], 3, true)],
      [0.9, { at: 'fire5' }],
    ],
  },
  {
    name: 'Vic',
    gear: ['raincoat', 'jeans', 'boots'],
    day: [
      [0.3, { at: 'cots' }],
      [0.4, { at: 'cook' }],
      [0.72, R(STROLL, 6)],
      [0.8, { at: 'cook' }],
      [0.92, { at: 'fire6' }],
    ],
  },
  {
    name: 'Bo',
    gear: ['helmet', 'camojacket', 'camopants', 'militaryboots'],
    rifle: true,
    day: [
      [0.15, { at: 'cots' }],
      [0.45, { at: 'watchGate' }],
      [0.85, { at: 'fire7' }],
    ],
  },
  {
    name: 'Nell',
    gear: ['beanie', 'militaryvest', 'camopants', 'militaryboots'],
    rifle: true,
    day: [
      [0.42, { at: 'cots' }],
      [0.88, { at: 'watchGate' }],
    ],
  },
  {
    name: 'Cole',
    gear: ['helmet', 'militaryvest', 'camopants', 'militaryboots'],
    rifle: true,
    // Up on the walkway over the gate day and night (the watch changes, the look doesn't).
    day: [[0, R(['walkW', 'walkE'], 14, false, 0)]],
  },
  {
    name: 'Mack',
    gear: ['cap', 'camojacket', 'jeans', 'militaryboots'],
    rifle: true,
    day: [
      [0.3, { at: 'fire0' }],
      [0.42, { at: 'tent1' }],
      [0.88, R(PATROL, 5)],
    ],
  },
  {
    name: 'Lou',
    gear: ['cowboyhat', 'jacket', 'jeans', 'boots'],
    day: [
      [0.3, { at: 'bunks' }],
      [0.45, { at: 'table2' }],
      [0.58, { at: 'fire9' }],
    ],
  },
  {
    name: 'Elle',
    gear: ['flannel', 'jeans', 'sneakers'],
    day: [
      [0.24, { at: 'tent2' }],
      [0.45, R(STROLL, 8)],
      [0.6, { at: 'table3' }],
      [0.7, R(STROLL, 8)],
      [0.86, { at: 'fire4' }],
    ],
  },
  {
    name: 'Gabe',
    gear: ['beanie', 'raincoat', 'cargopants', 'boots'],
    day: [
      [0.35, { at: 'bunks' }],
      [0.48, { at: 'notices' }],
      [0.55, R(STROLL, 6)],
      [0.68, { at: 'fire8' }],
    ],
  },
  {
    name: 'Ivy',
    gear: ['bandana', 'jacket', 'cargopants', 'sneakers'],
    day: [
      [0.45, { at: 'table3' }],
      [0.5, { at: 'wash2' }],
      [0.8, R(STROLL, 5)],
      // An early night: every seat at the fire is taken by then.
      [0.9, { at: 'tent3' }],
    ],
  },
]

// --- Ways between nodes ------------------------------------------------------------------------

const neighbours = new Map<string, { id: string; d: number }[]>()
for (const [a, b] of EDGES) {
  const na = NODES[a] as FolkNode
  const nb = NODES[b] as FolkNode
  const d = Math.hypot(na.x - nb.x, na.z - nb.z)
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    const list = neighbours.get(from) ?? []
    neighbours.set(from, list)
    list.push({ id: to, d })
  }
}

const ways = new Map<string, string[]>()

/** The shortest way along the lanes from one node to another (both ends included). */
export function folkWay(from: string, to: string): string[] {
  const key = `${from}>${to}`
  const known = ways.get(key)
  if (known) return known
  // Dijkstra on a few dozen nodes: a plain scan for the nearest is plenty.
  const dist = new Map<string, number>([[from, 0]])
  const prev = new Map<string, string>()
  const done = new Set<string>()
  for (;;) {
    let best: string | null = null
    for (const [id, d] of dist)
      if (!done.has(id) && (best === null || d < (dist.get(best) ?? 0))) best = id
    if (best === null) throw new Error(`no lane from ${from} to ${to}`)
    if (best === to) break
    done.add(best)
    for (const n of neighbours.get(best) ?? []) {
      const d = (dist.get(best) ?? 0) + n.d
      if (d < (dist.get(n.id) ?? Number.POSITIVE_INFINITY)) {
        dist.set(n.id, d)
        prev.set(n.id, best)
      }
    }
  }
  const way = [to]
  while (way[0] !== from) way.unshift(prev.get(way[0] as string) as string)
  ways.set(key, way)
  return way
}

// --- Where somebody is at a time of day --------------------------------------------------------

/** Where somebody is and what they're doing. */
export interface FolkState {
  x: number
  /** Height above the camp's ground. */
  y: number
  z: number
  yaw: number
  doing: FolkDoing
  /** Walking speed (m/s; 0 standing still). */
  speed: number
  /** Metres walked so far on this leg (for the step cycle). */
  walked: number
  /** Carrying a crate. */
  carrying: boolean
  /** Sitting: the seat's height. */
  seat: number
  /** In bed (not drawn). */
  hidden: boolean
}

/** A piece of somebody's timeline: walking a straight line, or staying put. */
interface Piece {
  dur: number
  from: FolkNode
  to: FolkNode
  /** Staying put: what they're doing and which way they face. */
  doing?: FolkDoing
  yaw?: number
  carrying?: boolean
  /** Metres walked before this piece (on its leg). */
  walked: number
}

interface PlannedTask {
  start: number
  end: number
  /** Walking there from wherever the last task left them. */
  there: Piece[]
  thereDur: number
  /** The task itself (one pass of a round, repeated; or one piece for staying put). */
  loop: Piece[]
  loopDur: number
  task: FolkTask
}

const nodeOf = (id: string): FolkNode => {
  const n = NODES[id]
  if (!n) throw new Error(`no lane node ${id}`)
  return n
}

/** Pieces walking along a list of nodes (the first is where they stand). */
function walkPieces(points: FolkNode[], speed: number, carrying = false): Piece[] {
  const out: Piece[] = []
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1] as FolkNode
    const to = points[i] as FolkNode
    const d = Math.hypot(to.x - from.x, to.z - from.z)
    if (d < 1e-6) continue
    out.push({ dur: d / speed, from, to, carrying, walked })
    walked += d
  }
  return out
}

/** One pass of a round: walk to each node in turn, stopping at each for `dwell` seconds. */
function roundPieces(task: Extract<FolkTask, { round: string[] }>, speed: number): Piece[] {
  const out: Piece[] = []
  const r = task.round
  for (let i = 0; i < r.length; i++) {
    const a = r[i] as string
    const b = r[(i + 1) % r.length] as string
    const way = folkWay(a, b).map(nodeOf)
    const legs = walkPieces(way, speed, task.carry === true && i === 0)
    out.push(...legs)
    const at = nodeOf(b)
    const last = legs[legs.length - 1]
    const s = SPOTS[b]
    const yaw = task.look ?? s?.yaw ?? (last ? facing(last.from.x, last.from.z, at.x, at.z) : 0)
    if ((task.dwell ?? 0) > 0)
      out.push({ dur: task.dwell ?? 0, from: at, to: at, doing: 'stand', yaw, walked: 0 })
  }
  return out
}

const pieceDur = (pieces: Piece[]) => pieces.reduce((s, p) => s + p.dur, 0)

/** Where a list of pieces leaves you `t` seconds in, and the piece (index) you're on. */
function along(pieces: Piece[], t: number): { at: FolkNode; i: number; u: number } {
  let left = t
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i] as Piece
    if (left < p.dur || i === pieces.length - 1) {
      const u = p.dur > 0 ? Math.min(1, Math.max(0, left / p.dur)) : 1
      return {
        at: {
          x: p.from.x + (p.to.x - p.from.x) * u,
          y: p.from.y + (p.to.y - p.from.y) * u,
          z: p.from.z + (p.to.z - p.from.z) * u,
        },
        i,
        u,
      }
    }
    left -= p.dur
  }
  throw new Error('no pieces')
}

/**
 * Plans somebody's day once: for each task, the walk there from where the last one left them,
 * and the task's own repeating loop. A day of one round (the watch on the walkway) has no walks:
 * its pace is nudged so a whole number of rounds fits the day exactly (no jump at midnight).
 */
export function planFolk(def: FolkDef): PlannedTask[] {
  const n = def.day.length
  const tasks: PlannedTask[] = def.day.map(([t, task], i) => {
    const next = def.day[(i + 1) % n] as [number, FolkTask]
    const start = t * DAY_SECONDS
    let end = next[0] * DAY_SECONDS
    if (end <= start) end += DAY_SECONDS
    let loop: Piece[]
    if ('at' in task) {
      const s = SPOTS[task.at]
      if (!s) throw new Error(`no spot ${task.at}`)
      const at = nodeOf(task.at)
      loop = [{ dur: end - start, from: at, to: at, doing: s.doing, yaw: s.yaw, walked: 0 }]
    } else loop = roundPieces(task, FOLK_SPEED)
    return { start, end, there: [], thereDur: 0, loop, loopDur: pieceDur(loop), task }
  })
  if (n === 1) {
    const only = tasks[0] as PlannedTask
    if (!('at' in only.task)) {
      const rounds = Math.max(1, Math.round(DAY_SECONDS / only.loopDur))
      const k = DAY_SECONDS / (rounds * only.loopDur)
      for (const p of only.loop) p.dur *= k
      only.loopDur *= k
    }
    return tasks
  }
  // Walks between tasks: start after a task that stays put (it always ends where it is), then
  // go round the day once, each walk starting where the task before it ended.
  const first = def.day.findIndex(([, task]) => 'at' in task)
  if (first < 0) throw new Error(`${def.name}: a day of rounds needs somewhere to stay put`)
  for (let k = 1; k <= n; k++) {
    const prev = tasks[(first + k - 1) % n] as PlannedTask
    const cur = tasks[(first + k) % n] as PlannedTask
    // Where the last task left them: the node they were heading for.
    let from: FolkNode
    let fromId: string
    if ('at' in prev.task) {
      fromId = prev.task.at
      from = nodeOf(fromId)
    } else {
      const left = (prev.end - prev.start - prev.thereDur) % prev.loopDur
      const { at, i } = along(prev.loop, left)
      const piece = prev.loop[i] as Piece
      from = at
      fromId = idOf(piece.to)
    }
    const target = 'at' in cur.task ? cur.task.at : (cur.task.round[0] as string)
    const way = folkWay(fromId, target).map(nodeOf)
    cur.there = walkPieces([from, ...way], FOLK_SPEED)
    cur.thereDur = pieceDur(cur.there)
  }
  return tasks
}

const ids = new Map<FolkNode, string>()
for (const [id, n] of Object.entries(NODES)) ids.set(n, id)
const idOf = (n: FolkNode): string => {
  const id = ids.get(n)
  if (id === undefined) throw new Error('not a lane node')
  return id
}

/** Somebody's state at `t` seconds into the day (0 – DAY_SECONDS), from their plan. */
export function folkAt(plan: PlannedTask[], t: number): FolkState {
  const day = ((t % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS
  let task = plan[plan.length - 1] as PlannedTask
  for (const p of plan) {
    const s = p.start
    const local = (((day - s) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS
    if (local < p.end - p.start) {
      task = p
      break
    }
  }
  const local = (((day - task.start) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS
  let pieces: Piece[]
  let into: number
  if (local < task.thereDur) {
    pieces = task.there
    into = local
  } else {
    pieces = task.loop
    into = (local - task.thereDur) % task.loopDur
  }
  const { at, i, u } = along(pieces, into)
  const p = pieces[i] as Piece
  if (p.doing) {
    const s = SPOTS[idOf(p.to)]
    return {
      ...at,
      yaw: p.yaw ?? 0,
      doing: p.doing,
      speed: 0,
      walked: 0,
      carrying: false,
      seat: s?.seat ?? 0,
      hidden: p.doing === 'sleep',
    }
  }
  const d = Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z)
  return {
    ...at,
    yaw: facing(p.from.x, p.from.z, p.to.x, p.to.z),
    doing: 'walk',
    speed: FOLK_SPEED,
    walked: p.walked + d * u,
    carrying: p.carrying === true,
    seat: 0,
    hidden: false,
  }
}
