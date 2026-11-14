# Deadwood / office-fps — the big plan

Written 2026-11-14 from four research passes (survival-genre player research, game feel and
free browser games, engine/tech, and a full audit of our own code). We take it step by step: each
phase is a set of small, shippable pieces, tested and shown before they go live.

Sizes: **S** ≤ 1 day · **M** 2–5 days · **L** 1–3 weeks · **XL** bigger, split before starting.

---

## The north star

> **Deadwood is the zombie survival game you can be playing with your friends ten seconds after
> they send you a link — free, in the browser, on any laptop — where every life tells a story
> worth telling.**

### Five pillars (every feature must serve at least one)

1. **Instant & free.** Link → playing in seconds. No install, no account wall, no paywall, no
   ads in the middle of play. Runs on a school Chromebook.
2. **Tension, then relief.** The dark forest is dangerous; Haven is warm. Fear comes from sound,
   darkness and smart pacing — not from grind or chores.
3. **Every life is a story.** Death is a chapter, not a reset: obituaries, turning into the
   zombie that carries your gear, legacies that help your next character.
4. **Better together.** Everything rewards helping: shared rewards, rescues, carrying a friend
   home. PvP is a choice you walk into, never forced on newcomers.
5. **Blocky, but rich.** Box-built people, guns and places (the style stays) with more texture,
   light, weather and life in them.

### Things we will not do

- No pay-to-win, no buyable currency, no loot boxes, no streaks that punish missing a day, no
  items that expire forever.
- No forced wipes of a player's own progress.
- No smooth/realistic remodels of people, guns or hands (tried, rejected).
- No engine switch to a non-TypeScript engine while the shared TS simulation is our core.

---

## Where we are (honest summary of the audit)

**Strong:** server-authoritative shooting with lag compensation, predicted movement (sprint,
slide, mantle, prone), 30+ survival weapons, a 3 km procedural Deadwood with ~90 places,
infection with turning, day/night, weather, heli drops, barricades, a pixel-art renderer with
forest LOD and an optional WebGPU path, a character creator, procedural audio, 566 tests.

**In flight (agent branches):** DayZ-style grid inventory, drivable cars, deeper per-player
quests with a journal, a fuller lit Haven + the start-cabin pickups + $50 start money, ambient
Haven people, object textures/trim. Already merged on `phase-15`: dodgeable zombie attacks,
one-shot headshots (except brutes), guns+ammo in homes, tree texture, softer lamps, new rain,
inventory scroll fix, infection clock, adrenaline at Gus.

**Weak / missing:**
- **Nothing persists.** Survival profiles live in memory, keyed by *name* (anyone typing your name
  gets your gear); lost on every deploy, restart or story end.
- **Cost ceiling.** Inputs at 30 msg/s/player ⇒ Cloudflare's free plan covers ~18 player-hours
  per day (30 people at once = ~37 minutes). Past the limit, players get errors.
- **Scaling.** Every snapshot goes to everyone (no area-of-interest, no delta compression);
  zombies use the same 32 player slots as people. (A crash from this at 3+ players was found and
  hot-fixed today.)
- No chat (text or voice), no parties, no progression, no crafting, no base building, no storage,
  no tutorial, no music, no controller/touch, thin accessibility, no moderation tools, no
  analytics, survival zombies have no pathfinding.
- Code hot spots: `director.ts` (1.9k lines, does everything), `main.ts`, `survival-hud.ts`.

---

## Phase 0 — Foundations: stable, cheap, scalable (do first)

Nothing else matters if the server falls over or the free plan runs out.

