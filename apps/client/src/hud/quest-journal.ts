import {
  endingOf,
  ITEMS,
  type Journal,
  noteText,
  noteTitle,
  PEOPLE,
  PERKS,
  QUESTS,
  type QuestDef,
  type QuestState,
  type Reward,
  STORY_TITLE,
  type SurvivalDef,
  stepApplies,
  UNLOCKS,
} from '@office-fps/shared'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
  text?: string,
) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  parent?.append(node)
  return node
}

export type JournalTab = 'quests' | 'notes' | 'people'
export const JOURNAL_TABS: JournalTab[] = ['quests', 'notes', 'people']

/** One row in a journal list: what it is, and how it's drawn. */
interface Entry {
  key: string
  label: string
  group: string
  state?: 'active' | 'done'
  draw: (into: HTMLElement) => void
}

/** "$60, Hiking backpack, Gus' prices drop" — what a quest pays, said short. */
export function rewardText(reward: Reward | undefined): string {
  if (!reward) return ''
  const parts: string[] = []
  if (reward.money) parts.push(`$${reward.money}`)
  for (const [item, n] of reward.items ?? [])
    parts.push(`${ITEMS[item]?.name ?? item}${n > 1 ? ` ×${n}` : ''}`)
  if (reward.reveals) parts.push('hidden stashes on your map')
  if (reward.perk) parts.push(PERKS[reward.perk] ?? reward.perk)
  if (reward.unlock) parts.push(UNLOCKS[reward.unlock] ?? reward.unlock)
  return parts.join(' · ')
}

/**
 * The journal (J): your quests (what you're doing, what you did, what you chose), the notes
 * and letters you've read, and the people of Haven. Drawn into the HUD's panel.
 */
export class QuestJournal {
  tab: JournalTab = 'quests'
  selected = 0
  private entries: Entry[] = []

  constructor(private readonly def: SurvivalDef) {}

  /** W/S, arrows and 1–3 move about; true if the key was the journal's. */
  key(code: string): boolean {
    const n = this.entries.length
    if (code === 'ArrowDown' || code === 'KeyS') this.selected = Math.min(n - 1, this.selected + 1)
    else if (code === 'ArrowUp' || code === 'KeyW') this.selected = Math.max(0, this.selected - 1)
    else if (code === 'ArrowRight' || code === 'KeyD') this.setTab(1)
    else if (code === 'ArrowLeft' || code === 'KeyA') this.setTab(-1)
    else if (code.startsWith('Digit')) {
      const tab = JOURNAL_TABS[Number(code.slice(5)) - 1]
      if (!tab) return false
      this.tab = tab
      this.selected = 0
    } else return false
    return true
  }

  private setTab(by: number): void {
    const i = JOURNAL_TABS.indexOf(this.tab)
    this.tab = JOURNAL_TABS[(i + by + JOURNAL_TABS.length) % JOURNAL_TABS.length] as JournalTab
    this.selected = 0
  }

  draw(panel: HTMLElement, journal: Journal, unlocks: readonly string[], redraw: () => void): void {
    panel.replaceChildren()
    const head = el('div', 'sv-panel-head', panel)
    el('b', '', head, `JOURNAL · ${STORY_TITLE.toUpperCase()}`)
    const tabs = el('div', 'sv-tabs', head)
    JOURNAL_TABS.forEach((tab, i) => {
      const node = el(
        'span',
        tab === this.tab ? 'sv-tab on' : 'sv-tab',
        tabs,
        `${i + 1} ${tab.toUpperCase()}`,
      )
      node.addEventListener('click', () => {
        this.tab = tab
        this.selected = 0
        redraw()
      })
    })
    const body = el('div', 'sv-panel-body', panel)
    const left = el('div', 'sv-col sv-journal-list', body)
    const right = el('div', 'sv-col sv-journal-page', body)

    this.entries =
      this.tab === 'quests'
        ? this.questEntries(journal)
        : this.tab === 'notes'
          ? this.noteEntries(journal)
          : this.peopleEntries(journal, unlocks)
    this.selected = Math.max(0, Math.min(this.entries.length - 1, this.selected))
    const list = el('div', 'sv-list', left)
    if (this.entries.length === 0)
      el(
        'div',
        'sv-row-name empty',
        list,
        this.tab === 'notes' ? 'Nothing read yet.' : 'Nothing yet.',
      )
    let group = ''
    this.entries.forEach((e, i) => {
      if (e.group !== group) {
        group = e.group
        el('div', 'sv-group', list, group)
      }
      const row = el('div', i === this.selected ? 'sv-row selected' : 'sv-row', list)
      el(
        'span',
        `sv-row-mark ${e.state ?? ''}`,
        row,
        e.state === 'done' ? '✓' : e.state === 'active' ? '▸' : '·',
      )
      el('span', e.state === 'done' ? 'sv-row-name faded' : 'sv-row-name', row, e.label)
      row.addEventListener('click', () => {
        this.selected = i
        redraw()
      })
    })
    el('div', 'sv-help', left, 'W/S select · A/D or 1–3 tab · J close')
    this.entries[this.selected]?.draw(right)
    const picked = list.querySelector('.selected')
    if (picked instanceof HTMLElement && picked.offsetTop + 40 > list.clientHeight)
      list.scrollTop = picked.offsetTop + 60 - list.clientHeight
  }

  // --- Quests ------------------------------------------------------------------------------

