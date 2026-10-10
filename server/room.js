// Room state machine: lobby → countdown → battle → results (→ lobby on rematch).
// Slots per team, host migration, bots (difficulty/faction), hidden fleets,
// ready/start conditions, countdown with bot fleet building, rematch votes,
// disconnect rules, spectators and chat. See docs/ARCHITECTURE.md §4.2.
//
// Sessions are plain objects the room only touches through `id`, `name`,
// `roomCode` and `sendRaw(str)`, so tests can use fakes.

import { randomInt } from 'node:crypto';
import {
  COUNTDOWN_SECONDS, RECONNECT_GRACE_MS, TICK_RATE, SNAPSHOT_EVERY, MAX_TICKS, DEFAULT_BUDGET, DIFFICULTIES, TEAM_SIZES, BUDGETS,
} from '../shared/constants.js';
import { FACTION_IDS } from '../shared/catalog.js';
import { validateFleet } from '../shared/fleet.js';
import { buildBotFleet } from '../shared/botFleet.js';
import { createRng } from '../shared/rng.js';
import { createBattle, getInitialShips, battleWorld } from '../shared/sim/battle.js';
import { S2C, ERR, MAX_CHAT_LENGTH } from '../shared/protocol.js';
import { startMatch as defaultStartMatch } from './match.js';

const BUDGET_POINTS = Object.values(BUDGETS).map((b) => b.points);
const BOT_NAMES = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco', 'Foxtrot', 'Golf', 'Hotel', 'Índia', 'Julieta', 'Kilo', 'Lima'];
const DEFAULT_BOT_DIFFICULTY = 'normal';
/** Humans + spectators a room accepts before answering ROOM_FULL. */
export const MAX_MEMBERS = 32;

const defaultClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

const ok = (extra) => (extra ? { ok: true, ...extra } : { ok: true });
const fail = (code, detail) => (detail === undefined ? { ok: false, code } : { ok: false, code, detail });

/**
 * Create a room. The creator becomes host and takes team 0 slot 0.
 * @param {Object} o
 * @param {string} o.code
 * @param {object} o.host                   session of the creator
 * @param {number} [o.teamSize]             1..6
 * @param {number} [o.budget]               one of BUDGETS points
 * @param {string} [o.botDifficulty]        default difficulty for auto-filled bots
 * @param {Function} [o.onDestroy]          (room) => void, after members were notified
 * @param {Function} [o.startMatch]         match runner (injectable for tests)
 * @param {{now():number,setTimeout:Function,clearTimeout:Function}} [o.clock]
 * @param {number} [o.countdownMs]          default 5000 (FE_COUNTDOWN_MS)
 * @param {number} [o.graceMs]              disconnected slot kept for this long (default 60 s)
 * @param {number} [o.emptyRoomMs]          room without connected humans destroyed after this (default 60 s)
 * @param {number} [o.maxTicks]             BattleConfig.maxTicks override (FE_MAX_TICKS)
 * @param {number} [o.tickMs]               loop tick duration (FE_TICK_MS)
 * @param {() => number|string} [o.seedFn]  match seed generator
 * @param {{warn:Function}} [o.log]
 */
