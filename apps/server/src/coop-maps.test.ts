import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  COOP_MAPS,
  type CoopZone,
  createPhysicsWorld,
  DEFAULT_RULES,
  goalZones,
  initPhysics,
  loadMap,
  type MapDef,
  mergeRules,
  TICK_RATE,
  type Vec3,
} from '@office-fps/shared'
import { Game } from './game.ts'
import type { Point } from './items.ts'
import { NavGrid } from './nav.ts'

beforeAll(async () => {
  await initPhysics()
})

const at = (v: Vec3): Point => ({ x: v[0], y: v[1], z: v[2] })
const centre = (z: CoopZone): Point => ({
  x: (z.min[0] + z.max[0]) / 2,
  y: z.min[1],
  z: (z.min[2] + z.max[2]) / 2,
})

/** Gates open while the team plays stage `i` (every earlier stage's). */
function gatesAt(map: MapDef, i: number): (id: number) => boolean {
  const open = new Set(
    (map.coop?.stages ?? [])
      .slice(0, i)
      .map((s) => s.opens)
      .filter((g) => g !== undefined),
  )
  return (id) => open.has(id)
}

for (const id of COOP_MAPS) {
  describe(`co-op map "${id}"`, () => {
    const map = loadMap(id)
    const stages = map.coop?.stages ?? []
    let built: NavGrid | null = null
    const grid = () => {
      built ??= new NavGrid(map, createPhysicsWorld(map), () => false)
      return built
    }

    test('has stages, and only the last one ends the run', () => {
      expect(stages.length).toBeGreaterThanOrEqual(8)
      expect(stages.at(-1)?.opens).toBeUndefined()
    })

    test('picking it starts zombies; another mode leaves it', () => {
      const rules = mergeRules(DEFAULT_RULES, { map: id })
      expect(rules.mode).toBe('zombies')
      expect(rules.map).toBe(id)
      expect(mergeRules(rules, { mode: 'tdm' }).map).not.toBe(id)
    })

    stages.forEach((stage, i) => {
      test(`stage ${i + 1} "${stage.name}": start, goal and zombies all on the walkable floor and connected`, () => {
        const nav = grid()
        const open = gatesAt(map, i)
        const start = stage.start[0]
        if (!start) throw new Error('no start')
        const field = nav.field([at(start.pos)], open)
        const problems: string[] = []
        const onFloor = (p: Vec3, what: string) => {
          const n = nav.nodes[nav.nearest(at(p))]
          if (!n || Math.hypot(n[0] - p[0], n[2] - p[2]) > 1.3 || Math.abs(n[1] - p[1]) > 0.1)
            problems.push(`${what} ${p.join(',')} is off the walkable floor`)
        }
        for (const s of stage.start) {
          onFloor(s.pos, 'start')
          if (!Number.isFinite(nav.distance(field, at(s.pos))))
            problems.push(`start ${s.pos.join(',')} cut off from the other starts`)
        }
        for (const z of goalZones(stage.goal)) {
          if (!Number.isFinite(nav.distance(field, centre(z))))
            problems.push(`goal at ${Object.values(centre(z)).join(',')} unreachable`)
        }
        for (const s of stage.zombieSpawns) {
          onFloor(s, 'zombie spawn')
          if (!Number.isFinite(nav.distance(field, at(s))))
            problems.push(`zombie spawn ${s.join(',')} can't get to the team`)
        }
        // Once this stage's gate is open, the next stage's start is reachable.
        const next = stages[i + 1]
        if (next?.start[0]) {
          const after = nav.field([at(start.pos)], gatesAt(map, i + 1))
          if (!Number.isFinite(nav.distance(after, at(next.start[0].pos))))
            problems.push('next stage unreachable after this one')
        }
        expect(problems).toEqual([])
      })
    })

    test('shut gates seal the later stages off', () => {
      const first = stages[0]?.start[0]
      const last = stages.at(-1)?.start[0]
      if (!first || !last) throw new Error('no starts')
      const nav = grid()
      const field = nav.field([at(first.pos)], gatesAt(map, 0))
      expect(nav.distance(field, at(last.pos))).toBe(Number.POSITIVE_INFINITY)
    })

    test('a player can walk up every ramp, bottom to top', () => {
      const game = new Game(map, createPhysicsWorld(map))
      game.setRules(mergeRules(DEFAULT_RULES, { mode: 'zombies', map: id }))
      const me = game.players.get(game.join('Walker', { send: () => {} }) ?? 0)
      if (!me) throw new Error('no player')
      const failed: string[] = []
      for (const [bottom, top] of map.navLinks ?? []) {
        game.setGates(0xffff)
        me.protectedUntil = Number.POSITIVE_INFINITY
        me.state.pos = at(bottom)
        me.state.vel = { x: 0, y: 0, z: 0 }
        const yaw = Math.atan2(-(top[0] - bottom[0]), -(top[2] - bottom[2]))
        let seq = (me.lastQueuedSeq) + 1
        for (let t = 0; t < 12 * TICK_RATE; t++) {
          game.handleInput(me.id, [
            { seq: seq++, buttons: Button.Forward, yaw, pitch: 0, viewTick: game.tick },
          ])
          game.step()
          me.health = 100
          const p = me.state.pos
          if (Math.abs(p.y - top[1]) < 0.1 && Math.hypot(p.x - top[0], p.z - top[2]) < 1.5) break
        }
        const p = me.state.pos
        if (Math.abs(p.y - top[1]) > 0.1)
          failed.push(
            `${bottom.join(',')} → ${top.join(',')} ended at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`,
          )
      }
      expect(failed).toEqual([])
    })
  })
}
