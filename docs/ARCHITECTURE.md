# Frota Estelar — Architecture & Module Contracts

This document is the integration contract between modules. Implementers must
follow the signatures and data shapes here exactly; `docs/SPEC.md` describes
gameplay rules and `docs/design/*.md` hold the long-form design proposals.

Fixed decisions:

- Vanilla JavaScript ES modules, no build step, no TypeScript, no frameworks, no
  external asset files. Shared code must run unchanged in Node 22 and modern browsers.
- Server: Node 22 + `ws`. Client: HTML5 Canvas 2D + Web Audio API.
- UI text in Brazilian Portuguese (pt-BR). Identifiers and comments in English.
- Simulation is a pure, deterministic, fixed-timestep engine (20 ticks/s). It never
  touches the DOM, timers, `Date`, or `Math.random`.
- Multiplayer is server-authoritative: the server simulates and streams frames.
  Single-player simulates in the browser. The renderer and audio consume the same
  frame format in both cases.

## 1. Repository layout

```
package.json                 scripts: start, test, simulate, e2e
shared/                      isomorphic, zero dependencies
  constants.js               tick rate, budgets, limits, world size, flags
  rng.js                     seeded PRNG (xoshiro128**) — DONE
  catalog.js                 factions, ships, weapons, abilities, presets — DONE
  fleet.js                   fleet validation, cost, presets scaling, autocomplete
  botFleet.js                computer fleet builder (random / preset / counter)
  levels.js                  single-player level ladder + AI difficulty profiles
  protocol.js                message type constants + payload validators
  sim/
    battle.js                createBattle / stepBattle / makeSnapshot / getResult / runToEnd / hashState
    spatial.js               uniform grid spatial hash
    movement.js              steering, separation, arena bounds
    weapons.js               firing, projectiles, hit resolution, damage application
    abilities.js             ability registry: trigger(ctx) + cast(ctx) per ability id
    ai.js                    per-ship decide(), team think, difficulty knobs
    deploy.js                initial deployment layout
    stats.js                 per-player stats accumulation + result/tiebreak
server/
  index.js                   bootstrap: http static + WebSocketServer (PORT env, default 3000)
  static.js                  static file server for client/ and shared/
  session.js                 per-socket session, token reconnection, rate limiting
  lobby.js                   room registry + message routing
  room.js                    room state machine (lobby → countdown → battle → results)
  match.js                   match runner: tick loop, frame broadcast
client/
  index.html                 single page; <div id="app"> + <canvas id="arena">
  styles.css
  app.js                     screen router + app state
  i18n.js                    pt-BR strings (object T)
  screens/                   menu.js, howto.js, spSetup.js, fleetBuilder.js, lobby.js, battle.js, results.js, codex.js, options.js
  battle/
    feed.js                  BattleFeed interface + emitter helper
    localRunner.js           runs shared/sim in the browser (Worker or main thread) → BattleFeed
    simWorker.js             Web Worker entry running the sim
    netClient.js             WebSocket client (lobby API + BattleFeed)
    interpolator.js          frame buffer + interpolation
    renderer.js              Canvas 2D renderer entry (camera, draw loop)
    sprites.js               procedural ship sprite definitions + cache
    effects.js               particles, projectiles, beams, explosions, ability VFX
    background.js            parallax starfield / nebula / planet
    camera.js
    hud.js
  audio/
    index.js                 AudioEngine singleton (buses, voice pool, event mapping)
    recipes.js               SFX synthesis recipes
    music.js                 generative soundtrack
tools/
  simulate.js                headless CLI: fleet vs fleet, N seeds, matrices
test/                        node:test unit tests (test/**/*.test.js)
test-e2e/                    Playwright end-to-end (run.js)
docs/
```

## 2. Shared data shapes

