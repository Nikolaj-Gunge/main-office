# Office FPS — Master Plan

A browser-based, always-on multiplayer first-person shooter for the office.
Open the URL → type your name once → you're in the match. No lobby, no install.

- **Graphics:** Three.js, rendered at low internal resolution with a pixel-art post-process (crisp pixels, palette, dithering).
- **Weapons:** Handgun, Rifle, Sniper.
- **Feel:** "Real" through motion, timing and sound — recoil, sway, bob, ADS, audio layers, hit feedback. Pixel graphics, grounded handling.
- **Damage:** 100 HP. Hit-zone multipliers. Headshot = instant kill with every weapon.
- **HUD:** Own health bar only (no enemy bars), ammo, crosshair, hit markers, damage direction, kill feed, scoreboard, minimap later.
- **Server:** One persistent, authoritative game server. The match never ends; people drop in and out.

---

## 1. Recommended codebase

### 1.1 Stack

| Layer               | Choice                                                           | Why                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language            | **TypeScript** everywhere                                        | Client and server share the same simulation code — the single most important thing for a networked FPS.                                                           |
| Monorepo            | **Bun workspaces** (Bun is already installed)                    | One install, one lockfile, native TS on the server with no build step.                                                                                            |
| Client bundler      | **Vite**                                                         | Fast HMR, handles WASM, shaders (`?raw`), assets.                                                                                                                 |
| Rendering           | **Three.js** (`WebGLRenderer`)                                   | Requested; mature; WebGPU renderer optional later.                                                                                                                |
| Physics / collision | **Rapier** (`@dimforge/rapier3d-compat`)                         | Same WASM build runs in browser and server → identical collision for prediction. Has a kinematic character controller (step-up, slopes, sliding along walls).     |
| Server runtime      | **Bun** (`Bun.serve` with built-in WebSocket)                    | Serves the static client _and_ the game socket on one port. Fast, simple. Node 24 + `ws` is a drop-in fallback if Bun ever bites.                                 |
| Transport           | **WebSocket, binary** (hand-rolled `DataView` encoder)           | On office LAN/near-region cloud, TCP head-of-line blocking is negligible. WebRTC DataChannels (geckos.io) can be added later behind the same interface if needed. |
| UI / HUD            | **Plain DOM + CSS** over the canvas (pixel font)                 | HUD is small; no framework needed. Menus can stay vanilla too.                                                                                                    |
| Audio               | **Web Audio API** (thin wrapper)                                 | Layered gunshots, positional footsteps, low-latency.                                                                                                              |
| Tests               | **`bun test`**                                                   | Shared sim must be unit-tested: movement, damage, hit detection, serialization.                                                                                   |
| Debug tooling       | **lil-gui** + **stats-gl**                                       | Live-tweak every feel parameter (recoil, sway, speeds) without reloads.                                                                                           |
| Assets              | **Blockbench** (models, pixel textures), **Blender** (map), glTF | Blockbench is made for low-poly pixel-textured models — perfect for the look.                                                                                     |
| Deploy              | **Docker** image, single container                               | Runs forever on any box/VPS; restarts on crash.                                                                                                                   |

**Considered and rejected:**

- _Colyseus / other room frameworks_ — great for turn-based/state sync, but an FPS needs custom client prediction, reconciliation and lag compensation; the framework would be in the way.
- _React (R3F) for the game_ — adds a reconciliation layer to a 60–144 Hz game loop. Not worth it.
- _Full rigid-body physics for players_ — players use a kinematic controller with hand-tuned movement math (Quake/Source style). Rigid bodies only for props later, if ever.
- _Babylon.js / PlayCanvas_ — fine engines, but Three.js was requested and gives full control of the pixel pipeline.

### 1.2 Repo layout

```
/
├─ apps/
│  ├─ client/                 Vite + Three.js
│  │  ├─ src/
│  │  │  ├─ main.ts           boot, pointer lock, loop
│  │  │  ├─ render/           renderer, pixel pass, viewmodel pass, materials
│  │  │  ├─ game/             local player, remote players, prediction, interpolation
│  │  │  ├─ weapons/          viewmodels, recoil/sway/bob springs, effects
│  │  │  ├─ fx/               muzzle flash, tracers, decals, particles
│  │  │  ├─ audio/            sound bank, mixer, positional audio
│  │  │  ├─ hud/              health, ammo, crosshair, killfeed, scoreboard, minimap
│  │  │  ├─ net/              socket, codec usage, clock sync
│  │  │  └─ input/            keyboard/mouse, bindings, sensitivity
│  │  └─ public/assets/       textures, models, sounds, fonts
│  └─ server/                 Bun
│     └─ src/
│        ├─ main.ts           HTTP static + WS upgrade
│        ├─ game.ts           tick loop, world, players
│        ├─ lagcomp.ts        hitbox history + rewind
│        ├─ spawn.ts          spawn selection
│        └─ admin.ts          health check, metrics, (later) admin commands
├─ packages/
│  └─ shared/                 imported by BOTH client and server
│     └─ src/
│        ├─ constants.ts      tick rate, metrics (heights, speeds)
│        ├─ math/             vec, springs, seeded RNG, ray-vs-capsule/sphere/box
│        ├─ sim/              movement step, weapon state machine
│        ├─ weapons.ts        weapon definitions (data only)
│        ├─ hitboxes.ts       hit-zone layout + damage multipliers
│        ├─ protocol/         message ids, binary encoder/decoder
│        └─ maps/             map definition format + loaders
├─ docs/                      design notes (metrics, protocol, map guide)
├─ Dockerfile
└─ PLAN.md
```