export function createRoom(o) {
  const code = o.code;
  const clock = o.clock || defaultClock;
  const startMatch = o.startMatch || defaultStartMatch;
  const onDestroy = o.onDestroy || (() => {});
  const countdownMs = o.countdownMs ?? COUNTDOWN_SECONDS * 1000;
  const graceMs = o.graceMs ?? RECONNECT_GRACE_MS;
  const emptyRoomMs = o.emptyRoomMs ?? RECONNECT_GRACE_MS;
  const seedFn = o.seedFn || (() => randomInt(0, 0x7fffffff));
  const log = o.log || console;

  let teamSize = TEAM_SIZES.includes(o.teamSize) ? o.teamSize : 1;
  let budget = BUDGET_POINTS.includes(o.budget) ? o.budget : DEFAULT_BUDGET;
  let botDifficulty = DIFFICULTIES.includes(o.botDifficulty) ? o.botDifficulty : DEFAULT_BOT_DIFFICULTY;
  let phase = 'lobby';
  let hostId = null;
  let destroyed = false;

  /** @type {Map<string, {id:string, session:object, name:string, connected:boolean, joinedAt:number, team:number, slot:number, fleet:object|null, ready:boolean, graceTimer:any}>} */
  const members = new Map();
  /** @type {Map<string, {id:string, name:string, difficulty:string, faction:string|null, fixedFleet:object|null, assignedFaction:string|null, fleet:object|null}>} */
  const bots = new Map();
  /** @type {({kind:'human'|'bot', id:string}|null)[][]} */
  const grid = [[], []];
  const rematchVotes = new Set();
  let joinCounter = 0;
  let botIdCounter = 0;
  let botNameCounter = 0;
  let countdownTimer = null;
  let destroyTimer = null;
  /** @type {null | {seed:any, runner:any, startInfo:object, dead:Set<number>, spawned:Map<number, object>, lastFrame:string|null, result:object|null}} */
  let match = null;

  for (let t = 0; t < 2; t++) for (let i = 0; i < teamSize; i++) grid[t].push(null);

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  function cell(team, slot) {
    return grid[team][slot];
  }

  function validSlot(team, slot) {
    return (team === 0 || team === 1) && Number.isInteger(slot) && slot >= 0 && slot < teamSize;
  }

  function sendTo(member, str) {
    if (!member.connected) return;
    try {
      member.session.sendRaw(str);
    } catch (err) {
      log.warn('[room] send failed', err);
    }
  }

  function broadcastRaw(str) {
    for (const m of members.values()) sendTo(m, str);
  }

  function broadcastObj(obj) {
    broadcastRaw(JSON.stringify(obj));
  }

  function broadcastState() {
    if (destroyed) return;
    for (const m of members.values()) {
      if (!m.connected) continue;
      sendTo(m, JSON.stringify({ t: S2C.ROOM, ...toState(m.id) }));
    }
  }

  function humansInSlots() {
    const list = [];
    for (let t = 0; t < 2; t++) {
      for (const c of grid[t]) if (c && c.kind === 'human') list.push(members.get(c.id));
    }
    return list;
  }

  function connectedHumans() {
    return [...members.values()].filter((m) => m.connected);
  }

  function clearGrace(m) {
    if (m.graceTimer) {
      clock.clearTimeout(m.graceTimer);
      m.graceTimer = null;
    }
  }

  function cancelDestroyTimer() {
    if (destroyTimer) {
      clock.clearTimeout(destroyTimer);
      destroyTimer = null;
    }
  }

  function maybeScheduleDestroy() {
    if (destroyed) return;
    if (members.size === 0) {
      destroy('room_closed');
      return;
    }
    if (connectedHumans().length > 0) {
      cancelDestroyTimer();
      return;
    }
    if (destroyTimer) return;
    destroyTimer = clock.setTimeout(() => {
      destroyTimer = null;
      if (destroyed || connectedHumans().length > 0) return;
      // Nobody came back within emptyRoomMs: an abandoned battle (paused by
      // syncMatchRunner) is torn down too instead of simulating for no one.
      destroy('room_closed');
    }, emptyRoomMs);
  }

  /**
   * Keep the match loop running only while somebody is connected to watch
   * it: with no connected humans (players or spectators) the runner is paused
   * and the empty-room timer eventually destroys the room; the first
   * reconnect/join resumes the battle from the same tick.
   */
  function syncMatchRunner() {
    if (destroyed || phase !== 'battle' || !match || !match.runner) return;
    const runner = match.runner;
    if (typeof runner.pause !== 'function' || typeof runner.resume !== 'function') return;
    if (connectedHumans().length === 0) runner.pause();
    else runner.resume();
  }

  function migrateHost() {
    const slotted = humansInSlots().filter((m) => m.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    const pool = slotted.length ? slotted : connectedHumans().sort((a, b) => a.joinedAt - b.joinedAt);
    if (pool.length) {
      hostId = pool[0].id;
      return;
    }
    // Nobody connected: keep an existing member as host so hostId stays valid.
    if (!members.has(hostId)) {
      const any = [...members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      hostId = any ? any.id : null;
    }
  }

  function freeSlotFor() {
    const humans = [0, 0];
    for (let t = 0; t < 2; t++) for (const c of grid[t]) if (c && c.kind === 'human') humans[t]++;
    const order = humans[1] < humans[0] ? [1, 0] : [0, 1];
    for (const t of order) {
      const i = grid[t].indexOf(null);
      if (i >= 0) return { team: t, slot: i };
    }
    return null;
  }

  function nextBotName() {
    const n = botNameCounter++;
    const base = BOT_NAMES[n % BOT_NAMES.length];
    return n < BOT_NAMES.length ? `Bot ${base}` : `Bot ${base} ${Math.floor(n / BOT_NAMES.length) + 1}`;
  }

  function makeBot(difficulty, faction, name) {
    const id = `bot_${++botIdCounter}`;
    const bot = { id, name: name || nextBotName(), difficulty, faction: faction || null, fixedFleet: null, assignedFaction: null, fleet: null };
    bots.set(id, bot);
    return bot;
  }

  function botFaction(b) {
    return b.faction || (b.fixedFleet && b.fixedFleet.faction) || b.assignedFaction || undefined;
  }

  function slotView(c) {
    if (!c) return { kind: 'empty', ready: false, hasFleet: false, connected: false, isHost: false };
    if (c.kind === 'human') {
      const m = members.get(c.id);
      return {
        kind: 'human', playerId: m.id, name: m.name, faction: m.fleet ? m.fleet.faction : undefined,
        ready: m.ready, hasFleet: !!m.fleet, connected: m.connected, isHost: m.id === hostId,
      };
    }
    const b = bots.get(c.id);
    return {
      kind: 'bot', playerId: b.id, name: b.name, difficulty: b.difficulty, faction: botFaction(b),
      ready: true, hasFleet: true, connected: true, isHost: false,
    };
  }

  /**
   * RoomState as seen by player `forId` (fleets of others are never included).
   * @param {string} forId
   */
  function toState(forId) {
    return {
      code,
      hostId,
      teamSize,
      budget,
      botDifficulty,
      phase,
      slots: grid.map((row) => row.map(slotView)),
      spectators: [...members.values()].filter((m) => m.team < 0).map((m) => ({ id: m.id, name: m.name, connected: m.connected })),
      rematchVotes: [...rematchVotes],
      you: forId,
    };
  }

  function battleStartMessage(forReconnect) {
    const info = { t: S2C.BATTLE_START, ...match.startInfo };
    if (forReconnect) {
      const alive = [...match.spawned.values()].filter((s) => !match.dead.has(s.id));
      info.ships = match.startInfo.ships.concat(alive);
      info.dead = [...match.dead];
    }
    return JSON.stringify(info);
  }

  function sendBattleSync(m) {
    if (!match) return;
    sendTo(m, battleStartMessage(true));
    if (match.lastFrame) sendTo(m, match.lastFrame);
    if (phase === 'results' && match.result) sendTo(m, JSON.stringify({ t: S2C.BATTLE_END, result: match.result }));
  }

  function clearBotFleets() {
    for (const b of bots.values()) {
      b.fleet = null;
      b.assignedFaction = null;
    }
  }

  function requireHost(session) {
    if (session.id !== hostId) return fail(ERR.NOT_HOST);
    return null;
  }

  function requireMember(session) {
    const m = members.get(session.id);
    if (!m) return { err: fail(ERR.NOT_IN_ROOM) };
    return { m };
  }

  // ---------------------------------------------------------------------
  // membership
  // ---------------------------------------------------------------------

  /**
   * Join: first free slot of the team with fewer humans (lobby only), else spectator.
   * @returns {{ok:true, room:object}|{ok:false, code:string}}
   */
  function join(session) {
    if (destroyed) return fail(ERR.ROOM_NOT_FOUND);
    const existing = members.get(session.id);
    if (existing) return ok({ room: toState(session.id) });
    if (members.size >= MAX_MEMBERS) return fail(ERR.ROOM_FULL);
    const m = {
      id: session.id, session, name: session.name, connected: true, joinedAt: ++joinCounter,
      team: -1, slot: -1, fleet: null, ready: false, graceTimer: null, expired: false,
    };
    members.set(m.id, m);
    session.roomCode = code;
    if (phase === 'lobby') {
      const free = freeSlotFor();
      if (free) {
        grid[free.team][free.slot] = { kind: 'human', id: m.id };
        m.team = free.team;
        m.slot = free.slot;
      }
    }
    if (hostId === null || !members.has(hostId)) hostId = m.id;
    cancelDestroyTimer();
    broadcastState();
    if (phase === 'battle' || phase === 'results') sendBattleSync(m);
    else if (phase === 'countdown') sendCountdown(m);
    syncMatchRunner();
    return ok({ room: toState(m.id) });
  }

  function removeMember(m, reason) {
    clearGrace(m);
    members.delete(m.id);
    rematchVotes.delete(m.id);
    if (m.session.roomCode === code) m.session.roomCode = null;
    const wasSlotted = m.team >= 0;
    if (wasSlotted) grid[m.team][m.slot] = null;
    if (reason === 'left' || reason === 'kicked') sendTo(m, JSON.stringify({ t: S2C.LEFT, reason }));
    if (destroyed) return;
    if (phase === 'countdown' && wasSlotted) abortCountdown();
    if (hostId === m.id) migrateHost();
    if (phase === 'results') checkRematch();
    broadcastState();
    syncMatchRunner();
    maybeScheduleDestroy();
  }

  /** Leave the room voluntarily. */
  function leave(session) {
    const m = members.get(session.id);
    if (!m) return fail(ERR.NOT_IN_ROOM);
    removeMember(m, 'left');
    return ok();
  }

  /** The member's socket dropped. */
  function onDisconnect(session) {
    const m = members.get(session.id);
    if (!m || !m.connected) return;
    m.connected = false;
    if (phase === 'countdown' && m.team >= 0) abortCountdown();
    if (phase !== 'battle') m.ready = false;
    if (hostId === m.id) migrateHost();
    clearGrace(m);
    m.graceTimer = clock.setTimeout(() => {
      m.graceTimer = null;
      expireMember(m);
    }, graceMs);
    if (phase === 'results') checkRematch();
    broadcastState();
    syncMatchRunner();
    maybeScheduleDestroy();
  }

  /**
   * Grace period over. In battle the seat is held until the end (the slot
   * then becomes a bot with the same fleet); otherwise the member is removed.
   */
  function expireMember(m) {
    if (m.connected || members.get(m.id) !== m) return;
    if (phase === 'battle') {
      m.expired = true;
      return;
    }
    removeMember(m, 'expired');
    if (phase === 'results') checkRematch();
  }

  /** The session store dropped this session (token no longer resumable). */
  function onSessionExpired(session) {
    const m = members.get(session.id);
    if (!m) return;
    clearGrace(m);
    m.connected = false;
    expireMember(m);
  }

  /**
   * The member reconnected (same session object). Returns false when the
   * session is no longer part of this room.
   */
  function onReconnect(session) {
    const m = members.get(session.id);
    if (!m) return false;
    m.session = session;
    m.connected = true;
    m.expired = false;
    clearGrace(m);
    cancelDestroyTimer();
    if (hostId === null || !members.has(hostId)) hostId = m.id;
    session.roomCode = code;
    broadcastState();
    if (phase === 'battle' || phase === 'results') sendBattleSync(m);
    else if (phase === 'countdown') sendCountdown(m);
    syncMatchRunner();
    return true;
  }

  /** The COUNTDOWN message is broadcast once; a member arriving mid-countdown needs its own copy. */
  function sendCountdown(m) {
    if (phase !== 'countdown' || !match || !match.startAt) return;
    const seconds = Math.max(0, (match.startAt - clock.now()) / 1000);
    sendTo(m, JSON.stringify({ t: S2C.COUNTDOWN, seconds, startAt: match.startAt }));
  }

  // ---------------------------------------------------------------------
  // lobby actions
  // ---------------------------------------------------------------------

  function setRoom(session, opts) {
    const { m, err } = requireMember(session);
    if (err) return err;
    const h = requireHost(m.session);
    if (h) return h;
    if (phase !== 'lobby') return fail(ERR.WRONG_PHASE, phase);
    const next = {};
    if (opts.teamSize !== undefined) {
      if (!TEAM_SIZES.includes(opts.teamSize)) return fail(ERR.BAD_TEAM_SIZE);
      next.teamSize = opts.teamSize;
    }
    if (opts.budget !== undefined) {
      if (!BUDGET_POINTS.includes(opts.budget)) return fail(ERR.BAD_BUDGET);
      next.budget = opts.budget;
    }
    if (opts.botDifficulty !== undefined) {
      if (!DIFFICULTIES.includes(opts.botDifficulty)) return fail(ERR.BAD_MESSAGE, 'botDifficulty');
      next.botDifficulty = opts.botDifficulty;
    }
    if (next.teamSize !== undefined && next.teamSize !== teamSize) {
      for (let t = 0; t < 2; t++) {
        const row = grid[t];
        while (row.length > next.teamSize) {
          const c = row.pop();
          if (!c) continue;
          if (c.kind === 'human') {
            const hm = members.get(c.id);
            hm.team = -1;
            hm.slot = -1;
            hm.ready = false;
          } else bots.delete(c.id);
        }
        while (row.length < next.teamSize) row.push(null);
      }
      teamSize = next.teamSize;
    }
    if (next.budget !== undefined && next.budget !== budget) {
      budget = next.budget;
      for (const hm of members.values()) {
        if (hm.fleet && !validateFleet(hm.fleet, budget).ok) {
          hm.fleet = null;
          hm.ready = false;
        }
      }
      for (const b of bots.values()) {
        if (b.fixedFleet && !validateFleet(b.fixedFleet, budget).ok) b.fixedFleet = null;
      }
    }
    if (next.botDifficulty !== undefined) botDifficulty = next.botDifficulty;
    broadcastState();
    return ok();
  }

  function pickSlot(session, team, slot) {
    const { m, err } = requireMember(session);
    if (err) return err;
    if (phase !== 'lobby') return fail(ERR.WRONG_PHASE, phase);
    if (!validSlot(team, slot)) return fail(ERR.SLOT_INVALID);
    const c = cell(team, slot);
    if (c && c.id === m.id) return ok();
    if (c) return fail(ERR.SLOT_TAKEN);
    if (m.team >= 0) grid[m.team][m.slot] = null;
    grid[team][slot] = { kind: 'human', id: m.id };
    m.team = team;
    m.slot = slot;
    m.ready = false;
    broadcastState();
    return ok();
  }

  function addBot(session, team, slot, difficulty, faction) {
    const { m, err } = requireMember(session);
    if (err) return err;
    const h = requireHost(m.session);
    if (h) return h;
    if (phase !== 'lobby') return fail(ERR.WRONG_PHASE, phase);
    if (!validSlot(team, slot)) return fail(ERR.SLOT_INVALID);
    if (cell(team, slot)) return fail(ERR.SLOT_TAKEN);
    if (!DIFFICULTIES.includes(difficulty)) return fail(ERR.BAD_MESSAGE, 'difficulty');
    if (faction !== undefined && faction !== null && !FACTION_IDS.includes(faction)) return fail(ERR.BAD_MESSAGE, 'faction');
    const bot = makeBot(difficulty, faction || null);
    grid[team][slot] = { kind: 'bot', id: bot.id };
    broadcastState();
    return ok({ botId: bot.id });
  }

  function removeBot(session, team, slot) {
    const { m, err } = requireMember(session);
    if (err) return err;
    const h = requireHost(m.session);
    if (h) return h;
    if (phase !== 'lobby') return fail(ERR.WRONG_PHASE, phase);
    if (!validSlot(team, slot)) return fail(ERR.SLOT_INVALID);
    const c = cell(team, slot);
    if (!c || c.kind !== 'bot') return fail(ERR.SLOT_INVALID, 'not_a_bot');
    bots.delete(c.id);
    grid[team][slot] = null;
    broadcastState();
    return ok();
  }

  function setFleet(session, fleet) {
    const { m, err } = requireMember(session);
    if (err) return err;
    if (phase !== 'lobby' && phase !== 'results') return fail(ERR.WRONG_PHASE, phase);
    const v = validateFleet(fleet, budget);
    if (!v.ok) return fail(ERR.FLEET_INVALID, { code: v.code, detail: v.detail });
    m.fleet = v.fleet;
    m.ready = false;
    broadcastState();
    return ok();
  }

  function setReady(session, ready) {
    const { m, err } = requireMember(session);
    if (err) return err;
    if (phase !== 'lobby') return fail(ERR.WRONG_PHASE, phase);
    if (m.team < 0) return fail(ERR.SLOT_INVALID, 'spectator');
    if (ready && !m.fleet) return fail(ERR.FLEET_MISSING);
    m.ready = !!ready;
    broadcastState();
    return ok();
  }

  /** Reasons a start is refused, per slot. */
  function startBlockers(fillBots) {
    const missing = [];
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < teamSize; i++) {
        const c = grid[t][i];
        if (!c) {
          if (!fillBots) missing.push({ team: t, slot: i, reason: 'empty' });
          continue;
        }
        if (c.kind !== 'human') continue;
        const hm = members.get(c.id);
        if (!hm.connected) missing.push({ team: t, slot: i, reason: 'disconnected' });
        else if (!hm.fleet) missing.push({ team: t, slot: i, reason: 'no_fleet' });
        else if (!hm.ready) missing.push({ team: t, slot: i, reason: 'not_ready' });
      }
    }
    return missing;
  }

  function start(session, opts = {}) {
    const { m, err } = requireMember(session);
    if (err) return err;
    const h = requireHost(m.session);
    if (h) return h;
    if (phase === 'results') {
      backToLobby();
      return ok();
    }
    if (phase !== 'lobby') return fail(ERR.WRONG_PHASE, phase);
    const fillBots = !!opts.fillBots;
    const missing = startBlockers(fillBots);
    if (missing.length) return fail(ERR.NOT_ALL_READY, { missing });
    if (fillBots) {
      for (let t = 0; t < 2; t++) {
        for (let i = 0; i < teamSize; i++) {
          if (!grid[t][i]) {
            const bot = makeBot(botDifficulty, null);
            grid[t][i] = { kind: 'bot', id: bot.id };
          }
        }
      }
    }
    startCountdown();
    return ok();
  }

  // ---------------------------------------------------------------------
  // countdown → battle → results
  // ---------------------------------------------------------------------

  function humanFleetsOfTeam(t) {
    const list = [];
    for (const c of grid[t]) {
      if (c && c.kind === 'human') {
        const hm = members.get(c.id);
        if (hm.fleet) list.push(hm.fleet);
      }
    }
    return list;
  }

  /** Build every bot's fleet (counter builders see the other team's human fleets). */
  function buildBotFleets(seed) {
    for (let t = 0; t < 2; t++) {
      const enemyFleets = humanFleetsOfTeam(1 - t);
      const teamBots = grid[t].filter((c) => c && c.kind === 'bot').map((c) => bots.get(c.id));
      const chosen = new Set(teamBots.map((b) => b.faction || (b.fixedFleet && b.fixedFleet.faction)).filter(Boolean));
      let pool = FACTION_IDS.filter((f) => !chosen.has(f));
      if (pool.length === 0) pool = [...FACTION_IDS];
      createRng(`${seed}:factions:${t}`).shuffle(pool);
      let k = 0;
      for (const b of teamBots) {
        let faction = b.faction;
        if (!faction && b.fixedFleet) faction = b.fixedFleet.faction;
        if (!faction) {
          faction = pool[k % pool.length];
          k++;
          b.assignedFaction = faction;
        }
        if (b.fixedFleet && validateFleet(b.fixedFleet, budget).ok) {
          b.fleet = validateFleet(b.fixedFleet, budget).fleet;
          continue;
        }
        b.fleet = buildBotFleet({
          budget, difficulty: b.difficulty, rng: createRng(`${seed}:${b.id}`), faction, enemyFleets,
        });
      }
    }
  }

  function startCountdown() {
    const seed = seedFn();
    phase = 'countdown';
    rematchVotes.clear();
    try {
      buildBotFleets(seed);
    } catch (err) {
      log.warn('[room] bot fleet build failed', err);
      phase = 'lobby';
      clearBotFleets();
      broadcastObj({ t: S2C.ERROR, code: ERR.COUNTDOWN_ABORTED, detail: 'bot_fleet' });
      broadcastState();
      return;
    }
    const startAt = clock.now() + countdownMs;
    match = { seed, startAt, runner: null, startInfo: null, dead: new Set(), spawned: new Map(), lastFrame: null, result: null };
    broadcastObj({ t: S2C.COUNTDOWN, seconds: countdownMs / 1000, startAt });
    broadcastState();
    countdownTimer = clock.setTimeout(() => {
      countdownTimer = null;
      startBattle();
    }, countdownMs);
  }

  function abortCountdown() {
    if (phase !== 'countdown') return;
    if (countdownTimer) {
      clock.clearTimeout(countdownTimer);
      countdownTimer = null;
    }
    phase = 'lobby';
    match = null;
    clearBotFleets();
    broadcastObj({ t: S2C.ERROR, code: ERR.COUNTDOWN_ABORTED });
    broadcastState();
  }

  function battlePlayers() {
    const players = [];
    for (let t = 0; t < 2; t++) {
      for (const c of grid[t]) {
        if (!c) continue;
        if (c.kind === 'human') {
          const hm = members.get(c.id);
          players.push({ id: hm.id, name: hm.name, team: t, isBot: false, fleet: hm.fleet, ai: 'especialista' });
        } else {
          const b = bots.get(c.id);
          players.push({ id: b.id, name: b.name, team: t, isBot: true, fleet: b.fleet, ai: b.difficulty });
        }
      }
    }
    return players;
  }

  function startBattle() {
    if (phase !== 'countdown' || destroyed) return;
    const players = battlePlayers();
    const config = { seed: match.seed, players };
    if (o.maxTicks) config.maxTicks = o.maxTicks;
    if (o.suddenDeathTick) config.suddenDeathTick = o.suddenDeathTick;
    let state;
    try {
      state = createBattle(config);
    } catch (err) {
      log.warn('[room] createBattle failed', err);
      phase = 'lobby';
      match = null;
      clearBotFleets();
      broadcastObj({ t: S2C.ERROR, code: ERR.COUNTDOWN_ABORTED, detail: 'battle_config' });
      broadcastState();
      return;
    }
    match.startInfo = {
      seed: match.seed,
      players: players.map((p) => ({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, faction: p.fleet.faction, fleet: p.fleet, ai: p.ai })),
      ships: getInitialShips(state),
      world: battleWorld(state),
      tickRate: TICK_RATE,
      snapshotEvery: SNAPSHOT_EVERY,
      maxTicks: config.maxTicks || MAX_TICKS,
    };
    phase = 'battle';
    broadcastRaw(battleStartMessage(false));
    broadcastState();
    const thisMatch = match;
    thisMatch.runner = startMatch({
      config,
      state,
      tickMs: o.tickMs,
      log,
      onFrame(str, frame) {
        if (match !== thisMatch) return;
        const ev = frame.e;
        for (let i = 0; i < ev.length; i++) {
          const e = ev[i];
          if (e[0] === 'die') thisMatch.dead.add(e[1]);
          else if (e[0] === 'spawn') {
            thisMatch.spawned.set(e[1], { id: e[1], cls: e[2], team: e[3], owner: e[4], x: e[5], y: e[6], a: e[7], source: e[8] });
          }
        }
        thisMatch.lastFrame = str;
        broadcastRaw(str);
      },
      onEnd(result) {
        if (match !== thisMatch) return;
        endBattle(result);
      },
      // The simulation threw and not even a draw result could be built:
      // close the room so nobody is left waiting on a dead battle.
      onAbort(err) {
        if (match !== thisMatch || destroyed) return;
        log.warn('[room] battle aborted', code, err);
        destroy('room_closed');
      },
    });
  }

  function endBattle(result) {
    if (phase !== 'battle') return;
    match.result = result;
    phase = 'results';
    broadcastObj({ t: S2C.BATTLE_END, result });
    // Humans that never came back keep their slot as a normal bot with the same fleet.
    for (const hm of humansInSlots()) {
      if (hm.connected) continue;
      const bot = makeBot(DEFAULT_BOT_DIFFICULTY, null, `${hm.name} (bot)`);
      bot.fixedFleet = hm.fleet;
      grid[hm.team][hm.slot] = { kind: 'bot', id: bot.id };
      hm.team = -1;
      hm.slot = -1;
      hm.ready = false;
    }
    for (const hm of members.values()) hm.ready = false;
    for (const hm of [...members.values()]) {
      if (hm.expired) {
        clearGrace(hm);
        members.delete(hm.id);
        if (hm.session.roomCode === code) hm.session.roomCode = null;
      }
    }
    rematchVotes.clear();
    if (!members.has(hostId) || !members.get(hostId).connected) migrateHost();
    broadcastState();
    maybeScheduleDestroy();
  }

  function backToLobby() {
    if (match && match.runner) match.runner.stop();
    match = null;
    phase = 'lobby';
    rematchVotes.clear();
    for (const hm of members.values()) hm.ready = false;
    clearBotFleets();
    broadcastState();
  }

  function checkRematch() {
    if (phase !== 'results') return;
    // a seated human whose socket blipped still holds the seat for the grace period: wait for
    // their vote (or their expiry) instead of jumping to the lobby the moment they drop
    const voters = humansInSlots().filter((hm) => hm.connected || !hm.expired);
    if (voters.length === 0) return;
    if (voters.every((hm) => rematchVotes.has(hm.id))) backToLobby();
  }

  function rematch(session) {
    const { m, err } = requireMember(session);
    if (err) return err;
    if (phase !== 'results') return fail(ERR.WRONG_PHASE, phase);
    if (m.team < 0) return fail(ERR.SLOT_INVALID, 'spectator');
    rematchVotes.add(m.id);
    broadcastState();
    checkRematch();
    return ok();
  }

  function chat(session, text) {
    const { m, err } = requireMember(session);
    if (err) return err;
    if (typeof text !== 'string') return fail(ERR.BAD_MESSAGE, 'text');
    const clean = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, MAX_CHAT_LENGTH);
    if (!clean) return fail(ERR.BAD_MESSAGE, 'text');
    broadcastObj({ t: S2C.CHAT, from: m.id, name: m.name, text: clean, ts: clock.now() });
    return ok();
  }

  /** Tear the room down, notifying everybody with `left { reason }`. */
  function destroy(reason = 'room_closed') {
    if (destroyed) return;
    destroyed = true;
    if (countdownTimer) clock.clearTimeout(countdownTimer);
    countdownTimer = null;
    cancelDestroyTimer();
    if (match && match.runner) match.runner.stop();
    const leftMsg = JSON.stringify({ t: S2C.LEFT, reason });
    for (const m of members.values()) {
      clearGrace(m);
      sendTo(m, leftMsg);
      if (m.session.roomCode === code) m.session.roomCode = null;
    }
    const sessions = [...members.values()].map((m) => m.session);
    members.clear();
    bots.clear();
    phase = 'lobby';
    match = null;
    onDestroy(room, sessions);
  }

  const room = {
    code,
    get phase() { return phase; },
    get hostId() { return hostId; },
    get teamSize() { return teamSize; },
    get budget() { return budget; },
    get botDifficulty() { return botDifficulty; },
    get destroyed() { return destroyed; },
    get memberCount() { return members.size; },
    get connectedCount() { return connectedHumans().length; },
    toState,
    join,
    leave,
    onDisconnect,
    onReconnect,
    onSessionExpired,
    setRoom,
    pickSlot,
    addBot,
    removeBot,
    setFleet,
    setReady,
    start,
    rematch,
    chat,
    destroy,
    /** Testing/inspection hooks (not part of the wire protocol). */
    _debug: {
      getMatch: () => match,
      getMember: (id) => members.get(id),
      getBot: (id) => bots.get(id),
      startBlockers,
    },
  };

  if (o.host) join(o.host);
  return room;
}
