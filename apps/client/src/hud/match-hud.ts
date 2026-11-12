import {
  type CoopDef,
  type CoopInfo,
  GUN_GAME_LADDER,
  type MatchInfo,
  MODE_NAMES,
  TEAMS,
  type TeamId,
  WEAPONS,
} from '@office-fps/shared'

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
) {
  const node = document.createElement(tag)
  node.className = className
  parent?.append(node)
  return node
}

/**
 * Game mode HUD: a bar at the top (mode, round clock, the score that matters in this mode) and
 * the winner screen between rounds.
 */
export class MatchHud {
  private readonly bar: HTMLDivElement
  private readonly mode: HTMLSpanElement
  private readonly clock: HTMLSpanElement
  private readonly score: HTMLSpanElement
  private readonly status: HTMLDivElement
  private readonly endScreen: HTMLDivElement
  private readonly progress: HTMLDivElement
  private readonly progressFill: HTMLDivElement
  private readonly banner: HTMLDivElement
  private bannerUntil = 0
  private lastStage: number | null = null
  private lastEndKey = ''
  /** Called once when a round ends (for the fanfare). */
  onRoundEnd?: (won: boolean) => void
  /** Zombies: the team finished a stage (a gate opened). */
  onStageDone?: () => void
  /** The co-op map's stages (zombies mode). */
  coop: CoopDef | undefined

  constructor(root: HTMLElement) {
    this.bar = el('div', 'hud-match', root)
    this.mode = el('span', 'hud-match-mode', this.bar)
    this.clock = el('span', 'hud-match-clock', this.bar)
    this.score = el('span', 'hud-match-score', this.bar)
    this.progress = el('div', 'hud-coop-progress', root)
    this.progressFill = el('div', '', this.progress)
    this.progress.hidden = true
    this.status = el('div', 'hud-match-status', root)
    this.banner = el('div', 'hud-coop-banner', root)
    this.banner.hidden = true
    this.endScreen = el('div', 'hud-round-end', root)
    this.endScreen.hidden = true
    this.bar.hidden = true
  }

  /** @param name looks up a player's name; `me` is your id. */
  update(match: MatchInfo, me: number, name: (id: number) => string): void {
    this.bar.hidden = false
    const self = match.players.find((p) => p.id === me)
    const teams = TEAMS[match.mode]
    const minutes = Math.floor(match.timeLeft / 60)
    const seconds = String(match.timeLeft % 60).padStart(2, '0')
    this.mode.textContent = MODE_NAMES[match.mode].toUpperCase()
    this.clock.textContent = match.phase === 'ended' ? 'ROUND OVER' : `${minutes}:${seconds}`

    // The one score line that matters in this mode.
    let score = ''
    let status = ''
    const leader = [...match.players].sort((a, b) => b.kills - a.kills)[0]
    if (match.mode === 'ffa') {
      score = `You ${self?.kills ?? 0} · ${leader ? `${name(leader.id)} ${leader.kills}` : '—'} / ${match.scoreLimit}`
    } else if (match.mode === 'tdm' && teams) {
      const [, a, b] = match.teamScores
      score = `${teams[1].name} ${a} – ${b} ${teams[2].name} · first to ${match.scoreLimit}`
      if (self && self.team !== 0) status = `You're ${teams[self.team as 1 | 2].name}`
    } else if (match.mode === 'lms') {
      const alive = match.players.filter((p) => !p.out).length
      score = `${alive} standing`
      if (self?.out) status = "You're out — back next round"
    } else if (match.mode === 'gungame') {
      const level = self?.level ?? 0
      const step = GUN_GAME_LADDER[level]
      const top = [...match.players].sort((a, b) => b.level - a.level)[0]
      score = `Level ${level + 1}/${GUN_GAME_LADDER.length}: ${step ? WEAPONS[step.weapon].name : '?'}`
      if (top && top.id !== me) score += ` · leader ${name(top.id)} (${top.level + 1})`
    } else if (match.mode === 'zombies' && match.coop) {
      ;({ score, status } = this.coopLine(match.coop, self?.out ?? false))
      this.clock.textContent = match.phase === 'ended' ? 'ROUND OVER' : `${minutes}:${seconds}`
    } else if (match.mode === 'infection' && teams) {
      const survivors = match.players.filter((p) => p.team === 1).length
      const infected = match.players.filter((p) => p.team === 2).length
      score = `${teams[1].name} ${survivors} · ${teams[2].name} ${infected}`
      status =
        self?.team === 2 ? 'INFECTED — knife only, but faster' : 'Survive until the clock runs out'
    }
    this.score.textContent = score
    if (match.mode !== 'zombies' || !match.coop) {
      this.progress.hidden = true
      this.lastStage = null
    }
    this.banner.hidden = performance.now() > this.bannerUntil
    this.status.textContent = status
    this.status.hidden = status === ''
    if (self && self.team !== 0 && teams)
      this.status.style.color = css(teams[self.team as 1 | 2].color)
    else this.status.style.color = ''

    this.showEnd(match, me, name)
  }

