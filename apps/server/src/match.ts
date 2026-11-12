import {
  createPhysicsWorld,
  type GameRules,
  GUN_GAME_LADDER,
  INFECTED_SPEED,
  loadMap,
  MAPS,
  type MatchInfo,
  MODE_NAMES,
  ROUND_END_SECONDS,
  type RoundResult,
  ServerMsg,
  TEAMS,
  type TeamId,
  TICK_RATE,
  WeaponId,
} from '@office-fps/shared'
import type { Game, ServerPlayer } from './game.ts'

/** A finished round: winner, winning team, headline. */
type Verdict = [ServerPlayer | null, TeamId, string]

/** Infection: people who join this long into a round start infected. */
const LATE_JOIN_INFECTED_SECONDS = 30
/** Maps the rotation cycles through (the gym is a test range, not a play map). */
const ROTATION = () => Object.keys(MAPS).filter((id) => id !== 'gym' && id !== 'range')

/**
 * Rounds and scoring for every game mode. The Game asks it what a player may do (hurt,
 * pick up, carry, how fast to run) and tells it about joins and kills; it decides when a
 * round ends, who won, and starts the next one (on the next map, with rotation on).
 *
 *   ffa       most kills; first to the score limit wins
 *   tdm       two teams; team kills, first team to the limit wins; no friendly fire
 *   lms       no respawns; the last one standing wins
 *   gungame   every 2 kills → the next weapon; first kill with the knife at the end wins
 *   infection one infected (knife only, faster); whoever they kill joins them; survivors win
 *             if anyone is alive when the time runs out
 */
export class MatchRunner {
  private readonly game: Game
  phase: 'playing' | 'ended' = 'playing'
  private roundStart = 0
  private phaseEnds = 0
  private teamScores: [number, number, number] = [0, 0, 0]
  private result: RoundResult | null = null

  constructor(game: Game) {
    this.game = game
    this.roundStart = game.tick
  }

  private get rules(): GameRules {
    return this.game.rules
  }

  private get roundEnds(): number {
    return this.roundStart + this.rules.timeLimit * 60 * TICK_RATE
  }

  /** People (and bots) in the game. */
  private get everyone(): ServerPlayer[] {
    // Shooting-range dummies are props, not players: they don't win, score or end rounds.
    return [...this.game.players.values()].filter((p) => !p.dummy)
  }

  // --- What the game asks ----------------------------------------------------------------

  /** No damage between teammates, and none at all on the winner screen. */
  canHurt(attacker: ServerPlayer, victim: ServerPlayer): boolean {
    if (this.phase === 'ended') return false
    if (attacker === victim) return true
    return attacker.team === 0 || attacker.team !== victim.team
  }

  /** Gun game and the infected can't pick weapons up (their weapon is the mode's). */
  canPickUp(player: ServerPlayer): boolean {
    return this.loadout(player) === null
  }

  /** The weapon the mode puts in your hand, or null for the normal loadout. */
  loadout(player: ServerPlayer): WeaponId | null {
    if (this.rules.mode === 'gungame') {
      return GUN_GAME_LADDER[Math.min(player.level, GUN_GAME_LADDER.length - 1)]?.weapon ?? null
    }
    if (this.rules.mode === 'infection' && player.team === 2) return WeaponId.Knife
    return null
  }

  speedFactor(player: ServerPlayer): number {
    return this.rules.mode === 'infection' && player.team === 2 ? INFECTED_SPEED : 1
  }

  // --- What the game tells us ------------------------------------------------------------

  onJoin(player: ServerPlayer): void {
    if (player.dummy) return
    const mode = this.rules.mode
    if (mode === 'tdm') player.team = this.smallerTeam()
    if (mode === 'infection') {
      const late = this.game.tick - this.roundStart > LATE_JOIN_INFECTED_SECONDS * TICK_RATE
      player.team = late || this.phase === 'ended' ? 2 : 1
    }
    // Last man standing: in the next round, not this one (unless it barely started).
    if (mode === 'lms' && this.game.tick - this.roundStart > 5 * TICK_RATE) player.out = true
  }

