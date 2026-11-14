import { describe, expect, test } from 'bun:test'
import {
  CAMP_FOLK,
  CAMP_SEATS,
  FOLK_LANES,
  FOLK_NODES,
  FOLK_SPEED,
  FOLK_SPOTS,
  type FolkState,
  folkAt,
  folkWay,
  planFolk,
} from './camp-folk.ts'
import { DAY_SECONDS } from './daytime.ts'
import { buildDeadwood } from './world.ts'

const plans = CAMP_FOLK.map((f) => planFolk(f))
/** Everybody's state every `step` seconds through a whole day. */
const sample = (step: number) => {
  const out: { t: number; who: number; s: FolkState }[] = []
  for (let t = 0; t < DAY_SECONDS; t += step)
    plans.forEach((plan, who) => {
      out.push({ t, who, s: folkAt(plan, t) })
    })
  return out
}
const day = sample(1)

/** Distance from a point to the segment a–b (on the ground). */
function toSegment(px: number, pz: number, a: string, b: string): number {
  const A = FOLK_NODES[a]
  const B = FOLK_NODES[b]
  if (!A || !B) throw new Error(`no node ${a} or ${b}`)
  const dx = B.x - A.x
  const dz = B.z - A.z
  const u = Math.max(0, Math.min(1, ((px - A.x) * dx + (pz - A.z) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(px - (A.x + dx * u), pz - (A.z + dz * u))
}

const spotNear = (x: number, z: number, r: number) =>
  Object.keys(FOLK_SPOTS).some((id) => {
    const n = FOLK_NODES[id]
    return n !== undefined && Math.hypot(n.x - x, n.z - z) < r
  })

const fireSeat = (s: FolkState) =>
  s.doing === 'sit' && CAMP_SEATS.some(([x, z]) => Math.hypot(x - s.x, z - s.z) < 0.01)

describe("Haven's townsfolk", () => {
  test('the same time of day always puts everybody in the same place', () => {
    const again = CAMP_FOLK.map((f) => planFolk(f))
    for (const t of [0, 77.5, 600, 1234.25, DAY_SECONDS - 0.5]) {
      plans.forEach((plan, i) => {
        expect(folkAt(again[i] ?? [], t)).toEqual(folkAt(plan, t))
        // A day later is the same again.
        expect(folkAt(plan, t + DAY_SECONDS)).toEqual(folkAt(plan, t))
      })
    }
  })

  test('every lane connects, and every task is reached well before it ends', () => {
    const ids = Object.keys(FOLK_NODES).filter((id) => !id.startsWith('walk'))
    for (const id of ids) expect(folkWay('gate', id).at(-1)).toBe(id)
    for (const plan of plans) {
      for (const task of plan) expect(task.thereDur).toBeLessThan(task.end - task.start - 20)
    }
  })

  test('walkers stay on the lanes and never jump', () => {
    for (const { s } of day) {
      if (s.doing !== 'walk') continue
      const off = Math.min(...FOLK_LANES.map(([a, b]) => toSegment(s.x, s.z, a, b)))
      expect(off).toBeLessThan(1e-6)
    }
    // A second apart, nobody has moved further than a second's walk (midnight included).
    const n = plans.length
    for (let i = 0; i < day.length; i++) {
      const a = day[i] as (typeof day)[number]
      const b = day[(i + n) % day.length] as (typeof day)[number]
      expect(b.who).toBe(a.who)
      const moved = Math.hypot(b.s.x - a.s.x, b.s.z - a.s.z)
      expect(moved).toBeLessThan(FOLK_SPEED * 1.001 + 1e-6)
    }
  })

  test('nobody shares a seat or a chore with somebody else', () => {
    const held = new Map<string, number>()
    for (const { t, who, s } of day) {
      if (s.doing === 'walk' || s.doing === 'sleep' || s.doing === 'stand') continue
      const key = `${t}:${s.x.toFixed(2)},${s.z.toFixed(2)}`
      const other = held.get(key)
      if (other !== undefined && other !== who)
        throw new Error(`${CAMP_FOLK[who]?.name} and ${CAMP_FOLK[other]?.name} at ${key}`)
      held.set(key, who)
    }
  })

  test('the fire is full at night; by day most are at work', () => {
    const at = (time: number) => plans.map((plan) => folkAt(plan, time * DAY_SECONDS))
    const night = at(0.1)
    expect(night.filter(fireSeat).length).toBeGreaterThanOrEqual(8)
    // Late at night most have gone to bed.
    expect(at(0.38).filter((s) => s.hidden).length).toBeGreaterThanOrEqual(8)
    const noon = at(0.7)
    expect(noon.filter(fireSeat).length).toBeLessThanOrEqual(3)
    const chores = ['chop', 'saw', 'hammer', 'laundry', 'cook', 'guard']
    expect(noon.filter((s) => chores.includes(s.doing)).length).toBeGreaterThanOrEqual(6)
    expect(noon.filter((s) => s.doing === 'walk' || s.carrying).length).toBeGreaterThanOrEqual(1)
    // Sitting people face the fire.
    for (const s of night.filter(fireSeat)) {
      const toFire = Math.atan2(-(0 - s.x), -(2 - s.z))
      expect(Math.abs(Math.atan2(Math.sin(s.yaw - toFire), Math.cos(s.yaw - toFire)))).toBeLessThan(
        0.01,
      )
    }
  })

  test('the lanes keep clear of everything in the camp and of the people you talk to', () => {
    const map = buildDeadwood()
    const def = map.survival
    if (!def) throw new Error('no survival')
    const haven = def.pois.find((p) => p.key === 'haven')
    if (!haven) throw new Error('no Haven')
    // Things a walker could bump into: anything between the ankles and the head.
    const things = map.boxes.filter((b) => {
      const bottom = b.center[1] - b.size[1] / 2 - haven.y
      const top = b.center[1] + b.size[1] / 2 - haven.y
      return (
        top > 0.1 &&
        bottom < 1.9 &&
        Math.hypot(b.center[0] - haven.x, b.center[2] - haven.z) < haven.r + 5
      )
    })
    const clear = (x: number, z: number, margin: number) => {
      for (const b of things) {
        const bx = b.center[0] - haven.x
        const bz = b.center[2] - haven.z
        const [tilt, yaw] = [b.rotation?.[0] ?? 0, b.rotation?.[1] ?? 0]
        let dx = x - bx
        let dz = z - bz
        if (tilt !== 0) {
          // Leaning things (tools against a block): their bounding circle.
          if (Math.hypot(dx, dz) < Math.hypot(b.size[0], b.size[2]) / 2 + margin) return false
          continue
        }
        if (yaw !== 0) {
          const c = Math.cos(yaw)
          const s = Math.sin(yaw)
          ;[dx, dz] = [dx * c - dz * s, dx * s + dz * c]
        }
        if (Math.abs(dx) < b.size[0] / 2 + margin && Math.abs(dz) < b.size[2] / 2 + margin)
          return false
      }
      return true
    }
    const npcs = def.npcs.map((n) => [n.pos[0] - haven.x, n.pos[2] - haven.z] as const)
    for (const [a, b] of FOLK_LANES) {
      const A = FOLK_NODES[a]
      const B = FOLK_NODES[b]
      if (!A || !B || A.y > 0) continue // the walkway is up on the gate
      const len = Math.hypot(B.x - A.x, B.z - A.z)
      for (let d = 0; d <= len; d += 0.2) {
        const x = A.x + ((B.x - A.x) * d) / len
        const z = A.z + ((B.z - A.z) * d) / len
        // At a seat or a chore you stand right at the thing you use.
        if (spotNear(x, z, 0.9)) continue
        if (!clear(x, z, 0.25)) throw new Error(`lane ${a}–${b} runs into something at ${x}, ${z}`)
        for (const [nx, nz] of npcs) {
          if (Math.hypot(nx - x, nz - z) < 0.6)
            throw new Error(`lane ${a}–${b} runs through somebody at ${nx}, ${nz}`)
        }
      }
    }
  })
})