| # | Item | Size | Why |
|---|---|---|---|
| 0.1 | ✅ Fix survival pool crash at 3+ players; tick errors logged, not fatal | S | Done & live (hotfix) |
| 0.2 | **Input batching**: send input every 3–4 ticks (15–20 Hz → ~10 msgs/s) without hurting prediction | M | Cuts Cloudflare request use 3×: ~55 free player-hours/day |
| 0.3 | **Area-of-interest snapshots**: 64 m grid; full rate ≤ 190 m, far players 5 Hz, nothing beyond view | L | Bandwidth, CPU, and kills wallhack/ESP cheats |
| 0.4 | **Delta snapshots** against the client's last acknowledged one (`ackSeq` exists) | M | Bandwidth |
| 0.5 | **Lightweight zombie entities**, separate from player slots (no character controller; compact record in snapshots) | L | 32 slots for people; 100–150 zombies per world |
| 0.6 | **Budget panel** on `/healthz` + admin: requests today vs the free allowance; graceful "servers full — help keep them running" screen instead of hard errors | S | Never surprise-fail |
| 0.7 | Decide hosting money: stay free until ~15 player-hours/day, then Workers Paid ($5/mo, ~$5–10 per busy world). Optional Ko-fi with an in-game "server fuel" bar | S | Stays free to play forever |
| 0.8 | **Split `director.ts`** into loot / inventory / story / population / trade modules (quests branch already pulls out `story.ts`) | M | Lets many features land without merge pain |
| 0.9 | Multi-player soak test in CI (8 bots + 30 zombies, 10 min) + client frame-time benchmark (fixed Deadwood flythrough) | M | Catch crashes & perf regressions automatically |
| 0.10 | Rate-limit actions; admin kick/ban/teleport/give/set-time | S | Moderation basics |
| 0.11 | Error reporting (server + client) into a free log sink | S | See what breaks for players |

---

## Phase 1 — Game feel ("juice"): make every action satisfying

Research: impact feel comes from **hit-stop + coherent sound + camera** together; Vlambeer's
"Art of Screenshake"; Doom's push-forward combat.

| # | Item | Size |
|---|---|---|
| 1.1 | **Trauma camera shake** (trauma², noise, rotation-only) for guns, hits, explosions, zombie claws — with a slider and "reduce motion" | S |
| 1.2 | **Gun feel pass**: muzzle light pulse, spring viewmodel kick, shell casings that stay (tiered caps), 5-layer shot sounds with 3–5 variants ±5% pitch, environment tails (cabin vs forest) | M |
| 1.3 | **Hit confirmation language**: body tick / crunchy headshot / two-note kill sting / dull "armoured" thud; zombie flinch, limb-cube pop, blood-cube decals (blocky gore) | M |
| 1.4 | **Melee overhaul**: wind-up pose, swing trail, 40/80/120 ms hit-stop on both sides, stagger → **finisher** prompt (Doom-style) that guarantees a small drop | M |
| 1.5 | Movement comfort: coyote time, jump buffer, landing dip, sprint FOV kick, surface footsteps; weighty in Deadwood, snappier in arenas | S |
| 1.6 | **Use timers** with animations (bandage 3 s, eat 2 s, reload interrupts) — cancel on sprint | S |
| 1.7 | Low-HP heartbeat + lowpass muffle, infection-tick sound, rarity pitch on pickups | S |

---

## Phase 2 — The first hour: hook players and give them direction

Research: 46% of mobile / 32% of PC web players have quit a game over load time; survival games
lose newcomers to "no direction" and fresh-spawn deaths.

| # | Item | Size |
|---|---|---|
| 2.1 | **Instant start**: link → in the cabin in < 10 s (code-split per mode, stream Deadwood chunks, playable while loading) | M |
| 2.2 | **Character card**: auto-generated name + past life ("Ellen Voss, ex-postal worker") and the line *"This is how she died."* | S |
| 2.3 | **Scripted first 10 minutes** (cabin → note → gun & knife → first daylight zombie with a telegraphed attack → first loot house with a backpack → walk to Haven → dusk horn, gates close, everyone at the fire → job board) | L |
| 2.4 | **Always one next step**: Haven job board + NPC requests + rumour markers; compact tracker | M |
| 2.5 | Newcomer shield: no hunger for the first in-game day, gentler zombies near the cabin, death in the first 10 min keeps your loot | S |
| 2.6 | Context hints instead of a controls wall (first time you see a door/loot/zombie) | S |
| 2.7 | **Haven as hope**: warm light, music, ambient people, NPC chatter, cooking smells… (camp agent in flight) | M |

---

## Phase 3 — Survival depth without chores

Research: Valheim's "hunger as a buff" and "Rested", Zomboid's learn-by-doing, 7 Days to Die's
horde nights; players hate upkeep chores and 60-second crafts.