  private questEntries(j: Journal): Entry[] {
    const active = (story: boolean) =>
      j.quests
        .map((state) => ({ state, def: QUESTS.find((q) => q.id === state.id) }))
        .filter(
          (x): x is { state: QuestState; def: QuestDef } => !!x.def && !!x.def.story === story,
        )
    const done = (story: boolean) =>
      j.done
        .map((id) => QUESTS.find((q) => q.id === id))
        .filter((d): d is QuestDef => !!d && !!d.story === story)
    const pickOf = (id: string) => j.flags.find((f) => f.startsWith(`${id}:`))?.slice(id.length + 1)
    const entry = (def: QuestDef, group: string, state?: QuestState): Entry => ({
      key: def.id,
      label: def.title,
      group,
      state: state ? 'active' : 'done',
      draw: (into) =>
        this.drawQuest(into, def, state ?? null, j.notes, state?.pick ?? pickOf(def.id)),
    })
    const story = [...active(true).map((x) => entry(x.def, STORY_TITLE, x.state))]
    const chapters = done(true)
      .reverse()
      .map((d) => entry(d, STORY_TITLE))
    return [
      ...story,
      ...chapters,
      ...active(false).map((x) => entry(x.def, 'Jobs', x.state)),
      ...done(false)
        .reverse()
        .map((d) => entry(d, 'Done')),
    ]
  }

  private drawQuest(
    into: HTMLElement,
    def: QuestDef,
    state: QuestState | null,
    notes: readonly string[],
    pick?: string,
  ): void {
    const chapter = def.story ? QUESTS.filter((q) => q.story).indexOf(def) + 1 : 0
    el('div', 'sv-page-kind', into, def.story ? `CHAPTER ${chapter}` : 'JOB')
    el('div', 'sv-page-title', into, def.title)
    const giver = def.giver ? PEOPLE[def.giver]?.name : null
    if (giver) el('div', 'sv-page-from', into, `From ${giver}`)
    el('div', 'sv-page-text', into, def.summary)
    el('div', 'sv-group', into, state ? 'Objectives' : 'What happened')
    const steps = el('div', 'sv-steps', into)
    def.steps.forEach((step, i) => {
      if (!stepApplies(step, pick)) return
      const reached = state ? i < state.step : true
      const now = state !== null && i === state.step
      if (!reached && !now) return
      el('div', now ? 'sv-step now' : 'sv-step done', steps, `${now ? '▸' : '✓'} ${step.text}`)
      if (step.kind === 'choose' && pick) {
        const chosen = step.options.find((o) => o.id === pick)
        if (chosen && (reached || !now))
          el('div', 'sv-step choice', steps, `You chose: "${chosen.label}"`)
      }
    })
    if (state) {
      const step = def.steps[state.step]
      if (step?.clue && !notes.includes(step.clue))
        el('div', 'sv-page-hint', into, 'No marker until you find something that points the way.')
      else if (step?.rough)
        el('div', 'sv-page-hint', into, 'You know roughly where. The search area is on your map.')
      // On a quest with a choice, what it pays depends on what you choose.
      const pay = def.endings ? '' : rewardText(def.reward)
      if (pay) el('div', 'sv-page-reward', into, `Reward: ${pay}`)
    } else {
      const end = endingOf(def, pick)
      el('div', 'sv-page-text ending', into, end.done)
      const pay = rewardText(end.reward)
      if (pay) el('div', 'sv-page-reward', into, `Earned: ${pay}`)
    }
  }

  // --- Notes ---------------------------------------------------------------------------------

  private noteEntries(j: Journal): Entry[] {
    return [...j.notes].reverse().map((key) => ({
      key,
      label: noteTitle(this.def, key),
      group: 'Read',
      draw: (into) => {
        const paper = el('div', 'sv-paper', into)
        el('div', 'sv-paper-title', paper, noteTitle(this.def, key))
        el('div', 'sv-paper-text', paper, noteText(this.def, key))
      },
    }))
  }

  // --- People ------------------------------------------------------------------------------

  private peopleEntries(j: Journal, unlocks: readonly string[]): Entry[] {
    const here = new Set(this.def.npcs.map((n) => n.key))
    if (unlocks.includes('nell')) here.add('nell')
    const out: Entry[] = []
    for (const [key, who] of Object.entries(PEOPLE)) {
      // Hollis: only once you know who he was.
      if (!here.has(key) && !(key === 'hollis' && j.notes.includes('hollis_locker'))) continue
      out.push({
        key,
        label: who.name,
        group: key === 'hollis' ? 'Gone' : 'Haven',
        draw: (into) => {
          el('div', 'sv-page-title', into, who.name)
          el('div', 'sv-page-text', into, who.bio)
          const jobs = QUESTS.filter((q) => q.giver === key)
          if (jobs.length > 0) {
            el('div', 'sv-group', into, 'Jobs')
            for (const q of jobs) {
              const state = j.done.includes(q.id)
                ? 'done'
                : j.quests.some((x) => x.id === q.id)
                  ? 'active'
                  : 'open'
              el(
                'div',
                `sv-step ${state === 'done' ? 'done' : state === 'active' ? 'now' : 'later'}`,
                into,
                `${state === 'done' ? '✓' : state === 'active' ? '▸' : '·'} ${q.title}`,
              )
            }
          }
        },
      })
    }
    // What Haven and its people do for you now.
    const perks = j.flags.filter((f) => PERKS[f])
    if (unlocks.length > 0 || perks.length > 0)
      out.push({
        key: 'haven',
        label: 'What Haven has now',
        group: 'Haven',
        draw: (into) => {
          el('div', 'sv-page-title', into, 'Haven')
          for (const u of unlocks)
            if (UNLOCKS[u]) el('div', 'sv-step done', into, `◆ ${UNLOCKS[u]}`)
          for (const f of perks) el('div', 'sv-step now', into, `◇ ${PERKS[f]}`)
          el(
            'div',
            'sv-page-hint',
            into,
            'What the world gains stays when you die. What people owe you does not.',
          )
        },
      })
    return out
  }
}