```js
/** @typedef {{ cls: string, count: number }} FleetEntry */
/** @typedef {{ faction: string, ships: FleetEntry[] }} Fleet */
// faction ∈ FACTION_IDS; every cls must belong to that faction (catalog SHIPS[cls].faction).

/** @typedef {'facil'|'normal'|'dificil'|'especialista'} Difficulty */

/**
 * @typedef {Object} BattlePlayer
 * @property {string} id         stable id ('p1', 'bot_2'...)
 * @property {string} name
 * @property {0|1} team
 * @property {boolean} isBot
 * @property {Fleet} fleet       validated
 * @property {Difficulty} [ai]   AI profile for this player's ships. Humans default to 'especialista'.
 */

/**
 * @typedef {Object} BattleConfig
 * @property {number|string} seed
 * @property {BattlePlayer[]} players       1..12, both teams non-empty
 * @property {number} [maxTicks]            default MAX_TICKS
 * @property {number} [suddenDeathTick]     default SUDDEN_DEATH_TICK
 */
```

### 2.1 `shared/fleet.js`

```js
export function fleetCost(fleet) → number
export function fleetShipCount(fleet) → number
export function normalizeFleet(fleet) → Fleet          // merge duplicates, drop count<=0, stable order by catalog
/**
 * @returns {{ ok: true, fleet: Fleet } | { ok: false, code: string, detail?: any }}
 * Error codes: FLEET_BAD_SHAPE, FLEET_UNKNOWN_FACTION, FLEET_UNKNOWN_CLASS, FLEET_WRONG_FACTION,
 *   FLEET_OVER_BUDGET, FLEET_SHIP_COUNT (total not in [minShips,maxShips]), FLEET_CLASS_CAP (size-class cap exceeded)
 */
export function validateFleet(fleet, budget = DEFAULT_BUDGET) → result
export function presetFleet(presetId, budget) → Fleet   // scale preset counts to budget: buy in listed priority order,
                                                        // repeat cycles while affordable, respect caps, never exceed budget
export function autoComplete(fleet, budget, rng) → Fleet // fill remaining budget with faction ships (cheap/useful mix), respecting caps
export function fleetSummary(fleet) → { cost, count, bySize: Record<sizeClass, number>, ehp, dps }
export function fleetToArray(fleet) → string[]           // expanded class ids in deployment order (big → small)
```

### 2.2 `shared/botFleet.js`

```js
/**
 * @param {Object} o
 * @param {number} o.budget
 * @param {Difficulty} o.difficulty
 * @param {import('./rng.js')} o.rng
 * @param {string} [o.faction]          force a faction; otherwise rng.pick(FACTION_IDS)
 * @param {Fleet[]} [o.enemyFleets]     known enemy fleets (used by 'counter' builders)
 * @param {'random'|'preset'|'counter'} [o.builder]  override the difficulty's builder
 * @returns {Fleet}   always valid for the budget
 */
export function buildBotFleet(o)
// facil: random legal fleet, spends 60–85% of budget, never buys a mothership.
// normal: random preset of the faction scaled to budget (presetFleet) then autoComplete.
// dificil / especialista: 'counter' — scores each preset of the faction against the enemy fleets'
//   size/hull/shield mix (see SPEC §5.3 matrix), picks the best (ties by rng), scales, autoCompletes.
```

### 2.3 `shared/levels.js`

```js
export const AI_PROFILES = { facil, normal, dificil, especialista }   // knobs, see SPEC §4.6
export const HUMAN_AI_PROFILE = AI_PROFILES.especialista
export const LEVELS = [ { n, name, desc, enemyFaction: string|'random', enemyBudgetMul, builder, boss?: string } ... ]  // 15 entries
export function levelInfo(n) → level   // n > 15: endless scaling (SPEC §5.1)
export function enemyBudget(level, difficulty, baseBudget) → number  // round(base * level.enemyBudgetMul * AI_PROFILES[difficulty].budgetMul)
```

### 2.4 `shared/protocol.js`