  onKill(victim: ServerPlayer, killer: ServerPlayer, weapon: WeaponId): void {
    if (this.phase === 'ended' || victim.dummy) return
    const mode = this.rules.mode
    if (mode === 'tdm' && killer !== victim && killer.team !== victim.team) {
      this.teamScores[killer.team]++
    }
    if (mode === 'lms') {
      victim.out = true
      victim.respawnAt = Number.POSITIVE_INFINITY
    }
    if (mode === 'infection' && victim.team === 1 && killer.team === 2) {
      victim.team = 2 // joins the infected when they respawn
      this.game.applyRules(victim)
    }
    if (mode === 'gungame' && killer !== victim) this.gunGameKill(victim, killer, weapon)
    this.check()
    this.broadcast()
  }

  /** Rules changed on the admin page: a new mode (or map rotation) starts a new round. */
  onRulesChanged(before: GameRules): void {
    if (before.mode !== this.rules.mode) this.startRound(false)
    else this.broadcast()
  }

  step(): void {
    const tick = this.game.tick
    if (this.phase === 'ended') {
      if (tick >= this.phaseEnds) this.startRound(this.rules.mapRotation)
      return
    }
    if (tick % TICK_RATE === 0) this.check()
  }

  // --- Rounds ------------------------------------------------------------------------------

  /** Ends the round if the mode's goal (or the clock) says so. */
  check(): void {
    if (this.phase !== 'playing') return
    const verdict = this.decide()
    if (verdict) this.end(...verdict)
  }

  /** The round's outcome if it is over now: [winner, winning team, headline]. */
  private decide(): Verdict | undefined {
    const win = (winner: ServerPlayer | null, team: TeamId, headline: string): Verdict => [
      winner,
      team,
      headline,
    ]
    const mode = this.rules.mode
    const players = this.everyone
    const timeUp = this.game.tick >= this.roundEnds
    const name = (p: ServerPlayer) => p.name

    if (mode === 'ffa') {
      const top = [...players].sort((a, b) => b.kills - a.kills)[0]
      if (top && top.kills >= this.rules.scoreLimit) return win(top, 0, `${name(top)} wins`)
      if (timeUp) return win(top ?? null, 0, top ? `${name(top)} wins on time` : 'Time!')
    }
    if (mode === 'tdm') {
      const [, a, b] = this.teamScores
      const styles = TEAMS.tdm
      const winner: TeamId = a > b ? 1 : b > a ? 2 : 0
      const headline =
        winner === 0
          ? `Draw ${a} – ${b}`
          : `${styles?.[winner]?.name ?? 'Team'} wins ${Math.max(a, b)} – ${Math.min(a, b)}`
      if (a >= this.rules.scoreLimit || b >= this.rules.scoreLimit || timeUp) {
        return win(null, winner, headline)
      }
    }
    if (mode === 'lms') {
      const standing = players.filter((p) => !p.out)
      if (players.length >= 2 && standing.length <= 1) {
        const last = standing[0]
        return win(
          last ?? null,
          0,
          last ? `${name(last)} is the last one standing` : 'Nobody survived',
        )
      }
      if (timeUp) {
        const top = [...standing].sort((a, b) => b.kills - a.kills)[0]
        return win(top ?? null, 0, top ? `${name(top)} wins on kills` : 'Time!')
      }
    }
    if (mode === 'gungame' && timeUp) {
      const top = [...players].sort((a, b) => b.level - a.level || b.kills - a.kills)[0]
      return win(top ?? null, 0, top ? `${name(top)} wins on time` : 'Time!')
    }
    if (mode === 'infection') {
      const survivors = players.filter((p) => p.team === 1)
      if (players.length >= 2 && survivors.length === 0) {
        return win(null, 2, 'The infected took over the office')
      }
      if (timeUp) return win(null, 1, `${survivors.length} survived`)
    }
  }

