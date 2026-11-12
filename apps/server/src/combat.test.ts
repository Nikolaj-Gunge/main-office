import { beforeAll, describe, expect, test } from 'bun:test'
import {
  Button,
  createPhysicsWorld,
  createWeaponState,
  DEFAULT_RULES,
  DebugFlag,
  decodeServerMessage,
  HitZone,
  initPhysics,
  loadMap,
  MapBuilder,
  mergeRules,
  type ServerMessage,
  ServerMsg,
  TICK_RATE,
  WEAPONS,
  WeaponId,
} from '@office-fps/shared'
import { Game, MAX_HEALTH } from './game.ts'

beforeAll(async () => {
  await initPhysics()
})

/** Open 100 × 100 m floor with one wall at z = -30 (for "shot hits the world" cases). */
function arena() {
  const m = new MapBuilder('arena', 'Arena', {
    sunDirection: [0, 1, 0],
    sunColor: 0,
    sunIntensity: 0,
    skyColor: 0,
    groundColor: 0,
    ambientIntensity: 0,
    fogColor: 0,
    fogNear: 0,
    fogFar: 0,
  })
  m.span([-50, -1, -50], [50, 0, 50], 'floor')
  m.span([-50, 0, -31], [50, 4, -30], 'wall')
  m.spawn(-40, 0, 40).spawn(40, 0, 40)
  const map = m.build()
  return new Game(map, createPhysicsWorld(map))
}

function fakeClient() {
  const inbox: ServerMessage[] = []
  return {
    inbox,
    send: (bytes: Uint8Array) => inbox.push(decodeServerMessage(bytes)),
    all<T extends ServerMessage['type']>(type: T) {
      return inbox.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[]
    },
  }
}

interface Setup {
  game: Game
  shooter: number
  victim: number
  a: ReturnType<typeof fakeClient>
  b: ReturnType<typeof fakeClient>
  seq: { n: number }
}

/** Two players 5 m apart (victim north of shooter), protection over, guns drawn. */
function duel(): Setup {
  const game = arena()
  const a = fakeClient()
  const b = fakeClient()
  const shooter = game.join('Anna', a) ?? 0
  const victim = game.join('Bo', b) ?? 0
  const pa = game.players.get(shooter)
  const pb = game.players.get(victim)
  if (!pa || !pb) throw new Error('join failed')
  pa.state.pos = { x: 0, y: 0, z: 0 }
  pb.state.pos = { x: 0, y: 0, z: -5 }
  pb.state.yaw = Math.PI // facing the shooter
  // These tests are about the handgun; the default loadout spawns with the rifle out.
  pa.state.weapon = createWeaponState(WeaponId.Handgun, 7)
  const seq = { n: 1 }
  // Let protection run out and guns finish drawing (both players send idle inputs).
  for (let t = 0; t < 2.5 * TICK_RATE; t++) {
    game.handleInput(shooter, [idle(seq.n)])
    game.handleInput(victim, [idle(seq.n)])
    seq.n++
    game.step()
  }
  return { game, shooter, victim, a, b, seq }
}

const idle = (seq: number) => ({ seq, buttons: 0, yaw: 0, pitch: 0, viewTick: 0 })

/** Aims from the shooter's eye at a point and clicks once (aiming down sights = tight spread). */
function shootAt(
  s: Setup,
  target: { x: number; y: number; z: number },
  viewTick?: number,
  victimYaw = 0,
) {
  const p = s.game.players.get(s.shooter)
  if (!p) throw new Error('no shooter')
  const eyeHeight = p.body.config.standEyeHeight
  const eye = { x: p.state.pos.x, y: p.state.pos.y + eyeHeight, z: p.state.pos.z }
  const dx = target.x - eye.x
  const dy = target.y - eye.y
  const dz = target.z - eye.z
  const yaw = Math.atan2(-dx, -dz)
  const pitch = Math.atan2(dy, Math.hypot(dx, dz))
  const vt = viewTick ?? s.game.tick
  // Press, then release over the next ticks (semi-auto needs a fresh click each time).
  s.game.handleInput(s.shooter, [
    { seq: s.seq.n++, buttons: Button.Fire | Button.Aim, yaw, pitch, viewTick: vt },
  ])
  s.game.handleInput(s.victim, [{ ...idle(s.seq.n), yaw: victimYaw }])
  s.game.step()
  for (let t = 0; t < 10; t++) {
    s.game.handleInput(s.shooter, [
      { seq: s.seq.n++, buttons: Button.Aim, yaw, pitch, viewTick: vt },
    ])
    s.game.handleInput(s.victim, [{ ...idle(s.seq.n), yaw: victimYaw }])
    s.game.step()
  }
}

