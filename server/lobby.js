// Lobby: room registry (4-letter codes from ROOM_CODE_ALPHABET) and routing
// of every C2S message (validated with validateMessage) to the session's
// room. Replies: `ack {rid}` on success, `error {rid, code, detail}` on
// failure. See docs/ARCHITECTURE.md §4.2.

import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/constants.js';
import { C2S, S2C, ERR, validateMessage, normalizeRoomCode } from '../shared/protocol.js';
import { createRoom } from './room.js';

/** Default maximum number of simultaneous rooms. */
export const DEFAULT_MAX_ROOMS = 50;

/**
 * Random room code.
 * @param {(max:number)=>number} [rand]  returns an int in [0, max)
 * @returns {string}
 */
export function makeRoomCode(rand = (max) => randomInt(0, max)) {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[rand(ROOM_CODE_ALPHABET.length)];
  return s;
}

/**
 * Create the lobby.
 * @param {Object} [o]
 * @param {number} [o.maxRooms]
 * @param {object} [o.roomOptions]  passed to createRoom (clock, countdownMs, maxTicks, tickMs, startMatch...)
 * @param {{warn:Function, info?:Function}} [o.log]
 */
export function createLobby({ maxRooms = DEFAULT_MAX_ROOMS, roomOptions = {}, log = console } = {}) {
  /** @type {Map<string, ReturnType<typeof createRoom>>} */
  const rooms = new Map();
  const startedAt = Date.now();

  function reply(session, rid, result) {
    if (result.ok) {
      if (rid === undefined) return;
      const msg = { t: S2C.ACK, rid };
      if (result.room) msg.room = result.room;
      session.send(msg);
    } else {
      const msg = { t: S2C.ERROR, code: result.code };
      if (rid !== undefined) msg.rid = rid;
      if (result.detail !== undefined) msg.detail = result.detail;
      session.send(msg);
    }
  }

  function roomOf(session) {
    if (!session.roomCode) return null;
    const room = rooms.get(session.roomCode);
    if (!room) {
      session.roomCode = null;
      return null;
    }
    return room;
  }

  function uniqueCode() {
    for (let i = 0; i < 100; i++) {
      const c = makeRoomCode();
      if (!rooms.has(c)) return c;
    }
    return null;
  }

  function createRoomFor(session, { teamSize, budget, botDifficulty }) {
    if (rooms.size >= maxRooms) return { ok: false, code: ERR.ROOM_FULL, detail: 'server' };
    const code = uniqueCode();
    if (!code) return { ok: false, code: ERR.ROOM_FULL, detail: 'codes' };
    const current = roomOf(session);
    if (current) current.leave(session);
    const room = createRoom({
      ...roomOptions,
      code,
      host: session,
      teamSize,
      budget,
      botDifficulty,
      log,
      onDestroy: (r) => {
        rooms.delete(r.code);
        if (roomOptions.onDestroy) roomOptions.onDestroy(r);
      },
    });
    rooms.set(code, room);
    return { ok: true, room: room.toState(session.id) };
  }

  function joinRoom(session, codeRaw) {
    const code = normalizeRoomCode(codeRaw);
    const room = rooms.get(code);
    if (!room || room.destroyed) return { ok: false, code: ERR.ROOM_NOT_FOUND };
    const current = roomOf(session);
    if (current && current !== room) current.leave(session);
    return room.join(session);
  }

  const lobby = {
    rooms,
    /**
     * Route one validated-or-not C2S message from an established session.
     * @param {object} session
     * @param {any} msg parsed JSON with `t`
     */
    handleMessage(session, msg) {
      const rid = Number.isInteger(msg.rid) ? msg.rid : undefined;
      const v = validateMessage(msg, 'c2s');
      if (!v.ok) return reply(session, rid, v);
      switch (msg.t) {
        case C2S.PING:
          return session.send({ t: S2C.PONG, c: msg.c, s: Date.now() });
        case C2S.CREATE_ROOM:
          return reply(session, rid, createRoomFor(session, msg));
        case C2S.JOIN_ROOM:
          return reply(session, rid, joinRoom(session, msg.code));
        case C2S.HELLO:
          return reply(session, rid, { ok: false, code: ERR.BAD_MESSAGE, detail: 'already_hello' });
        default:
          break;
      }
      const room = roomOf(session);
      if (!room) return reply(session, rid, { ok: false, code: ERR.NOT_IN_ROOM });
      switch (msg.t) {
        case C2S.LEAVE_ROOM:
          return reply(session, rid, room.leave(session));
        case C2S.SET_ROOM:
          return reply(session, rid, room.setRoom(session, msg));
        case C2S.PICK_SLOT:
          return reply(session, rid, room.pickSlot(session, msg.team, msg.slot));
        case C2S.ADD_BOT:
          return reply(session, rid, room.addBot(session, msg.team, msg.slot, msg.difficulty, msg.faction ?? null));
        case C2S.REMOVE_BOT:
          return reply(session, rid, room.removeBot(session, msg.team, msg.slot));
        case C2S.SET_FLEET:
          return reply(session, rid, room.setFleet(session, msg.fleet));
        case C2S.READY:
          return reply(session, rid, room.setReady(session, msg.ready));
        case C2S.START:
          return reply(session, rid, room.start(session, { fillBots: !!msg.fillBots }));
        case C2S.REMATCH:
          return reply(session, rid, room.rematch(session));
        case C2S.CHAT:
          if (session.chatBucket && !session.chatBucket.take()) {
            return reply(session, rid, { ok: false, code: ERR.RATE_LIMITED, detail: 'chat' });
          }
          return reply(session, rid, room.chat(session, msg.text));
        default:
          return reply(session, rid, { ok: false, code: ERR.BAD_MESSAGE, detail: 'unknown_type' });
      }
    },
    /** Socket dropped (session kept for the grace period). */
    onDisconnect(session) {
      const room = roomOf(session);
      if (room) room.onDisconnect(session);
    },
    /** Session resumed on a new socket. */
    onReconnect(session) {
      const room = roomOf(session);
      if (room && !room.onReconnect(session)) session.roomCode = null;
    },
    /** Session expired after the grace period. */
    onSessionExpired(session) {
      const room = roomOf(session);
      if (room) room.onSessionExpired(session);
    },
    getRoom(code) {
      return rooms.get(normalizeRoomCode(code)) || null;
    },
    /** `/health` body. */
    health() {
      return { ok: true, rooms: rooms.size, uptime: Math.round((Date.now() - startedAt) / 1000) };
    },
    /** Destroy every room (shutdown). */
    closeAll(reason = 'room_closed') {
      for (const room of [...rooms.values()]) room.destroy(reason);
      rooms.clear();
    },
  };
  return lobby;
}
