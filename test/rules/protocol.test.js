import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  C2S, S2C, ERR, validateName, isRoomCode, normalizeRoomCode, validateMessage, parseMessage,
  MAX_MESSAGE_BYTES, MAX_CHAT_LENGTH, BUDGET_POINTS,
} from '../../shared/protocol.js';
import { MAX_NAME_LENGTH, ROOM_CODE_ALPHABET } from '../../shared/constants.js';

const ok = (m, dir) => assert.deepEqual(validateMessage(m, dir), { ok: true }, JSON.stringify(m));
const rejects = (m, dir) => {
  const r = validateMessage(m, dir);
  assert.equal(r.ok, false, `should reject ${JSON.stringify(m)}`);
  assert.equal(r.code, ERR.BAD_MESSAGE);
  return r;
};

describe('constants', () => {
  test('C2S / S2C / ERR have the contract keys and unique wire values', () => {
    const c2sKeys = ['HELLO', 'CREATE_ROOM', 'JOIN_ROOM', 'LEAVE_ROOM', 'SET_ROOM', 'PICK_SLOT', 'ADD_BOT', 'REMOVE_BOT', 'SET_FLEET', 'READY', 'START', 'REMATCH', 'CHAT', 'PING'];
    const s2cKeys = ['WELCOME', 'ERROR', 'ROOM', 'LEFT', 'COUNTDOWN', 'BATTLE_START', 'FRAME', 'BATTLE_END', 'CHAT', 'PONG', 'ACK'];
    const errKeys = ['BAD_MESSAGE', 'BAD_NAME', 'VERSION_MISMATCH', 'RATE_LIMITED', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'NOT_HOST', 'WRONG_PHASE',
      'BAD_TEAM_SIZE', 'BAD_BUDGET', 'SLOT_TAKEN', 'SLOT_INVALID', 'FLEET_INVALID', 'FLEET_MISSING', 'NOT_ALL_READY', 'COUNTDOWN_ABORTED', 'NOT_IN_ROOM'];
    for (const k of c2sKeys) assert.equal(typeof C2S[k], 'string', k);
    for (const k of s2cKeys) assert.equal(typeof S2C[k], 'string', k);
    for (const k of errKeys) assert.equal(ERR[k], k);
    assert.equal(new Set(Object.values(C2S)).size, Object.keys(C2S).length);
    assert.equal(new Set(Object.values(S2C)).size, Object.keys(S2C).length);
    assert.equal(S2C.FRAME, 'f');
    assert.equal(C2S.HELLO, 'hello');
    assert.deepEqual(BUDGET_POINTS, [800, 1500, 2500]);
    assert.equal(MAX_MESSAGE_BYTES, 16384);
    assert.equal(MAX_CHAT_LENGTH, 200);
  });
});

describe('validateName', () => {
  test('trims, bounds 1..16, rejects control chars and non-strings', () => {
    assert.equal(validateName('  Ana  '), 'Ana');
    assert.equal(validateName('João   da Silva'), 'João da Silva');
    assert.equal(validateName('x'.repeat(MAX_NAME_LENGTH)), 'x'.repeat(MAX_NAME_LENGTH));
    assert.equal(validateName('x'.repeat(MAX_NAME_LENGTH + 1)), null);
    assert.equal(validateName(''), null);
    assert.equal(validateName('   '), null);
    assert.equal(validateName('bad\u0000name'), null);
    assert.equal(validateName('bad\u001bname'), null);
    assert.equal(validateName('tab\tname'), 'tab name');
    assert.equal(validateName(42), null);
    assert.equal(validateName(null), null);
    assert.equal(validateName(undefined), null);
  });
});

