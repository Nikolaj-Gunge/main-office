// Admin page (/admin): change the server's game rules live. Only imports types from shared —
// everything it needs (choices, ranges, defaults) comes from the server, so this page stays tiny.
import type { GameRules } from '@office-fps/shared'
import '@fontsource/pixelify-sans/400.css'
import '@fontsource/pixelify-sans/700.css'

interface AdminState {
  rules: GameRules
  choices: {
    maps: { id: string; name: string }[]
    skins: string[]
    jingles: string[]
    ranges: Record<string, { min: number; max: number; step: number }>
    defaults: GameRules
  }
  players: { id: number; name: string; kills: number; deaths: number; ping: number }[]
}

type NumericKey =
  | 'gravity'
  | 'speed'
  | 'jump'
  | 'playerScale'
  | 'spread'
  | 'recoil'
  | 'damage'
  | 'respawnSeconds'

const PASSWORD_KEY = 'office-fps:admin-password'
const TINY_SCALE = 0.5

const SLIDERS: { key: NumericKey; label: string; unit: string }[] = [
  { key: 'gravity', label: 'Gravity', unit: '×' },
  { key: 'jump', label: 'Jump power', unit: '×' },
  { key: 'speed', label: 'Run speed', unit: '×' },
  { key: 'playerScale', label: 'Body size', unit: '×' },
  { key: 'spread', label: 'Spread (0 = laser)', unit: '×' },
  { key: 'recoil', label: 'Recoil', unit: '×' },
  { key: 'damage', label: 'Damage', unit: '×' },
  { key: 'respawnSeconds', label: 'Respawn time', unit: 's' },
]

const SKIN_NAMES: Record<string, string> = {
  slime: 'Office slime',
  worker: 'Office worker',
  robot: 'Robot',
}
const JINGLE_NAMES: Record<string, string> = {
  off: 'Off (just the ding)',
  arcade: 'Arcade',
  fanfare: 'Fanfare',
  airhorn: 'Airhorn',
}

/** One-click combinations. Each starts from normal play (map, skin and jingle are kept). */
const PRESETS: { label: string; rules: Partial<GameRules> }[] = [
  { label: 'Normal', rules: {} },
  { label: 'Moon', rules: { gravity: 0.17 } },
  { label: 'Tiny people', rules: { playerScale: TINY_SCALE } },
  { label: 'Laser aim', rules: { spread: 0, recoil: 0 } },
  { label: 'One-shot', rules: { oneShot: true } },
  { label: 'Headshots only', rules: { headshotsOnly: true } },
  {
    label: 'Chaos',
    rules: {
      gravity: 0.35,
      speed: 1.5,
      playerScale: TINY_SCALE,
      oneShot: true,
      infiniteAmmo: true,
      respawnSeconds: 1,
    },
  },
]

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...children)
  return node
}

const root = document.querySelector<HTMLElement>('#admin')
if (!root) throw new Error('Missing #admin')

let password = sessionStorage.getItem(PASSWORD_KEY) ?? ''
let state: AdminState | null = null
let pending: Partial<GameRules> = {}
let sendTimer: ReturnType<typeof setTimeout> | null = null
const savedToast = h('div', { class: 'saved', role: 'status' }, 'Saved')
document.body.append(savedToast)

async function api(path: string, body?: unknown): Promise<AdminState> {
  const response = await fetch(`/admin/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${password}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as AdminState & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`)
  return data
}

function flashSaved(): void {
  savedToast.classList.add('show')
  setTimeout(() => savedToast.classList.remove('show'), 900)
}

/** Queues a rules change; sliders send at most a few times a second while dragging. */
function change(update: Partial<GameRules>, immediate = false): void {
  pending = { ...pending, ...update }
  if (state) state.rules = { ...state.rules, ...update }
  if (sendTimer) clearTimeout(sendTimer)
  // Sliders don't redraw the page (it would drop the slider you're dragging).
  sendTimer = setTimeout(() => flush(immediate), immediate ? 0 : 250)
}

async function flush(redraw: boolean): Promise<void> {
  const update = pending
  pending = {}
  sendTimer = null
  try {
    state = await api('rules', update)
    flashSaved()
    if (redraw) render()
  } catch (err) {
    showLogin((err as Error).message)
  }
}

function showLogin(error = ''): void {
  const input = h('input', {
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'Admin password',
    'aria-label': 'Admin password',
  })
  const status = h('div', { class: `status${error ? ' error' : ''}`, role: 'alert' }, error)
  const form = h('form', { class: 'login' }, input, h('button', { type: 'submit' }, 'Unlock'))
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    password = input.value
    status.className = 'status'
    status.textContent = 'Checking…'
    try {
      state = await api('state')
      sessionStorage.setItem(PASSWORD_KEY, password)
      render()
    } catch (err) {
      status.className = 'status error'
      status.textContent = (err as Error).message
    }
  })
  root?.replaceChildren(
    h('h1', {}, 'ADMIN'),
    h('p', { class: 'subtitle' }, 'Office FPS server controls'),
    h('section', { class: 'card' }, h('h2', {}, 'Log in'), form, status),
  )
  input.focus()
}

function choiceGroup(
  label: string,
  options: { id: string; name: string }[],
  current: string,
  onPick: (id: string) => void,
): HTMLElement {
  const group = h('div', { class: 'choices', role: 'group', 'aria-label': label })
  for (const option of options) {
    const button = h(
      'button',
      { type: 'button', 'aria-pressed': String(option.id === current) },
      option.name,
    )
    button.addEventListener('click', () => onPick(option.id))
    group.append(button)
  }
  return group
}

