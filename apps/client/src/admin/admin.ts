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
    spawnWeapons: string[]
    botSkills: string[]
    modes: { id: string; name: string }[]
    ranges: Record<string, { min: number; max: number; step: number }>
    defaults: GameRules
  }
  players: {
    id: number
    name: string
    kills: number
    deaths: number
    ping: number
    bot: boolean
    alive: boolean
  }[]
  /** Today's Cloudflare request use (server budget.ts); null on servers without it. */
  budget: {
    day: string
    messages: number
    http: number
    usedToday: number
    freeLimit: number
    pct: number
    resting: boolean
  } | null
  bans: { name: string; ip?: string; reason: string; at: number }[]
  /** Survival's named places (teleport targets). */
  places: { key: string; name: string }[]
  survival: {
    time: number
    weather: string | null
    pinned: string | null
    weathers: string[]
    items: { id: string; name: string }[]
  } | null
  errorCount: number
}

interface ReportedError {
  at: number
  source: string
  message: string
  stack?: string
  context?: string
  count: number
}

/** Survival times of day to jump to (the day's clock, 0–1: see shared daytime.ts). */
const TIMES: { label: string; t: number }[] = [
  { label: 'Midnight', t: 0.15 },
  { label: 'Dawn', t: 0.41 },
  { label: 'Noon', t: 0.62 },
  { label: 'Dusk', t: 0.89 },
]

type NumericKey =
  | 'gravity'
  | 'speed'
  | 'jump'
  | 'playerScale'
  | 'spread'
  | 'recoil'
  | 'damage'
  | 'respawnSeconds'
  | 'bots'
  | 'timeLimit'
  | 'scoreLimit'

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

const SPAWN_WEAPON_NAMES: Record<string, string> = {
  none: 'Handgun only',
  rifle: '+ Rifle',
  sniper: '+ Sniper',
  shotgun: '+ Shotgun',
  mp5: '+ MP5',
  lmg: '+ LMG',
  random: '+ Random',
}

/** One-click combinations. Each starts from normal play (map, skin, loadout, jingle kept). */
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
      // URI-encoded: headers can't carry æ, ø, å reliably (the server decodes it).
      'X-Admin-Password': encodeURIComponent(password),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? null : JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as AdminState & { error?: string }
  if (!response.ok) {
    throw Object.assign(new Error(data.error ?? `Error ${response.status}`), {
      status: response.status,
    })
  }
  return data
}

/** A moderation / survival tool: redraws on success, says what went wrong otherwise. */
async function act(path: string, body: unknown): Promise<void> {
  try {
    state = await api(path, body)
    flashSaved()
    render()
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401 || status === 429) showLogin((err as Error).message)
    else alert((err as Error).message)
  }
}

let errors: ReportedError[] = []

async function loadErrors(): Promise<void> {
  try {
    const data = (await api('errors')) as unknown as { errors: ReportedError[] }
    errors = data.errors
    render()
  } catch {
    // The state request reports login trouble; this one stays quiet.
  }
}

/** "3 min ago" for an error's time. */
function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