| # | Item | Size |
|---|---|---|
| 3.1 | **Needs as buffs**: "Well fed" / "Hydrated" / **"Rested"** (sit at the Haven fire or sleep in a bunk → XP bonus + infection resistance). Starving hurts slowly, never kills an AFK player | M |
| 3.2 | **Crafting (short, ≤ 10 s, while walking)**: bandages from rags, lockpicks, molotovs, pipe bombs, silencers from bottles, barricade kits, arrows/bolts — using today's junk items | L |
| 3.3 | **Base building, light**: placeable plank walls, doors, spike traps, a lockable stash crate; shared barricades decay, personal stash at Haven never does (no offline-raid misery) | L |
| 3.4 | **Storage**: put things *into* containers (cars, crates, lockers); personal Haven locker | M |
| 3.5 | **Learn-by-doing skills** (5 levels each): Aim, Melee, Stealth, Medic, Mechanic, Carpentry, Fitness. Field manuals multiply XP | L |
| 3.6 | Status effects with stakes: wet/cold at night in rain (campfire, dry clothes), sprained ankle from falls, food poisoning from bad meat, fatigue | M |
| 3.7 | Hunting & cooking (deer, boar, rabbits; cook at fires), fishing at the lake, a Haven vegetable patch | L |
| 3.8 | Weapon condition & a few attachments (suppressor, scope, flashlight mount, extended mag) — repaired by Ray the mechanic | M |
| 3.9 | **Zombie pathfinding** (flow fields around places, door/window entry, clawing at doors) + readable states (idle/investigate/chase/lost) | L |

---

## Phase 4 — Persistence & progression: death is a chapter, not a reset

Research: forced wipes and lost bases drive players away (Tarkov, Dune: Awakening lost ~95%);
Arc Raiders keeps account unlocks; Zomboid makes death memorable.

| # | Item | Size |
|---|---|---|
| 4.1 | **Anonymous accounts**: a random secret token in the browser (optional later: link Discord/email to keep it across devices). Fixes name impersonation | M |
| 4.2 | **Save characters and the world** to Durable Object storage (on leave + every few minutes): gear, needs, infection, position; world: quests, discovered places, Haven upgrades, graves. Survives deploys | L |
| 4.3 | What's **lost on death**: the character, their skills, what they carried. What's **kept**: account cosmetics, Haven locker, the camp library (field manuals you brought home), journal of past lives, NPC reputation | M |
| 4.4 | **Legacy traits**: each dead character leaves one small perk earned by how they lived (40 kills → *Steady Hands*, 5 nights survived → *Night Owl*); pick one when you start anew | M |
| 4.5 | **Obituary wall** in Haven: blocky portrait, days survived, kills, how they died; players leave flowers | M |
| 4.6 | **Evacuation (prestige)**: reach the extraction heli with rare items to retire a character on purpose — they become a Haven NPC with their name who gives future characters a bonus | L |
| 4.7 | **Field Notes**: 7 weekly challenges that bank (do them any day, no streaks) → cosmetic rewards only (hats, jackets, gun wraps, camp banners); old season items come back later | M |
| 4.8 | **Survival Journal** achievements that read like stories ("Bitten but cured", "Carried a stranger home") with shareable image cards | M |

---

## Phase 5 — Social: the browser's superpower is friends

Research: 54% of web players play with friends/family; Arc Raiders: ~95% use proximity chat;
Krunker's Discord Activity doubled its players; Apex's ping wheel cut toxicity.

