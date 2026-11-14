import type { ChatChannel } from '@office-fps/shared'

/** A line in the log fades this long after it arrived (ms), unless the chat is open. */
const FADE_MS = 8000
/** Lines kept (older ones drop off the top). */
const KEEP = 60

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  nearby: 'NEARBY',
  all: 'ALL',
  team: 'TEAM',
}

export interface ChatLine {
  /** Who said it (null: a game message, "You wave." and the like). */
  from: number | null
  name?: string
  text: string
  channel?: ChatChannel
  /** Draw it as an aside (system notes, waves). */
  quiet?: boolean
}

/**
 * Bottom-left text chat: recent lines that fade after 8 s, the whole log and a typing line while
 * open. Keys typed into it never reach the game (they stop at the input). Enter sends, Esc
 * cancels, Tab switches channel. Names in the log can be clicked (mute) while it's open.
 */
export class ChatBox {
  private readonly root: HTMLDivElement
  private readonly log: HTMLDivElement
  private readonly entry: HTMLFormElement
  private readonly channelTag: HTMLSpanElement
  private readonly input: HTMLInputElement
  private channels: ChatChannel[] = ['all']
  private channel: ChatChannel = 'all'
  /** A line was typed and Enter pressed. */
  onSend?: (text: string, channel: ChatChannel) => void
  /** The chat closed (sent or cancelled). */
  onClose?: () => void
  /** A speaker's name was clicked in the open log. */
  onNameClick?: (id: number) => void

  constructor(parent: HTMLElement, maxLength: number) {
    this.root = document.createElement('div')
    this.root.className = 'hud-chat'
    this.log = document.createElement('div')
    this.log.className = 'hud-chat-log'
    this.entry = document.createElement('form')
    this.entry.className = 'hud-chat-entry'
    this.channelTag = document.createElement('span')
    this.input = document.createElement('input')
    this.input.maxLength = maxLength
    this.input.spellcheck = false
    this.input.autocomplete = 'off'
    this.entry.append(this.channelTag, this.input)
    this.entry.hidden = true
    this.root.append(this.log, this.entry)
    parent.append(this.root)

    // Everything typed stays in the chat: no movement, no shooting, no menu.
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.code === 'Escape') {
        e.preventDefault()
        this.close()
      } else if (e.code === 'Tab') {
        e.preventDefault()
        const next = this.channels[(this.channels.indexOf(this.channel) + 1) % this.channels.length]
        this.setChannel(next ?? this.channel)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const text = this.input.value.trim()
        if (text) this.onSend?.(text, this.channel)
        this.close()
      }
    })
    this.input.addEventListener('keyup', (e) => e.stopPropagation())
    // Clicking elsewhere (the game) closes it.
    this.input.addEventListener('blur', () => {
      if (this.isOpen) this.close()
    })
    this.log.addEventListener('mousedown', (e) => {
      const name = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')
      if (!name || !this.isOpen) return
      e.preventDefault() // keep the input focused
      this.onNameClick?.(Number(name.dataset.id))
    })
  }

  get isOpen(): boolean {
    return !this.entry.hidden
  }

  /** The channels this mode has, the first being the default. */
  setChannels(channels: ChatChannel[]): void {
    this.channels = channels
    if (!channels.includes(this.channel)) this.setChannel(channels[0] ?? 'all')
  }

  open(): void {
    if (this.isOpen) return
    this.setChannel(this.channels[0] ?? 'all')
    this.entry.hidden = false
    this.root.classList.add('open')
    this.input.value = ''
    this.input.focus()
    this.log.scrollTop = this.log.scrollHeight
  }

  close(): void {
    if (!this.isOpen) return
    this.entry.hidden = true
    this.root.classList.remove('open')
    this.input.blur()
    this.log.scrollTop = this.log.scrollHeight
    this.onClose?.()
  }

  /**
   * Keeps the chat just above `below` (survival's vitals, which grow as conditions pile up);
   * null: back to its usual place.
   */
  stayAbove(below: HTMLElement | null): void {
    const top = below?.offsetParent ? below.getBoundingClientRect().top : null
    const parent = this.root.parentElement?.getBoundingClientRect()
    this.root.style.bottom = top !== null && parent ? `${parent.bottom - top + 10}px` : ''
  }

  /** Shows or hides the whole chat (the setting). */
  setVisible(visible: boolean): void {
    this.root.hidden = !visible
    if (!visible) this.close()
  }

  add(line: ChatLine): void {
    const row = document.createElement('div')
    row.className = line.quiet ? 'line quiet' : `line ${line.channel ?? ''}`
    if (line.channel && line.channel !== 'all' && !line.quiet) {
      const tag = document.createElement('i')
      tag.textContent = `[${CHANNEL_LABEL[line.channel]}] `
      row.append(tag)
    }
    if (line.name) {
      const name = document.createElement('b')
      name.textContent = line.name
      if (line.from !== null) {
        name.dataset.id = String(line.from)
        name.title = 'Click to mute / unmute'
      }
      row.append(name, ': ')
    }
    row.append(line.text)
    this.log.append(row)
    while (this.log.childElementCount > KEEP) this.log.firstElementChild?.remove()
    this.log.scrollTop = this.log.scrollHeight
    // Fade it out later (CSS hides faded lines unless the chat is open).
    setTimeout(() => row.classList.add('old'), FADE_MS)
  }

  private setChannel(channel: ChatChannel): void {
    this.channel = channel
    this.channelTag.textContent = `${CHANNEL_LABEL[channel]}${this.channels.length > 1 ? ' ⇥' : ''}`
    this.channelTag.className = channel
  }
}
