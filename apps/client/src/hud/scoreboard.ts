import { PLAYER_COLORS, type ScoreEntry } from '@office-fps/shared'

export interface ScorePlayer {
  name: string
  color: number
}

/** Hold Tab: everyone's kills, deaths, K/D and ping, best first. */
export class Scoreboard {
  private readonly root: HTMLDivElement
  private readonly body: HTMLTableSectionElement
  private entries: ScoreEntry[] = []

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud-scoreboard'
    this.root.innerHTML = `
      <h2>SCOREBOARD</h2>
      <table>
        <thead><tr><th class="name">Player</th><th>K</th><th>D</th><th>K/D</th><th>Ping</th></tr></thead>
        <tbody></tbody>
      </table>
      <p class="hint">Free-for-all · first to nothing, forever</p>
    `
    this.body = this.root.querySelector('tbody') as HTMLTableSectionElement
    this.root.hidden = true
    parent.append(this.root)
  }

  update(entries: ScoreEntry[]): void {
    this.entries = entries
  }

  show(visible: boolean, players: Map<number, ScorePlayer>, myId: number): void {
    this.root.hidden = !visible
    if (!visible) return
    const rows = [...this.entries].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    this.body.innerHTML = ''
    for (const e of rows) {
      const p = players.get(e.id)
      const tr = document.createElement('tr')
      if (e.id === myId) tr.className = 'me'
      const color = `#${(PLAYER_COLORS[(p?.color ?? 0) % PLAYER_COLORS.length] ?? 0xffffff).toString(16).padStart(6, '0')}`
      const kd = e.deaths === 0 ? e.kills.toFixed(1) : (e.kills / e.deaths).toFixed(2)
      const cells = [p?.name ?? `#${e.id}`, String(e.kills), String(e.deaths), kd, `${e.ping}`]
      cells.forEach((text, i) => {
        const td = document.createElement('td')
        td.textContent = text
        if (i === 0) {
          td.className = 'name'
          td.style.setProperty('--color', color)
        }
        tr.append(td)
      })
      this.body.append(tr)
    }
  }
}
