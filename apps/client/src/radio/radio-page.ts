import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/700.css'
import './radio.css'
import type { RotMood, WeatherKind } from '@office-fps/shared'
// Only this file from shared: the page must not pull in three.js, Rapier or the maps.
import {
  MOOD_VOTE_LABELS,
  RADIO_FEED_PATH,
  RADIO_POLL_EMPTY_MS,
  RADIO_POLL_MS,
  RADIO_VOTE_PATH,
  type RadioFeed,
  type RadioVoteReply,
} from '@office-fps/shared/radio-feed'

/**
 * Haven Radio (/radio): Radio Free Deadwood on a phone, no 3D. Asks the server for the world's
 * summary every 20 s (radio-feed.ts; a minute while nobody's there, never while the tab is
 * hidden) and draws it. On a streamer night it also takes the listener's vote on the night.
 */

const WEATHER: Record<WeatherKind, string> = {
  clear: 'Clear',
  overcast: 'Overcast',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  storm: 'Storm',
  snow: 'Snow',
}
const MOOD_NOTE: Record<RotMood, string> = {
  calm: 'Quiet. Too quiet.',
  fog: 'Fog, and more of them in it.',
  hunting: 'Fast ones, hunting.',
  choir: 'The Choir sings.',
}
const MOODS = Object.keys(MOOD_VOTE_LABELS) as RotMood[]

const params = new URLSearchParams(location.search)
// The server checks it (unknown worlds go to the default one).
const world = params.get('world')?.trim().toLowerCase() || ''
const query = world ? `?world=${encodeURIComponent(world)}` : ''

const root = document.getElementById('radio') as HTMLElement

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

let feed: RadioFeed | null = null
let failed = false
let timer: ReturnType<typeof setTimeout> | null = null
let voteNote = ''

const votedKey = (night: number) => `radio-vote:${world || 'default'}:${night}`
function votedFor(night: number): string | null {
  try {
    return localStorage.getItem(votedKey(night))
  } catch {
    return null
  }
}

async function poll(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  try {
    const r = await fetch(RADIO_FEED_PATH + query, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(String(r.status))
    feed = (await r.json()) as RadioFeed
    failed = false
  } catch {
    failed = true
  }
  render()
  schedule()
}

function schedule(): void {
  if (document.visibilityState !== 'visible') return // visibilitychange picks it up again
  const wait = failed || (feed && feed.survivors === 0) ? RADIO_POLL_EMPTY_MS : RADIO_POLL_MS
  timer = setTimeout(() => void poll(), wait)
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void poll()
  else if (timer) {
    clearTimeout(timer)
    timer = null
  }
})

async function vote(mood: RotMood, night: number): Promise<void> {
  voteNote = '…'
  render()
  try {
    const r = await fetch(RADIO_VOTE_PATH + query, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood }),
    })
    const reply = (await r.json()) as RadioVoteReply
    if (reply.ok || reply.error === 'voted') {
      try {
        localStorage.setItem(votedKey(night), reply.ok ? mood : 'yes')
      } catch {}
    }
    if (reply.votes && feed?.votes) feed.votes = reply.votes
    voteNote = reply.ok
      ? 'Your vote is in. Wes will read it out at dusk.'
      : reply.error === 'voted'
        ? 'You already voted for this night.'
        : reply.error === 'off'
          ? 'Voting is closed.'
          : 'The line is busy. Try again later.'
  } catch {
    voteNote = 'No signal. Try again.'
  }
  render()
}

function stat(label: string, value: string, cls = ''): HTMLElement {
  const box = el('div', `radio-stat ${cls}`)
  box.append(el('div', 'radio-stat-label', label), el('div', 'radio-stat-value', value))
  return box
}

