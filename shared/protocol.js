// Wire protocol: message type constants, error codes and payload validators.
// Isomorphic (used by server/session.js and client/battle/netClient.js).
// See docs/ARCHITECTURE.md §2.4 and §4.2.

import {
  BUDGETS, TEAM_SIZES, DIFFICULTIES, MAX_NAME_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH,
} from './constants.js';
import { FACTION_IDS } from './catalog.js';
import { validateFleet, FLEET_ERR } from './fleet.js';

/** Client → server message types (wire values). */
export const C2S = Object.freeze({
  HELLO: 'hello',
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  SET_ROOM: 'set_room',
  PICK_SLOT: 'pick_slot',
  ADD_BOT: 'add_bot',
  REMOVE_BOT: 'remove_bot',
  SET_FLEET: 'set_fleet',
  SET_ROLE: 'set_role',
  PILOT_INPUT: 'pilot_input',
  READY: 'ready',
  START: 'start',
  REMATCH: 'rematch',
  CHAT: 'chat',
  PING: 'ping',
});

/** Server → client message types (wire values). */
export const S2C = Object.freeze({
  WELCOME: 'welcome',
  ACK: 'ack',
  ERROR: 'error',
  ROOM: 'room',
  LEFT: 'left',
  COUNTDOWN: 'countdown',
  BATTLE_START: 'battle_start',
  FRAME: 'f',
  BATTLE_END: 'battle_end',
  CHAT: 'chat',
  PONG: 'pong',
});

/** Error codes carried by S2C.ERROR (the client maps them to pt-BR). */
export const ERR = Object.freeze({
  BAD_MESSAGE: 'BAD_MESSAGE',
  BAD_NAME: 'BAD_NAME',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  NOT_HOST: 'NOT_HOST',
  WRONG_PHASE: 'WRONG_PHASE',
  BAD_TEAM_SIZE: 'BAD_TEAM_SIZE',
  BAD_BUDGET: 'BAD_BUDGET',
  SLOT_TAKEN: 'SLOT_TAKEN',
  SLOT_INVALID: 'SLOT_INVALID',
  FLEET_INVALID: 'FLEET_INVALID',
  FLEET_MISSING: 'FLEET_MISSING',
  NOT_ALL_READY: 'NOT_ALL_READY',
  COUNTDOWN_ABORTED: 'COUNTDOWN_ABORTED',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  PILOT_DISABLED: 'PILOT_DISABLED',
  STALE_MATCH: 'STALE_MATCH',
  FLEET_LOCKED: 'FLEET_LOCKED',
});

export const LEFT_REASONS = Object.freeze(['left', 'kicked', 'room_closed']);
export const ROOM_PHASES = Object.freeze(['lobby', 'countdown', 'battle', 'results']);
/** Coordination labels, without stat bonuses or exclusive seats. */
export const TEAM_ROLES = Object.freeze(['vanguard', 'support', 'striker']);

export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_CHAT_LENGTH = 200;
export const MAX_TOKEN_LENGTH = 128;
export const MAX_RID = 0x7fffffff;
export const MAX_FLEET_ENTRIES = 64;
export const MAX_CLASS_ID_LENGTH = 40;
export const MAX_SLOT_INDEX = Math.max(...TEAM_SIZES) - 1;
export const RATE_LIMIT = Object.freeze({ perSecond: 20, burst: 40 });
export const CHAT_RATE_LIMIT = Object.freeze({ perSecond: 1, burst: 1 });

export const BUDGET_POINTS = Object.freeze(Object.values(BUDGETS).map((b) => b.points));

const C2S_TYPES = new Set(Object.values(C2S));
const S2C_TYPES = new Set(Object.values(S2C));

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Validate a display name: trimmed, 1..MAX_NAME_LENGTH chars, no control
 * characters. Internal whitespace runs are collapsed to one space.
 * @param {any} s
 * @returns {string|null}  the cleaned name, or null when unacceptable
 */