```js
export const C2S = { HELLO, CREATE_ROOM, JOIN_ROOM, LEAVE_ROOM, SET_ROOM, PICK_SLOT, ADD_BOT, REMOVE_BOT, SET_FLEET, READY, START, REMATCH, CHAT, PING }
export const S2C = { WELCOME, ERROR, ROOM, LEFT, COUNTDOWN, BATTLE_START, FRAME, BATTLE_END, CHAT, PONG }
export const ERR = { BAD_MESSAGE, BAD_NAME, VERSION_MISMATCH, RATE_LIMITED, ROOM_NOT_FOUND, ROOM_FULL, NOT_HOST, WRONG_PHASE,
                     BAD_TEAM_SIZE, BAD_BUDGET, SLOT_TAKEN, SLOT_INVALID, FLEET_INVALID, FLEET_MISSING, NOT_ALL_READY, COUNTDOWN_ABORTED, NOT_IN_ROOM }
export function validateName(s) → string|null       // trim, 1..16 chars, no control chars
export function isRoomCode(s) → boolean              // 4 chars of ROOM_CODE_ALPHABET
export function validateMessage(msg) → { ok, code? } // shape check per type (numbers are integers in range, strings bounded)
```

## 3. Simulation (`shared/sim/battle.js`)

```js
export function createBattle(config: BattleConfig) → BattleState
export function getInitialShips(state) → ShipInit[]
export function stepBattle(state) → SimEvent[]      // advances exactly one tick; returns this tick's events (new array each call)
export function makeSnapshot(state) → Snapshot
export function getResult(state) → BattleResult | null
export function hashState(state) → string            // hex; identical for identical (config, tick)
export function runToEnd(config, { onTick } = {}) → BattleResult
export function battleWorld(state) → { w, h }
export const AI_PROFILES  // re-export from levels.js for convenience

/**
 * @typedef {Object} ShipInit
 * @property {number} id          sequential from 1
 * @property {string} cls         catalog ship id
 * @property {string} owner       BattlePlayer.id
 * @property {0|1} team
 * @property {number} x
 * @property {number} y
 * @property {number} a           heading radians (0 = +x)
 * @property {number} [source]    spawning ship id for spawned units (not for initial ships)
 *
 * @typedef {Object} Snapshot
 * @property {number} k           tick
 * @property {number[][]} s       alive ships: [id, round(x*10), round(y*10), heading 0..255, hp‰ 0..1000, shield‰ 0..1000, flags]
 *                                flags are the FLAG bits from constants.js
 *
 * @typedef {Object} BattleResult
 * @property {0|1|-1} winner      -1 = draw
 * @property {'elimination'|'timeout'|'draw'} reason
 * @property {number} ticks
 * @property {number[]} remainingValue   [team0, team1]  Σ cost × (hp+shield)/(maxHp+maxShield) over surviving purchased ships
 * @property {Record<string, PlayerStats>} players
 * @property {{ shipId:number, cls:string, owner:string, damageDealt:number }|null} mvp
 *
 * @typedef {Object} PlayerStats
 * @property {number} damageDealt
 * @property {number} damageTaken
 * @property {number} healing
 * @property {number} kills
 * @property {number} losses
 * @property {number} shipsTotal      purchased ships
 * @property {number} shipsAlive
 * @property {number} valueAlive
 */
```

`BattleState` is a plain object (no classes): `{ tick, rng, config, world, ships: Ship[] (index = id-1, includes dead), alive: number[] per team, projectiles, areas, grid, teams: [TeamState, TeamState], stats, events, nextId, suddenDeath: bool, ended: BattleResult|null }`. Iteration is always in id order. All randomness goes through `state.rng`.

### 3.1 Events (`SimEvent`, compact arrays, first element is the type)

```
['shot',  srcId, dstId, weaponIdx, hit]                 hitscan weapon fired (laser, ion lance, contact). hit 0|1
['charge', srcId, weaponIdx, seconds]                   telegraphed heavy beam starts charging
['proj',  projId, srcId, dstId, weaponIdx, x, y]        projectile launched from (x,y) toward dst; client animates it
['pend',  projId, outcome, x, y]                        projectile ended at (x,y): 0 miss/fizzle, 1 hit, 2 intercepted
['hit',   dstId, amount, dmgType, toShield]             damage applied (amount integer ≥ 1); toShield 0|1
['sbreak', id]                                          shield reached 0
['die',   id, killerId, x, y]                           killerId 0 if none (e.g. lifetime expiry)
['cast',  srcId, abilityId, targetId, x, y]             ability activated; targetId 0 if none; (x,y) effect center
['spawn', id, cls, team, ownerId, x, y, a, sourceId]    spawned unit (also pushed to initial ships of late joiners)
['heal',  srcId, dstId, amount, kind]                   kind 'hull'|'shield'
['aoe',   x, y, radius, kind]                           splash impact / area pulse for VFX+SFX; kind = dmgType or abilityId
['area',  areaId, kind, x, y, radius, on]               persistent area (acid cloud, singularity) created (on=1) / removed (on=0)
['phase', name]                                         'engage' (first contact) | 'suddenDeath'
['end',   winner, reason]
```

