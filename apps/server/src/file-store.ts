import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SaveStore } from './saves.ts'

/**
 * Saves as JSON files in one folder (the Bun server; ./data/saves by default, gitignored).
 * Each key is its own file, written to a temporary name and renamed so a crash never leaves
 * half a save.
 */
export class FileStore implements SaveStore {
  private readonly dir: string
  private ready: Promise<unknown> | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  private path(key: string): string {
    return join(this.dir, `${encodeURIComponent(key)}.json`)
  }

  async get(key: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.path(key), 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
  }

  async put(key: string, value: unknown): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true })
    await this.ready
    const path = this.path(key)
    await writeFile(`${path}.tmp`, JSON.stringify(value))
    await rename(`${path}.tmp`, path)
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }
}
