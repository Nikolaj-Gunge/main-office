import {
  DAY_SECONDS,
  EVAC_BOARD_RANGE,
  EVAC_CALL_USES,
  EVAC_HOLD,
  EVAC_ITEMS,
  EVAC_LEASH,
  type EvacAccount,
  type EvacShared,
  evacMissing,
  evacPad,
  evacPhase,
  heightAt,
  ITEMS,
  RETIRED_SHOWN,
  RETIRED_SPOTS,
  type Retired,
  type WalkerState,
  ZombieKind,
} from '@office-fps/shared'
import type { ServerPlayer } from '../game.ts'
import type { Point } from '../items.ts'
import type { Person, StoryHost } from './story.ts'

/** Waves of the dead during the hold, and the most of them out at once for it. */
const WAVES = 6
const MOST = 18
/** They come out of the trees this far from the pad (m). */
const SPAWN_NEAR = 75
const SPAWN_FAR = 110
/** People this close hear the flare go up (m); everyone else hears of it on the radio. */
const HEARD = 600

/** What the evacuation gets to do in the world (the director: see director.ts). */
export interface EvacHost
  extends Pick<
    StoryHost,
    | 'def'
    | 'now'
    | 'random'
    | 'people'
    | 'count'
    | 'take'
    | 'touch'
    | 'notice'
    | 'dialog'
    | 'broadcast'
    | 'wake'
    | 'horde'
    | 'spawnZed'
    | 'steer'
    | 'unsiege'
  > {
  /** They got on: the director retires the character and makes them somebody new at Haven. */
  retire(p: Person): void
}

interface Call {
  /** The player who called it in, and the name they went by. */
  caller: ServerPlayer
  by: string
  started: number
  heading: number
  wave: number
  nextWave: number
  zeds: Set<ServerPlayer>
  boarded: boolean
  /** Phase last told to everyone (to broadcast once per change). */
  told: string
}

/**
 * Evacuation (shared/survival/evac.ts): the field radio on the tower hill, the hold, the
 * helicopter, and the retired who live at Haven afterwards. One evacuation at a time.
 */
export class Evac {
  private readonly host: EvacHost
  private call: Call | null = null
  /** Those who got out, oldest first (WorldSave.retired). */
  retired: Retired[] = []

  constructor(host: EvacHost) {
    this.host = host
  }

  /** The world starts over (or was loaded): who lives at Haven. */
  restore(retired: readonly Retired[] | undefined): void {
    this.retired = (retired ?? []).filter((r) => r && typeof r.name === 'string').slice()
  }

  reset(): void {
    this.abort(null)
    this.retired = []
  }

  /** E on the field radio. */
  use(p: Person): void {
    const player = p.player
    if (this.call) {
      const left = Math.ceil(EVAC_HOLD - (this.host.now() - this.call.started))
      const text =
        this.call.caller === player
          ? left > 0
            ? `Static, then a voice: "${left} seconds out. Hold that pad."`
            : 'Static. "On approach. Get on the pad."'
          : `${this.call.by} already called it in. One seat.`
      return void this.host.notice(player, 'info', text)
    }
    const missing = evacMissing((item) => this.host.count(p, item))
    if (missing.length > 0) {
      const names = missing.map((i) => ITEMS[i]?.name ?? i).join(', ')
      const have = EVAC_ITEMS.length - missing.length
      return void this.host.notice(
        player,
        'info',
        have === 0
          ? `A military field radio, dead. A card taped to it: EVAC — BATTERY, FLARE, PAPERS.\n\nYou'd need: ${names}.`
          : `Not yet. Still missing: ${names}.`,
      )
    }
    this.start(p)
  }