export function validateName(s) {
  if (typeof s !== 'string') return null;
  const name = s.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) return null;
  if (CONTROL_CHARS.test(name)) return null;
  return name;
}

/**
 * Is `s` a room code: exactly ROOM_CODE_LENGTH chars of ROOM_CODE_ALPHABET?
 * @param {any} s
 * @returns {boolean}
 */
export function isRoomCode(s) {
  if (typeof s !== 'string' || s.length !== ROOM_CODE_LENGTH) return false;
  for (let i = 0; i < s.length; i++) if (!ROOM_CODE_ALPHABET.includes(s[i])) return false;
  return true;
}

/**
 * Clean user input into a candidate room code (trim, uppercase, O→0 style
 * confusions are NOT fixed: 0/1/I/O are simply not in the alphabet).
 * @param {any} s
 * @returns {string}
 */
export function normalizeRoomCode(s) {
  return typeof s === 'string' ? s.trim().toUpperCase() : '';
}

// ---------------------------------------------------------------------------
// Field helpers (return an error string or null)
// ---------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const isBool = (v) => typeof v === 'boolean';

const bad = (detail) => ({ ok: false, code: ERR.BAD_MESSAGE, detail });
const OK = Object.freeze({ ok: true });

function checkTeamSlot(m) {
  if (!isInt(m.team, 0, 1)) return 'team';
  if (!isInt(m.slot, 0, MAX_SLOT_INDEX)) return 'slot';
  return null;
}

/** Shape-only fleet check: structure, bounds; semantics are the server's job. */
function fleetShapeError(fleet) {
  if (!isObj(fleet)) return 'fleet';
  if (!isStr(fleet.faction, MAX_CLASS_ID_LENGTH)) return 'fleet.faction';
  if (!Array.isArray(fleet.ships) || fleet.ships.length > MAX_FLEET_ENTRIES) return 'fleet.ships';
  for (const e of fleet.ships) {
    if (!isObj(e) || !isStr(e.cls, MAX_CLASS_ID_LENGTH) || !isInt(e.count, 0, 1000)) return 'fleet.ships[]';
  }
  // Delegate the structural part to fleet.js (budget/faction/class semantics are not checked here).
  const r = validateFleet(fleet, Infinity);
  if (!r.ok && r.code === FLEET_ERR.BAD_SHAPE) return 'fleet';
  return null;
}

