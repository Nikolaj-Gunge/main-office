import { DurableObject } from 'cloudflare:workers'
import type { SaveStore } from '@office-fps/server/saves'

/**
 * Characters and the world (see apps/server/src/saves.ts), in one Durable Object's storage that
 * outlives the game rooms: rooms are per protocol version, this isn't, so saves survive deploys,
 * updates and rooms being evicted. Keys: "world" and "char:<account>"; values are JSON.
 */
export class SaveVault extends DurableObject {
  async get(key: string): Promise<unknown> {
    return this.ctx.storage.get(key)
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.ctx.storage.put(key, value)
  }

  async delete(key: string): Promise<void> {
    await this.ctx.storage.delete(key)
  }
}

/** The vault as a SaveStore for a room (RPC to the one vault). */
export function vaultStore(env: Env): SaveStore {
  const vault = env.SAVES.get(env.SAVES.idFromName('office'))
  return {
    get: (key) => vault.get(key),
    put: (key, value) => vault.put(key, value),
    delete: (key) => vault.delete(key),
  }
}