describe('isRoomCode', () => {
  test('exactly 4 chars of the alphabet', () => {
    assert.equal(isRoomCode('AB23'), true);
    assert.equal(isRoomCode('ZZZZ'), true);
    assert.equal(isRoomCode('ab23'), false);
    assert.equal(isRoomCode('AB1O'), false); // 1 and O are not in the alphabet
    assert.equal(isRoomCode('ABC'), false);
    assert.equal(isRoomCode('ABCDE'), false);
    assert.equal(isRoomCode(''), false);
    assert.equal(isRoomCode(1234), false);
    assert.equal(isRoomCode(null), false);
    for (const ch of ROOM_CODE_ALPHABET) assert.equal(isRoomCode(ch.repeat(4)), true);
    assert.equal(normalizeRoomCode('  ab23 '), 'AB23');
    assert.equal(normalizeRoomCode(5), '');
  });
});

describe('validateMessage (c2s)', () => {
  test('rejects non-objects, missing/unknown t and bad rid', () => {
    for (const m of [null, undefined, 1, 'hello', [], {}, { t: 1 }, { t: 'nope' }, { t: 'welcome' }, { t: 'f' }]) rejects(m);
    rejects({ t: 'ping', c: 1, rid: -1 });
    rejects({ t: 'ping', c: 1, rid: 1.5 });
    rejects({ t: 'ping', c: 1, rid: '1' });
    ok({ t: 'ping', c: 1, rid: 0 });
    ok({ t: 'ping', c: 1, rid: 12345 });
  });

  test('hello', () => {
    ok({ t: 'hello', name: 'Ana', version: 1 });
    ok({ t: 'hello', name: 'Ana', version: 1, token: 'abc' });
    rejects({ t: 'hello', version: 1 });
    rejects({ t: 'hello', name: '', version: 1 });
    rejects({ t: 'hello', name: 'x'.repeat(17), version: 1 });
    rejects({ t: 'hello', name: 'Ana' });
    rejects({ t: 'hello', name: 'Ana', version: '1' });
    rejects({ t: 'hello', name: 'Ana', version: 1.2 });
    rejects({ t: 'hello', name: 'Ana', version: 1, token: 7 });
    rejects({ t: 'hello', name: 'Ana', version: 1, token: 'x'.repeat(200) });
  });

  test('create_room / join_room / leave_room / set_room', () => {
    ok({ t: 'create_room', teamSize: 1, budget: 800 });
    ok({ t: 'create_room', teamSize: 6, budget: 2500 });
    rejects({ t: 'create_room', teamSize: 0, budget: 1500 });
    rejects({ t: 'create_room', teamSize: 7, budget: 1500 });
    rejects({ t: 'create_room', teamSize: 2.5, budget: 1500 });
    rejects({ t: 'create_room', teamSize: 2, budget: 1000 });
    rejects({ t: 'create_room', teamSize: 2, budget: '1500' });
    rejects({ t: 'create_room', teamSize: 2 });
    ok({ t: 'join_room', code: 'QW34' });
    rejects({ t: 'join_room', code: 'qw34' });
    rejects({ t: 'join_room' });
    ok({ t: 'leave_room' });
    ok({ t: 'leave_room', rid: 3 });
    ok({ t: 'set_room' });
    ok({ t: 'set_room', teamSize: 3 });
    ok({ t: 'set_room', budget: 2500, botDifficulty: 'dificil' });
    rejects({ t: 'set_room', teamSize: 9 });
    rejects({ t: 'set_room', budget: 1 });
    rejects({ t: 'set_room', botDifficulty: 'impossivel' });
  });

  test('pick_slot / add_bot / remove_bot', () => {
    ok({ t: 'pick_slot', team: 0, slot: 0 });
    ok({ t: 'pick_slot', team: 1, slot: 5 });
    rejects({ t: 'pick_slot', team: 2, slot: 0 });
    rejects({ t: 'pick_slot', team: 0, slot: 6 });
    rejects({ t: 'pick_slot', team: 0, slot: -1 });
    rejects({ t: 'pick_slot', team: '0', slot: 0 });
    rejects({ t: 'pick_slot', team: 0 });
    ok({ t: 'add_bot', team: 1, slot: 2, difficulty: 'normal' });
    ok({ t: 'add_bot', team: 1, slot: 2, difficulty: 'especialista', faction: 'lumen' });
    ok({ t: 'add_bot', team: 1, slot: 2, difficulty: 'facil', faction: null });
    rejects({ t: 'add_bot', team: 1, slot: 2 });
    rejects({ t: 'add_bot', team: 1, slot: 2, difficulty: 'hard' });
    rejects({ t: 'add_bot', team: 1, slot: 2, difficulty: 'normal', faction: 'borg' });
    ok({ t: 'remove_bot', team: 0, slot: 1 });
    rejects({ t: 'remove_bot', team: 0, slot: 1.5 });
  });

  test('set_fleet checks shape only (semantics are the server\'s job)', () => {
    ok({ t: 'set_fleet', fleet: { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 3 }] } });
    ok({ t: 'set_fleet', fleet: { faction: 'terran', ships: [] } });
    // unknown faction/class or over budget still pass the shape check
    ok({ t: 'set_fleet', fleet: { faction: 'borg', ships: [{ cls: 'cube', count: 1 }] } });
    ok({ t: 'set_fleet', fleet: { faction: 'terran', ships: [{ cls: 'ter_prometeu', count: 1 }, { cls: 'ter_atlas', count: 2 }] } });
    rejects({ t: 'set_fleet' });
    rejects({ t: 'set_fleet', fleet: null });
    rejects({ t: 'set_fleet', fleet: [] });
    rejects({ t: 'set_fleet', fleet: { faction: 'terran' } });
    rejects({ t: 'set_fleet', fleet: { ships: [] } });
    rejects({ t: 'set_fleet', fleet: { faction: 7, ships: [] } });
    rejects({ t: 'set_fleet', fleet: { faction: 'terran', ships: [{ cls: 'ter_vespa' }] } });
    rejects({ t: 'set_fleet', fleet: { faction: 'terran', ships: [{ cls: 'ter_vespa', count: -1 }] } });
    rejects({ t: 'set_fleet', fleet: { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 1.5 }] } });
    rejects({ t: 'set_fleet', fleet: { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 99999 }] } });
    rejects({ t: 'set_fleet', fleet: { faction: 'terran', ships: [{ cls: 'x'.repeat(100), count: 1 }] } });
    rejects({ t: 'set_fleet', fleet: { faction: 'terran', ships: new Array(65).fill({ cls: 'ter_vespa', count: 1 }) } });
  });

  test('ready / start / rematch / chat / ping', () => {
    ok({ t: 'ready', ready: true });
    ok({ t: 'ready', ready: false });
    rejects({ t: 'ready', ready: 1 });
    rejects({ t: 'ready' });
    ok({ t: 'start' });
    ok({ t: 'start', fillBots: true });
    rejects({ t: 'start', fillBots: 'yes' });
    ok({ t: 'rematch' });
    ok({ t: 'chat', text: 'olá!' });
    ok({ t: 'chat', text: 'x'.repeat(MAX_CHAT_LENGTH) });
    rejects({ t: 'chat', text: 'x'.repeat(MAX_CHAT_LENGTH + 1) });
    rejects({ t: 'chat', text: '' });
    rejects({ t: 'chat', text: '   ' });
    rejects({ t: 'chat', text: 'a\u0000b' });
    rejects({ t: 'chat', text: 5 });
    rejects({ t: 'chat' });
    ok({ t: 'ping', c: 0 });
    ok({ t: 'ping', c: 1700000000000 });
    rejects({ t: 'ping', c: -1 });
    rejects({ t: 'ping', c: 1.5 });
    rejects({ t: 'ping' });
  });
});