function render(): void {
  const f = feed
  const head = el('header', 'radio-head')
  const title = el('h1', '', 'RADIO FREE DEADWOOD')
  const sub = el('div', 'radio-sub')
  const dot = el('span', `radio-dot ${failed ? 'off' : 'on'}`)
  sub.append(
    dot,
    document.createTextNode(
      failed && !f ? 'No signal' : f ? `${f.name} · Night ${f.night}` : 'Tuning in…',
    ),
  )
  head.append(title, sub)
  const parts: HTMLElement[] = [head]

  if (f && !f.live) {
    parts.push(
      el('p', 'radio-empty', 'Nothing on this frequency. The server is not running Deadwood.'),
    )
  } else if (f) {
    const stats = el('section', 'radio-stats')
    stats.append(
      stat('Time', `${f.clock}`, f.phase === 'night' ? 'night' : ''),
      stat('Weather', WEATHER[f.weather] ?? f.weather),
      stat('Survivors', String(f.survivors)),
      stat('Day', String(f.day)),
    )
    parts.push(stats)

    // Haven: morale bar and the Red Night countdown.
    const haven = el('section', 'radio-card radio-haven')
    const bar = el('div', 'radio-bar')
    const fill = el('div', `radio-bar-fill ${f.morale < 30 ? 'low' : f.morale >= 70 ? 'high' : ''}`)
    fill.style.width = `${Math.max(0, Math.min(100, f.morale))}%`
    bar.append(fill)
    const red =
      f.redIn <= 0
        ? 'RED NIGHT TONIGHT. Get to the walls.'
        : f.redIn === 1
          ? 'Red Night tomorrow.'
          : `Red Night in ${f.redIn} days.`
    haven.append(
      el('h2', '', 'HAVEN'),
      el('div', 'radio-morale', `Morale: ${f.moraleWord} (${f.morale})`),
      bar,
      el('div', `radio-red ${f.redIn <= 0 ? 'now' : ''}`, red),
    )
    parts.push(haven)

    if (f.mood) {
      const mood = el('section', 'radio-card radio-mood')
      mood.append(
        el('h2', '', 'TONIGHT'),
        el('div', '', `${MOOD_VOTE_LABELS[f.mood]}. ${MOOD_NOTE[f.mood]}`),
      )
      parts.push(mood)
    }

    // The broadcast, newest first.
    const air = el('section', 'radio-card radio-air')
    air.append(el('h2', '', 'ON THE AIR · Wes Harlan'))
    if (f.lines.length === 0) air.append(el('p', 'radio-hiss', '…static. Just the hiss.'))
    const list = el('ol', 'radio-lines')
    for (const line of [...f.lines].reverse()) list.append(el('li', '', line))
    air.append(list)
    parts.push(air)

    if (f.votes) parts.push(voteCard(f.votes.night, f.votes.tally))

    if (f.dawn) {
      const dawn = el('section', 'radio-card radio-dawn')
      dawn.append(el('h2', '', 'DAWN REPORT'), el('div', 'radio-dawn-title', f.dawn.title))
      for (const line of f.dawn.lines) dawn.append(el('p', '', line))
      parts.push(dawn)
    }
  }

  const foot = el('footer', 'radio-foot')
  const join = el('a', 'radio-join', 'Join on a computer →')
  join.href = `/${query}`
  const age = el(
    'div',
    'radio-age',
    failed ? 'Lost the signal. Trying again…' : f ? 'Updates every 20 seconds.' : '',
  )
  foot.append(join, age)
  parts.push(foot)
  root.replaceChildren(...parts)
}

function voteCard(night: number, tally: Record<RotMood, number>): HTMLElement {
  const card = el('section', 'radio-card radio-vote')
  card.append(
    el('h2', '', `STREAMER NIGHT · VOTE NIGHT ${night}`),
    el('p', 'radio-vote-note', 'Pick what the Rot does next night. One vote each.'),
  )
  const mine = votedFor(night)
  const total = MOODS.reduce((n, m) => n + tally[m], 0)
  const row = el('div', 'radio-vote-row')
  for (const m of MOODS) {
    const b = el('button', `radio-vote-btn ${mine === m ? 'mine' : ''}`)
    b.type = 'button'
    b.disabled = mine !== null
    const pct = total ? Math.round((tally[m] / total) * 100) : 0
    b.append(
      el('span', '', MOOD_VOTE_LABELS[m]),
      el('span', 'radio-vote-count', `${tally[m]} · ${pct}%`),
    )
    b.addEventListener('click', () => void vote(m, night))
    row.append(b)
  }
  card.append(row)
  if (voteNote) card.append(el('p', 'radio-vote-note', voteNote))
  return card
}

render()
void poll()