Events reference ships by numeric id. Clients look up `cls`, faction, size class and owner from the battle start info and `spawn` events.

### 3.2 Frames

A **frame** is what both the local runner and the server emit every `SNAPSHOT_EVERY` ticks:

```js
{ k: tick, s: Snapshot.s, e: SimEvent[] }   // e = events of the ticks since the previous frame, in order
```

## 4. Server

### 4.1 Static (`server/static.js`)
Serves `client/` at `/` and `shared/` at `/shared/` with correct MIME types (`.js` → `text/javascript`, `.html`, `.css`, `.svg`, `.json`, `.ico`), `Cache-Control: no-cache`, path traversal blocked, `/` → `client/index.html`. `/health` returns JSON `{ ok, rooms, uptime }`.

### 4.2 Protocol (JSON text frames, `t` = type; C2S may carry `rid` echoed in `ack`/`error`)

| Dir | `t` | Payload | Notes |
|---|---|---|---|
| C→S | `hello` | `{ name, token?, version }` | token resumes a session dropped < 60 s ago |
| S→C | `welcome` | `{ playerId, token, version, serverTime }` | |
| S→C | `ack` | `{ rid }` | success for a request without other response |
| S→C | `error` | `{ rid?, code, detail? }` | codes in `ERR`; client translates |
| C→S | `create_room` | `{ teamSize, budget }` | teamSize 1..6, budget ∈ BUDGETS points; creator = host, team 0 slot 0 |
| C→S | `join_room` | `{ code }` | joins first free slot (team with fewer humans); full → spectator |
| C→S | `leave_room` | `{}` | |
| C→S | `set_room` | `{ teamSize?, budget?, botDifficulty? }` | host only, lobby phase; shrinking removes extra slots |
| C→S | `pick_slot` | `{ team, slot }` | clears ready |
| C→S | `add_bot` | `{ team, slot, difficulty, faction? }` | host only; bot is always ready; fleet built at countdown |
| C→S | `remove_bot` | `{ team, slot }` | host only |
| C→S | `set_fleet` | `{ fleet }` | server validates with room budget; clears ready; others only see `hasFleet` |
| C→S | `ready` | `{ ready }` | requires valid fleet when true |
| C→S | `start` | `{ fillBots?: boolean }` | host; all slots filled (or fillBots) and all humans ready, else NOT_ALL_READY `{ missing: [...] }` |
| S→C | `room` | `RoomState` | full state push on every change |
| S→C | `left` | `{ reason: 'left'\|'kicked'\|'room_closed' }` | |
| S→C | `countdown` | `{ seconds, startAt }` | bots' fleets are built now (counter builders see human fleets) |
| S→C | `battle_start` | `BattleStartInfo` | includes revealed fleets; for reconnects also `dead: number[]` and the latest frame |
| S→C | `f` | `{ k, s, e }` | frame, 10 Hz |
| S→C | `battle_end` | `{ result: BattleResult }` | |
| C→S | `rematch` | `{}` | when all connected humans voted (or host `start`), back to lobby keeping fleets, ready=false |
| C→S/S→C | `chat` | `{ text }` / `{ from, name, text, ts }` | ≤ 200 chars, 1/s |
| C→S/S→C | `ping`/`pong` | `{ c }` / `{ c, s }` | |

