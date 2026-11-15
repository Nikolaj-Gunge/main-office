import {
  ITEMS,
  PLAQUE_NAMES,
  PROJECT_BOARD_KEY,
  PROJECT_MORALE,
  PROJECTS,
  type ProjectDef,
  type ProjectId,
  type ProjectShared,
  type ProjectsSave,
  plaqueNames,
  projectDef,
  projectFull,
  sharedProjects,
} from '@office-fps/shared'
import type { CampHost } from './camp.ts'
import type { Person } from './story.ts'

/** What the projects need of the camp (camp.ts hands its own host on, and its morale). */
export interface ProjectsHost
  extends Pick<
    CampHost,
    'people' | 'count' | 'take' | 'touch' | 'notice' | 'dialog' | 'broadcast'
  > {
  /** Raise the camp's morale. */
  cheer(n: number): void
  /** The world's day (camp.ts). */
  day(): number
}

/**
 * Haven's community projects (shared/survival/projects.ts): E on the project board shows what is
 * being built and gives what you carry towards one. A finished project stands for good, cheers
 * the camp, and its plaque names the builders. Kept in the world save with the camp.
 */
export class Projects {
  private readonly host: ProjectsHost
  private state: ProjectsSave = {}

  constructor(host: ProjectsHost) {
    this.host = host
  }

  /** From the world save (already read by readCamp). */
  restore(save: ProjectsSave | undefined): void {
    this.state = structuredClone(save ?? {})
  }

  save(): ProjectsSave {
    return structuredClone(this.state)
  }

  /** Built and standing. */
  has(id: ProjectId): boolean {
    return this.state[id]?.done !== undefined
  }

  shared(): ProjectShared[] {
    return sharedProjects(this.state)
  }

  /** What of `def`'s needs this person carries and the project still lacks. */
  private offer(p: Person, def: ProjectDef): [item: string, n: number][] {
    const s = this.state[def.id]
    if (s?.done !== undefined) return []
    const out: [string, number][] = []
    for (const [item, need] of Object.entries(def.needs)) {
      const n = Math.min(this.host.count(p, item), need - (s?.given[item] ?? 0))
      if (n > 0) out.push([item, n])
    }
    return out
  }

  /** E on the board: what's being built, and a line to give to each project you can help. */
  use(p: Person): void {
    const lines: string[] = []
    const options: { id: string; label: string }[] = []
    for (const def of PROJECTS) {
      const s = this.state[def.id]
      if (s?.done !== undefined) {
        lines.push(`${def.name}: BUILT. ${plaqueNames(s, 3).join(', ')}${this.more(s)}.`)
        continue
      }
      const need = Object.entries(def.needs)
        .map(([item, n]) => `${ITEMS[item]?.name ?? item} ${s?.given[item] ?? 0}/${n}`)
        .join(', ')
      lines.push(`${def.name}: ${need}. ${def.good}`)
      const offer = this.offer(p, def)
      if (offer.length > 0)
        options.push({
          id: `give:${def.id}`,
          label: `Give to ${def.name} (${offer.map(([item, n]) => `${ITEMS[item]?.name ?? item} ×${n}`).join(', ')})`,
        })
    }
    options.push({ id: 'bye', label: 'Leave it.' })
    this.host.dialog(p.player, {
      npc: PROJECT_BOARD_KEY,
      name: 'Haven builds',
      text: `${lines.join('\n\n')}\n\nBring planks, scrap and the like. Every name goes on the plaque.`,
      options,
    })
  }

  private more(s: { donors: Record<string, number> }): string {
    const n = Object.keys(s.donors).length
    return n > 3 ? ` and ${n - 3} more` : ''
  }

  /** An answer on the board. */
  choose(p: Person, option: string): void {
    if (!option.startsWith('give:')) return void this.host.dialog(p.player, null)
    const def = projectDef(option.slice(5))
    if (def) this.give(p, def.id)
    this.use(p)
  }

  /** Gives everything they carry that `id` still needs: how many things went in. */
  give(p: Person, id: ProjectId): number {
    const def = projectDef(id)
    if (!def) return 0
    const offer = this.offer(p, def)
    if (offer.length === 0) {
      this.host.notice(p.player, 'info', `You have nothing ${def.name} still needs.`)
      return 0
    }
    const s = this.state[id] ?? { given: {}, donors: {} }
    this.state[id] = s
    let total = 0
    for (const [item, n] of offer) {
      this.host.take(p, item, n)
      s.given[item] = (s.given[item] ?? 0) + n
      total += n
    }
    const name = p.player.name.slice(0, 32) || 'Somebody'
    s.donors[name] = (s.donors[name] ?? 0) + total
    this.host.touch(p)
    if (projectFull(def, s)) this.finish(def)
    else
      this.host.notice(
        p.player,
        'info',
        `${total} thing${total === 1 ? '' : 's'} for ${def.name}. Your name goes on the list.`,
      )
    this.host.broadcast()
    return total
  }

  /** Everything is in: it goes up, Haven takes heart, and the plaque is nailed on. */
  private finish(def: ProjectDef): void {
    const s = this.state[def.id]
    if (!s || s.done !== undefined) return
    s.done = this.host.day()
    this.host.cheer(PROJECT_MORALE)
    const names = plaqueNames(s, PLAQUE_NAMES)
    const text = `${def.name} is finished. Haven turns out to see it. On the plaque: ${names.join(', ')}.`
    for (const p of this.host.people()) this.host.notice(p.player, 'story', text, 'Haven builds')
  }
}