/** Night, dawn, day or dusk for the day's clock (thresholds as in shared daytime.ts). */
function phaseText(t: number): string {
  if (t < 0.4 || t >= 0.96) return 'Night'
  if (t < 0.48) return 'Dawn'
  return t < 0.88 ? 'Day' : 'Dusk'
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
      void loadErrors()
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
  const { rules, choices, players, places } = state

  const mapCard = card(
    'Map',
    'Switching reloads everyone into the new map (scores are kept).',
    choiceGroup('Map', choices.maps, rules.map, (id) => {
      if (id !== rules.map) change({ map: id }, true)
    }),
  )

  /** A labelled slider that sends its value (debounced) as `key`. */
  const slider = (key: NumericKey, label: string, unit: string) => {
    const range = choices.ranges[key]
    const id = `rule-${key}`
    const input = h('input', {
      id,
      type: 'range',
      min: String(range?.min ?? 0),
      max: String(range?.max ?? 1),
      step: String(range?.step ?? 1),
    })
    input.value = String(rules[key])
    const output = h('output', { for: id }, `${rules[key]}${unit}`)
    input.addEventListener('input', () => {
      output.textContent = `${input.value}${unit}`
      change({ [key]: Number(input.value) })
    })
    return h('div', { class: 'slider' }, h('label', { for: id }, label), input, output)
  }
  const rotation = h('input', { type: 'checkbox' })
  rotation.checked = rules.mapRotation
  rotation.addEventListener('change', () => change({ mapRotation: rotation.checked }, true))
  const newRound = h('button', { type: 'button' }, 'Start new round')
  newRound.addEventListener('click', async () => {
    state = await api('new-round', {})
    flashSaved()
    render()
  })
  const modeCard = card(
    'Game mode',
    'Switching mode starts a new round. A round ends on time or when the score limit is reached, shows the winner, then the next one starts. Zombies is co-op on one of the co-op maps (Outbreak, Dead Mall, Last Train — pick one under Map): the bot difficulty sets how tough the horde is, and bots fight on your team.',
    choiceGroup('Game mode', choices.modes, rules.mode, (id) => {
      if (id !== rules.mode) change({ mode: id as GameRules['mode'] }, true)
    }),
    h('br'),
    h(
      'div',
      { class: 'sliders' },
      slider('timeLimit', 'Round time', ' min'),
      slider('scoreLimit', 'Score limit', ' kills'),
    ),
    h('br'),
    h(
      'div',
      { class: 'row' },
      h('label', { class: 'toggle' }, rotation, 'Next map after every round'),
      newRound,
    ),
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

  const loadoutCard = card(
    'Spawn with',
    'Everyone always has the handgun. Applies from each player’s next spawn.',
    choiceGroup(
      'Spawn weapon',
      choices.spawnWeapons.map((id) => ({ id, name: SPAWN_WEAPON_NAMES[id] ?? id })),
      rules.spawnWeapon,
      (id) => change({ spawnWeapon: id as GameRules['spawnWeapon'] }, true),
    ),
  )

  const botCount = h('input', {
    id: 'rule-bots',
    type: 'range',
    min: '0',
    max: String(choices.ranges.bots?.max ?? 10),
    step: '1',
  })
  botCount.value = String(rules.bots)
  const botOutput = h('output', { for: 'rule-bots' }, String(rules.bots))
  botCount.addEventListener('input', () => {
    botOutput.textContent = botCount.value
    change({ bots: Number(botCount.value) })
  })
  const botsCard = card(
    'Bots',
    'Bots play along like people: they roam, spot you, react and shoot. They make room when people join.',
    h(
      'div',
      { class: 'slider' },
      h('label', { for: 'rule-bots' }, 'Number of bots'),
      botCount,
      botOutput,
    ),
    h('br'),
    choiceGroup(
      'Bot skill',
      choices.botSkills.map((id) => ({ id, name: id[0]?.toUpperCase() + id.slice(1) })),
      rules.botSkill,
      (id) => change({ botSkill: id as GameRules['botSkill'] }, true),
    ),
  )

  const presets = h('div', { class: 'choices' })
  for (const preset of PRESETS) {
    const button = h('button', { type: 'button' }, preset.label)
    button.addEventListener('click', () => {
      const {
        map,
        skin,
        jingles,
        spawnWeapon,
        bots,
        botSkill,
        mode,
        timeLimit,
        scoreLimit,
        mapRotation,
        showDamage,
        ...normal
      } = choices.defaults
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
    toggle('Show damage numbers', rules.showDamage, (on) => change({ showDamage: on }, true)),
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

  const people = players.filter((p) => !p.bot)
  /** Per-person tools: kick, ban, teleport, start over (survival). Bots get none. */
  const actions = (p: AdminState['players'][number]) => {
    if (p.bot) return h('td', {})
    const kick = h('button', { type: 'button', class: 'small' }, 'Kick')
    kick.addEventListener('click', () => {
      const reason = prompt(`Kick ${p.name}? Reason (shown to them):`, '')
      if (reason !== null) void act('kick', { id: p.id, reason })
    })
    const ban = h('button', { type: 'button', class: 'small danger' }, 'Ban')
    ban.addEventListener('click', () => {
      const reason = prompt(`Ban ${p.name}? Reason (shown to them):`, '')
      if (reason !== null) void act('ban', { id: p.id, reason })
    })
    const go = h('select', { class: 'small', 'aria-label': `Teleport ${p.name}` })
    go.append(h('option', { value: '' }, 'Teleport…'))
    if (places.length) {
      const group = h('optgroup', { label: 'Places' })
      for (const place of places)
        group.append(h('option', { value: `place:${place.key}` }, place.name))
      go.append(group)
    }
    const others = players.filter((o) => o.id !== p.id && o.alive)
    if (others.length) {
      const group = h('optgroup', { label: 'To player' })
      for (const o of others) group.append(h('option', { value: `to:${o.id}` }, o.name))
      go.append(group)
    }
    go.disabled = !p.alive
    go.addEventListener('change', () => {
      const [kind, target] = go.value.split(':')
      if (kind === 'place') void act('teleport', { id: p.id, place: target })
      if (kind === 'to') void act('teleport', { id: p.id, to: Number(target) })
    })
    const tools: Node[] = [kick, ban, go]
    if (state?.survival) {
      const reset = h('button', { type: 'button', class: 'small' }, 'Start over')
      reset.addEventListener('click', () => {
        if (confirm(`Wipe ${p.name}'s character (pockets, kit, journal) and start them over?`))
          void act('reset-character', { id: p.id })
      })
      tools.push(reset)
    }
    return h('td', {}, h('div', { class: 'actions' }, ...tools))
  }
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
        h('th', {}, ''),
      ),
    ),
    h(
      'tbody',
      {},
      ...players.map((p) =>
        h(
          'tr',
          {},
          h('td', {}, p.bot ? `${p.name} (bot)` : p.alive ? p.name : `${p.name} (dead)`),
          h('td', { class: 'num' }, String(p.kills)),
          h('td', { class: 'num' }, String(p.deaths)),
          h('td', { class: 'num' }, p.bot ? '—' : `${p.ping} ms`),
          actions(p),
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
    void loadErrors()
    render()
  })
  const playersCard = card(
    `Players online (${players.length})`,
    'Kick and ban show the reason to the player. A ban keeps the name (and their address, where known) out until lifted.',
    h('div', { class: 'row' }, h('span', {}, ''), h('span', { class: 'choices' }, refresh, reset)),
    players.length ? table : h('p', { class: 'hint' }, 'Nobody is playing right now.'),
  )

  const budgetCard = state.budget ? renderBudget(state.budget) : null
  const message = h('input', {
    type: 'text',
    maxlength: '200',
    placeholder: 'Server restarting in 5 minutes',
    'aria-label': 'Message to everyone',
  })
  const messageForm = h(
    'form',
    { class: 'login' },
    message,
    h('button', { type: 'submit' }, 'Send to all'),
  )
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault()
    if (message.value.trim()) void act('broadcast', { text: message.value })
  })
  const messageCard = card(
    'Message everyone',
    'Shows as a line in the survival notice feed ("Server: …").',
    messageForm,
  )

  const cards: Node[] = []
  const sv = state.survival
  if (sv) {
    const times = h('div', { class: 'choices' })
    for (const { label, t } of TIMES) {
      const button = h('button', { type: 'button' }, label)
      button.addEventListener('click', () => void act('time', { time: t }))
      times.append(button)
    }
    const weather = choiceGroup(
      'Weather',
      [
        { id: '', name: 'As it comes' },
        ...sv.weathers.map((w) => ({ id: w, name: w[0]?.toUpperCase() + w.slice(1) })),
      ],
      sv.pinned ?? '',
      (id) => void act('weather', { kind: id || null }),
    )
    const who = h('select', { 'aria-label': 'Give to' })
    for (const p of people) who.append(h('option', { value: String(p.id) }, p.name))
    const item = h('select', { 'aria-label': 'Item' })
    for (const i of sv.items) item.append(h('option', { value: i.id }, i.name))
    const count = h('input', {
      type: 'number',
      min: '1',
      max: '999',
      value: '1',
      class: 'count',
      'aria-label': 'How many',
    })
    const give = h(
      'form',
      { class: 'give' },
      who,
      item,
      count,
      h('button', { type: 'submit' }, 'Give'),
    )
    give.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!who.value) return alert('Nobody to give it to.')
      void act('give', { id: Number(who.value), item: item.value, n: Number(count.value) })
    })
    cards.push(
      card(
        'Survival tools',
        `Now: ${phaseText(sv.time)} (${sv.time.toFixed(2)}), ${sv.weather ?? 'clear'}${sv.pinned ? ' (held)' : ''}. Time only winds forward; the weather clock moves with it.`,
        h('h3', {}, 'Time of day'),
        times,
        h('h3', {}, 'Weather'),
        weather,
        h('h3', {}, 'Give'),
        people.length ? give : h('p', { class: 'hint' }, 'Nobody to give anything to.'),
      ),
    )
  }

  if (state.bans.length) {
    const list = h('ul', { class: 'list' })
    for (const b of state.bans) {
      const lift = h('button', { type: 'button', class: 'small' }, 'Unban')
      lift.addEventListener('click', () => void act('unban', { name: b.name }))
      list.append(
        h(
          'li',
          {},
          h(
            'span',
            {},
            h('strong', {}, b.name),
            ` — ${b.reason}`,
            h('span', { class: 'meta' }, ` ${b.ip ?? ''} ${ago(b.at)}`),
          ),
          lift,
        ),
      )
    }
    cards.push(card(`Bans (${state.bans.length})`, null, list))
  }

  const errorList = h('ul', { class: 'list errors' })
  for (const e of errors) {
    errorList.append(
      h(
        'li',
        {},
        h(
          'details',
          {},
          h(
            'summary',
            {},
            h('span', { class: `tag ${e.source}` }, e.source),
            ` ${e.message}`,
            h('span', { class: 'meta' }, ` ×${e.count} · ${ago(e.at)}`),
          ),
          ...(e.context ? [h('p', { class: 'meta' }, e.context)] : []),
          ...(e.stack ? [h('pre', {}, e.stack)] : []),
        ),
      ),
    )
  }
  const reload = h('button', { type: 'button' }, 'Reload')
  reload.addEventListener('click', () => void loadErrors())
  const errorsCard = card(
    `Errors (${errors.length})`,
    'The last 50 from the server and players’ browsers, newest first. Repeats are counted.',
    h('div', { class: 'row' }, h('span', {}, ''), reload),
    errors.length ? errorList : h('p', { class: 'hint' }, 'Nothing has gone wrong. Yet.'),
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
    modeCard,
    mapCard,
    skinCard,
    loadoutCard,
    botsCard,
    presetCard,
    rulesCard,
    jingleCard,
    playersCard,
    ...(budgetCard ? [budgetCard] : []),
    ...cards,
    messageCard,
    errorsCard,
  )
}

