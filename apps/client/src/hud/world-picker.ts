import {
  isPrivateWorld,
  parseWorldId,
  privateWorldId,
  WORLD_PARAM,
  type WorldsReply,
  worldName,
} from '@office-fps/shared'

/** How often the menu refreshes the head counts while it's open (each is a metered request). */
const REFRESH_MS = 30_000
/** How soon a list that never came (a timeout under load, a server restarting) is asked again. */
const RETRY_MS = 5_000

/** The world list (GET /worlds), or null if the server doesn't have one (older server). */
export async function fetchWorlds(): Promise<WorldsReply | null> {
  try {
    const response = await fetch('/worlds', { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return null
    const body = (await response.json()) as WorldsReply
    return Array.isArray(body.worlds) && typeof body.pick === 'string' ? body : null
  } catch {
    return null
  }
}

/** The world in the page's `?world=` (a link somebody shared, or the last pick), if any. */
export function worldFromUrl(): string | null {
  return parseWorldId(new URLSearchParams(location.search).get(WORLD_PARAM))
}

/** A link to a world: this page with `?world=` set. */
export function worldLink(id: string): string {
  const url = new URL(location.href)
  url.searchParams.set(WORLD_PARAM, id)
  url.searchParams.delete('mute') // a testing switch, not part of the invitation
  return url.toString()
}

/** What the picker does with the connection: where to join. */
export interface WorldTarget {
  world: string | null
  readonly state: string
}

/**
 * The world picker on the PLAY tab (survival only): every public world with its head count,
 * "any" (the busiest one with room, worlds.ts), and a private world shared by link. The choice
 * goes into the page URL, so a reload or a shared link lands in the same world. Changing worlds
 * after joining reloads the page into the new one.
 */
export class WorldPicker {
  readonly root: HTMLElement
  private readonly list: HTMLElement
  private readonly linkRow: HTMLElement
  private readonly linkInput: HTMLInputElement
  /** Chosen world, or null for "any". */
  private chosen: string | null = worldFromUrl()
  private reply: WorldsReply | null = null
  private lastFetch = 0
  private fetching = false

  constructor(
    private readonly net: WorldTarget,
    private readonly isOpen: () => boolean,
  ) {
    this.root = document.createElement('div')
    this.root.className = 'world-picker'
    const label = document.createElement('div')
    label.className = 'world-picker-label'
    label.textContent = 'World'
    this.list = document.createElement('div')
    this.list.className = 'world-picker-list'
    this.linkRow = document.createElement('div')
    this.linkRow.className = 'world-picker-link'
    this.linkInput = document.createElement('input')
    this.linkInput.readOnly = true
    this.linkInput.addEventListener('focus', () => this.linkInput.select())
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'menu-small'
    copy.textContent = 'Copy link'
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.linkInput.value).then(() => {
        copy.textContent = 'Copied'
        setTimeout(() => {
          copy.textContent = 'Copy link'
        }, 1500)
      })
    })
    this.linkRow.append(this.linkInput, copy)
    this.root.append(label, this.list, this.linkRow)
    this.render()
    this.apply()
    void this.refresh()
    setInterval(() => {
      if (!this.isOpen() || document.visibilityState !== 'visible') return
      const since = performance.now() - this.lastFetch
      // No list yet: keep asking (joined or not), or the world buttons never show. Once there is
      // one, the counts refresh only before joining (each request is metered).
      if (!this.reply ? since > RETRY_MS : !this.joined && since > REFRESH_MS) void this.refresh()
    }, 1000)
  }

  private get joined(): boolean {
    return this.net.state === 'open' || this.net.state === 'connecting'
  }

  /** Each fresh list (the title screen counts the survivors out tonight from it). */
  onReply: ((reply: WorldsReply) => void) | null = null

  /** Fetches the head counts and redraws. */
  async refresh(): Promise<void> {
    if (this.fetching) return
    this.fetching = true
    this.lastFetch = performance.now()
    const reply = await fetchWorlds()
    this.fetching = false
    if (reply) {
      this.reply = reply
      this.onReply?.(reply)
    }
    this.apply()
    this.render()
  }

  /** Points the connection at the chosen world (or the busiest one with room). */
  private apply(): void {
    if (this.joined) return // a reconnect keeps the world it was in
    this.net.world = this.chosen ?? this.reply?.pick ?? null
  }

  private choose(id: string | null): void {
    if (id === this.chosen) return
    this.chosen = id
    const url = new URL(location.href)
    if (id) url.searchParams.set(WORLD_PARAM, id)
    else url.searchParams.delete(WORLD_PARAM)
    if (this.joined) {
      // Somewhere else entirely: leave this world (the character is saved) and load that one.
      location.assign(url.toString())
      return
    }
    history.replaceState(null, '', url.toString())
    this.apply()
    this.render()
  }

  private render(): void {
    const buttons: HTMLButtonElement[] = []
    const button = (id: string | null, text: string, note: string, full = false) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'world-choice'
      if (id === this.chosen) b.classList.add('chosen')
      if (full) b.classList.add('full')
      const name = document.createElement('span')
      name.textContent = text
      const count = document.createElement('span')
      count.className = 'world-count'
      count.textContent = note
      b.append(name, count)
      b.addEventListener('click', () => this.choose(id))
      buttons.push(b)
    }
    const pick = this.reply?.pick
    button(null, 'Any', pick ? `→ ${worldName(pick)}` : 'busiest')
    for (const w of this.reply?.worlds ?? []) {
      const note = w.full ? 'full' : w.players === 1 ? '1 survivor' : `${w.players} survivors`
      button(w.id, w.name, note, w.full)
    }
    if (this.chosen && isPrivateWorld(this.chosen))
      button(this.chosen, worldName(this.chosen), 'by link')
    else button(privateWorldId(), 'Private', 'new link')
    this.list.replaceChildren(...buttons)
    const priv = this.chosen && isPrivateWorld(this.chosen) ? this.chosen : null
    this.linkRow.hidden = !priv
    if (priv) this.linkInput.value = worldLink(priv)
  }
}
