/**
 * Haven's community projects (apps/server/src/survival/projects.ts): things everybody in a world
 * builds together, by bringing materials to the project board. Once one is finished it stands for
 * good, does Haven a small lasting good, and a plaque on it names the people who built it.
 */

export type ProjectId = 'watchtower' | 'well' | 'wall' | 'greenhouse'

export interface ProjectDef {
  id: ProjectId
  name: string
  /** What it takes (item id → how many). */
  needs: Record<string, number>
  /** What it does for Haven once built (the board says so). */
  good: string
  /** Where it stands, in Haven's own coordinates. */
  at: [x: number, z: number]
}

export const PROJECTS: readonly ProjectDef[] = [
  {
    id: 'watchtower',
    name: 'The North Watchtower',
    needs: { planks: 24, scrap: 8, ducttape: 3 },
    good: 'A lookout over the gate road: on a Red Night the waves come further apart.',
    at: [-33.5, -26],
  },
  {
    id: 'well',
    name: 'The Well',
    needs: { scrap: 10, planks: 8, ducttape: 4 },
    good: 'Clean water close at hand: the days wear on Haven less.',
    at: [-35, 6],
  },
  {
    id: 'wall',
    name: 'The Outer Wall',
    needs: { planks: 36, scrap: 14 },
    good: 'A second palisade either side of the gate: the dead inside the wall cost Haven less.',
    at: [0, -35],
  },
  {
    id: 'greenhouse',
    name: 'The Greenhouse',
    needs: { planks: 16, electronics: 4, ducttape: 6 },
    good: 'Food grown at home: the traders charge a little less.',
    at: [36, 4],
  },
]

export const PROJECT_IDS = PROJECTS.map((p) => p.id)

export function projectDef(id: string): ProjectDef | undefined {
  return PROJECTS.find((p) => p.id === id)
}

/** The board for it, beside the morale board (Haven's coordinates), and its key. */
export const PROJECT_BOARD: [x: number, z: number] = [-4.6, -22.8]
export const PROJECT_BOARD_KEY = 'haven_projects'
/** What finishing one does for the camp's morale. */
export const PROJECT_MORALE = 10
/** Names on a plaque. */
export const PLAQUE_NAMES = 10
/** Effects, once built. */
export const WATCHTOWER_WAVE_GAP = 15
export const WELL_DAY_TOLL = 1
export const WALL_INSIDE = 0.75
export const GREENHOUSE_PRICE = 0.95

/** One project as the world keeps it (WorldSave.camp.projects). */
export interface ProjectSave {
  /** Item id → how many given so far. */
  given: Record<string, number>
  /** Character name → how many things they gave. */
  donors: Record<string, number>
  /** World day it was finished, or absent. */
  done?: number
}

export type ProjectsSave = Partial<Record<ProjectId, ProjectSave>>

/** One project as everybody sees it (CampShared.projects). */
export interface ProjectShared {
  id: ProjectId
  /** How many of each `needs` item are in, in the def's order. */
  given: number[]
  /** Finished (the world day). */
  done?: number
  /** The plaque: the most generous builders first (finished projects only). */
  names?: string[]
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0)

/** A saved record, read defensively: unknown projects and items are dropped. */
export function readProjects(raw: unknown): ProjectsSave {
  const out: ProjectsSave = {}
  if (!raw || typeof raw !== 'object') return out
  for (const def of PROJECTS) {
    const r = (raw as Record<string, unknown>)[def.id] as Partial<ProjectSave> | undefined
    if (!r || typeof r !== 'object') continue
    const given: Record<string, number> = {}
    for (const [item, n] of Object.entries(def.needs))
      given[item] = Math.min(n, Math.floor(count(r.given?.[item])))
    const donors: Record<string, number> = {}
    if (r.donors && typeof r.donors === 'object')
      for (const [name, n] of Object.entries(r.donors))
        if (typeof name === 'string' && count(n) > 0)
          donors[name.slice(0, 32)] = Math.floor(count(n))
    out[def.id] = {
      given,
      donors,
      ...(typeof r.done === 'number' && Number.isFinite(r.done) ? { done: r.done } : {}),
    }
  }
  return out
}

/** Whether everything it needs is in. */
export function projectFull(def: ProjectDef, save: ProjectSave | undefined): boolean {
  return Object.entries(def.needs).every(([item, n]) => (save?.given[item] ?? 0) >= n)
}

/** The builders, most generous first (ties: by name), at most `n`. */
export function plaqueNames(save: ProjectSave | undefined, n = PLAQUE_NAMES): string[] {
  return Object.entries(save?.donors ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name]) => name)
}

/** How far along it is, 0–1 (by count of things). */
export function projectProgress(def: ProjectDef, given: readonly number[]): number {
  const needs = Object.values(def.needs)
  const total = needs.reduce((a, b) => a + b, 0)
  const have = needs.reduce((a, n, i) => a + Math.min(n, given[i] ?? 0), 0)
  return total > 0 ? have / total : 1
}

/** Everybody's view of the projects. */
export function sharedProjects(save: ProjectsSave): ProjectShared[] {
  return PROJECTS.map((def) => {
    const s = save[def.id]
    return {
      id: def.id,
      given: Object.keys(def.needs).map((item) => s?.given[item] ?? 0),
      ...(s?.done !== undefined ? { done: s.done, names: plaqueNames(s) } : {}),
    }
  })
}
