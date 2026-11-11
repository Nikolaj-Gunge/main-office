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

Open http://localhost:5173 and click to play.

## Controls (gym map, offline movement)

| Key            | Action                                                     |
| -------------- | ---------------------------------------------------------- |
| Mouse          | Look (raw input, CS-style sensitivity)                     |
| WASD           | Move                                                       |
| Space          | Jump                                                       |
| C / Left Ctrl  | Crouch (C recommended: Ctrl+W closes the tab)              |
| Shift          | Sprint (forward only)                                      |
| V              | Toggle noclip (Space/Ctrl up/down); leaving it drops you there |
| F1             | Settings + live movement / camera-feel tuning              |
| F3             | Debug text (fps, position, speed, grounded, ping)          |
| Esc            | Release mouse                                              |

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

## Layout

```
apps/client      Vite + Three.js game client
apps/server      Bun HTTP + WebSocket authoritative server
packages/shared  Code used by both: constants, binary protocol, maps, (soon) simulation
```

Server endpoints: `/ws` game socket, `/healthz` status JSON, everything else serves the built client.

## Checkpoint workflow

Each phase in [PLAN.md](PLAN.md) is built on its own branch and only lands on `main` once it has
been played and approved. Every approved phase gets a tag, so there is always a known-good version
to go back to.

1. Work happens on `phase-N` (pushed to GitHub as a backup while in progress).
2. Test it: `git checkout phase-N && bun install && bun dev`.
3. Approved → fast-forward `main` to it and tag it:
   ```sh
   git checkout main && git merge --ff-only phase-N
   git tag -a phase-N -m "Phase N approved" && git push origin main phase-N
   ```
4. Not approved → keep iterating on `phase-N`; `main` is untouched.

Going back:

```sh
git tag -l 'phase-*'            # list approved checkpoints
git checkout phase-2            # look at / run an old checkpoint
git revert <commit>             # undo a specific change on main, keeping history
```