```js
/**
 * @typedef {Object} Slot
 * @property {'empty'|'human'|'bot'} kind
 * @property {string} [playerId]
 * @property {string} [name]
 * @property {Difficulty} [difficulty]   bots
 * @property {string} [faction]          known once a fleet is set (humans) / chosen (bots)
 * @property {boolean} ready
 * @property {boolean} hasFleet
 * @property {boolean} connected
 * @property {boolean} isHost
 *
 * @typedef {Object} RoomState
 * @property {string} code
 * @property {string} hostId
 * @property {number} teamSize
 * @property {number} budget
 * @property {Difficulty} botDifficulty
 * @property {'lobby'|'countdown'|'battle'|'results'} phase
 * @property {Slot[][]} slots            [team0[], team1[]]
 * @property {{ id, name }[]} spectators
 * @property {string[]} rematchVotes
 * @property {string} you                the receiving player's id
 *
 * @typedef {Object} BattleStartInfo
 * @property {number|string} seed
 * @property {{ id, name, team, isBot, faction, fleet, ai }[]} players
 * @property {ShipInit[]} ships
 * @property {{ w:number, h:number }} world
 * @property {number} tickRate
 * @property {number} snapshotEvery
 * @property {number[]} [dead]           reconnect only
 */
```

Validation rules: message ≤ 16 KB, JSON parse in try/catch, unknown `t` → BAD_MESSAGE, token bucket 20 msg/s burst 40, numeric fields `Number.isInteger` + range, never trust client ids (session identifies the player).

Disconnects: lobby → slot `connected=false` for 60 s then empty (host migrates immediately); countdown → aborted; battle → nothing changes, the sim continues; if the player does not return by battle end the slot becomes a bot (normal) for rematch purposes. Room with no humans is destroyed after 60 s.

### 4.3 Match runner (`server/match.js`)

```js
export function startMatch({ config, onFrame, onEnd, tickMs = TICK_MS }) → { stop(), state }
// drift-corrected loop (setInterval 10 ms, compare against nextTickAt), max 8 catch-up ticks per wakeup,
// serializes each frame ONCE per room and broadcasts the string. Emits onEnd(result) then stops.
```

## 5. Client

### 5.1 `BattleFeed` (`client/battle/feed.js`)

```js
/**
 * @typedef {Object} BattleFeed
 * @property {(cb:(info:BattleStartInfo)=>void)=>void} onStart
 * @property {(cb:(frame:{k:number,s:number[][],e:any[],at:number})=>void)=>void} onFrame   // at = performance.now() on arrival
 * @property {(cb:(result:BattleResult)=>void)=>void} onEnd
 * @property {(cb:(status:'ok'|'reconnecting'|'lost')=>void)=>void} onStatus
 * @property {{ setSpeed(x:0|1|2|4):void, isLocal:boolean }} controls   // speed 0 = pause; network feed ignores setSpeed
 * @property {() => void} dispose
 */
export function createLocalRunner(config, { useWorker = true } = {}) → BattleFeed   // emits start immediately, frames at TICK_MS*SNAPSHOT_EVERY*(1/speed)
export function createNetClient(url) → NetClient                                   // see 5.2
```

The local runner must emit frames with exactly the same shape as the server (`{k,s,e,at}`) so `battle.js` screen code does not branch on the source.

### 5.2 `NetClient`

```js
NetClient = {
  connect(name): Promise<{ playerId }>,        // reuses sessionStorage token
  createRoom({ teamSize, budget }): Promise<RoomState>,
  joinRoom(code): Promise<RoomState>,
  leaveRoom(), setRoom(opts), pickSlot(team, slot), addBot(team, slot, difficulty, faction), removeBot(team, slot),
  setFleet(fleet), setReady(bool), start({ fillBots }), rematch(), chat(text): Promise<void>,
  onRoom(cb), onCountdown(cb), onError(cb), onChat(cb), onLeft(cb),
  feed: BattleFeed,            // one instance reused across matches
  latencyMs: number,
  dispose(),
}
```
Requests carry an incrementing `rid`; `ack`/`error` resolve/reject the Promise. Reconnect with backoff 0.5/1/2/4 s (max 5 tries) sending `hello{token}`.

### 5.3 Renderer (`client/battle/renderer.js`)

