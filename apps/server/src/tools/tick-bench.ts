/**
 * Measures server tick cost in Deadwood survival: N walking (and now and then shooting) people,
 * the director's full pool of the dead, optionally a bandit raid and a Red Night, and a
 * breakdown of where each tick goes (zombie thinking, player sim, director systems, snapshots).
 * In-process, seeded, no sockets, so runs are comparable before/after a change.
 *
 *   bun apps/server/src/tools/tick-bench.ts [players=8] [haven|spread|forest] [seconds=20] [raid] [red] [nolod]
 *   bun --cpu-prof apps/server/src/tools/tick-bench.ts ...   (writes a .cpuprofile)
 */
import * as shared from '@office-fps/shared'
import { Game } from '../game.ts'
import { moderationOf } from '../moderation.ts'

const {
  Button,
  createPhysicsWorld,
  DEFAULT_RULES,
  drawIn,
  heightAt,
  INPUT_BATCH_TICKS,
  initPhysics,
  loadMap,
  mergeRules,
  seeded,
  TICK_RATE,
} = shared

const args = process.argv.slice(2)
const players = Number(args[0] ?? 8)
const layout = args[1] ?? 'haven'
const seconds = Number(args[2] ?? 20)
const raid = args.includes('raid')
const red = args.includes('red')
/** `nolod`: every zombie moves every tick (the old way), for before/after runs. */
const nolod = args.includes('nolod')

// Haven sits at (0, 480); since v39 the county is drawn in towards it, so far spots go through
// drawIn (Haven, Mill Creek, the farm, Pinewatch, Ashford, the motel, Site 7, Bunker 12).
const SPREAD: [number, number][] = (
  [
    [0, 480],
    [960, 240],
    [-450, 160],
    [-820, -260],
    [340, -1010],
    [600, 660],
    [1150, -1130],
    [-1210, 440],
  ] as [number, number][]
).map(([x, z]) => drawIn(x, z))
const spotFor = (i: number): [number, number] => {
  if (layout === 'spread') return SPREAD[i % SPREAD.length] ?? [0, 0]
  // A loose group: in Haven, or out in the forest north-east of it.
  const [cx, cz] = layout === 'forest' ? [150, 330] : [0, 480]
  return [cx + Math.cos(i) * (6 + i * 2), cz + Math.sin(i) * (6 + i * 2)]
}

// Seed Math.random too (the director rolls with it), so runs repeat.
Math.random = seeded(22)
await initPhysics()
const map = loadMap('deadwood')
const game = new Game(map, createPhysicsWorld(map), seeded(11))
const sink = { send() {} }
const ids = Array.from({ length: players }, (_, i) => game.join(`P${i}`, sink) ?? 0)
game.setRules(mergeRules(DEFAULT_RULES, { mode: 'survival' }))
const place = () =>
  ids.forEach((id, i) => {
    const p = game.players.get(id)
    const [x, z] = spotFor(i)
    if (!p) return
    p.state.pos = { x, y: (map.survival ? heightAt(map.survival.terrain, x, z) : 0) + 0.2, z }
    p.state.vel = { x: 0, y: 0, z: 0 }
  })
place()
if (nolod) (game.moveLod as unknown as { stride: number }).stride = 1

// --- Timing hooks: wrap methods on live objects (works whatever they do inside) -------------
const buckets = new Map<string, { ms: number; calls: number }>()
let measuring = false
const wrap = (obj: unknown, key: string, label: string) => {
  const o = obj as Record<string, unknown>
  const fn = o?.[key]
  if (typeof fn !== 'function') return
  const bound = (fn as (...a: unknown[]) => unknown).bind(o)
  o[key] = (...a: unknown[]) => {
    if (!measuring) return bound(...a)
    const t0 = performance.now()
    try {
      return bound(...a)
    } finally {
      const b = buckets.get(label) ?? { ms: 0, calls: 0 }
      b.ms += performance.now() - t0
      b.calls++
      buckets.set(label, b)
    }
  }
}
const director = game.match.survivalDirector as unknown as Record<string, unknown>
wrap(game, 'thinkBots', 'game.thinkBots (all AI think)')
wrap(game.match, 'thinkZombie', '  zombie think')
wrap(game, 'sendSnapshots', 'game.sendSnapshots')
wrap(game, 'sendScoreboard', 'game.sendScoreboard')
wrap(game.match, 'broadcast', 'match.broadcast (survival shared)')
wrap(game.match, 'step', 'match.step (director)')
for (const key of [
  'senses',
  'populate',
  'subscribe',
  'batter',
  'discover',
  'stockPlaces',
  'tickSurvivor',
  'settleAmmo',
  'shortOfBreath',
]) {
  wrap(director, key, `  director.${key}`)
}
for (const sys of [
  'weatherWorld',
  'junk',
  'alphas',
  'lurkers',
  'bandits',
  'vehicles',
  'workbench',
  'story',
  'building',
  'chart',
  'chalk',
  'rot',
  'camp',
  'radio',
  'needs',
  'skills',
  'fieldNotes',
  'legacy',
  'gate',
  'firstShot',
  'evac',
  'drops',
  'trades',
  'pvp',
]) {
  const o = director?.[sys] as Record<string, unknown> | undefined
  if (!o) continue
  const proto = Object.getPrototypeOf(o) as object
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue
    const d = Object.getOwnPropertyDescriptor(proto, key)
    if (typeof d?.value !== 'function') continue
    wrap(o, key, `  ${sys}.${key}`)
  }
}