/** @type {Record<string, (m: any) => string|null>} */
const C2S_CHECKS = {
  [C2S.HELLO]: (m) => {
    if (validateName(m.name) === null) return 'name';
    if (m.token !== undefined && !isStr(m.token, MAX_TOKEN_LENGTH)) return 'token';
    if (!isInt(m.version, 0, 1_000_000)) return 'version';
    return null;
  },
  [C2S.CREATE_ROOM]: (m) => {
    if (!isInt(m.teamSize, 1, 6) || !TEAM_SIZES.includes(m.teamSize)) return 'teamSize';
    if (!Number.isInteger(m.budget) || !BUDGET_POINTS.includes(m.budget)) return 'budget';
    if (m.pilotsEnabled !== undefined && !isBool(m.pilotsEnabled)) return 'pilotsEnabled';
    return null;
  },
  [C2S.JOIN_ROOM]: (m) => (isRoomCode(m.code) ? null : 'code'),
  [C2S.LEAVE_ROOM]: () => null,
  [C2S.SET_ROOM]: (m) => {
    if (m.teamSize !== undefined && (!isInt(m.teamSize, 1, 6) || !TEAM_SIZES.includes(m.teamSize))) return 'teamSize';
    if (m.budget !== undefined && (!Number.isInteger(m.budget) || !BUDGET_POINTS.includes(m.budget))) return 'budget';
    if (m.botDifficulty !== undefined && !DIFFICULTIES.includes(m.botDifficulty)) return 'botDifficulty';
    if (m.pilotsEnabled !== undefined && !isBool(m.pilotsEnabled)) return 'pilotsEnabled';
    return null;
  },
  [C2S.PICK_SLOT]: checkTeamSlot,
  [C2S.ADD_BOT]: (m) => {
    const e = checkTeamSlot(m);
    if (e) return e;
    if (!DIFFICULTIES.includes(m.difficulty)) return 'difficulty';
    if (m.faction !== undefined && m.faction !== null && !FACTION_IDS.includes(m.faction)) return 'faction';
    return null;
  },
  [C2S.REMOVE_BOT]: checkTeamSlot,
  [C2S.SET_FLEET]: (m) => fleetShapeError(m.fleet),
  [C2S.SET_ROLE]: (m) => (TEAM_ROLES.includes(m.role) ? null : 'role'),
  [C2S.PILOT_INPUT]: (m) => {
    if (!isStr(m.matchId, 64) || !m.matchId.length) return 'matchId';
    const p = m.input;
    if (!isObj(p) || !isInt(p.seq, 0, MAX_RID) || !isBool(p.manual)) return 'input';
    if (Object.keys(p).some((key) => !['seq', 'manual', 'moveX', 'moveY', 'aimX', 'aimY', 'fire', 'ability'].includes(key))) return 'input';
    if (!p.manual) return null;
    if (!Number.isFinite(p.moveX) || Math.abs(p.moveX) > 1 || !Number.isFinite(p.moveY) || Math.abs(p.moveY) > 1) return 'input.move';
    if (!Number.isFinite(p.aimX) || !Number.isFinite(p.aimY) || Math.abs(p.aimX) > 100_000 || Math.abs(p.aimY) > 100_000) return 'input.aim';
    if (!isBool(p.fire) || !isBool(p.ability)) return 'input.actions';
    return null;
  },
  [C2S.READY]: (m) => (isBool(m.ready) ? null : 'ready'),
  [C2S.START]: (m) => (m.fillBots === undefined || isBool(m.fillBots) ? null : 'fillBots'),
  [C2S.REMATCH]: () => null,
  [C2S.CHAT]: (m) => {
    if (typeof m.text !== 'string') return 'text';
    const text = m.text.trim();
    if (text.length < 1 || text.length > MAX_CHAT_LENGTH) return 'text';
    if (CONTROL_CHARS.test(text)) return 'text';
    return null;
  },
  [C2S.PING]: (m) => (isInt(m.c, 0, Number.MAX_SAFE_INTEGER) ? null : 'c'),
};