  /** Zombies: stage and goal on the bar, the progress bar, and a banner when a gate opens. */
  private coopLine(coop: CoopInfo, out: boolean): { score: string; status: string } {
    const stages = this.coop?.stages ?? []
    const stage = stages[coop.stage]
    this.mode.textContent = `ZOMBIES · STAGE ${Math.min(coop.stage + 1, stages.length)}/${stages.length}`
    if (this.lastStage !== null && coop.stage > this.lastStage) {
      const next = stages[coop.stage]
      this.showBanner(
        next ? 'GATE OPEN' : 'ESCAPED!',
        next ? `Next: ${next.name} — ${next.task}` : '',
      )
      this.onStageDone?.()
    }
    this.lastStage = coop.stage
    if (!stage) {
      this.progress.hidden = true
      return { score: 'You made it out', status: '' }
    }
    const goal = stage.goal
    let score = `${stage.name}: ${stage.task}`
    if (goal.kind === 'kill' && coop.kills) score += ` ${coop.kills[0]}/${coop.kills[1]}`
    if (goal.kind === 'hold') score += ` ${Math.floor(coop.progress * 100)}%`
    this.progress.hidden = goal.kind === 'reach'
    this.progressFill.style.width = `${Math.round(coop.progress * 100)}%`
    const status = out
      ? "You're down — your team brings you back at the next checkpoint"
      : goal.kind === 'hold' && coop.progress > 0 && coop.progress < 1
        ? 'Stay in the green area!'
        : ''
    return { score, status }
  }

  showBanner(big: string, small: string, seconds = 4): void {
    this.banner.replaceChildren()
    el('div', 'big', this.banner).textContent = big
    if (small) el('div', 'small', this.banner).textContent = small
    this.bannerUntil = performance.now() + seconds * 1000
    this.banner.hidden = false
  }

  /** Hides the stage banner once its time is up (call every frame). */
  tick(): void {
    if (!this.banner.hidden && performance.now() > this.bannerUntil) this.banner.hidden = true
  }

  private showEnd(match: MatchInfo, me: number, name: (id: number) => string): void {
    const result = match.result
    this.endScreen.hidden = match.phase !== 'ended' || !result
    if (!result || match.phase !== 'ended') {
      this.lastEndKey = ''
      return
    }
    const teams = TEAMS[match.mode]
    const key = `${result.headline}|${result.winnerId}`
    if (key !== this.lastEndKey) {
      this.lastEndKey = key
      this.endScreen.replaceChildren()
      const title = el('div', 'hud-round-end-title', this.endScreen)
      title.textContent = result.headline
      const winnerTeam = result.winnerTeam as TeamId
      if (winnerTeam !== 0 && teams) title.style.color = css(teams[winnerTeam].color)
      for (const award of result.awards) {
        const row = el('div', 'hud-round-end-award', this.endScreen)
        el('span', 'title', row).textContent = award.title
        el('span', 'name', row).textContent = name(award.playerId)
        el('span', 'value', row).textContent = award.value
      }
      el('div', 'hud-round-end-next', this.endScreen)
      const self = match.players.find((p) => p.id === me)
      const won =
        result.winnerId === me ||
        (winnerTeam !== 0 && self !== undefined && self.team === winnerTeam)
      this.onRoundEnd?.(won)
    }
    const next = this.endScreen.querySelector('.hud-round-end-next')
    if (next) next.textContent = `Next round in ${match.timeLeft}`
  }
}