/** Requests used today against the free plan's daily allowance. */
function renderBudget(budget: NonNullable<AdminState['budget']>): HTMLElement {
  const n = (x: number) => x.toLocaleString('en-US')
  const limited = budget.freeLimit > 0
  const summary = limited
    ? `${n(budget.usedToday)} of ${n(budget.freeLimit)} requests (${budget.pct}%)`
    : `${n(budget.usedToday)} requests (no daily limit set)`
  const bar = h('div', {
    style:
      'height:10px;border:1px solid currentColor;margin:8px 0;' +
      `background:linear-gradient(90deg,${budget.resting ? '#b33831' : '#e0a458'} ` +
      `${Math.min(100, budget.pct)}%,transparent 0)`,
  })
  return card(
    'Free plan budget today',
    'Cloudflare meters each HTTP request and every 20 messages players send. At 95% of the ' +
      'limit new players are told the servers are resting; the count resets at midnight UTC.',
    h('p', {}, summary),
    ...(limited ? [bar] : []),
    h(
      'p',
      { class: 'hint' },
      `${budget.day} UTC · ${n(budget.messages)} messages · ${n(budget.http)} HTTP requests` +
        (budget.resting ? ' · new joins are turned away' : ''),
    ),
  )
}

if (password) {
  api('state')
    .then((s) => {
      state = s
      render()
      void loadErrors()
    })
    .catch((err: Error) => showLogin(err.message))
} else {
  showLogin()
}
