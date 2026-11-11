/** Fixed simulation rate shared by client prediction and the server (Hz). */
export const TICK_RATE = 60
export const TICK_DT = 1 / TICK_RATE

/** How often the server broadcasts snapshots (Hz). */
export const SNAPSHOT_RATE = 30

/** Default port the server listens on (HTTP + WebSocket). */
export const DEFAULT_SERVER_PORT = 3000

/** Path the game WebSocket is upgraded on. */
export const WS_PATH = '/ws'

/** Bumped whenever the binary protocol changes incompatibly. */
export const PROTOCOL_VERSION = 1