const health = (s: Setup) => s.game.players.get(s.victim)?.health ?? -1

describe('combat', () => {
  test('a headshot kills instantly, and everyone hears about it', () => {
    const s = duel()
    shootAt(s, { x: 0, y: 1.64, z: -5 })
    expect(health(s)).toBe(0)
    expect(s.a.all(ServerMsg.HitConfirm).at(-1)).toMatchObject({ zone: HitZone.Head, killed: true })
    expect(s.b.all(ServerMsg.Damaged).at(-1)).toMatchObject({ health: 0 })
    for (const c of [s.a, s.b]) {
      expect(c.all(ServerMsg.Kill).at(-1)).toMatchObject({
        killerId: s.shooter,
        victimId: s.victim,
        headshot: true,
      })
    }
    expect(s.game.players.get(s.shooter)?.kills).toBe(1)
    // The scoreboard goes out right after the kill.
    const board = s.b.all(ServerMsg.Scoreboard).at(-1)
    expect(board?.entries.find((e) => e.id === s.shooter)?.kills).toBe(1)
    expect(board?.entries.find((e) => e.id === s.victim)?.deaths).toBe(1)
  })

  test('chest shots take 4 hits with the handgun', () => {
    const s = duel()
    const chest = { x: 0, y: 1.3, z: -5 }
    for (let i = 0; i < 3; i++) shootAt(s, chest)
    expect(health(s)).toBe(MAX_HEALTH - 3 * 26)
    shootAt(s, chest)
    expect(health(s)).toBe(0)
    expect(s.a.all(ServerMsg.HitConfirm).map((h) => h.zone)).toEqual([
      HitZone.Chest,
      HitZone.Chest,
      HitZone.Chest,
      HitZone.Chest,
    ])
  })

  test('legs take less damage than the chest', () => {
    const s = duel()
    shootAt(s, { x: 0.1, y: 0.4, z: -5 })
    expect(s.a.all(ServerMsg.HitConfirm).at(-1)).toMatchObject({ zone: HitZone.Leg, damage: 17 })
  })

  test('walls stop bullets', () => {
    const s = duel()
    const victim = s.game.players.get(s.victim)
    if (!victim) throw new Error()
    victim.state.pos = { x: 0, y: 0, z: -35 } // behind the wall at z = -30
    for (let t = 0; t < 6; t++) s.game.step() // let history catch up
    shootAt(s, { x: 0, y: 1.3, z: -35 })
    expect(health(s)).toBe(MAX_HEALTH)
    expect(s.b.all(ServerMsg.ShotFired).at(-1)?.result).toBe(1) // World
  })

  test('the dead respawn after 3 s with full health, far from the killer', () => {
    const s = duel()
    shootAt(s, { x: 0, y: 1.64, z: -5 })
    const victim = s.game.players.get(s.victim)
    expect(victim?.state.alive).toBe(false)
    for (let t = 0; t < DEFAULT_RULES.respawnSeconds * TICK_RATE + 2; t++) s.game.step()
    expect(victim?.state.alive).toBe(true)
    expect(victim?.health).toBe(MAX_HEALTH)
    expect(Math.hypot(victim?.state.pos.x ?? 0, victim?.state.pos.z ?? 0)).toBeGreaterThan(40)
  })

  test('freshly spawned players are protected', () => {
    const s = duel()
    const victim = s.game.players.get(s.victim)
    if (!victim) throw new Error()
    victim.protectedUntil = s.game.tick + 1000
    shootAt(s, { x: 0, y: 1.64, z: -5 })
    expect(health(s)).toBe(MAX_HEALTH)
  })
})

