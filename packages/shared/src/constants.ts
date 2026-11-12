/** Fixed simulation rate shared by client prediction and the server (Hz). */
export const TICK_RATE = 60
export const TICK_DT = 1 / TICK_RATE

/** How often the server broadcasts snapshots (Hz). */
export const SNAPSHOT_RATE = 30
/**
 * Client sends its input commands in batches of this many ticks (60 Hz / 2 = 30 messages/s).
 * Halves the message count, which is what Cloudflare's free plan meters; costs ≤17 ms of
 * server-side input delay (your own movement is predicted locally, so you don't feel it).
 */
export const INPUT_BATCH_TICKS = 2

/** Default port the server listens on (HTTP + WebSocket). */
export const DEFAULT_SERVER_PORT = 3000

/** Path the game WebSocket is upgraded on. */
export const WS_PATH = '/ws'

/** Bumped whenever the binary protocol changes incompatibly. */
export const PROTOCOL_VERSION = 12

/** Hard cap on simultaneous players (ids and counts are encoded in a u8/u16). */
export const MAX_PLAYERS = 32

/** Max player name length (characters). */
export const MAX_NAME_LENGTH = 16

/** Player colors by index (server assigns the index). Readable against the gym's dev textures. */
export const PLAYER_COLORS = [
  0xe83b3b, 0x4d9be6, 0x1ebc73, 0xf9c22b, 0xa884f3, 0xfb6b1d, 0x30e1b9, 0xf04f78, 0x8fd3ff,
  0x91db69, 0xfbb954, 0xeaaded,
] as const
