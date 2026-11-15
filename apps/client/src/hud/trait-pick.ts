import {
  type Legacy,
  PICK_SECONDS,
  type SurvivalAction,
  type SurvivalSelf,
  TRAITS,
  type TraitId,
} from '@office-fps/shared'

/** Once per character (bio seed), like the card. */
const SEEN_KEY = 'office-fps:trait-seen'
/** Up this long (s) before it keeps what you have and goes. */
const SHOW_SECONDS = 25

/** One choice: an earned trait and who left it, or null for none. */
export interface TraitOption {
  id: TraitId | null
  name: string
  desc: string
  /** "Walt Brandt put down 40 of the dead". */
  from: string
}

/** What a new character can pick from: every trait their past lives left, newest first. */
export function traitOptions(legacy: Legacy | undefined): TraitOption[] {
  if (!legacy || legacy.traits.length === 0) return []
  const out: TraitOption[] = legacy.traits.map((id) => {
    const t = TRAITS[id]
    const who = legacy.lives.find((l) => l.trait === id)?.name ?? 'Somebody before you'
    return { id, name: t.name, desc: t.desc, from: `${who} ${t.how}.` }
  })
  out.push({ id: null, name: 'Nothing', desc: 'Start clean.', from: '' })
  return out
}

/** Should the pick show now? A new character, with traits to pick from, not shown yet. */
export function wantsPick(
  self: SurvivalSelf | null,
  legacy: Legacy | undefined,
  lastSeen: number | null,
): boolean {
  const bio = self?.bio
  if (!bio || bio.seed === lastSeen) return false
  if ((self.age ?? 0) > PICK_SECONDS - 30) return false
  return (legacy?.traits.length ?? 0) > 0
}

const load = (): number | null => {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return raw === null ? null : Number(raw)
  } catch {
    return null
  }
}

/**
 * The legacy trait pick (ROADMAP 4.4), after the character card: what the dead left you, one to
 * carry. Number keys or a click choose; Enter keeps the newest (what the server gave already).
 */
export class TraitPick {
  private readonly root: HTMLDivElement
  private readonly list: HTMLDivElement
  private options: TraitOption[] = []
  private age = -1
  private seed = 0
  private current: TraitId | null = null
  private readonly send: (action: SurvivalAction) => void

  constructor(parent: HTMLElement, send: (action: SurvivalAction) => void) {
    this.send = send
    this.root = document.createElement('div')
    this.root.className = 'sv-traits'
    this.root.hidden = true
    const inner = document.createElement('div')
    inner.className = 'sv-traits-inner'
    const head = document.createElement('div')
    head.className = 'sv-traits-head'
    head.textContent = 'WHAT THEY LEFT YOU'
    this.list = document.createElement('div')
    this.list.className = 'sv-traits-list'
    const help = document.createElement('div')
    help.className = 'sv-traits-help'
    help.textContent = 'number to choose · Enter to keep'
    inner.append(head, this.list, help)
    this.root.append(inner)
    parent.append(this.root)
    // Ahead of the game's own keys while it's up (numbers would switch weapons).
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.age < 0) return
        if (e.code === 'Enter' || e.code === 'Escape') this.close()
        else if (e.code.startsWith('Digit')) {
          const option = this.options[Number(e.code.slice(5)) - 1]
          if (option) this.choose(option.id)
        } else return
        e.preventDefault()
        e.stopImmediatePropagation()
      },
      { capture: true },
    )
  }

  get showing(): boolean {
    return this.age >= 0
  }

  /** Every frame: shows itself once the card is gone, if there's something to pick. */
  update(dt: number, self: SurvivalSelf | null, alive: boolean, cardUp: boolean): void {
    if (this.age < 0) {
      if (!alive || cardUp || !self?.bio || !wantsPick(self, self.legacy, load())) return
      this.open(self)
      return
    }
    this.age += dt
    if (this.age > SHOW_SECONDS || !alive) this.close()
  }

  private open(self: SurvivalSelf): void {
    this.seed = self.bio?.seed ?? 0
    this.current = self.trait ?? null
    this.options = traitOptions(self.legacy)
    this.age = 0
    this.draw()
    this.root.hidden = false
  }

  private draw(): void {
    this.list.replaceChildren()
    this.options.forEach((o, i) => {
      const row = document.createElement('div')
      row.className = o.id === this.current ? 'sv-trait on' : 'sv-trait'
      const key = document.createElement('span')
      key.className = 'sv-trait-key'
      key.textContent = String(i + 1)
      const name = document.createElement('span')
      name.className = 'sv-trait-name'
      name.textContent = o.name
      const desc = document.createElement('span')
      desc.className = 'sv-trait-desc'
      desc.textContent = o.from ? `${o.desc} ${o.from}` : o.desc
      row.append(key, name, desc)
      row.addEventListener('click', () => this.choose(o.id))
      this.list.append(row)
    })
  }

  private choose(id: TraitId | null): void {
    if (id !== this.current) this.send({ a: 'trait', id })
    this.current = id
    this.draw()
    this.close()
  }

  private close(): void {
    if (this.age < 0) return
    this.age = -1
    this.root.hidden = true
    try {
      localStorage.setItem(SEEN_KEY, String(this.seed))
    } catch {
      // Private mode: it may show again next time.
    }
  }
}