  /** Starts a fresh round: scores reset, teams drawn, everyone respawned. */
  startRound(nextMap: boolean): void {
    if (nextMap) {
      const maps = ROTATION()
      const next = maps[(maps.indexOf(this.game.mapId) + 1) % maps.length]
      if (next && next !== this.game.mapId) {
        const map = loadMap(next)
        this.game.rotateMap(map, createPhysicsWorld(map))
      }
    }
    this.phase = 'playing'
    this.roundStart = this.game.tick
    this.teamScores = [0, 0, 0]
    this.result = null
    const players = this.everyone
    const mode = this.rules.mode
    // Teams: shuffled, then alternated (balanced). Infection: one random patient zero.
    const shuffled = [...players].sort(() => Math.random() - 0.5)
    shuffled.forEach((p, i) => {
      p.team = mode === 'tdm' ? (((i % 2) + 1) as TeamId) : mode === 'infection' ? 1 : 0
      p.kills = 0
      p.deaths = 0
      p.headshots = 0
      p.level = 0
      p.levelKills = 0
      p.out = false
    })
    if (mode === 'infection' && shuffled[0] && shuffled.length >= 2) shuffled[0].team = 2
    for (const p of players) {
      this.game.applyRules(p)
      this.game.respawnNow(p)
    }
    this.game.sendScoreboard()
    this.broadcast()
  }

  private end(winner: ServerPlayer | null, team: TeamId, headline: string): void {
    this.phase = 'ended'
    this.phaseEnds = this.game.tick + ROUND_END_SECONDS * TICK_RATE
    this.result = {
      winnerId: winner?.id ?? null,
      winnerTeam: team,
      headline,
      awards: this.awards(),
    }
    this.broadcast()
  }

  /** Winner-screen awards: most kills, best K/D, most headshots. */
  private awards(): RoundResult['awards'] {
    const players = this.everyone
    const awards: RoundResult['awards'] = []
    const best = (score: (p: ServerPlayer) => number) =>
      [...players].filter((p) => score(p) > 0).sort((a, b) => score(b) - score(a))[0]
    const mvp = best((p) => p.kills)
    if (mvp) awards.push({ title: 'MVP', playerId: mvp.id, value: `${mvp.kills} kills` })
    const kd = best((p) => (p.kills >= 2 ? p.kills / Math.max(1, p.deaths) : 0))
    if (kd) {
      awards.push({
        title: 'Best K/D',
        playerId: kd.id,
        value: (kd.kills / Math.max(1, kd.deaths)).toFixed(1),
      })
    }
    const sharp = best((p) => p.headshots)
    if (sharp)
      awards.push({
        title: 'Sharpshooter',
        playerId: sharp.id,
        value: `${sharp.headshots} headshots`,
      })
    return awards
  }

  // --- Gun game ------------------------------------------------------------------------------

  private gunGameKill(victim: ServerPlayer, killer: ServerPlayer, weapon: WeaponId): void {
    const step = GUN_GAME_LADDER[killer.level]
    if (!step) return
    // A knife kill (before the knife level) humiliates: the victim drops a level.
    if (weapon === WeaponId.Knife && step.weapon !== WeaponId.Knife) {
      victim.level = Math.max(0, victim.level - 1)
      victim.levelKills = 0
    }
    if (weapon !== step.weapon && weapon !== WeaponId.Knife) return
    killer.levelKills++
    if (killer.levelKills < step.kills) return
    if (killer.level === GUN_GAME_LADDER.length - 1) {
      this.end(killer, 0, `${killer.name} wins gun game`)
      return
    }
    killer.level++
    killer.levelKills = 0
    const next = GUN_GAME_LADDER[killer.level]
    if (next) this.game.giveWeapon(killer, next.weapon)
  }

  // --- Telling everyone -------------------------------------------------------------------

  info(): MatchInfo {
    const ticksLeft =
      this.phase === 'ended' ? this.phaseEnds - this.game.tick : this.roundEnds - this.game.tick
    return {
      mode: this.rules.mode,
      phase: this.phase,
      timeLeft: Math.max(0, Math.ceil(ticksLeft / TICK_RATE)),
      scoreLimit: this.rules.scoreLimit,
      teamScores: this.teamScores,
      players: this.everyone.map((p) => ({
        id: p.id,
        team: p.team,
        kills: p.kills,
        deaths: p.deaths,
        headshots: p.headshots,
        level: p.level,
        out: p.out,
      })),
      result: this.result,
    }
  }

  broadcast(): void {
    this.game.broadcastMessage({ type: ServerMsg.Match, match: this.info() })
  }

  private smallerTeam(): TeamId {
    const players = this.everyone
    const a = players.filter((p) => p.team === 1).length
    const b = players.filter((p) => p.team === 2).length
    return a <= b ? 1 : 2
  }

  /** For the startup log. */
  describe(): string {
    return MODE_NAMES[this.rules.mode]
  }
}
