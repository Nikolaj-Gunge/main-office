import { WORLD_HALF, WORLD_SIZE } from './types.ts'

/**
 * The map you draw yourself (apps/server/src/survival/chart.ts): Deadwood starts blank on every
 * character's map, and fills in, a square at a time, where they have walked. Places they set foot
 * in get inked. A character's map is lost with them; the account keeps a faded copy of every map
 * its characters ever drew (the "old map"), shown in pencil under a new one.
 *
 * The squares are a bitset, one bit per CHART_CELL square, sent and saved as base64.
 */

/** One square of the map (m). */
export const CHART_CELL = 32
/** Squares along a side. */
export const CHART_GRID = WORLD_SIZE / CHART_CELL
/** Bytes in a chart. */
export const CHART_BYTES = (CHART_GRID * CHART_GRID) / 8
/** How far around you the map fills in as you walk (m). */
export const CHART_REVEAL = 80
/** Shares of the county charted that are worth telling (and writing in the journal). */
export const CHART_MILESTONES = [0.05, 0.1, 0.25, 0.5] as const

/** A character's own map (SurvivalSelf.chart): saved with the character. */
export interface Chart {
  /** The squares seen (base64 bitset, CHART_BYTES). */
  seen: string
  /** Places set foot in (poi keys): inked on the map. */
  inked: string[]
}

export const emptyBits = (): Uint8Array => new Uint8Array(CHART_BYTES)

/** The square a world point falls in, or -1 off the map. */
export function chartCell(x: number, z: number): number {
  const cx = Math.floor((x + WORLD_HALF) / CHART_CELL)
  const cz = Math.floor((z + WORLD_HALF) / CHART_CELL)
  if (cx < 0 || cz < 0 || cx >= CHART_GRID || cz >= CHART_GRID) return -1
  return cz * CHART_GRID + cx
}

export function hasCell(bits: Uint8Array, i: number): boolean {
  return i >= 0 && ((bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0
}

function setCell(bits: Uint8Array, i: number): boolean {
  if (i < 0 || hasCell(bits, i)) return false
  bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7))
  return true
}

/** Whether a world point is on the map. */
export function charted(bits: Uint8Array, x: number, z: number): boolean {
  return hasCell(bits, chartCell(x, z))
}

/** Fills in every square within `r` of (x, z): how many were new. */
export function revealAround(bits: Uint8Array, x: number, z: number, r = CHART_REVEAL): number {
  let added = 0
  const steps = Math.ceil(r / CHART_CELL)
  const cx = Math.floor((x + WORLD_HALF) / CHART_CELL)
  const cz = Math.floor((z + WORLD_HALF) / CHART_CELL)
  for (let dz = -steps; dz <= steps; dz++)
    for (let dx = -steps; dx <= steps; dx++) {
      const gx = cx + dx
      const gz = cz + dz
      if (gx < 0 || gz < 0 || gx >= CHART_GRID || gz >= CHART_GRID) continue
      // The square's nearest point to you, within reach.
      const nx = Math.max(gx * CHART_CELL, Math.min(x + WORLD_HALF, (gx + 1) * CHART_CELL))
      const nz = Math.max(gz * CHART_CELL, Math.min(z + WORLD_HALF, (gz + 1) * CHART_CELL))
      if (Math.hypot(nx - (x + WORLD_HALF), nz - (z + WORLD_HALF)) > r) continue
      if (setCell(bits, gz * CHART_GRID + gx)) added++
    }
  return added
}

/** Adds everything on `from` to `into` (maps only ever grow): whether anything was new. */
export function mergeBits(into: Uint8Array, from: Uint8Array): boolean {
  let grew = false
  for (let i = 0; i < CHART_BYTES; i++) {
    const v = (into[i] ?? 0) | (from[i] ?? 0)
    if (v !== into[i]) {
      into[i] = v
      grew = true
    }
  }
  return grew
}

/** Squares on the map. */
export function countBits(bits: Uint8Array): number {
  let n = 0
  for (const b of bits) {
    let v = b
    while (v) {
      v &= v - 1
      n++
    }
  }
  return n
}

/** How much of the county is on the map, 0–1. */
export const chartShare = (bits: Uint8Array): number => countBits(bits) / (CHART_GRID * CHART_GRID)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The bitset as base64 (no padding needed: CHART_BYTES is a multiple of 3). */
export function bitsToText(bits: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bits.length; i += 3) {
    const n = ((bits[i] ?? 0) << 16) | ((bits[i + 1] ?? 0) << 8) | (bits[i + 2] ?? 0)
    out +=
      B64.charAt((n >> 18) & 63) +
      B64.charAt((n >> 12) & 63) +
      B64.charAt((n >> 6) & 63) +
      B64.charAt(n & 63)
  }
  return out
}

/** Back from base64; anything malformed reads as a blank map. */
export function textToBits(text: unknown): Uint8Array {
  const bits = emptyBits()
  if (typeof text !== 'string' || text.length !== (CHART_BYTES / 3) * 4) return bits
  for (let i = 0, o = 0; i < text.length; i += 4, o += 3) {
    let n = 0
    for (let k = 0; k < 4; k++) {
      const v = B64.indexOf(text[i + k] ?? '')
      if (v < 0) return emptyBits()
      n = (n << 6) | v
    }
    bits[o] = (n >> 16) & 255
    bits[o + 1] = (n >> 8) & 255
    bits[o + 2] = n & 255
  }
  return bits
}

/** A saved chart, read defensively. */
export function readChart(raw: unknown): Chart {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Chart>
  return {
    seen: bitsToText(textToBits(r.seen)),
    inked: Array.isArray(r.inked) ? r.inked.filter((k) => typeof k === 'string').slice(0, 400) : [],
  }
}
