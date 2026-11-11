<img src="assets/icon.svg" width="64" height="64" alt="">

# Office FPS

Always-on, browser-based multiplayer FPS for the office. Three.js with a pixel-art look,
authoritative Bun game server. See [PLAN.md](PLAN.md) for the full design and roadmap.

## Requirements

- [Bun](https://bun.sh) 1.3+

## Getting started

```sh
bun install
bun dev          # client on http://localhost:5173, server on :3000 (Vite proxies /ws)
```

Open http://localhost:5173, enter a name and click Play. Open a second tab to see yourself from
the outside. To play with colleagues on the office network: `bun run build && bun start`, then
everyone opens `http://<your-ip>:3000`.

## Controls (gym map)

| Key            | Action                                                     |
| -------------- | ---------------------------------------------------------- |
| Mouse          | Look (raw input, CS-style sensitivity)                     |
| WASD           | Move                                                       |
| Space          | Jump                                                       |
| C / Left Ctrl  | Crouch (C recommended: Ctrl+W closes the tab)              |
| Shift          | Sprint (forward only)                                      |
| Left mouse     | Shoot                                                      |
| Right mouse    | Aim down sights (tighter spread)                           |
| R              | Reload                                                     |
| 1 / 2          | Rifle-or-sniper slot / handgun                             |
| Q / wheel      | Switch to the other weapon                                 |
| E              | Swap your rifle/sniper for the weapon on the floor         |
| Shift (scoped) | Hold breath — steadies the sniper scope for 3 s            |
| M              | Mute / unmute (or open the game with `?mute=1`)            |

Trackpad? Esc → Controls → **Toggle aim**: one right / two-finger click scopes in, the next scopes out.
| Tab (hold)     | Scoreboard                                                 |
| Esc            | Menu: resume, loadout, settings, rebind controls           |
| V              | Toggle noclip (Space/Ctrl up/down); leaving it drops you there |
| F1             | Settings + live movement / camera-feel tuning              |
| F3             | Debug text (fps, position, speed, ping, bandwidth, prediction corrections) |
| F4             | Hitbox debug: green = where you see players, red = where the server checked your last shot |

F1 → "Network test" adds fake latency/jitter (presets up to 300 ms RTT) to try the netcode on
localhost. `/healthz` on the server reports players and tick timings.

Everyone spawns at a random spot (away from and out of sight of enemies) with only a handgun.
Rifles and snipers lie around the map with full ammo: walk over one with an empty slot to take
it, or press E to swap (your old one is thrown down). Dying drops your rifle/sniper.

The default map is the office; open the game with `?map=gym` (and start the server with
`MAP=gym`) for the metrics gym.

Audio starts when you click Play (browsers block sound before a click). Volume is in F1 → Audio.

To run a second, isolated dev instance next to your normal one:
`PORT=3200 bun apps/server/src/main.ts` and `cd apps/client && CLIENT_PORT=5200 SERVER_PORT=3200 bunx vite`.

Look settings are saved in `localStorage`. Movement and camera-feel tuning are not (they must
match the server): use "copy values as JSON" in F1 and paste into the shared defaults. In dev builds, `window.__game` exposes the camera,
settings and renderer for console debugging.

## Scripts

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `bun dev`           | Client (Vite HMR) + server (watch mode)             |
| `bun test`          | Unit tests (shared simulation, protocol)            |
| `bun run typecheck` | `tsc` in every workspace                            |
| `bun run lint`      | Biome lint + format check (`bun run format` fixes)  |
| `bun run build`     | Production client build → `apps/client/dist`        |
| `bun start`         | Production server: serves `dist` + WebSocket on one port (`PORT`, default 3000) |
| `bun run bots`      | Headless bots for load tests (`--count 20 --url ws://… --seconds 60`; add `--shoot` to make them shoot at the nearest player) |

## Hosting on Cloudflare (free plan)

The always-on office server runs on Cloudflare: Workers Assets serve the client, and one Durable
Object (`GameRoom`, in `apps/cloudflare`) runs the same `Game` as the Bun server. Anyone with the
link can join: **https://office-fps.office-fps-cloudflare.workers.dev**

```sh
cd apps/cloudflare
bunx wrangler login   # once, opens the browser
bun run deploy        # builds client + worker, uploads → https://office-fps.<you>.workers.dev
bun run preview       # same thing locally in Cloudflare's runtime (http://localhost:8787)
```

**Admin page:** `/admin` (e.g. https://office-fps.office-fps-cloudflare.workers.dev/admin). From there you can:
- switch map;
- pick everyone's skin and the kill jingle;
- change gravity, jump, speed, body size (tiny people), spread, recoil, damage and respawn time;
- turn on one-shot, headshots only and infinite ammo;
- apply presets;
- see who's online and reset scores.

Set its password once; Cloudflare asks for it without showing it:

```sh
cd apps/cloudflare && bunx wrangler secret put ADMIN_PASSWORD
```

Locally: `ADMIN_PASSWORD=… bun dev`. Without a password the admin page is disabled. After 5 wrong
tries, that address is locked out for 10 minutes. Rules are saved in the room and survive
restarts and deploys.

Free plan budget: about **100,000 Durable Object requests per day**, resetting at 01:00
Copenhagen time (00:00 UTC). Each player sends 30 input messages a second. If Cloudflare counts
WebSocket messages 20:1, as it does for billing, that is roughly **18 player-hours of play a day**;
the docs don't say whether the free quota uses the same ratio. Static files are free and unlimited.
When the quota runs out, new connections fail until the reset. Check usage in the Cloudflare
dashboard → Workers → office-fps → Metrics. Deploying restarts the room: everyone reconnects
automatically and scores reset.

## Layout

```
apps/client      Vite + Three.js game client
apps/server      Bun HTTP + WebSocket authoritative server
apps/cloudflare  Cloudflare Worker + Durable Object wrapper around the same server code
packages/shared  Code used by both: constants, binary protocol, maps, (soon) simulation
```

Server endpoints: `/ws` game socket, `/healthz` status JSON, everything else serves the built client.

## Checkpoint workflow

Each phase in [PLAN.md](PLAN.md) is built on its own branch and only lands on `main` once it has
been played and approved. Every approved phase gets a tag, so there is always a known-good version
to go back to.

1. Work happens on `phase-N` (pushed to GitHub as a backup while in progress).
2. Test it: `git checkout phase-N && bun install && bun dev`.
3. Approved → fast-forward `main` to it, tag it, and delete the branch (the tag replaces it):
   ```sh
   git checkout main && git merge --ff-only phase-N
   git tag -a phase-N -m "Phase N approved"
   git push origin refs/heads/main refs/tags/phase-N
   git branch -d phase-N && git push origin --delete refs/heads/phase-N
   ```
4. Not approved → keep iterating on `phase-N`; `main` is untouched.

Going back:

```sh
git tag -l 'phase-*'            # list approved checkpoints
git checkout phase-2            # look at / run an old checkpoint
git revert <commit>             # undo a specific change on main, keeping history
```