```js
export function createRenderer(canvas, { start: BattleStartInfo, myTeam: 0|1|null, audio }) → Renderer
Renderer.onFrame(frame)     // push to interpolator; schedule frame.e for VFX/SFX at presentation time
Renderer.draw(nowMs)        // called from rAF by the battle screen
Renderer.resize()
Renderer.setOptions({ showNames, grid, reducedMotion, quality })
Renderer.getView()          // { ships: Map<id, {x,y,a,hp,sh,flags,cls,team,owner}>, tick } — used by HUD
Renderer.camera             // { follow(id), setMode('auto'|'free'), zoomBy(f), pan(dx,dy) }
Renderer.dispose()
```
Interpolation delay: 120 ms local, 160 ms network. Events are applied when presentation time crosses their frame.

### 5.4 Audio (`client/audio/index.js`)

```js
export const audio = {
  init(): Promise<void>,              // call synchronously inside the first pointerdown/keydown handler; idempotent
  isReady(): boolean,
  play(name, opts?): void,            // names: 'ui.hover' 'ui.click' 'ui.confirm' 'ui.error' 'ui.buy' 'ui.countdown' 'ui.go'
                                      // 'shot.<weaponType>' 'hit.hull' 'hit.shield' 'shield.break' 'death' 'cast.<abilityKind>' 'charge'
  consumeEvents(events, lookup): void,// lookup(id) → { cls, faction, sizeClass, team, x, y } for ships referenced by events
  setCamera(cx, cy, halfWidth, aspect): void,
  setBattleState({ aliveFrac: [a,b], destroyedFrac, elapsedSec }): void,   // drives music intensity, ~4 Hz
  setScene('none'|'menu'|'builder'|'battle'|'victory'|'defeat'): void,
  setFactionHint(factionId): void,
  setVolume(bus: 'master'|'music'|'sfx'|'ui', v: 0..1): void, setMuted(bool): void, getSettings(): Settings,
  stats(): { voices, created, coalesced, dropped },
}
```

### 5.5 Screens and testing hooks

- All interactive controls carry `data-test` attributes (`data-test="name"`, `"menu-single"`, `"menu-multi"`, `"faction-<id>"`, `"ship-add-<cls>"`, `"ship-remove-<cls>"`, `"preset-<id>"`, `"fleet-confirm"`, `"room-code"`, `"create-room"`, `"join-room"`, `"join-code"`, `"ready"`, `"start"`, `"slot-<team>-<i>"`, `"add-bot-<team>-<i>"`, `"speed-<x>"`, `"result-winner"`, `"rematch"`, `"next-level"`, ...).
- `window.__fe` debug object exposed when `?debug=1`: `{ state, screen, feed, renderer, errors: [], audio }`.
- URL params: `?sala=CODE` joins directly; `?seed=` fixes the SP seed; `?autotest=1&level=&difficulty=&faction=&preset=&speed=` starts a single-player battle immediately (used by e2e).

## 6. Tools and tests

- `node tools/simulate.js --a <preset|cls:n,...> --b <...> --seeds 50 [--budget 1500] [--ai especialista] [--json]`
- `node tools/simulate.js --matrix --seeds 20` (all presets × all presets, prints win-rate table)
- `node tools/simulate.js --factions --seeds 20` (faction × faction pooled over presets)
- `node tools/simulate.js --difficulty --seeds 30` (each difficulty vs a normal preset fleet)
- Unit tests run with `npm test` (node:test, `test/**/*.test.js`). E2E with `npm run e2e` (Playwright, Chromium at `/opt/pw-browsers`, module at `/opt/node-tools/node_modules/playwright/index.mjs` with fallback to `import('playwright')`).

## 7. Conventions

- Determinism: no `Math.random`, `Date`, timers or object-key-order-dependent iteration inside `shared/sim`. Arrays iterate in id order. `Math.sin/cos/atan2/sqrt/hypot` are allowed.
- Hot paths avoid per-tick allocation where easy (reuse arrays); no premature micro-optimization elsewhere.
- Errors from the server are codes; the client maps them to pt-BR in `i18n.js`.
- Never use `innerHTML` with user-provided strings; use `textContent`.
- Keep modules small and pure where possible; prefer functions over classes in `shared/`.