| # | Item | Size |
|---|---|---|
| 5.1 | **Text chat** (proximity + Haven-wide + party), rate-limited, filter on by default, per-player mute | S |
| 5.2 | **Ping wheel**: zombie / loot / go here / help / infected! — works without a mic, in every mode | M |
| 5.3 | **Friendly emote/bark** on one key (DRG's "Rock and Stone") | S |
| 5.4 | **Proximity voice** (WebRTC, push-to-talk, off by default for newcomers); a radio item for long range; dead players go silent; **loud voices attract zombies** | L |
| 5.5 | **Parties & invite links**: "join my camp" links with preview cards; party members spawn near each other, share map pings and quest credit | M |
| 5.6 | **Multiple worlds + world picker**: fill the busiest world first; private worlds by link; character not tied to one world | L |
| 5.7 | **PvP by choice**: Haven is a hard safe zone; forest PvE by default; a "Lawless" region (far north / military base) with PvP on and better loot. Reputation (Saint / Neutral / Raider) shown by clothing colour; trust handshake & *Oathbreaker* mark | L |
| 5.8 | Two-person tasks: stretcher a downed friend, carry a generator, hot-wire a car while someone keeps watch | M |
| 5.9 | Spectate friends after death; trade window between players | M |
| 5.10 | Endorse a "good camp-mate" after a night | S |

---

## Phase 6 — A living world with a director

Research: Left 4 Dead's AI Director (build-up → peak → relax), Hunt's sound traps, 7DTD blood
moons, Zomboid's helicopter event, State of Decay's community.

| # | Item | Size |
|---|---|---|
| 6.1 | **"The Rot" — tension director** per player/group: stress from damage, nearby dead, low ammo, darkness → spawns out of sight ahead of you at peaks, holds back during relax, moves caches | L |
| 6.2 | **Sound as information**: crows/birds scatter only for players (and go silent near hordes); glass and branches underfoot; gunshots pull zombies from 150 m+; car alarms | M |
| 6.3 | **Adaptive music**: 3–4 stems by tension, dusk horn stinger, warm Haven theme, silence as a weapon | L |
| 6.4 | **Red Night sieges** every ~7 in-game days: everyone online defends Haven; the gate banner remembers wins; Haven can grow — or shrink after a failed siege | L |
| 6.5 | **Camp morale** as a shared bar: deliveries, defended nights, funerals raise it → trader tiers, new services; low morale → NPCs leave (and you may meet them later, turned) | M |
| 6.6 | **Radio Free Deadwood**: a camp DJ reads out real server events ("Heli drop at the quarry", "Ellen Voss didn't make it") | M |
| 6.7 | **Named Alphas** per region (the Sawmill Brute, the Choir at the church) that unlock the next region / trader tier | L |
| 6.8 | New zombie behaviours: play dead, crawlers under cars, **mimics** that repeat the last nearby chat line ("help… over here") | M |
| 6.9 | **Weather that changes the map**: storms flood the river and cut the bridge, fog lets hordes migrate, snow shows footprints | L |
| 6.10 | Human threats: bandit NPC camps, raiders who come for Haven's supplies | L |
| 6.11 | **Your turned self**: you rise at your death spot wearing your clothes, name floating above — friends put you down and recover your gear | S (mostly exists) |
| 6.12 | Graves: bury bodies for morale and a small buried stash | S |

---

## Phase 7 — Looks & performance: blocky, but rich (tech roadmap)

Research verdict: **stay on three.js** (r187). Our look is limited by draw calls, textures,
shadows and post effects, which three already has; switching would cost the shared TS simulation
that is our biggest asset. The pixel look is a perf *advantage*: screen effects run at low internal
resolution.

| # | Item | Size |
|---|---|---|
| 7.1 | **Device tiers** (auto-detect + 10 s frame probe): shadows, draw distance, decal/corpse caps, DPR cap, fog density | M |
| 7.2 | **Chunk building in a Web Worker** (no hitches while walking) | M |
| 7.3 | **Cascaded shadows** (three's `SunLight`) — shadows out to forest scale | M |
| 7.4 | **Pixel texture arrays** (16–32 texels/m, nearest) for wood, metal, brick, cloth, bark — detail without smoothness | M |
| 7.5 | **Ambient occlusion** at internal resolution, quantised to the palette — corners and boxes get depth | M |
| 7.6 | **Volumetric fog & light shafts** (low-res ray-march) for lamps in mist and moonlight through trees | M |
| 7.7 | `BatchedMesh` per chunk; pixelated multi-angle impostors for far trees | M |
| 7.8 | Many lamps via tiled lights (WebGPU) once a place has > 8 | M |
| 7.9 | GPU grass and particles (WebGPU compute, WebGL fallback) | L |
| 7.10 | **WebGPU vs WebGL benchmark** on ~6 devices (Intel laptop, M1, mid Android, iPhone Safari, Firefox, Chromebook); make WebGPU default only at CPU parity, then drop GLSL twins (TSL only) | M |
| 7.11 | **Babylon.js 9 spike** (1 week, optional): render one Deadwood chunk from shared data with our post pass; switch only if ≥ 30% faster on our real scene | M |
| 7.12 | Optional desktop build (Electron + "Ultra" preset, Steam later) — same code | M |

---

## Phase 8 — Reach: everyone, everywhere, still free

| # | Item | Size |
|---|---|---|
| 8.1 | **Accessibility pack**: full remap (exists), FOV 70–110, separate music/ambience/voice/UI volumes, captions for directional threats ("Horde — north-east"), colour-blind safe markers (shape + colour), flicker/photosensitivity toggle, reduce motion, UI scale, hold/toggle everything | M |
| 8.2 | **Gamepad** support with gentle aim slow-down (needs the input button field widened to 32 bits) | M |
| 8.3 | **Touch/mobile** twin-stick controls with aim assist; separate pool or input-based balancing | L |
| 8.4 | **Clips**: rolling 15–30 s replay buffer → "Save clip" (WebM); end-of-night highlight reel from server events; photo mode | M |
| 8.5 | **Discord**: community server, Rich Presence, then a **Discord Activity** build (office FFA + zombies) | M |
| 8.6 | **CrazyGames "lite" build** (office maps + co-op zombies, < 20 MB) with ads *only between rounds* → funnels players to Deadwood; main site stays ad-free | M |
| 8.7 | Community map/camp editor (blocky primitives), shared by link; monthly map jam | XL |

---

## Signature ideas (what makes Deadwood unlike anything else)

1. **The bitten clock as drama** — race to the medic with an escort, hunt adrenaline, or ask a
   friend to end it; your last words go out on Haven radio.
2. **You become the zombie** that carries your gear, your name over its head.
3. **Obituary wall + graves + Radio Free Deadwood** — the server writes its own story.
4. **Legacy traits & evacuation** — dying hands your next character a gift; escaping makes you a
   Haven legend NPC.
5. **The Rot** — a director with moods (Fog Night, Hunting Season, the Choir) the camp prophet
   hints at.
6. **Mimic infected** that repeat what players said.
7. **Red Nights** where everyone online holds the gate.
8. **Trust handshake / Oathbreaker** and reputation colours.
9. **Loud voices draw the dead** — proximity chat as a risk.
10. **Weather that rewrites the map** each session.

---

## How we'll know it's working

- Time from link to first movement (target < 10 s on a mid laptop).
- First-session length and % who reach Haven; % who come back the next day/week.
- Average group size; % of sessions with chat/ping use.
- Crash-free hours; tick time p99; client frame time per device tier.
- Requests/day vs budget.

---

## Order of work (proposal)

1. **Now — finish & merge the in-flight branches** (start cabin/Haven, camp people, detail,
   cars, quests, grid inventory), each rebased on `phase-15`, tested, shown, then deployed.
2. **Sprint A — Foundations**: 0.2 input batching, 0.6 budget panel, 0.8 split director, 0.9 soak
   test, 0.10 moderation, 4.1 anonymous accounts, 4.2 persistence. *(The game stops losing
   everything on every deploy.)*
3. **Sprint B — Feel**: 1.1–1.7.
4. **Sprint C — First hour**: 2.1–2.6 + text chat 5.1 + ping wheel 5.2.
5. **Sprint D — Scale**: 0.3 area-of-interest, 0.4 deltas, 0.5 lightweight zombies, 7.1 device
   tiers, 7.2 worker chunks.
6. **Sprint E — Depth**: 3.1 buffs/Rested, 3.2 crafting, 3.4 storage, 3.9 pathfinding, 6.1 The Rot,
   6.2 sound, 6.3 music.
7. **Sprint F — Progression & social**: 4.3–4.8, 5.4–5.7.
8. **Sprint G — Living world**: 6.4–6.12, 3.3 building, 3.5 skills.
9. **Sprint H — Looks**: 7.3–7.10 (+ optional 7.11 spike).
10. **Sprint I — Reach**: 8.1–8.6.

Each sprint ends the same way: tests + screenshots → you play it → "deploy".