// Character-controller sweeps (Rapier), counted per owner kind via the body's prototype.
{
  const anyBody = [...game.players.values()][0]?.body as unknown as object | undefined
  const proto = anyBody ? (Object.getPrototypeOf(anyBody) as Record<string, unknown>) : null
  const owner = new Map<unknown, string>()
  const kindOf = (body: unknown) => {
    for (const p of game.players.values())
      if (p.body === body) owner.set(body, p.zombie ? 'zombie' : p.npc ? 'npc' : 'person')
    return owner.get(body) ?? '?'
  }
  const orig = proto?.sweepOnce as ((...a: unknown[]) => unknown) | undefined
  if (proto && orig) {
    proto.sweepOnce = function (this: unknown, ...a: unknown[]) {
      if (!measuring) return orig.apply(this, a)
      const t0 = performance.now()
      try {
        return orig.apply(this, a)
      } finally {
        const d = a[1] as { x: number; z: number }
        const label = `  rapier sweep (${owner.get(this) ?? kindOf(this)}${d.x || d.z ? ' h' : ' v'})`
        const b = buckets.get(label) ?? { ms: 0, calls: 0 }
        b.ms += performance.now() - t0
        b.calls++
        buckets.set(label, b)
      }
    }
  }
}

if (raid) moderationOf(game).raid()
if (red) moderationOf(game).redNight()

let seq = 1
const pending = ids.map(() => [] as shared.InputCommand[])
const times: number[] = []
const run = (ticks: number) => {
  for (let t = 0; t < ticks; t++) {
    ids.forEach((id, i) => {
      const p = game.players.get(id)
      if (p) {
        p.health = 100 // keep everyone up, walking and drawing the dead
        if (!p.state.alive) p.state.alive = true
      }
      const yaw = (game.tick / TICK_RATE) * 0.4 + i
      const fire = (game.tick + i * 37) % 240 < 3 ? Button.Fire : 0
      const buttons =
        Button.Forward | (Math.floor(game.tick / 300 + i) % 3 === 0 ? Button.Sprint : 0) | fire
      pending[i]?.push({ seq: seq++, buttons, yaw, pitch: 0, viewTick: game.tick })
      if (game.tick % INPUT_BATCH_TICKS === 0) game.handleInput(id, pending[i]?.splice(0) ?? [])
    })
    const t0 = performance.now()
    game.step()
    if (measuring) times.push(performance.now() - t0)
  }
}

run(TICK_RATE * 15) // let the woods fill up and the dead find people
measuring = true
const zombiesUp = () => [...game.players.values()].filter((p) => p.zombie && p.state.alive).length
const upAtStart = zombiesUp()
run(TICK_RATE * seconds)
const upAtEnd = zombiesUp()

times.sort((a, b) => a - b)
const ticks = times.length
const pct = (p: number) => times[Math.min(ticks - 1, Math.floor(ticks * p))] ?? 0
const mean = times.reduce((a, b) => a + b, 0) / ticks
console.log(
  `tick-bench players=${players} layout=${layout} ${seconds}s raid=${raid} red=${red} · ` +
    `entities ${game.players.size} · zombies up ${upAtStart}→${upAtEnd} · ` +
    `npc ${[...game.players.values()].filter((p) => p.npc).length} · light movers ${game.moveLod.count}`,
)
console.log(
  `tick ms: mean ${mean.toFixed(3)} · p50 ${pct(0.5).toFixed(3)} · p95 ${pct(0.95).toFixed(3)} · ` +
    `p99 ${pct(0.99).toFixed(3)} · max ${pct(1).toFixed(3)}`,
)
const rows = [...buckets.entries()]
  .map(([k, v]) => ({ k, perTick: v.ms / ticks, calls: v.calls / ticks }))
  .filter((r) => r.perTick > 0.002)
  .sort((a, b) => b.perTick - a.perTick)
for (const r of rows.slice(0, 30))
  console.log(
    `${r.perTick.toFixed(3).padStart(8)} ms/tick  ${r.calls.toFixed(1).padStart(6)} calls/tick  ${r.k}`,
  )
process.exit(0)