describe('validateMessage (s2c)', () => {
  test('accepts well-formed server messages and rejects malformed ones', () => {
    ok({ t: 'welcome', playerId: 'p1', token: 'tok', version: 1, serverTime: 123 }, 's2c');
    rejects({ t: 'welcome', playerId: '', token: 'tok', version: 1, serverTime: 123 }, 's2c');
    ok({ t: 'ack', rid: 1 }, 's2c');
    rejects({ t: 'ack' }, 's2c');
    ok({ t: 'error', code: 'ROOM_FULL' }, 's2c');
    ok({ t: 'error', rid: 2, code: 'FLEET_INVALID', detail: { code: 'FLEET_OVER_BUDGET' } }, 's2c');
    rejects({ t: 'error' }, 's2c');
    ok({ t: 'room', code: 'AB23', hostId: 'p1', teamSize: 2, budget: 1500, botDifficulty: 'normal', phase: 'lobby', slots: [[], []], spectators: [], rematchVotes: [], you: 'p1' }, 's2c');
    rejects({ t: 'room', code: 'AB23', hostId: 'p1', teamSize: 2, budget: 1500, phase: 'nope', slots: [[], []], spectators: [], rematchVotes: [], you: 'p1' }, 's2c');
    rejects({ t: 'room', code: 'AB23', hostId: 'p1', teamSize: 2, budget: 1500, phase: 'lobby', slots: [[]], spectators: [], rematchVotes: [], you: 'p1' }, 's2c');
    ok({ t: 'left', reason: 'kicked' }, 's2c');
    rejects({ t: 'left', reason: 'banned' }, 's2c');
    ok({ t: 'countdown', seconds: 5, startAt: 1000 }, 's2c');
    rejects({ t: 'countdown', seconds: '5', startAt: 1000 }, 's2c');
    ok({ t: 'battle_start', seed: 'abc', players: [], ships: [], world: { w: 1, h: 1 }, tickRate: 20, snapshotEvery: 2 }, 's2c');
    ok({ t: 'battle_start', seed: 1, players: [], ships: [], world: { w: 1, h: 1 }, tickRate: 20, snapshotEvery: 2, dead: [1] }, 's2c');
    rejects({ t: 'battle_start', players: [], ships: [], world: {}, tickRate: 20, snapshotEvery: 2 }, 's2c');
    ok({ t: 'f', k: 10, s: [], e: [] }, 's2c');
    rejects({ t: 'f', k: -1, s: [], e: [] }, 's2c');
    rejects({ t: 'f', k: 1, s: {}, e: [] }, 's2c');
    ok({ t: 'battle_end', result: { winner: 0 } }, 's2c');
    rejects({ t: 'battle_end' }, 's2c');
    ok({ t: 'chat', from: 'p1', name: 'Ana', text: 'oi', ts: 1 }, 's2c');
    rejects({ t: 'chat', from: 'p1', name: 'Ana', text: 'oi' }, 's2c');
    ok({ t: 'pong', c: 1, s: 2 }, 's2c');
    rejects({ t: 'pong', c: 1 }, 's2c');
    // direction matters
    rejects({ t: 'hello', name: 'Ana', version: 1 }, 's2c');
    rejects({ t: 'welcome', playerId: 'p1', token: 'tok', version: 1, serverTime: 123 }, 'c2s');
  });
});

describe('parseMessage', () => {
  test('parses JSON text, enforces size and validates', () => {
    assert.deepEqual(parseMessage('{"t":"ping","c":1}'), { ok: true, msg: { t: 'ping', c: 1 } });
    assert.equal(parseMessage('{bad json').ok, false);
    assert.equal(parseMessage('{bad json').code, ERR.BAD_MESSAGE);
    assert.equal(parseMessage('"a string"').ok, false);
    assert.equal(parseMessage('{"t":"nope"}').ok, false);
    assert.equal(parseMessage(`{"t":"chat","text":"${'x'.repeat(MAX_MESSAGE_BYTES)}"}`).detail, 'too_large');
    assert.equal(parseMessage(42).ok, false);
    const buf = new TextEncoder().encode('{"t":"ready","ready":true}');
    assert.deepEqual(parseMessage(buf), { ok: true, msg: { t: 'ready', ready: true } });
    assert.equal(parseMessage(new Uint8Array(MAX_MESSAGE_BYTES + 1)).detail, 'too_large');
    assert.deepEqual(parseMessage('{"t":"pong","c":1,"s":2}', 's2c'), { ok: true, msg: { t: 'pong', c: 1, s: 2 } });
  });
});
