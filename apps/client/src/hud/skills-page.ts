import {
  ITEMS,
  MAX_SKILL_LEVEL,
  SKILL_IDS,
  SKILLS,
  type SkillId,
  type Skills,
  skillProgress,
} from '@office-fps/shared'
import type { Entry } from './quest-journal.ts'

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

/** A level bar: five pips, the one being worked on filling up. */
function levelBar(into: HTMLElement, skills: Skills | null, id: SkillId, picked: boolean): void {
  const { level, to } = skillProgress(skills ?? undefined, id)
  const row = el('div', picked ? 'sk-row picked' : 'sk-row', into)
  el('span', 'sk-name', row, SKILLS[id].name)
  const pips = el('span', 'sk-pips', row)
  for (let i = 0; i < MAX_SKILL_LEVEL; i++) {
    const pip = el('i', i < level ? 'sk-pip full' : 'sk-pip', pips)
    if (i === level && level < MAX_SKILL_LEVEL) {
      const fill = el('b', 'sk-pip-fill', pip)
      fill.style.width = `${Math.round(to * 100)}%`
    }
  }
  el('span', 'sk-level', row, String(level))
  const left = skills?.read?.[id]
  if (left) el('span', 'sk-boost', row, `×3 ${Math.ceil(left / 60)}m`)
}

/**
 * The journal's Skills tab: what this character has learned by doing (skills.ts), as level bars,
 * and on the page what each skill does and how it's learned. Lost with the character.
 */
export function skillEntries(skills: Skills | null): Entry[] {
  return SKILL_IDS.map((id) => {
    const info = SKILLS[id]
    const { level } = skillProgress(skills ?? undefined, id)
    return {
      key: id,
      label: `${info.name} ${level}`,
      group: 'Learned by doing',
      ...(level >= MAX_SKILL_LEVEL
        ? { state: 'done' as const }
        : level > 0
          ? { state: 'active' as const }
          : {}),
      draw: (into) => {
        el('div', 'sv-page-kind', into, 'SKILLS · THIS CHARACTER')
        const bars = el('div', 'sk-bars', into)
        for (const other of SKILL_IDS) levelBar(bars, skills, other, other === id)
        el('div', 'sv-page-title', into, `${info.name} — level ${level} of ${MAX_SKILL_LEVEL}`)
        el('div', 'sv-page-text', into, `${info.learn} ${info.gives}`)
        const left = skills?.read?.[id]
        el(
          'div',
          'sv-page-hint',
          into,
          left
            ? `You read the manual: three times as fast for another ${Math.ceil(left / 60)} minutes.`
            : `A field manual (${ITEMS[info.manual]?.name ?? info.manual}) would make it come three times as fast for half an hour. Look in houses, offices and police stations.`,
        )
        el('div', 'sv-page-hint', into, 'What you learn dies with you.')
      },
    }
  })
}
