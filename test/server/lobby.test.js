import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLobby, makeRoomCode } from '../../server/lobby.js';
import { createTokenBucket } from '../../server/session.js';
import { ERR, isRoomCode } from '../../shared/protocol.js';
import { presetFleet } from '../../shared/fleet.js';
import { createFakeClock, createFakeSession } from './helpers.js';

function setup() {
  const clock = createFakeClock();
  const lobby = createLobby({ maxRooms: 2, roomOptions: { clock, startMatch: () => ({ stop() {}, state: {} }) }, log: { warn() {} } });
  const mk = (id) => {
    const s = createFakeSession(id);
    s.chatBucket = createTokenBucket(1, 1, clock.now);
    return s;
  };
  return { lobby, clock, mk };
}

describe('lobby', () => {
  test('room codes use the alphabet and are 4 chars', () => {
    for (let i = 0; i < 200; i++) assert.ok(isRoomCode(makeRoomCode()), makeRoomCode());
    assert.equal(makeRoomCode(() => 0), 'AAAA');
  });

  test('invalid messages → BAD_MESSAGE with rid echoed; unknown type too', () => {
    const { lobby, mk } = setup();
    const s = mk('a');
    lobby.handleMessage(s, { t: 'warp', rid: 3 });
    assert.deepEqual(s.last('error'), { t: 'error', code: ERR.BAD_MESSAGE, rid: 3, detail: 'unknown_type' });
    lobby.handleMessage(s, { t: 'create_room', teamSize: 7, budget: 1500, rid: 4 });
    assert.equal(s.last('error').rid, 4);
    assert.equal(s.last('error').code, ERR.BAD_MESSAGE);
    lobby.handleMessage(s, { t: 'create_room', teamSize: 1, budget: 999 });
    assert.equal(s.last('error').rid, undefined);
    lobby.handleMessage(s, { t: 'pick_slot', team: 0, slot: 0, rid: 5 });
    assert.equal(s.last('error').code, ERR.NOT_IN_ROOM);
  });

  test('create/join/leave with ack carrying the room state; ROOM_NOT_FOUND; max rooms', () => {
    const { lobby, mk } = setup();
    const a = mk('a');
    lobby.handleMessage(a, { t: 'create_room', teamSize: 2, budget: 800, rid: 1 });
    const ack = a.last('ack');
    assert.equal(ack.rid, 1);
    assert.ok(isRoomCode(ack.room.code));
    assert.equal(ack.room.teamSize, 2);
    assert.equal(ack.room.budget, 800);
    assert.equal(ack.room.hostId, 'a');
    assert.equal(a.roomCode, ack.room.code);
    assert.equal(lobby.rooms.size, 1);
    const b = mk('b');
    lobby.handleMessage(b, { t: 'join_room', code: 'ZZZZ', rid: 1 });
    assert.equal(b.last('error').code, ERR.ROOM_NOT_FOUND);
    lobby.handleMessage(b, { t: 'join_room', code: ack.room.code.toLowerCase(), rid: 2 });
    assert.equal(b.last('error').code, ERR.BAD_MESSAGE, 'codes are uppercase on the wire');
    lobby.handleMessage(b, { t: 'join_room', code: ack.room.code, rid: 2 });
    assert.equal(b.last('ack').room.slots[1][0].playerId, 'b');
    assert.equal(b.last('ack').room.you, 'b');
    assert.equal(a.last('room').slots[1][0].playerId, 'b');
    // creating another room auto-leaves the current one
    lobby.handleMessage(b, { t: 'create_room', teamSize: 1, budget: 1500, rid: 3 });
    assert.equal(lobby.rooms.size, 2);
    assert.equal(a.last('room').slots[1][0].kind, 'empty');
    const c = mk('c');
    lobby.handleMessage(c, { t: 'create_room', teamSize: 1, budget: 1500, rid: 1 });
    assert.equal(c.last('error').code, ERR.ROOM_FULL);
    lobby.handleMessage(b, { t: 'leave_room', rid: 4 });
    assert.equal(b.last('ack').rid, 4);
    assert.equal(b.last('left').reason, 'left');
    assert.equal(lobby.rooms.size, 1, 'empty room destroyed');
    lobby.handleMessage(b, { t: 'leave_room', rid: 5 });
    assert.equal(b.last('error').code, ERR.NOT_IN_ROOM);
    assert.equal(lobby.health().rooms, 1);
  });

  test('routes room actions and replies ack/error; chat rate limited 1/s', () => {
    const { lobby, mk, clock } = setup();
    const a = mk('a');
    lobby.handleMessage(a, { t: 'create_room', teamSize: 1, budget: 1500, rid: 1 });
    lobby.handleMessage(a, { t: 'set_fleet', fleet: presetFleet('fer_ferro', 1500), rid: 2 });
    assert.equal(a.last('ack').rid, 2);
    lobby.handleMessage(a, { t: 'set_fleet', fleet: presetFleet('fer_ferro', 2500), rid: 3 });
    assert.equal(a.last('error').code, ERR.FLEET_INVALID);
    assert.equal(a.last('error').detail.code, 'FLEET_OVER_BUDGET');
    lobby.handleMessage(a, { t: 'ready', ready: true, rid: 4 });
    assert.equal(a.last('ack').rid, 4);
    lobby.handleMessage(a, { t: 'add_bot', team: 1, slot: 0, difficulty: 'facil', rid: 5 });
    assert.equal(a.last('ack').rid, 5);
    lobby.handleMessage(a, { t: 'remove_bot', team: 1, slot: 0, rid: 6 });
    assert.equal(a.last('ack').rid, 6);
    lobby.handleMessage(a, { t: 'set_room', botDifficulty: 'especialista', rid: 7 });
    assert.equal(a.last('room').botDifficulty, 'especialista');
    lobby.handleMessage(a, { t: 'start', rid: 8 });
    assert.equal(a.last('error').code, ERR.NOT_ALL_READY);
    lobby.handleMessage(a, { t: 'rematch', rid: 9 });
    assert.equal(a.last('error').code, ERR.WRONG_PHASE);
    lobby.handleMessage(a, { t: 'chat', text: 'oi', rid: 10 });
    assert.equal(a.last('chat').text, 'oi');
    lobby.handleMessage(a, { t: 'chat', text: 'spam', rid: 11 });
    assert.equal(a.last('error').code, ERR.RATE_LIMITED);
    clock.advance(1000);
    lobby.handleMessage(a, { t: 'chat', text: 'ok', rid: 12 });
    assert.equal(a.last('chat').text, 'ok');
    lobby.handleMessage(a, { t: 'ping', c: 123 });
    assert.equal(a.last('pong').c, 123);
    lobby.handleMessage(a, { t: 'start', fillBots: true, rid: 13 });
    assert.equal(a.last('ack').rid, 13);
    assert.equal(a.last('room').phase, 'countdown');
  });

  test('disconnect / reconnect / expiry are forwarded to the room', () => {
    const { lobby, mk, clock } = setup();
    const a = mk('a');
    lobby.handleMessage(a, { t: 'create_room', teamSize: 1, budget: 1500, rid: 1 });
    const code = a.roomCode;
    lobby.onDisconnect(a);
    assert.equal(lobby.getRoom(code).toState('a').slots[0][0].connected, false);
    lobby.onReconnect(a);
    assert.equal(lobby.getRoom(code).toState('a').slots[0][0].connected, true);
    lobby.onDisconnect(a);
    lobby.onSessionExpired(a);
    assert.equal(lobby.getRoom(code), null, 'last member expired → room gone');
    assert.equal(a.roomCode, null);
    lobby.onReconnect(a); // no room: harmless
    const b = mk('b');
    lobby.handleMessage(b, { t: 'create_room', teamSize: 1, budget: 1500, rid: 1 });
    lobby.closeAll();
    assert.equal(b.last('left').reason, 'room_closed');
    assert.equal(lobby.rooms.size, 0);
    clock.advance(1);
  });
});