  /** Calls the helicopter in: the battery goes in, the flare goes up, the dead come. */
  start(p: Person): void {
    const pad = evacPad(this.host.def())
    if (!pad) return
    for (const item of EVAC_CALL_USES) this.host.take(p, item, 1)
    this.host.touch(p)
    const now = this.host.now()
    this.call = {
      caller: p.player,
      by: p.self.bio?.name ?? p.player.name,
      started: now,
      // In from the south-east, the way Haven is.
      heading: -Math.PI * 0.75 + (this.host.random() - 0.5) * 0.6,
      wave: 0,
      nextWave: now + 4,
      zeds: new Set(),
      boarded: false,
      told: 'hold',
    }
    this.host.wake('radio')
    this.host.horde('radio', 10)
    this.host.notice(
      p.player,
      'story',
      `The battery clicks home. Static, then a voice, very far away:\n\n"Read you. ${Math.round(EVAC_HOLD / 60)} minutes, maybe less. Hold the pad."\n\nYou fire the flare. Red light over the whole hill.\n\nEverything for a mile heard that.`,
    )
    for (const q of this.host.people()) {
      if (q === p) continue
      const d = Math.hypot(q.player.state.pos.x - pad.x, q.player.state.pos.z - pad.z)
      this.host.notice(
        q.player,
        'warn',
        d < HEARD
          ? 'A red flare over the radio tower. Somebody is calling for a way out.'
          : `Haven's radio crackles: somebody called in a helicopter at the radio tower.`,
      )
    }
    this.host.broadcast()
  }

  /** Once a second. */
  tick(): void {
    const c = this.call
    if (!c) return
    const pad = evacPad(this.host.def())
    if (!pad) return void this.abort(null)
    const now = this.host.now()
    const age = now - c.started
    const phase = evacPhase(age)
    const me = c.caller.state
    const near = Math.hypot(me.pos.x - pad.x, me.pos.z - pad.z)

    if (!c.boarded && (!this.host.people().some((q) => q.player === c.caller) || !me.alive))
      return void this.abort('The pilot hears nothing back on the radio, and turns for home.')
    if (phase === 'hold' && near > EVAC_LEASH)
      return void this.abort('You left the pad. The voice on the radio stops answering.')

    // The dead come out of the trees in waves for the noise, all of them for the pad.
    if ((phase === 'hold' || phase === 'inbound') && c.wave < WAVES && now >= c.nextWave) {
      c.wave++
      c.nextWave = now + EVAC_HOLD / WAVES
      const n = Math.min(MOST - c.zeds.size, 3 + c.wave)
      for (let i = 0; i < n; i++) this.spawn(pad, c)
    }
    for (const z of [...c.zeds]) {
      if (!z.state.alive) c.zeds.delete(z)
      else this.host.steer(z, pad)
    }

    if (phase === 'landed' && !c.boarded && near < EVAC_BOARD_RANGE && me.alive) {
      const p = this.host.people().find((q) => q.player === c.caller)
      if (p) return void this.board(p)
    }
    if (phase === 'outbound' && !c.boarded)
      return void this.abort("The pilot couldn't wait any longer. The helicopter lifts away empty.")
    if (phase === 'gone') return void this.end()
    if (phase !== c.told) {
      c.told = phase
      if (phase === 'inbound')
        this.host.notice(c.caller, 'warn', 'Rotors. Coming in low over the trees. Get to the pad.')
      if (phase === 'landed')
        this.host.notice(c.caller, 'warn', "It's down. Get on, now. It won't wait.")
      this.host.broadcast()
    }
  }

  /** One of the dead for the hold, coming out of the trees round the pad. */
  private spawn(pad: Point, c: Call): void {
    const a = this.host.random() * Math.PI * 2
    const r = SPAWN_NEAR + this.host.random() * (SPAWN_FAR - SPAWN_NEAR)
    const x = pad.x + Math.cos(a) * r
    const z = pad.z + Math.sin(a) * r
    const kind = this.host.random() < 0.2 + c.wave * 0.05 ? ZombieKind.Runner : ZombieKind.Walker
    const zed = this.host.spawnZed({ x, y: heightAt(this.host.def().terrain, x, z), z }, kind, {
      siege: true,
    })
    if (zed) c.zeds.add(zed)
  }