describe('lag compensation', () => {
  /** Victim strafes right at walk speed; returns where they were at `tick`. */
  function strafingDuel() {
    const s = duel()
    const track = new Map<number, { x: number; y: number; z: number }>()
    for (let t = 0; t < 40; t++) {
      const seq = s.seq.n++
      s.game.handleInput(s.victim, [
        { seq, buttons: Button.Left, yaw: Math.PI, pitch: 0, viewTick: 0 },
      ])
      s.game.handleInput(s.shooter, [idle(seq)])
      s.game.step()
      const v = s.game.players.get(s.victim)?.state.pos
      if (v) track.set(s.game.tick, { ...v })
    }
    return { s, track }
  }

  test('a shot aimed where the shooter saw the target 150 ms ago hits', () => {
    const { s, track } = strafingDuel()
    const viewTick = s.game.tick - 0.15 * TICK_RATE
    const seen = track.get(viewTick)
    if (!seen) throw new Error('no history')
    shootAt(s, { x: seen.x, y: seen.y + 1.3, z: seen.z }, viewTick)
    expect(s.a.all(ServerMsg.HitConfirm).length).toBe(1)
  })

  test('the same aim without lag compensation (viewTick = now) misses', () => {
    const { s, track } = strafingDuel()
    const seen = track.get(s.game.tick - 0.15 * TICK_RATE)
    if (!seen) throw new Error('no history')
    shootAt(s, { x: seen.x, y: seen.y + 1.3, z: seen.z }, s.game.tick)
    expect(s.a.all(ServerMsg.HitConfirm).length).toBe(0)
  })

  test('rewind is capped: a 1 s old view is treated as 400 ms old', () => {
    const { s, track } = strafingDuel()
    const seen = track.get(s.game.tick - 30) // 0.5 s ago
    if (!seen) throw new Error('no history')
    shootAt(s, { x: seen.x, y: seen.y + 1.3, z: seen.z }, s.game.tick - TICK_RATE)
    expect(s.a.all(ServerMsg.HitConfirm).length).toBe(0)
  })

  test('debug flag sends back the rewound poses', () => {
    const { s, track } = strafingDuel()
    s.game.setDebug(s.shooter, DebugFlag.LagComp)
    const viewTick = s.game.tick - 0.15 * TICK_RATE
    const seen = track.get(viewTick)
    if (!seen) throw new Error('no history')
    shootAt(s, { x: seen.x, y: seen.y + 1.3, z: seen.z }, viewTick)
    const debug = s.a.all(ServerMsg.DebugShot).at(-1)
    expect(debug?.poses[0]?.x).toBeCloseTo(seen.x, 1)
  })
})

describe('arsenal', () => {
  /** Aim for `aimSeconds` (scope in), then click once. */
  function aimedShot(s: Setup, target: { x: number; y: number; z: number }, aimSeconds: number) {
    const p = s.game.players.get(s.shooter)
    if (!p) throw new Error('no shooter')
    const eye = { x: p.state.pos.x, y: p.state.pos.y + 1.65, z: p.state.pos.z }
    const dx = target.x - eye.x
    const dz = target.z - eye.z
    const yaw = Math.atan2(-dx, -dz)
    const pitch = Math.atan2(target.y - eye.y, Math.hypot(dx, dz))
    const step = (buttons: number) => {
      s.game.handleInput(s.shooter, [
        { seq: s.seq.n++, buttons, yaw, pitch, viewTick: s.game.tick },
      ])
      s.game.handleInput(s.victim, [idle(s.seq.n)])
      s.game.step()
    }
    for (let t = 0; t < aimSeconds * TICK_RATE; t++) step(Button.Aim)
    step(Button.Aim | Button.Fire)
    for (let t = 0; t < 5; t++) step(Button.Aim)
  }

  function arm(s: Setup, id: WeaponId) {
    const p = s.game.players.get(s.shooter)
    if (!p) throw new Error()
    p.state.weapon = createWeaponState(id, 3)
    p.state.weapon.draw = 0
  }

  test('a scoped sniper shot to the chest kills; to the leg it does not', () => {
    const s = duel()
    arm(s, WeaponId.Sniper)
    aimedShot(s, { x: 0.1, y: 0.4, z: -5 }, 0.5)
    expect(health(s)).toBe(MAX_HEALTH - 75)
    arm(s, WeaponId.Sniper)
    aimedShot(s, { x: 0, y: 1.3, z: -5 }, 0.5)
    expect(health(s)).toBe(0)
    expect(s.b.all(ServerMsg.Kill).at(-1)?.weapon).toBe(WeaponId.Sniper)
  })

  test('the rifle needs 4 chest hits', () => {
    const s = duel()
    arm(s, WeaponId.Rifle)
    for (let i = 0; i < 3; i++) aimedShot(s, { x: 0, y: 1.3, z: -5 }, 0.3)
    expect(health(s)).toBe(MAX_HEALTH - 90)
    aimedShot(s, { x: 0, y: 1.3, z: -5 }, 0.3)
    expect(health(s)).toBe(0)
  })

  test('others are told which weapon fired', () => {
    const s = duel()
    arm(s, WeaponId.Sniper)
    aimedShot(s, { x: 0, y: 1.3, z: -5 }, 0.5)
    expect(s.b.all(ServerMsg.ShotFired).at(-1)?.weapon).toBe(WeaponId.Sniper)
  })
})