/** @type {Record<string, (m: any) => string|null>} */
const S2C_CHECKS = {
  [S2C.WELCOME]: (m) => {
    if (!isStr(m.playerId, 64) || m.playerId.length === 0) return 'playerId';
    if (!isStr(m.token, MAX_TOKEN_LENGTH)) return 'token';
    if (!isInt(m.version, 0, 1_000_000)) return 'version';
    if (typeof m.serverTime !== 'number' || !Number.isFinite(m.serverTime)) return 'serverTime';
    return null;
  },
  [S2C.ACK]: (m) => (isInt(m.rid, 0, MAX_RID) ? null : 'rid'),
  [S2C.ERROR]: (m) => {
    if (m.rid !== undefined && !isInt(m.rid, 0, MAX_RID)) return 'rid';
    if (!isStr(m.code, 64)) return 'code';
    return null;
  },
  [S2C.ROOM]: (m) => {
    if (!isStr(m.code, 16) || !isStr(m.hostId, 64)) return 'room';
    if (!Number.isInteger(m.teamSize) || !Number.isInteger(m.budget)) return 'room';
    if (!ROOM_PHASES.includes(m.phase)) return 'phase';
    if (!Array.isArray(m.slots) || m.slots.length !== 2 || !m.slots.every(Array.isArray)) return 'slots';
    if (!Array.isArray(m.spectators) || !Array.isArray(m.rematchVotes)) return 'room';
    if (!isStr(m.you, 64)) return 'you';
    return null;
  },
  [S2C.LEFT]: (m) => (LEFT_REASONS.includes(m.reason) ? null : 'reason'),
  [S2C.COUNTDOWN]: (m) => {
    if (typeof m.seconds !== 'number' || !Number.isFinite(m.seconds)) return 'seconds';
    if (typeof m.startAt !== 'number' || !Number.isFinite(m.startAt)) return 'startAt';
    return null;
  },
  [S2C.BATTLE_START]: (m) => {
    if (m.seed === undefined || (typeof m.seed !== 'number' && typeof m.seed !== 'string')) return 'seed';
    if (!Array.isArray(m.players) || !Array.isArray(m.ships)) return 'players';
    if (!isObj(m.world)) return 'world';
    if (!Number.isInteger(m.tickRate) || !Number.isInteger(m.snapshotEvery)) return 'tickRate';
    if (m.dead !== undefined && !Array.isArray(m.dead)) return 'dead';
    return null;
  },
  [S2C.FRAME]: (m) => {
    if (!isInt(m.k, 0, Number.MAX_SAFE_INTEGER)) return 'k';
    if (!Array.isArray(m.s) || !Array.isArray(m.e)) return 'frame';
    return null;
  },
  [S2C.BATTLE_END]: (m) => (isObj(m.result) ? null : 'result'),
  [S2C.CHAT]: (m) => {
    if (!isStr(m.from, 64) || !isStr(m.name, MAX_NAME_LENGTH * 2)) return 'from';
    if (!isStr(m.text, MAX_CHAT_LENGTH)) return 'text';
    if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return 'ts';
    return null;
  },
  [S2C.PONG]: (m) => {
    if (!isInt(m.c, 0, Number.MAX_SAFE_INTEGER)) return 'c';
    if (typeof m.s !== 'number' || !Number.isFinite(m.s)) return 's';
    return null;
  },
};

/**
 * Validate a parsed message's shape for its type. Numbers must be integers in
 * range, strings bounded; the fleet in `set_fleet` is checked for shape only
 * (the server validates classes/budget with validateFleet and answers
 * FLEET_INVALID). Unknown `t` → BAD_MESSAGE.
 * @param {any} msg
 * @param {'c2s'|'s2c'} [dir]  which direction's schema to apply (default c2s)
 * @returns {{ ok: true } | { ok: false, code: string, detail?: string }}
 */
export function validateMessage(msg, dir = 'c2s') {
  if (!isObj(msg)) return bad('not_object');
  if (typeof msg.t !== 'string') return bad('t');
  const checks = dir === 's2c' ? S2C_CHECKS : C2S_CHECKS;
  const known = dir === 's2c' ? S2C_TYPES : C2S_TYPES;
  if (!known.has(msg.t)) return bad('unknown_type');
  if (msg.rid !== undefined && !isInt(msg.rid, 0, MAX_RID)) return bad('rid');
  const field = checks[msg.t](msg);
  return field ? bad(field) : OK;
}

/**
 * Parse a raw text frame: size limit, JSON in try/catch, then validateMessage.
 * @param {string|Uint8Array|ArrayBuffer} raw
 * @param {'c2s'|'s2c'} [dir]
 * @returns {{ ok: true, msg: any } | { ok: false, code: string, detail?: string }}
 */
export function parseMessage(raw, dir = 'c2s') {
  let text;
  if (typeof raw === 'string') text = raw;
  else if (raw && typeof raw.byteLength === 'number') {
    if (raw.byteLength > MAX_MESSAGE_BYTES) return bad('too_large');
    try {
      text = new TextDecoder().decode(raw);
    } catch {
      return bad('encoding');
    }
  } else return bad('not_text');
  if (text.length > MAX_MESSAGE_BYTES) return bad('too_large');
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return bad('json');
  }
  const v = validateMessage(msg, dir);
  return v.ok ? { ok: true, msg } : v;
}