  /** Aboard: they hand over the papers and the character's story ends here. */
  private board(p: Person): void {
    const c = this.call
    if (!c) return
    c.boarded = true
    this.host.take(p, 'evacpapers', 1)
    const days = Math.floor((p.self.age ?? 0) / DAY_SECONDS)
    this.retired.push({ name: c.by, day: days })
    for (const z of c.zeds) this.host.unsiege(z)
    c.zeds.clear()
    // The director makes them somebody new; the helicopter flies out with the old one.
    this.host.retire(p)
    for (const q of this.host.people())
      if (q !== p)
        this.host.notice(
          q.player,
          'info',
          `${c.by} got out. The helicopter turns north and is gone.`,
        )
    this.host.broadcast()
  }

  /** The helicopter has gone: the evacuation is over (whatever happened). */
  private end(): void {
    const c = this.call
    if (!c) return
    for (const z of c.zeds) this.host.unsiege(z)
    this.call = null
    this.host.broadcast()
  }

  /** It's off: the caller is told why (if `why`). */
  private abort(why: string | null): void {
    const c = this.call
    if (!c) return
    this.end()
    if (why) this.host.notice(c.caller, 'warn', why)
  }

  /** What everybody sees (SurvivalShared.evac). */
  shared(): EvacShared | undefined {
    const c = this.call
    const pad = c && evacPad(this.host.def())
    if (!c || !pad) return undefined
    return {
      by: c.by,
      age: this.host.now() - c.started,
      x: pad.x,
      y: pad.y,
      z: pad.z,
      heading: c.heading,
      ...(c.boarded ? { boarded: true } : {}),
    }
  }

  // --- The retired, at Haven --------------------------------------------------------------------

  /** The retired standing about Haven (the latest few), each at their own spot. */
  private shown(): { key: string; r: Retired; x: number; y: number; z: number; yaw: number }[] {
    const haven = this.host.def().pois.find((p) => p.key === 'haven')
    if (!haven) return []
    const latest = this.retired.slice(-RETIRED_SHOWN)
    return latest.map((r, i) => {
      const [hx, hz, yaw] = RETIRED_SPOTS[i] ?? [0, 0, 0]
      return { key: `retired:${i}`, r, x: haven.x + hx, y: haven.y, z: haven.z + hz, yaw }
    })
  }

  /** Drawn like anybody walking with someone (SurvivalShared.walkers), standing still. */
  walkers(): WalkerState[] {
    return this.shown().map((s) => ({
      key: s.key,
      who: s.r.name,
      x: s.x,
      y: s.y,
      z: s.z,
      yaw: s.yaw,
      follow: 0,
      hp: 100,
    }))
  }

  /** Who of the retired one can talk to, and where they stand. */
  talkables(): { key: string; name: string; pos: [number, number, number] }[] {
    return this.shown().map((s) => ({ key: s.key, name: s.r.name, pos: [s.x, s.y, s.z] }))
  }

  /** Talking to one of the retired (true if `key` is one). */
  talk(p: Person, key: string): boolean {
    const s = this.shown().find((x) => x.key === key)
    if (!s) return false
    const days = s.r.day === 1 ? 'one day' : `${s.r.day} days`
    const lines = [
      `I lasted ${days} out there, then I got on the helicopter at the tower. They flew me round the long way and I asked to be set down here again. Don't ask me why.`,
      "Battery, flare, papers. Then you hold the pad while every one of them in the county comes for the flare. That's the whole trick.",
      'I leave a bundle by the bunkhouse for whoever comes after me. Somebody did it for me once.',
    ]
    const line = lines[Math.floor(this.host.random() * lines.length)] ?? lines[0]
    this.host.dialog(p.player, {
      npc: key,
      name: s.r.name,
      text: line ?? '',
      options: [{ id: 'bye', label: 'Take care.' }],
    })
    return true
  }
}

/** The account's evacuation record (its `evac` part), read defensively. */
export function evacAccount(data: Record<string, unknown>): EvacAccount {
  const raw = data.evac as Partial<EvacAccount> | undefined
  const retired = Array.isArray(raw?.retired)
    ? raw.retired.filter((n): n is string => typeof n === 'string')
    : []
  return { retired }
}