**Golden rule:** anything that affects gameplay outcome (movement, weapon timing, spread, damage, hit zones) lives in `packages/shared` and is pure, deterministic and tested. The client only _predicts_ with it; the server _decides_ with it.

---

## 2. Architecture

### 2.1 Networking model (authoritative server, Source/Valorant style)

```
Client (60–144 fps render)                 Server (60 Hz fixed tick)
──────────────────────────                 ─────────────────────────
sample input @ 60 Hz ── InputCmd{seq,tick,  ─►  queue per player
                         buttons, yaw,           apply inputs in order (shared sim)
                         pitch, viewTick}        fire? → rewind hitboxes to viewTick
predict own movement + weapon (shared sim)       raycast world + hitboxes → damage
keep unacknowledged inputs                       record hitbox history (1 s)
                                    ◄── Snapshot @ 30 Hz {tick, lastAckedSeq,
reconcile: reset to server state,                 players[], events[]}
replay pending inputs
interpolate remote players ~2 snapshots behind (≈66 ms)
```

- **Fixed simulation tick: 60 Hz** on both sides (`dt = 1/60`). Rendering is decoupled with interpolation between sim states → smooth on 144 Hz monitors.
- **Snapshots: 30 Hz** (LAN can do 60). Full state per snapshot is fine for ≤ 32 players (~30 bytes/player). Delta compression is a later optimization.
- **Client-side prediction** for own movement _and_ own weapon state (ammo, fire cooldown, reload) → zero perceived input lag.
- **Reconciliation:** on each snapshot, snap predicted state to server state at `lastAckedSeq`, replay pending inputs. Smooth tiny corrections visually instead of popping.
- **Entity interpolation:** remote players rendered ~2 snapshot intervals in the past, lerping between buffered snapshots.
- **Lag compensation:** server keeps a 1-second ring buffer of every player's hitbox poses per tick. A fire command carries the tick the shooter was _seeing_; the server rewinds targets to that tick before raycasting. Max rewind clamped (e.g. 250 ms).
- **Deterministic spread:** spread uses a seeded RNG (`seed = playerId ^ tick ^ shotIndex`) so client-drawn tracers/impacts land exactly where the server computes them.
- **Client effects are instant, damage is server-confirmed:** muzzle flash, recoil, tracer, impact decal play immediately; hit marker and damage numbers only appear when the server confirms (on LAN that's ~10–30 ms — feels instant).
- **Input validation:** server clamps pitch, rejects impossible fire rates, caps input queue length, ignores out-of-order seqs. Light anti-cheat is enough for an office.

### 2.2 Binary protocol (sketch)

```
Client → Server
  0x01 Join        { name: str8, color: u8, loadout: u8 }
  0x02 Input       { seq: u32, tick: u32, viewTick: u32, buttons: u16,
                     yaw: u16, pitch: i16, weaponSlot: u8 }   (send last 3 for redundancy)
  0x03 Ping        { clientTime: f64 }
  0x04 Chat        { text: str8 }                              (later)

Server → Client
  0x81 Welcome     { playerId: u16, serverTick: u32, mapId: u8, tickRate: u8 }
  0x82 Snapshot    { tick: u32, ackSeq: u32,
                     you: { full predicted state },
                     players: [{ id, pos f32x3, vel i16x3, yaw u16, pitch i16,
                                 flags u8 (crouch/ads/reload/dead), weapon u8 }] }
  0x83 Events      { [ShotFired | Hit | Kill | Damage{fromDir} | Spawn | Leave | Join] }
  0x84 Pong        { clientTime: f64, serverTime: f64 }
  0x85 Scoreboard  { [id, name, kills, deaths, ping] }        (1 Hz)
```

Angles quantized to u16 (0.0055° resolution), buttons as bitmask (fwd, back, left, right, jump, crouch, sprint, fire, ads, reload, use).

### 2.3 Server loop

- `setInterval` is too jittery → use an accumulator loop driven by `performance.now()` (catch up multiple ticks if late, never more than ~5).
- One `World` instance: Rapier world (static map colliders + one kinematic controller per player), player table, hitbox history, event queue.
- The match is a **continuous Free-For-All**. Scoreboard can soft-reset every N minutes (e.g. 20 min "rounds" with a 10 s "Top 3" overlay) so newcomers have a chance — configurable.
- Disconnect → remove after 5 s grace (reconnect on tab refresh keeps score via a token in `localStorage`).

---

## 3. Visual style — "pixelated, but feels real"

Realism comes from **motion, timing, sound and lighting**, not polygon count. The pixel look is a post-process on top of a normally lit 3D scene.

### 3.1 Pixel pipeline

1. Render world into a **low-res render target**: fixed internal height (default **270 px**, options 180 / 240 / 360), width from aspect ratio. `NearestFilter`, no antialiasing.
2. Render the **viewmodel** (hands + gun) into the _same_ render target in a second pass (own scene, own camera with ~55° FOV, depth cleared) → gun never clips into walls and is pixelated consistently with the world.
3. **Post-process pass** (fullscreen quad, custom shader):
   - Color quantization to a curated palette (LUT texture, ~48–64 colors) — gives cohesive art direction.
   - **4×4 Bayer ordered dithering** for gradients (fog, lights, sky).
   - Optional **depth/normal edge outlines** (1 px) for readability of silhouettes and cover edges.
4. **Upscale** to the screen at integer scale with nearest-neighbour (`image-rendering: pixelated`), letterboxing remainder.
5. HUD drawn in DOM with a pixel font (e.g. _Press Start 2P_ / _m5x7_), snapped to the same pixel grid scale.

### 3.2 Materials & lighting

- Textures 16–64 px with **32 px per meter** texel density, `NearestFilter`, nearest mipmaps (avoids shimmer at distance).
- Lighting: baked lightmaps / vertex colors for the static map + a few dynamic lights (muzzle flashes, key lights). Banded (quantized) diffuse shading for a stylized-but-grounded look.
- Distance **fog** and a strong **key light** direction for depth reading.
- Optional retro touches as toggles: vertex snapping (PS1 wobble) — off by default because it hurts aim clarity.

---

## 4. Core mechanics & game feel

### 4.1 Metrics (1 unit = 1 meter) — tactical-to-medium tempo (between CS and Apex)

| Metric                                | Value                                      |
| ------------------------------------- | ------------------------------------------ |
| Player capsule height / radius        | 1.80 m / 0.35 m                            |
| Eye height standing / crouched        | 1.65 m / 1.10 m                            |
| Walk speed (handgun / rifle / sniper) | 5.6 / 5.2 / 4.7 m/s                        |
| Sprint speed (no firing, ×1.35)       | ~7.0 m/s                                   |
| Crouch walk                           | 2.4 m/s                                    |
| ADS move speed                        | ×0.6                                       |
| Gravity                               | 20 m/s² (snappier than real 9.8)           |
| Jump height                           | ~1.0 m (v₀ ≈ 6.3 m/s)                      |
| Step-up height                        | 0.40 m                                     |
| Max climbable slope                   | 45°                                        |
| Mantle (phase 11)                     | ledges ≤ 1.6 m                             |
| Slide (phase 11)                      | sprint + crouch, 0.7 s, ×1.3 boost, decays |
| Ground accel / friction / air accel   | 10 / 6 / 1.5 (Source-style, tweak live)    |
| Fall damage                           | none (keeps it fun)                        |

**Level-building metrics derived from the above:**

| Element                          | Size                                   | Reason                                       |
| -------------------------------- | -------------------------------------- | -------------------------------------------- |
| Low cover                        | 1.0 m high                             | Crouched = hidden, standing = can shoot over |
| High cover                       | ≥ 1.9 m                                | Full cover standing                          |
| Jumpable obstacle                | ≤ 0.9 m                                | Below jump height with margin                |
| Door width / height              | 1.4–2.0 m / 2.4 m                      | Comfortable passage, readable choke          |
| Corridor width                   | 2.5–4 m                                | 2 players side-by-side minimum               |
| Choke point                      | 2–4 m wide                             | Forces engagement                            |
| Ceiling height (rooms)           | 3–4 m                                  | Room for jumping, not claustrophobic         |
| Floor-to-floor (vertical levels) | 4 m                                    | Stairs: 0.25 m rise, 0.3 m run               |
| Sniper sightline (max)           | ~60–80 m                               | Map scale for an office crowd                |
| Engagement ranges                | close < 10 m, mid 10–30 m, long > 30 m | Balance weapons against these                |

A **"gym" test map** with labelled heights/widths gets built first (phase 2), so every number is felt before the real map exists.

### 4.2 Movement

- Pure function in shared: `stepPlayer(state, input, dt, physics) → state`.
- Quake/Source-style accelerate/friction model; Rapier `KinematicCharacterController` for collide-and-slide, step-up, slope limit, ground snapping.
- Crouch (hold), sprint (hold Shift, forward only, can't fire, short sprint-to-fire delay ~0.15 s), jump with coyote time (0.1 s) and jump buffering.
- Movement inaccuracy: spread grows with horizontal speed and while airborne → rewards stopping to shoot (tactical feel).
- Camera: head bob tied to step cycle (subtle), landing dip on impact, small roll on strafe.

### 4.3 Gunplay feel (client-side layers, all spring-driven)

All of these use a critically-damped spring utility so they combine naturally and recover smoothly:

1. **View punch / camera recoil** — camera kicks up + random yaw, springs back. Affects where you look.
2. **Recoil pattern (rifle)** — deterministic per-shot offset table (first ~10 shots climb, then sway left/right). Learnable, like CS. Recovers when you stop firing.
3. **Viewmodel kick** — gun moves back/up/rotates per shot, separate from camera.
4. **Weapon sway** — gun lags behind mouse movement (inverse of mouse delta, clamped), plus idle breathing sway.
5. **Weapon bob** — figure-8 motion synced with footsteps, bigger when sprinting, gun tilted down when sprinting.
6. **ADS** (right mouse) — lerp gun to sight position, FOV zoom (rifle 1.25×, handgun 1.15×), reduced spread & sway, slower movement.
7. **Sniper scope** — full-screen scope overlay with pixel reticle, 4× zoom, visible sway that grows over time; hold Shift to steady for 3 s. Unscoped shots have huge spread.
8. **Muzzle flash** — sprite + 1-frame point light (lights the hands and nearby walls).
9. **Tracers** — every 1st shot handgun/sniper, every 3rd rifle; bullet-cracks for near-misses ("whizz" when a shot passes you).
10. **Impacts** — surface-dependent particles (dust/sparks/splinters) + decals (pooled, capped at ~128).
11. **Shell ejection** — pooled pixel sprites with simple physics.
12. **Screen shake** — tiny for own shots, more for nearby damage.
13. **Hit feedback** — hit marker (white = body, red/bigger + distinct "tink" = headshot), kill confirm icon + sound.

### 4.4 Audio

- Gunshot = 3 layers: **mechanical** (close), **body** (punch), **tail** (room reverb / distant echo). Distance crossfades layers: far shots are tail-heavy and delayed.
- Positional footsteps for everyone (louder when sprinting, silent-ish crouched) — key tactical info.
- Reload stages (mag out / mag in / bolt) timed to animation; "click" on empty.
- Low health: heartbeat + muffled low-pass on the master bus.
- Damage taken: grunt + directional impact.
- Sources: Sonniss GDC bundles (royalty-free), freesound (CC0), or self-recorded; processed for consistency.

---

## 5. Weapons

|                              | **Handgun**          | **Rifle**          | **Sniper**       |
| ---------------------------- | -------------------- | ------------------ | ---------------- |
| Fire mode                    | Semi-auto            | Full-auto          | Bolt-action      |
| Fire rate                    | 400 RPM cap (0.15 s) | 600 RPM (0.10 s)   | 1 shot / 1.4 s   |
| Magazine / reserve           | 12 / 48              | 30 / 90            | 5 / 20           |
| Reload (tactical / empty)    | 1.5 / 1.9 s          | 2.2 / 2.8 s        | 2.8 / 3.4 s      |
| Draw time                    | 0.35 s               | 0.6 s              | 0.9 s            |
| Base damage (chest)          | 26                   | 30                 | 115              |
| Falloff                      | 26 → 18 at 15–30 m   | 30 → 24 at 25–50 m | none             |
| Hip spread / ADS spread      | 1.2° / 0.4°          | 2.0° / 0.25°       | 8° / 0° (scoped) |
| ADS zoom                     | 1.15×                | 1.25×              | 4× scope         |
| Move speed                   | 5.6 m/s              | 5.2 m/s            | 4.7 m/s          |
| Shots to kill (chest, close) | 4                    | 4                  | 1                |

### 5.1 Hit zones (all weapons)

| Zone                  | Multiplier       | Shape (server hitbox) |
| --------------------- | ---------------- | --------------------- |
| **Head**              | **Instant kill** | Sphere r = 0.13 m     |
| Upper torso (chest)   | ×1.0             | Oriented box          |
| Lower torso (stomach) | ×0.9             | Oriented box          |
| Arms                  | ×0.75            | Capsules              |
| Legs                  | ×0.65            | Capsules              |

- Sniper: chest/stomach kill (115 / 103), arms 86, legs 75 → arms/legs leave the target alive (tense, rewards precision).
- Hitboxes are simple primitives posed from player state (stand/crouch, pitch rotates head/upper body) — _not_ the render mesh. Same code on client (debug draw toggle) and server.
- Ray order: raycast world (Rapier) for wall distance → test rewound hitboxes (analytic ray-vs-sphere/capsule/OBB) → nearest hit within wall distance wins. Wall penetration is a possible later feature.

### 5.2 Loadout (default proposal)

Everyone always has the **handgun** (slot 2). On (re)spawn you pick a **primary**: **rifle or sniper** (slot 1). Keys: `1` primary, `2` handgun, `Q` last weapon, mouse wheel cycles. Ammo refills on respawn; ammo boxes on the map later.

---

## 6. HUD & information

| Element                   | Position            | Notes                                                                          |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| **Health bar** (own only) | bottom-left         | 100 → 0, segmented pixel bar, number next to it, flashes + turns red < 30      |
| Ammo                      | bottom-right        | `12 / 48`, weapon icon, "RELOAD" prompt when low                               |
| Crosshair                 | center              | Dynamic gap = current spread; hidden when ADS with sights/scope                |
| Hit marker                | center              | Body vs headshot variants, kill variant                                        |
| Damage direction          | ring around center  | Red arc pointing to attacker, fades over 1.5 s                                 |
| Low health                | full screen         | Red vignette, desaturation, heartbeat                                          |
| Kill feed                 | top-right           | `Anna [rifle] ✛ Bo` with headshot icon                                         |
| Scoreboard                | `Tab`               | Name, K, D, K/D, ping; sorted by kills                                         |
| Death screen              | full                | "Killed by X with Y (headshot)", respawn countdown 3 s, primary choice         |
| Minimap                   | top-left (phase 7+) | Top-down render of map, self + direction; enemies only when firing (red pings) |
| Net stats                 | toggle `F3`         | FPS, ping, tick, packet loss, prediction errors                                |

No enemy health bars. No enemy name tags through walls; names only on crosshair-hover within LOS.

---

## 7. Level design

**First real map: "Main Office"** — a stylized, exaggerated version of the actual office (people love shooting their colleagues in their own building).

- **Layout:** classic three-lane structure with connectors: a central open-plan area (open, mid-range, risky), a corridor/meeting-room lane (close quarters, choke points at doors), a mezzanine/stairwell lane (vertical, sniper perches).
- **Verticality:** 2 levels + rooftop/mezzanine overlook. Every high ground has a counter (second staircase, window line of sight, flank route) so no position is unbeatable.
- **Choke points:** doors between zones (2–3 m), kitchen counter, reception desk. Open spaces between them for manoeuvring.
- **Cover:** desks (low cover 1.0 m), pillars (high cover), meeting-room glass walls (see-through, not shoot-through at first), server racks. Cover spaced so you can always move between pieces in < 2 s of exposure.
- **Focal points & lighting:** bright light on key routes/objectives, darker side rooms; unique landmark props per area (coffee machine, ping-pong table, logo wall) so players can call out positions ("he's at the coffee machine").
- **Spawns:** 12–16 spawn points spread out; picked by "furthest from living enemies, not in an enemy's line of sight". 2 s spawn protection (ends on firing).
- **Pipeline:** blockout in Blender with grey boxes using the metrics above → export glTF; meshes named `COL_*` become Rapier colliders (both client and server), `SPAWN_*` empties become spawn points, `LIGHT_*` key lights. Pixel textures from Blockbench/Aseprite.

---

## 8. Hosting — "always on"

- One Docker container: Bun serves `apps/client/dist` (static) + `wss://` game socket on one port. Health check endpoint `/healthz`.
- **Options (pick one):**
  - **Internal office machine/VM** — lowest latency (< 2 ms), free; needs someone to keep it running.
  - **Small cloud VM** close to the office (e.g. Hetzner Helsinki/Falkenstein, Fly.io `arn`/`ams`) — ~10–25 ms from Copenhagen, survives the office Wi-Fi, ~€5/month.
- Restart policy `always`, structured logs, optional uptime ping to Slack on crash.
- Optional access gate: shared office password or IP allowlist (keep it simple).
- Stats persistence (all-time leaderboard, per-player K/D) via **SQLite** (`bun:sqlite`) in phase 10.

---

## 9. Build phases — from the bottom up

Every phase ends with something you can run and feel. Don't start the next phase until the "Done when" is true.

### Phase 0 — Foundation ✅

- Bun workspaces monorepo: `apps/client`, `apps/server`, `packages/shared`.
- TypeScript strict, ESLint + Prettier (or Biome), Vitest, path aliases.
- `bun dev` runs client (Vite) + server (watch) together; Vite proxies `/ws` to server.
- GitHub Actions: typecheck + test.
- **Done when:** browser shows a spinning cube; server logs a WebSocket connection and echoes a ping.

### Phase 1 — Render core + pixel pipeline ✅

- Renderer setup, resize handling, pointer lock, mouse look (raw input, sensitivity setting).
- Low-res render target + nearest upscale + palette/dither post shader; resolution switch in lil-gui.
- Map format v0: JSON list of boxes (pos, size, material) — loaded by client and server.
- "Gym" map: floor grid with 1 m markings, steps of 0.2–1.2 m, cover blocks at 1.0/1.9 m, door frames of different widths, a 4 m mezzanine with stairs, a long 80 m sightline.
- Free-fly camera, stats-gl, debug overlay.
- **Done when:** gym looks pixel-crisp and stable at 144 fps, no shimmer when moving.

### Phase 2 — Local player movement (offline) ✅

- Fixed-timestep loop (60 Hz sim, interpolated render).
- Rapier init (shared helper), static colliders from map.
- `stepPlayer` in shared: walk/sprint/crouch/jump, accel/friction, step-up, slopes, coyote time, jump buffer.
- Camera bob, landing dip, strafe roll; all params live-tweakable.
- Unit tests: jump height ≈ 1.0 m, top speeds, step-up 0.4 m works and 0.5 m doesn't, can't jump onto 1.2 m.
- **Done when:** running around the gym feels good and every metric matches the table.
- **Implementation notes:** Rapier's built-in autostep/snap proved unreliable with velocity clipping, so `PlayerBody` does its own Quake-style step-up (probe up → across → center raycast must find a walkable surface ≤ step height) and ground snap. Combined moves are split into horizontal + vertical sweeps (Rapier occasionally stalls on diagonal moves with a downward component). Walls clip velocity with their horizontal normal only, so ledge edges can't add upward speed. 25 movement tests cover every metric, plus determinism and a randomized fuzz on the gym.

### Phase 3 — Networking backbone ✅

- Binary codec + protocol in shared (round-trip tests).
- Server: accumulator tick loop, join/leave, input queues, shared `stepPlayer`, snapshots @ 30 Hz.
- Client: input commands, prediction + reconciliation, remote interpolation buffer, clock/tick sync via ping.
- Placeholder avatars (colored capsules + name), join flow with name (stored in `localStorage`).
- Dev tools: artificial latency/jitter/loss toggle (client + server) to test bad conditions; `F3` net stats.
- Headless bot clients (run in Bun) that wander around for load testing.
- **Done when:** 2+ browsers move smoothly with 150 ms simulated latency; own movement never feels delayed; 20 bots run with server tick time < 2 ms.
- **Implementation notes:** client-paced input queue on the server (≤2 commands per player per tick, 20 max queued, duplicates dropped). Own state is sent at full f64 precision and inputs are quantized *before* prediction, so the client replays bit-exactly: a scripted 600-tick run at 150 ms lag reconciles with 0 cm correction. Players don't collide with each other (collision groups) to avoid constant mispredictions. Remote players are drawn 100 ms in the past via a smoothed server-clock estimate. Measured: 20 bots on one laptop, tick ≈1.1 ms (sim ≈0.65 ms, snapshot sends ≈0.9 ms per round, ≈45 µs per `ws.send`).

### Phase 4 — First weapon end-to-end (handgun) ✅

- Weapon definitions + weapon state machine in shared (fire cooldown, mag, reload, draw), predicted on client.
- Hitbox layout + debug draw; server hitbox history ring buffer; lag-compensated hitscan.
- Damage zones, headshot instakill, health, death, respawn with spawn selection + protection.
- Placeholder viewmodel (box gun) in its own pass; basic muzzle flash + tracer + impact.
- Events: hit confirm, kill feed entries.
- **Done when:** two people can shoot each other; hitting the head kills instantly; hits register correctly at 150 ms simulated latency (verified with debug hitbox draw of rewound pose).
- **Implementation notes:** weapon state (ammo, cooldown, reload, draw, click buffer, spread seed) lives inside the predicted `PlayerState`, so client and server agree shot-for-shot; spread is a seeded hash of (server seed, shot index). Server history is kept per *snapshot* tick and interpolated exactly like the client draws remote players, so the rewound pose equals what was on screen — measured 0 cm error over 12 live shots at 166 ms RTT. Rewind is capped at 400 ms. Viewmodel renders into its own target and is composited in the post shader (keeps world depth for outlines). `bun run bots --shoot` gives you someone to fight alone.

### Phase 5 — Game feel pass #1 ✅

- Spring utility; view punch, viewmodel kick, sway, bob, ADS transitions.
- Audio engine: layered gunshots with distance, footsteps (own + positional others), reload sounds, hit/kill sounds.
- Hit markers (body/head/kill), damage direction indicator, screen shake, low-health vignette + heartbeat.
- Decals, impact particles, shell casings (pooled).
- **Done when:** blind test — shooting the handgun "feels right" to 3 colleagues.
- **Implementation notes:** all sounds are synthesized at startup from noise/sweeps/filters (`apps/client/src/audio/sounds.ts`, ~18 sounds with variants) — no asset files or licences; recorded samples can replace them later under the same ids. Gunshots mix three layers by distance with speed-of-sound delay and distance low-pass; 3D sounds use HRTF panning with our own distance curves. Other players' footsteps are derived from their interpolated movement (no protocol change); crouch-walking is silent to others. Recoil moves the real look angles (so the server agrees automatically) and springs back; screen shake is visual only. Aiming zooms the FOV per weapon (`aimZoom`) and scales sensitivity by 1/zoom.

### Phase 6 — Rifle & sniper ✅

- Full-auto + learnable recoil pattern for rifle; spray recovery.
- Sniper: bolt cycle, scope overlay, 4× zoom, scope sway + hold breath, unscoped inaccuracy, glint visible to others.
- Weapon switching (draw times), loadout choice on death screen, movement inaccuracy, sprint-to-fire delay, damage falloff.
- **Done when:** each weapon has a clear role: handgun close/backup, rifle mid, sniper long — nothing dominates in playtests.
- **Implementation notes:** loadout = primary (rifle or sniper, chosen on the join screen or with 1/2 while dead, applied at next spawn) + handgun; the holstered weapon keeps its own ammo/timers inside the predicted state. Aim accuracy builds over `adsTime`. Scope sway and hold-breath live in the shared weapon state, so the camera drift you see equals the bullet's offset on the server. The rifle's spray pattern is a fixed per-shot table applied by the client recoil (no recovery until you stop firing). Remote snapshots carry weapon + aiming → avatar gun model and the sniper glint (brightest when they point at you).

### Phase 7 — Complete HUD & UX ✅

- Health bar, ammo, dynamic crosshair, kill feed, scoreboard (`Tab`), death screen, name-on-hover.
- Settings menu: sensitivity, FOV, pixel resolution, volume, keybinds (saved to `localStorage`).
- Join screen styling, controls help, connection-lost/reconnect handling.
- Minimap.
- **Done when:** a new colleague can open the URL and play without being told anything.
- **Implementation notes:** one menu serves as join screen and Esc pause menu (PLAY / SETTINGS / CONTROLS tabs); every action is rebindable (keyboard, mouse buttons, wheel), stored with the other settings in localStorage. The server sends a scoreboard once a second and after every kill; clients report their measured RTT in pings for the ping column. Names show only for the player under your crosshair within line of sight (world raycast + hitboxes). Minimap is drawn once from the map boxes, rotated with the player; enemies appear only as red pings when they fire. Pixel font: Pixelify Sans (OFL), bundled — no external requests. lil-gui (F1) stays as the developer/tuning panel.

### Phase 8 — The office map ✅

- Greybox in Blender following metrics → playtest → iterate → art pass.
- glTF loader with `COL_` / `SPAWN_` / `LIGHT_` conventions; baked lighting; pixel textures; landmark props.
- Lighting to guide flow; choke points, verticality, sightlines validated in playtests.
- **Done when:** 6–10 people play 20 minutes and nobody gets lost or spawn-killed repeatedly.
- **Implementation notes (first pass, before office photos):** "Main Office" is code-built (`packages/shared/src/maps/office.ts`), 60 × 40 m: double-height open-plan hall (desk clusters, glass meeting rooms, reception with logo wall, kitchen with coffee machine and ping-pong) under a glass-railed gallery; north wing with boardroom, quiet room, server room (ground) and games room, offices, lounge, CEO office (upper). Three routes up (grand stairs, kitchen stairs, enclosed west stairwell). Map boxes can be render-only or collider-only; maps can carry lights and a skyline. Visual upgrade: richer procedural textures per material, glass, emissive panels/screens/rack LEDs with a half-res bloom pass, 360p default with 40 colour levels and softer dither/outlines (saved settings adopt the new look once). Minimap draws one image per floor. `?map=gym` still loads the gym; the server tells clients its map on join. Measured: 20 shooting bots ≈ 1.2–2.7 ms per tick on this map.

- **Spawns & weapon pickups (added during phase 8 at the user's request):** spawn anywhere — the server precomputes ~950 free floor spots on both floors and picks a random one ≥ 10 m from and out of sight of every living enemy (glass doesn't hide you). Everyone spawns with only the handgun; 9 map spots hold rifles/snipers (full ammo, back 25 s after being taken). Empty slot → walk over to pick up and draw; full slot → E swaps and throws yours down; dying drops your rifle/sniper (30 s on the floor). The loadout choice from phase 6 is gone. Tests check every weapon spot is reachable by walking over it.

### Phase 9 — Characters & animation ✅

- Low-poly pixel-textured character (Blockbench), third-person weapon models, team-less color/hat customization.
- Animations: idle, walk/run (blend by speed), crouch, jump, ADS pose, reload, death (ragdoll-ish or canned).
- Upper body follows pitch; footstep sync with animation.
- First-person hands model for viewmodels with reload/draw animations.
- **Done when:** you can read what an enemy is doing (crouching, reloading, aiming) from their silhouette.

### Phase 10 — Always-on deployment ✅

> **Implementation notes:**
> - Host: Cloudflare free plan (user's choice).
>   - `apps/cloudflare`: Workers Assets serve the client; one Durable Object (`GameRoom`, idFromName `office`, locationHint `weur`) runs the unchanged `Game`, `GameLoop` and session code.
>   - `apps/server/src/session.ts` is the transport-agnostic connection handler, shared by Bun and the Durable Object.
> - Rapier: Workers can't compile WASM from bytes. `build.ts` cuts the inlined base64 out of `rapier.mjs` and points it at a precompiled module uploaded next to the worker, giving a 264 KB worker plus 3 MB WASM.
> - Free quota:
>   - Clients batch inputs, 2 ticks per message, 30 msg/s.
>   - The server takes 1 command per tick, and 2 only above a backlog.
>   - The room loop stops when empty and pauses after 5 s with no input.
> - Not done here: the Dockerfile and SQLite stats. On the free plan, scores are in-memory only.

- Dockerfile (multi-stage: build client → run server), env config, `/healthz`, graceful shutdown (warn players, persist scores).
- Deploy to chosen host, HTTPS (Caddy or platform TLS), restart policy, uptime alert.
- SQLite stats: all-time kills/deaths/headshots per name, leaderboard page.
- **Done when:** server ran for 7 days without manual intervention.

### Phase 11 — Admin page, game rules, modes, maps (user request) ✅

Built in 3 testable parts on `phase-11`:

1. **Admin + rules + skins + jingles** ✅
   - `/admin` page with a password (the `ADMIN_PASSWORD` secret), using the `AdminApi` in `apps/server/src/admin.ts`. The Bun server and the Durable Object share it.
   - `GameRules` (`packages/shared/src/rules.ts`) cover: map, skin, jingles, gravity, speed, jump, playerScale, spread, recoil, damage, oneShot, headshotsOnly, infiniteAmmo, respawnSeconds.
     - The server sends them (`ServerMsg.Rules`, protocol v8).
     - Movement and weapon rules apply on both sides via `movementFor` and `weaponRulesFor`, so prediction stays exact.
     - Damage rules are server-only.
     - Hitboxes scale with `HitPose.scale`.
   - Skins: slime, office worker and robot, all with the same hitboxes. Kill jingles are synthesized (arcade, fanfare, airhorn) and escalate on streaks.
   - Map switch: `Game.changeMap` respawns everyone and re-sends Welcome. Clients reload into the new map and rejoin automatically.
   - Rules persist in Durable Object storage.
2. **Game modes with rounds** ✅
   - Modes: free for all, team deathmatch (Marketing vs IT), last man standing, gun game (rifle → shotgun → sniper → handgun → knife, 2 kills each, a knife kill drops the victim a level), and infection (patient zero is knife-only and 20% faster, the killed join them, survivors win on time).
   - Rounds end on time or the score limit. An 8 s winner screen follows (headline, MVP, best K/D, sharpshooter), then the next round starts, optionally on the next map.
   - All of this lives in `apps/server/src/match.ts` (`MatchRunner`), sent as `ServerMsg.Match`.
   - Everyone always carries a knife (slot 3); a backstab kills in one.
   - Admin bots (0–10, easy/normal/hard) play every mode.
3. **New maps** ✅ Meeting Room, Rooftop, Warehouse, Campus.

### Phase 12 — Polish & extensions (backlog, pick freely)

**Built on `phase-12` (user request, awaiting test):**

- **MP5** (weapon 5): 800 rpm, 22 damage falling to 14 between 12 and 30 m, light recoil. On the floor on every map, available as a spawn loadout, and in the gun game ladder.
- **Shotgun range:** pellets now fade from 20 to 8 between 5 and 35 m (before: 2 at 22 m).
- **Zombies (co-op)**, mode `zombies` on the **Outbreak** map (`maps/outbreak.ts`, 160 m long, one floor).
  - Five stages, each with a goal: Lobby (kill), Open office (reach), Server room (hold), Parking garage (hold), Loading yard (hold).
  - Finishing a goal opens the stage's gate (`MapBox.gate`).
    - Gates are colliders switched on and off on both sides (`setGates`), and the client hides their meshes.
    - Finishing also revives fallen survivors at the checkpoint and refills everyone.
  - Everyone down means "Overrun" and a retry of the same stage. Finishing the last stage means "Escaped".
  - Server pieces:
    - `zombies.ts` (`ZombieDirector`) runs a pool of up to 20 zombie players: walkers, and runners (faster, less health) that become more common in later stages. They spawn out of sight, ≥ 9 m away.
    - `zombie-brain.ts` handles chasing, clawing and spreading apart.
    - `nav.ts` builds a 0.8 m walking grid with distance fields. Survivor bots use it to follow the team and stand in goal zones.
  - Bot difficulty sets how many zombies come, how much health they have and how hard they claw.
  - Choosing zombies moves the server to Outbreak. Co-op maps are kept out of the map rotation.
  - Client: zombie and runner bodies, groans and claw sounds, objective bar with progress, a "GATE OPEN" banner, the goal area marked on the floor and a waypoint on the HUD.
  - Only your own zombie kills appear in the kill feed.
  - Protocol v15: `PlayerJoined.kind`, `MatchInfo.coop`.
- **Zombies round 2:**
  - Outbreak is now 8 stages: the yard became a 4-floor loading tower (bay, 2nd floor, 3rd floor, roof helipad).
    - Floors are joined by walled 20° ramps, each gated at the bottom.
    - The nav grid joins floors via `MapDef.navLinks`. `nearest()` also finds a node for someone on a ramp.
  - Checkpoints hand out bigger guns (`CoopStage.armory`, `WEAPON_TIER`): MP5, then rifle, then the new LMG (weapon 7, 100-round belt).
  - More zombies the further you get: intensity 0.8 → 2.4, a pool of 24, faster spawning in later stages.
  - Claws hit harder: 17 / 27 / 38 for easy / normal / hard.
  - MP5 and LMG: tall open sights, and the gun held lower and further out when aiming.
- **Per-weapon recoil animation:**
  - Flip, twist and side jerk, each with its own recovery speed.
  - Pistol slide (locks back when empty), charging handles, sniper bolt.
- **Zombies round 3 — two big co-op maps and new goal types (protocol v17):**
  - New goals:
    - `activate`: visit every spot (switches, pumps, fuel cans), optionally staying a few seconds at each.
    - `defend`: zombies tear at a thing; if it breaks, the stage restarts.
    - `survive`: a countdown.
  - Stages may open no gate; only the last stage ends the run.
  - Dead Mall (`mall`), 10 stages:
    - Car park → keycards from the shops → food court → defend the generator → escalator to the upper floor.
    - Upper floor: security office hold → cinema.
    - Roof: flares → defend the radio → survive until the helicopter.
  - Last Train (`metro`), 11 stages over 350 m, going down:
    - Street (fuses from wrecks) → ramp down to the concourse (breakers, survive) → escalators.
    - Platform (defend the signal box) → tunnel → pump room.
    - Depot: fuel cans, control room on a gantry, defend the train.
  - Map/mode coupling: picking a co-op map starts zombies; picking another mode leaves it for the office.
  - Nav: fields are capped at 160 steps (cheap on big maps), and ramp links respect gates.
  - Every co-op map is covered by `coop-maps.test.ts`:
    - starts, goals and spawns are on the floor and connected;
    - gates seal off what's behind them;
    - a player can walk up every ramp.
- Next co-op idea (user): a heist map — sneak past guards and police.

- Slide and mantle; lean (Q/E).
- Wall penetration for thin materials; destructible glass.
- Game modes: Team Deathmatch, Gun Game, "Last one standing at 17:00".
- Map rotation / map vote; second map.
- Killcam (we already have hitbox history + snapshots).
- Emotes, sprays, chat, spectator mode.
- WebRTC/unreliable transport if remote players on bad connections complain.
- Delta-compressed snapshots, interest management if > 32 players.
- Smaller first load: swap `@dimforge/rapier3d-compat` (base64-inlined WASM, ~1.8 MB gzipped bundle) for `@dimforge/rapier3d` with a binary `.wasm` + Vite WASM plugin.

---

## 10. Testing strategy

- **Unit (shared):** movement metrics, weapon timings, damage table, ray-vs-hitbox math, codec round-trips, seeded spread reproducibility.
- **Simulation tests:** run server world headless with scripted inputs; assert outcomes (player A shoots B's head at tick N → B dead).
- **Bots:** headless clients for load and soak tests (24 h run before going "always on").
- **Netcode tests:** artificial latency/jitter/loss presets (LAN, Wi-Fi, bad) in CI simulations — prediction error stays below threshold.
- **Playtests:** short Friday sessions after phases 4, 5, 6, 8; collect feel notes in `docs/playtests.md`.

---

## 11. Open decisions (defaults chosen, change any time)

1. **Loadout:** handgun always + choose rifle _or_ sniper per life (default) — vs. carry all three.
2. **Mode:** continuous Free-For-All with optional 20-minute soft reset (default) — vs. teams.
3. **Hosting:** small cloud VM near Copenhagen (default) — vs. office machine.
4. **Map theme:** stylized version of the real office (default).
5. **Access:** open URL inside office network / shared password (default) — vs. company SSO.

---

## 12. Immediate next step

Start **Phase 0**: scaffold the monorepo, get the Vite client and Bun server talking over a WebSocket, with the shared package imported by both.