describe('game rules', () => {
  const chest = { x: 0, y: 1.32, z: -5 }
  const head = { x: 0, y: 1.64, z: -5 }

  test('one-shot: any hit kills', () => {
    const s = duel()
    s.game.setRules(mergeRules(DEFAULT_RULES, { oneShot: true }))
    shootAt(s, chest)
    expect(health(s)).toBe(0)
  })

  test('headshots only: body shots do nothing, a headshot still kills', () => {
    const s = duel()
    s.game.setRules(mergeRules(DEFAULT_RULES, { headshotsOnly: true }))
    shootAt(s, chest)
    expect(health(s)).toBe(MAX_HEALTH)
    shootAt(s, head)
    expect(health(s)).toBe(0)
  })

  test('damage multiplier scales body shots', () => {
    const normal = duel()
    shootAt(normal, chest)
    const lost = MAX_HEALTH - health(normal)
    const doubled = duel()
    doubled.game.setRules(mergeRules(DEFAULT_RULES, { damage: 2 }))
    shootAt(doubled, chest)
    expect(MAX_HEALTH - health(doubled)).toBe(Math.min(MAX_HEALTH, lost * 2))
  })

  test('tiny people have tiny hitboxes', () => {
    const s = duel()
    s.game.setRules(mergeRules(DEFAULT_RULES, { playerScale: 0.5 }))
    shootAt(s, chest) // where a normal chest would be: over a tiny player's head
    expect(health(s)).toBe(MAX_HEALTH)
    shootAt(s, { x: 0, y: 1.32 * 0.5, z: -5 })
    expect(health(s)).toBeLessThan(MAX_HEALTH)
  })

  test('respawn time follows the rules', () => {
    const s = duel()
    s.game.setRules(mergeRules(DEFAULT_RULES, { respawnSeconds: 1 }))
    shootAt(s, head)
    const victim = s.game.players.get(s.victim)
    expect(victim?.state.alive).toBe(false)
    for (let t = 0; t < TICK_RATE; t++) s.game.step()
    expect(s.game.players.get(s.victim)?.state.alive).toBe(true)
  })

  test('everyone is told the rules on join and on every change', () => {
    const s = duel()
    expect(s.b.all(ServerMsg.Rules).at(-1)?.rules).toEqual(DEFAULT_RULES)
    s.game.setRules(mergeRules(DEFAULT_RULES, { gravity: 0.2, skin: 'robot' }))
    const last = s.b.all(ServerMsg.Rules).at(-1)?.rules
    expect(last?.gravity).toBe(0.2)
    expect(last?.skin).toBe('robot')
    expect(s.game.players.get(s.victim)?.body.config.gravity).toBeCloseTo(20 * 0.2)
  })

  test('changing map respawns everyone in it and re-sends the world', () => {
    const s = duel()
    const map = loadMap('gym')
    s.game.changeMap(map, createPhysicsWorld(map))
    expect(s.game.mapId).toBe('gym')
    expect(s.game.rules.map).toBe('gym')
    expect(s.a.all(ServerMsg.Welcome).at(-1)?.mapId).toBe('gym')
    for (const p of s.game.players.values()) expect(p.state.alive).toBe(true)
    // The game keeps running in the new world.
    for (let t = 0; t < 30; t++) s.game.step()
  })
})

describe('shotgun', () => {
  /** Duel with the shooter holding a shotgun, `distance` m from the victim. */
  function shotgunDuel(distance: number) {
    const s = duel()
    const pa = s.game.players.get(s.shooter)
    const pb = s.game.players.get(s.victim)
    if (!pa || !pb) throw new Error('setup')
    pa.state.weapon = createWeaponState(WeaponId.Shotgun, 99)
    pb.state.pos = { x: 0, y: 0, z: -distance }
    for (let t = 0; t < TICK_RATE; t++) {
      s.game.handleInput(s.shooter, [idle(s.seq.n)])
      s.game.handleInput(s.victim, [idle(s.seq.n)])
      s.seq.n++
      s.game.step()
    }
    return s
  }

  test('point blank to the chest is a one-shot kill', () => {
    const s = shotgunDuel(3)
    shootAt(s, { x: 0, y: 1.25, z: -3 })
    expect(health(s)).toBe(0)
  })

  test('still a one-shot kill at 5 m', () => {
    const s = shotgunDuel(5)
    shootAt(s, { x: 0, y: 1.25, z: -5 })
    expect(health(s)).toBe(0)
  })

  test('damage drops with distance: 12 m hurts, but no longer kills', () => {
    const s = shotgunDuel(12)
    shootAt(s, { x: 0, y: 1.25, z: -12 })
    expect(health(s)).toBeGreaterThan(0)
    expect(health(s)).toBeLessThan(80)
  })

  test('far away the pellets barely hurt', () => {
    const s = shotgunDuel(30)
    shootAt(s, { x: 0, y: 1.25, z: -30 })
    expect(health(s)).toBeGreaterThan(80)
  })

  test('one shot fires a tracer per pellet, but only the first is the "real" shot', () => {
    const s = shotgunDuel(10)
    const before = s.b.all(ServerMsg.ShotFired).length
    shootAt(s, { x: 0, y: 1.25, z: -10 })
    const shots = s.b.all(ServerMsg.ShotFired).slice(before)
    expect(shots.length).toBe(8)
    expect(shots.filter((m) => !m.pellet).length).toBe(1)
  })

  test('a pellet in the head hurts more but is not an instant kill at range', () => {
    const s = shotgunDuel(15)
    shootAt(s, { x: 0, y: 1.64, z: -15 })
    expect(health(s)).toBeGreaterThan(0)
    expect(health(s)).toBeLessThan(MAX_HEALTH)
  })
})