function card(title: string, hint: string | null, ...body: Node[]): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, title),
    ...(hint ? [h('p', { class: 'hint' }, hint)] : []),
    ...body,
  )
}

function render(): void {
  if (!state || !root) return
  const { rules, choices, players } = state

  const mapCard = card(
    'Map',
    'Switching reloads everyone into the new map (scores are kept).',
    choiceGroup('Map', choices.maps, rules.map, (id) => {
      if (id !== rules.map) change({ map: id }, true)
    }),
  )

  const skinCard = card(
    'Skin for everyone',
    null,
    choiceGroup(
      'Skin',
      choices.skins.map((id) => ({ id, name: SKIN_NAMES[id] ?? id })),
      rules.skin,
      (id) => change({ skin: id as GameRules['skin'] }, true),
    ),
  )

  const presets = h('div', { class: 'choices' })
  for (const preset of PRESETS) {
    const button = h('button', { type: 'button' }, preset.label)
    button.addEventListener('click', () => {
      const { map, skin, jingles, ...normal } = choices.defaults
      change({ ...normal, ...preset.rules }, true)
    })
    presets.append(button)
  }
  const presetCard = card('Presets', 'Each one starts from normal play.', presets)

  const toggle = (label: string, checked: boolean, onChange: (on: boolean) => void) => {
    const input = h('input', { type: 'checkbox' })
    input.checked = checked
    input.addEventListener('change', () => onChange(input.checked))
    return h('label', { class: 'toggle' }, input, label)
  }
  const toggles = h(
    'div',
    { class: 'toggles' },
    toggle('Tiny people', rules.playerScale <= TINY_SCALE, (on) =>
      change({ playerScale: on ? TINY_SCALE : 1 }, true),
    ),
    toggle('One-shot kills', rules.oneShot, (on) => change({ oneShot: on }, true)),
    toggle('Headshots only', rules.headshotsOnly, (on) => change({ headshotsOnly: on }, true)),
    toggle('Infinite ammo', rules.infiniteAmmo, (on) => change({ infiniteAmmo: on }, true)),
  )

  const sliders = h('div', { class: 'sliders' })
  for (const { key, label, unit } of SLIDERS) {
    const range = choices.ranges[key]
    if (!range) continue
    const id = `rule-${key}`
    const input = h('input', {
      id,
      type: 'range',
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
    })
    input.value = String(rules[key])
    const output = h('output', { for: id }, `${rules[key]}${unit}`)
    input.addEventListener('input', () => {
      const value = Number(input.value)
      output.textContent = `${value}${unit}`
      change({ [key]: value })
    })
    sliders.append(h('div', { class: 'slider' }, h('label', { for: id }, label), input, output))
  }
  const rulesCard = card('Rules', 'Changes apply to everyone instantly.', toggles, h('br'), sliders)

  const jingle = h('select', { 'aria-label': 'Kill jingle' })
  for (const id of choices.jingles) {
    const option = h('option', { value: id }, JINGLE_NAMES[id] ?? id)
    option.selected = id === rules.jingles
    jingle.append(option)
  }
  jingle.addEventListener('change', () =>
    change({ jingles: jingle.value as GameRules['jingles'] }, true),
  )
  const jingleCard = card(
    'Kill jingle',
    'Plays for whoever gets the kill; double and triple kills escalate.',
    jingle,
  )

  const table = h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Name'),
        h('th', { class: 'num' }, 'Kills'),
        h('th', { class: 'num' }, 'Deaths'),
        h('th', { class: 'num' }, 'Ping'),
      ),
    ),
    h(
      'tbody',
      {},
      ...players.map((p) =>
        h(
          'tr',
          {},
          h('td', {}, p.name),
          h('td', { class: 'num' }, String(p.kills)),
          h('td', { class: 'num' }, String(p.deaths)),
          h('td', { class: 'num' }, `${p.ping} ms`),
        ),
      ),
    ),
  )
  const reset = h('button', { type: 'button' }, 'Reset scores')
  reset.addEventListener('click', async () => {
    if (!confirm('Reset everyone’s kills and deaths to 0?')) return
    state = await api('reset-scores', {})
    flashSaved()
    render()
  })
  const refresh = h('button', { type: 'button' }, 'Refresh')
  refresh.addEventListener('click', async () => {
    state = await api('state')
    render()
  })
  const playersCard = card(
    `Players online (${players.length})`,
    null,
    h('div', { class: 'row' }, h('span', {}, ''), h('span', { class: 'choices' }, refresh, reset)),
    players.length ? table : h('p', { class: 'hint' }, 'Nobody is playing right now.'),
  )

  const logout = h('button', { type: 'button' }, 'Log out')
  logout.addEventListener('click', () => {
    sessionStorage.removeItem(PASSWORD_KEY)
    password = ''
    state = null
    showLogin()
  })

  root.replaceChildren(
    h('div', { class: 'row' }, h('h1', {}, 'ADMIN'), logout),
    h('p', { class: 'subtitle' }, 'Office FPS server controls — changes go live for everyone.'),
    mapCard,
    skinCard,
    presetCard,
    rulesCard,
    jingleCard,
    playersCard,
  )
}

if (password) {
  api('state')
    .then((s) => {
      state = s
      render()
    })
    .catch((err: Error) => showLogin(err.message))
} else {
  showLogin()
}
