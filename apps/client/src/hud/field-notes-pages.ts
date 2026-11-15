import {
  ACHIEVEMENTS,
  COSMETICS,
  type CosmeticKind,
  type FieldNotes,
  isoWeek,
  weekIndex,
  weekNotes,
} from '@office-fps/shared'
import type { Entry } from './quest-journal.ts'
import { downloadCard, drawBanner, drawShareCard } from './share-card.ts'

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

const KIND_NAMES: Record<CosmeticKind, string> = {
  hat: 'Hats',
  jacket: 'Jackets',
  wrap: 'Gun wraps',
  banner: 'Camp banners',
}

const DAY_MS = 86_400_000

/**
 * The journal's Field Notes tab: this week's seven notes, and the wardrobe of cosmetics they paid
 * (put one on and others see it: hats and jackets; wraps show on your guns).
 */
export function fieldEntries(
  notes: FieldNotes,
  now: number,
  wear: (kind: CosmeticKind, id: string | null) => void,
): Entry[] {
  const week = weekNotes(weekIndex(now))
  const current = notes.week === weekIndex(now)
  const done = (id: string) => current && notes.done.includes(id)
  const progress = (id: string) => (current ? (notes.progress[id] ?? 0) : 0)
  const { week: number } = isoWeek(now)
  const daysLeft = Math.ceil((weekIndex(now) + 1) * 7 - 3 - now / DAY_MS)
  const group = `Week ${number} · ${week.filter((n) => done(n.id)).length}/${week.length}`
  const out: Entry[] = week.map((n) => ({
    key: n.id,
    label: n.text,
    group,
    ...(done(n.id)
      ? { state: 'done' as const }
      : progress(n.id) > 0
        ? { state: 'active' as const }
        : {}),
    draw: (into) => {
      el('div', 'sv-page-kind', into, `FIELD NOTE · WEEK ${number}`)
      el('div', 'sv-page-title', into, n.text)
      const shown = n.event === 'drive_m' ? (x: number) => `${(x / 1000).toFixed(1)} km` : String
      const have = done(n.id) ? n.need : progress(n.id)
      const bar = el('div', 'fn-bar', into)
      const fill = el('div', 'fn-bar-fill', bar)
      fill.style.width = `${Math.round((have / n.need) * 100)}%`
      el('div', 'sv-page-text', into, `${shown(have)} / ${shown(n.need)}`)
      el(
        'div',
        `sv-page-reward${notes.owned.includes(n.reward.id) ? ' fn-owned' : ''}`,
        into,
        `${done(n.id) ? 'Earned' : 'Pays'}: ${n.reward.name} (${KIND_NAMES[n.reward.kind].toLowerCase().replace(/s$/, '')})`,
      )
      el(
        'div',
        'sv-page-hint',
        into,
        `Do it any day this week: what you've done keeps. ${daysLeft} day${daysLeft === 1 ? '' : 's'} left. Things from past weeks come round again.`,
      )
    },
  }))
  for (const kind of ['hat', 'jacket', 'wrap', 'banner'] as const) {
    const all = COSMETICS.filter((c) => c.kind === kind)
    const owned = all.filter((c) => notes.owned.includes(c.id))
    const on = notes.wear[kind]
    out.push({
      key: `wear:${kind}`,
      label: `${KIND_NAMES[kind]} (${owned.length}/${all.length})`,
      group: 'Wardrobe',
      ...(on ? { state: 'active' as const } : {}),
      draw: (into) => {
        el('div', 'sv-page-kind', into, 'WARDROBE')
        el('div', 'sv-page-title', into, KIND_NAMES[kind])
        const list = el('div', 'fn-wardrobe', into)
        const row = (id: string | null, name: string) => {
          const r = el('div', `fn-item${(on ?? null) === id ? ' on' : ''}`, list)
          if (kind === 'banner' && id) {
            const swatch = el('canvas', 'fn-swatch', r)
            swatch.width = 48
            swatch.height = 60
            const ctx = swatch.getContext('2d')
            if (ctx)
              drawBanner(
                ctx,
                COSMETICS.find((c) => c.id === id),
                12,
                4,
                2.4,
              )
          } else if (kind === 'wrap' && id) {
            const swatch = el('span', 'fn-chip', r)
            const tint = COSMETICS.find((c) => c.id === id)?.tint ?? 0
            swatch.style.background = `#${tint.toString(16).padStart(6, '0')}`
          }
          el('span', 'fn-item-name', r, name)
          el('span', 'fn-item-mark', r, (on ?? null) === id ? 'WEARING' : '')
          r.addEventListener('click', () => wear(kind, id))
        }
        row(null, 'Nothing')
        for (const c of owned) row(c.id, c.name)
        if (owned.length === 0)
          el('div', 'sv-page-hint', into, 'Nothing yet. Field Notes pay these out, one a note.')
        else if (owned.length < all.length)
          el(
            'div',
            'sv-page-hint',
            into,
            `${all.length - owned.length} more come round in other weeks.`,
          )
        if (kind === 'hat' || kind === 'jacket')
          el('div', 'sv-page-hint', into, 'Shows over what you wear. Changes nothing else.')
      },
    })
  }
  return out
}

/**
 * The journal's Record tab: the share card, and the Survival Journal's entries (earned ones
 * with their story, the rest with how far along you are).
 */
export function recordEntries(
  notes: FieldNotes,
  now: number,
  who: string,
  player: string,
): Entry[] {
  const out: Entry[] = [
    {
      key: 'card',
      label: 'Share card',
      group: 'Share',
      draw: (into) => {
        el('div', 'sv-page-kind', into, 'SURVIVAL JOURNAL')
        const canvas = el('canvas', 'fn-card', into)
        drawShareCard(canvas, { who, player, notes, now })
        const button = el('button', 'fn-download', into, 'Download PNG')
        button.addEventListener('click', () => downloadCard(canvas, who))
      },
    },
  ]
  const got = new Map(notes.got)
  const earned = ACHIEVEMENTS.filter((a) => got.has(a.id)).sort(
    (a, b) => (got.get(b.id) ?? 0) - (got.get(a.id) ?? 0),
  )
  for (const a of earned)
    out.push({
      key: a.id,
      label: a.title,
      group: `Written (${earned.length}/${ACHIEVEMENTS.length})`,
      state: 'done',
      draw: (into) => {
        el('div', 'sv-page-kind', into, 'SURVIVAL JOURNAL')
        el('div', 'sv-page-title', into, a.title)
        el('div', 'sv-paper-text fn-story', into, a.story)
        const when = new Date(got.get(a.id) ?? now)
        el('div', 'sv-page-hint', into, `Written ${when.toLocaleDateString()}`)
      },
    })
  for (const a of ACHIEVEMENTS) {
    if (got.has(a.id)) continue
    const have = Math.min(a.need, notes.stats[a.stat] ?? 0)
    out.push({
      key: a.id,
      label: a.title,
      group: 'Not yet',
      draw: (into) => {
        el('div', 'sv-page-kind', into, 'SURVIVAL JOURNAL')
        el('div', 'sv-page-title', into, a.title)
        el('div', 'sv-page-hint', into, 'Not written yet. Live it first.')
        if (a.need > 1) {
          const shown = a.stat === 'drive_m' ? (x: number) => `${Math.floor(x / 1000)} km` : String
          el('div', 'sv-page-text', into, `${shown(have)} / ${shown(a.need)}`)
        }
      },
    })
  }
  return out
}