describe('spawn loadout', () => {
  test('players respawn holding the rules’ spawn weapon, handgun holstered', () => {
    const s = duel()
    s.game.setRules(mergeRules(DEFAULT_RULES, { spawnWeapon: 'shotgun', respawnSeconds: 0 }))
    shootAt(s, { x: 0, y: 1.64, z: -5 })
    for (let t = 0; t < 3; t++) s.game.step()
    const victim = s.game.players.get(s.victim)
    expect(victim?.state.alive).toBe(true)
    expect(victim?.state.weapon.id).toBe(WeaponId.Shotgun)
    expect(victim?.state.holstered?.id).toBe(WeaponId.Handgun)
  })

  test('"none" keeps the handgun-only start', () => {
    const s = duel()
    shootAt(s, { x: 0, y: 1.64, z: -5 })
    for (let t = 0; t < DEFAULT_RULES.respawnSeconds * TICK_RATE + 2; t++) s.game.step()
    const victim = s.game.players.get(s.victim)
    expect(victim?.state.weapon.id).toBe(WeaponId.Handgun)
    expect(victim?.state.holstered).toBeNull()
  })
})

describe('knife', () => {
  /** Duel with the shooter's knife drawn, the victim `distance` m away facing `victimYaw`. */
  function knifeDuel(distance: number, victimYaw: number) {
    const s = duel()
    const pa = s.game.players.get(s.shooter)
    const pb = s.game.players.get(s.victim)
    if (!pa || !pb) throw new Error('setup')
    pb.state.pos = { x: 0, y: 0, z: -distance }
    pb.state.yaw = victimYaw
    // 3 = knife.
    s.game.handleInput(s.shooter, [
      { seq: s.seq.n++, buttons: Button.Slot3, yaw: 0, pitch: 0, viewTick: s.game.tick },
    ])
    s.game.handleInput(s.victim, [{ ...idle(s.seq.n), yaw: victimYaw }])
    s.game.step()
    for (let t = 0; t < TICK_RATE; t++) {
      s.game.handleInput(s.shooter, [idle(s.seq.n)])
      s.game.handleInput(s.victim, [{ ...idle(s.seq.n), yaw: victimYaw }])
      s.seq.n++
      s.game.step()
    }
    expect(pa.state.weapon.id).toBe(WeaponId.Knife)
    return s
  }
  const chest = (z: number) => ({ x: 0, y: 1.3, z })

  test('two slashes from the front kill', () => {
    const s = knifeDuel(1.5, Math.PI) // facing the attacker
    shootAt(s, chest(-1.5), undefined, Math.PI)
    expect(health(s)).toBe(MAX_HEALTH - WEAPONS[WeaponId.Knife].damage)
    // Let the swing cool down (both players keep sending input; the sim is client-paced).
    for (let t = 0; t < 30; t++) {
      s.game.handleInput(s.shooter, [idle(s.seq.n)])
      s.game.handleInput(s.victim, [{ ...idle(s.seq.n), yaw: Math.PI }])
      s.seq.n++
      s.game.step()
    }
    shootAt(s, chest(-1.5), undefined, Math.PI)
    expect(health(s)).toBe(0)
  })

  test('a backstab kills in one', () => {
    const s = knifeDuel(1.5, 0) // back turned to the attacker
    shootAt(s, chest(-1.5))
    expect(health(s)).toBe(0)
  })

  test('out of reach does nothing', () => {
    const s = knifeDuel(4, Math.PI)
    shootAt(s, chest(-4), undefined, Math.PI)
    expect(health(s)).toBe(MAX_HEALTH)
  })
})
