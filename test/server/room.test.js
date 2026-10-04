import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from '../../server/room.js';
import { ERR } from '../../shared/protocol.js';
import { presetFleet, validateFleet } from '../../shared/fleet.js';
import { FACTION_IDS } from '../../shared/catalog.js';
import { createFakeClock, createFakeSession } from './helpers.js';

const TERRAN = presetFleet('ter_linha', 1500);
const VORRAX = presetFleet('vor_mare', 1500);
const LUMEN = presetFleet('lum_coro', 1500);

/** Fake match runner: the test drives frames/end by hand. */
function fakeStartMatch() {
  const calls = [];
  const fn = (o) => {
    const handle = {
      o,
      stopped: false,
      stop() { handle.stopped = true; },
      state: o.state,
      frame(k, e = []) { o.onFrame(JSON.stringify({ t: 'f', k, s: [], e }), { t: 'f', k, s: [], e }); },
      end(result) { o.onEnd(result); },
    };
    calls.push(handle);
    return handle;
  };
  fn.calls = calls;
  return fn;
}

function setup(opts = {}) {
  const clock = createFakeClock();
  const startMatch = fakeStartMatch();
  const destroyed = [];
  const host = createFakeSession('h', 'Host');
  const room = createRoom({
    code: 'ABCD', host, teamSize: opts.teamSize ?? 1, budget: opts.budget ?? 1500, botDifficulty: opts.botDifficulty,
    clock, startMatch, seedFn: () => 42, onDestroy: (r) => destroyed.push(r.code), log: { warn() {} }, ...opts.room,
  });
  return { clock, startMatch, destroyed, host, room };
}

function readyUp(room, session, fleet = TERRAN) {
  assert.equal(room.setFleet(session, fleet).ok, true);
  assert.equal(room.setReady(session, true).ok, true);
}

describe('room: lobby basics', () => {
  test('creator is host at team 0 slot 0 and receives a room push', () => {
    const { room, host } = setup();
    assert.equal(room.phase, 'lobby');
    assert.equal(room.hostId, 'h');
    assert.equal(host.roomCode, 'ABCD');
    const st = host.last('room');
    assert.equal(st.you, 'h');
    assert.equal(st.slots[0][0].kind, 'human');
    assert.equal(st.slots[0][0].isHost, true);
    assert.equal(st.slots[1][0].kind, 'empty');
    assert.deepEqual(st.spectators, []);
  });

  test('join fills the team with fewer humans, then spectators', () => {
    const { room } = setup({ teamSize: 1 });
    const b = createFakeSession('b');
    assert.equal(room.join(b).ok, true);
    assert.equal(room.toState('b').slots[1][0].playerId, 'b');
    const c = createFakeSession('c');
    const r = room.join(c);
    assert.equal(r.ok, true);
    assert.deepEqual(r.room.spectators.map((s) => s.id), ['c']);
    // every member gets a push with its own `you`
    assert.equal(b.last('room').you, 'b');
    assert.equal(c.last('room').you, 'c');
  });

  test('pick_slot: invalid, taken, move keeps fleet and clears ready', () => {
    const { room, host } = setup({ teamSize: 2 });
    assert.equal(room.pickSlot(host, 0, 5).code, ERR.SLOT_INVALID);
    assert.equal(room.pickSlot(host, 2, 0).code, ERR.SLOT_INVALID);
    const b = createFakeSession('b');
    room.join(b);
    assert.equal(room.pickSlot(b, 0, 0).code, ERR.SLOT_TAKEN);
    readyUp(room, host);
    assert.equal(room.toState('h').slots[0][0].ready, true);
    assert.equal(room.pickSlot(host, 1, 1).ok, true);
    const st = room.toState('h');
    assert.equal(st.slots[0][0].kind, 'empty');
    assert.equal(st.slots[1][1].playerId, 'h');
    assert.equal(st.slots[1][1].hasFleet, true);
    assert.equal(st.slots[1][1].faction, 'terran');
    assert.equal(st.slots[1][1].ready, false);
    assert.equal(room.pickSlot(host, 1, 1).ok, true, 'picking own slot is a no-op');
  });

  test('fleets are validated against the room budget and hidden from others', () => {
    const { room, host } = setup({ budget: 800 });
    const r = room.setFleet(host, TERRAN); // 1500-point fleet
    assert.equal(r.ok, false);
    assert.equal(r.code, ERR.FLEET_INVALID);
    assert.equal(r.detail.code, 'FLEET_OVER_BUDGET');
    assert.equal(room.setFleet(host, { faction: 'nope', ships: [] }).detail.code, 'FLEET_UNKNOWN_FACTION');
    assert.equal(room.setFleet(host, presetFleet('ter_linha', 800)).ok, true);
    const b = createFakeSession('b');
    room.join(b);
    const seen = JSON.stringify(b.last('room'));
    assert.ok(!seen.includes('"ships"'), 'fleet contents must not leak');
    assert.equal(b.last('room').slots[0][0].hasFleet, true);
    assert.equal(b.last('room').slots[0][0].faction, 'terran');
  });

  test('ready requires a fleet; spectators cannot ready', () => {
    const { room, host } = setup();
    assert.equal(room.setReady(host, true).code, ERR.FLEET_MISSING);
    room.setFleet(host, TERRAN);
    assert.equal(room.setReady(host, true).ok, true);
    assert.equal(room.setFleet(host, VORRAX).ok, true);
    assert.equal(room.toState('h').slots[0][0].ready, false, 'set_fleet clears ready');
    const b = createFakeSession('b');
    room.join(b);
    const c = createFakeSession('c');
    room.join(c);
    room.setFleet(c, TERRAN);
    assert.equal(room.setReady(c, true).code, ERR.SLOT_INVALID);
    const stranger = createFakeSession('x');
    assert.equal(room.setReady(stranger, true).code, ERR.NOT_IN_ROOM);
  });

  test('add/remove bot: host only, lobby only, slot checks', () => {
    const { room, host } = setup({ teamSize: 2 });
    const b = createFakeSession('b');
    room.join(b);
    assert.equal(room.addBot(b, 1, 1, 'normal').code, ERR.NOT_HOST);
    assert.equal(room.addBot(host, 1, 0, 'normal').code, ERR.SLOT_TAKEN);
    assert.equal(room.addBot(host, 1, 7, 'normal').code, ERR.SLOT_INVALID);
    assert.equal(room.addBot(host, 1, 1, 'impossivel').code, ERR.BAD_MESSAGE);
    assert.equal(room.addBot(host, 1, 1, 'dificil', 'klingon').code, ERR.BAD_MESSAGE);
    const r = room.addBot(host, 1, 1, 'dificil', 'lumen');
    assert.equal(r.ok, true);
    const slot = room.toState('h').slots[1][1];
    assert.equal(slot.kind, 'bot');
    assert.equal(slot.difficulty, 'dificil');
    assert.equal(slot.faction, 'lumen');
    assert.equal(slot.ready, true);
    assert.equal(slot.hasFleet, true);
    assert.match(slot.name, /^Bot /);
    assert.equal(room.removeBot(b, 1, 1).code, ERR.NOT_HOST);
    assert.equal(room.removeBot(host, 1, 0).code, ERR.SLOT_INVALID);
    assert.equal(room.removeBot(host, 1, 1).ok, true);
    assert.equal(room.toState('h').slots[1][1].kind, 'empty');
  });

  test('set_room: host only; shrinking removes extra slots; budget change invalidates fleets', () => {
    const { room, host } = setup({ teamSize: 3 });
    const b = createFakeSession('b');
    room.join(b);
    assert.equal(room.setRoom(b, { teamSize: 2 }).code, ERR.NOT_HOST);
    assert.equal(room.setRoom(host, { teamSize: 9 }).code, ERR.BAD_TEAM_SIZE);
    assert.equal(room.setRoom(host, { budget: 1234 }).code, ERR.BAD_BUDGET);
    room.pickSlot(b, 1, 2);
    room.addBot(host, 0, 2, 'facil');
    readyUp(room, host);
    assert.equal(room.setRoom(host, { teamSize: 2, botDifficulty: 'dificil' }).ok, true);
    const st = room.toState('h');
    assert.equal(st.teamSize, 2);
    assert.equal(st.botDifficulty, 'dificil');
    assert.equal(st.slots[0].length, 2);
    assert.deepEqual(st.spectators.map((s) => s.id), ['b'], 'human in a removed slot becomes spectator');
    assert.equal(room.setRoom(host, { budget: 800 }).ok, true);
    assert.equal(room.toState('h').slots[0][0].hasFleet, false, 'over-budget fleet dropped');
    assert.equal(room.toState('h').slots[0][0].ready, false);
    assert.equal(room.setRoom(host, { teamSize: 4 }).ok, true);
    assert.equal(room.toState('h').slots[1].length, 4);
  });

  test('chat is broadcast with sender id/name and sanitized', () => {
    const { room, host, clock } = setup();
    const b = createFakeSession('b', 'Bia');
    room.join(b);
    assert.equal(room.chat(b, '  olá \u0007 mundo  ').ok, true);
    const m = host.last('chat');
    assert.deepEqual(m, { t: 'chat', from: 'b', name: 'Bia', text: 'olá  mundo', ts: clock.now() });
    assert.equal(b.last('chat').text, 'olá  mundo');
    assert.equal(room.chat(b, '   ').code, ERR.BAD_MESSAGE);
  });
});

describe('room: start → countdown → battle → results → rematch', () => {
  test('start errors: not host, NOT_ALL_READY with missing list', () => {
    const { room, host } = setup({ teamSize: 2 });
    const b = createFakeSession('b');
    room.join(b);
    assert.equal(room.start(b).code, ERR.NOT_HOST);
    let r = room.start(host);
    assert.equal(r.code, ERR.NOT_ALL_READY);
    assert.deepEqual(r.detail.missing, [
      { team: 0, slot: 0, reason: 'no_fleet' },
      { team: 0, slot: 1, reason: 'empty' },
      { team: 1, slot: 0, reason: 'no_fleet' },
      { team: 1, slot: 1, reason: 'empty' },
    ]);
    room.setFleet(host, TERRAN);
    readyUp(room, b, VORRAX);
    r = room.start(host, { fillBots: true });
    assert.deepEqual(r.detail.missing, [{ team: 0, slot: 0, reason: 'not_ready' }]);
    room.setReady(host, true);
    room.onDisconnect(b);
    r = room.start(host, { fillBots: true });
    assert.deepEqual(r.detail.missing, [{ team: 1, slot: 0, reason: 'disconnected' }]);
    assert.equal(room.phase, 'lobby');
  });

  test('countdown: bot fleets are built now; fillBots gives same-team bots distinct factions; battle starts after 5 s', () => {
    const { room, host, clock, startMatch } = setup({ teamSize: 3, botDifficulty: 'dificil' });
    const b = createFakeSession('b');
    room.join(b); // team 1 slot 0
    readyUp(room, host, TERRAN);
    readyUp(room, b, LUMEN);
    room.addBot(host, 1, 1, 'facil', 'ferrix');
    const r = room.start(host, { fillBots: true });
    assert.equal(r.ok, true);
    assert.equal(room.phase, 'countdown');
    const cd = host.last('countdown');
    assert.equal(cd.seconds, 5);
    assert.equal(cd.startAt, clock.now() + 5000);
    assert.equal(b.last('countdown').seconds, 5);
    const st = host.last('room');
    assert.equal(st.phase, 'countdown');
    // team 0: host + 2 filled bots (dificil, distinct random factions)
    const t0bots = st.slots[0].filter((s) => s.kind === 'bot');
    assert.equal(t0bots.length, 2);
    assert.ok(t0bots.every((s) => s.difficulty === 'dificil'));
    assert.ok(t0bots.every((s) => FACTION_IDS.includes(s.faction)));
    assert.notEqual(t0bots[0].faction, t0bots[1].faction);
    // team 1: b + chosen ferrix bot + 1 filled bot (not ferrix: distinct)
    const t1bots = st.slots[1].filter((s) => s.kind === 'bot');
    assert.equal(t1bots.length, 2);
    assert.equal(t1bots[0].faction, 'ferrix');
    assert.notEqual(t1bots[1].faction, 'ferrix');
    for (const bot of [...t0bots, ...t1bots]) {
      const bb = room._debug.getBot(bot.playerId);
      assert.ok(bb.fleet, 'fleet built at countdown');
      assert.equal(validateFleet(bb.fleet, 1500).ok, true);
      assert.equal(bb.fleet.faction, bot.faction);
    }
    // nothing changes during countdown
    assert.equal(room.setFleet(host, VORRAX).code, ERR.WRONG_PHASE);
    assert.equal(room.pickSlot(host, 0, 1).code, ERR.WRONG_PHASE);
    assert.equal(room.setReady(host, false).code, ERR.WRONG_PHASE);
    assert.equal(room.start(host).code, ERR.WRONG_PHASE);
    assert.equal(startMatch.calls.length, 0);
    clock.advance(4999);
    assert.equal(room.phase, 'countdown');
    clock.advance(1);
    assert.equal(room.phase, 'battle');
    assert.equal(startMatch.calls.length, 1);
    const bs = host.last('battle_start');
    assert.equal(bs.seed, 42);
    assert.equal(bs.players.length, 6);
    assert.ok(bs.ships.length > 10);
    assert.equal(bs.tickRate, 20);
    assert.equal(bs.snapshotEvery, 2);
    assert.ok(bs.world.w > 0);
    assert.equal(bs.dead, undefined);
    const pb = bs.players.find((p) => p.id === 'b');
    assert.deepEqual(pb.fleet, LUMEN, 'fleets revealed at battle start');
    assert.equal(pb.isBot, false);
    assert.equal(pb.ai, 'especialista');
    assert.ok(bs.players.filter((p) => p.isBot).every((p) => p.fleet && p.ai));
    assert.equal(b.last('battle_start').seed, 42);
    assert.equal(host.last('room').phase, 'battle');
  });

  test('countdown aborts when a slotted human leaves or disconnects', () => {
    const { room, host, clock } = setup();
    const b = createFakeSession('b');
    room.join(b);
    readyUp(room, host);
    readyUp(room, b, VORRAX);
    room.start(host);
    assert.equal(room.phase, 'countdown');
    host.clear();
    room.onDisconnect(b);
    assert.equal(room.phase, 'lobby');
    assert.equal(host.last('error').code, ERR.COUNTDOWN_ABORTED);
    assert.equal(host.last('room').phase, 'lobby');
    assert.equal(host.last('room').slots[1][0].connected, false);
    clock.advance(10_000);
    assert.equal(room.phase, 'lobby', 'countdown timer was cancelled');
    room.onReconnect(b);
    room.setReady(b, true);
    room.setReady(host, true);
    room.start(host);
    assert.equal(room.phase, 'countdown');
    room.leave(b);
    assert.equal(room.phase, 'lobby');
    assert.equal(b.last('left').reason, 'left');
    assert.equal(room.toState('h').slots[1][0].kind, 'empty');
    // a spectator leaving does not abort
    room.addBot(host, 1, 0, 'normal');
    const c = createFakeSession('c');
    room.join(c);
    assert.deepEqual(room.toState('c').spectators.map((s) => s.id), ['c']);
    room.setReady(host, true);
    room.start(host);
    assert.equal(room.phase, 'countdown');
    room.leave(c);
    assert.equal(room.phase, 'countdown');
  });

  test('battle: frames broadcast as-is, late joiner gets battle_start with dead + last frame, end → results', () => {
    const { room, host, clock, startMatch } = setup();
    const b = createFakeSession('b');
    room.join(b);
    readyUp(room, host);
    readyUp(room, b, VORRAX);
    room.start(host);
    clock.advance(5000);
    const run = startMatch.calls[0];
    assert.equal(run.o.config.seed, 42);
    assert.equal(run.o.state.tick, 0);
    host.clear();
    b.clear();
    run.frame(2, [['shot', 1, 20, 0, 1]]);
    run.frame(4, [['die', 20, 1, 100, 100], ['spawn', 99, 'ter_vespa', 0, 'h', 5, 5, 0, 3]]);
    assert.equal(host.count('f'), 2);
    assert.deepEqual(host.all ? null : null, null);
    assert.deepEqual(b.out.filter((m) => m.t === 'f'), host.out.filter((m) => m.t === 'f'));
    const late = createFakeSession('late');
    assert.equal(room.join(late).ok, true);
    const bs = late.last('battle_start');
    assert.deepEqual(bs.dead, [20]);
    assert.ok(bs.ships.some((s) => s.id === 99 && s.source === 3), 'spawned unit appended for late joiners');
    assert.equal(late.last('f').k, 4);
    assert.equal(late.last('room').phase, 'battle');
    assert.deepEqual(late.last('room').spectators.map((s) => s.id), ['late']);
    // human disconnect during battle changes nothing in the sim
    room.onDisconnect(b);
    assert.equal(room.phase, 'battle');
    assert.equal(run.stopped, false);
    run.frame(6);
    assert.equal(b.count('f'), 2, 'disconnected member receives nothing');
    // reconnect: battle_start again with dead and last frame
    b.clear();
    room.onReconnect(b);
    assert.deepEqual(b.last('battle_start').dead, [20]);
    assert.equal(b.last('f').k, 6);
    const result = { winner: 0, reason: 'elimination', ticks: 6, remainingValue: [1, 0], players: {}, mvp: null };
    run.end(result);
    assert.equal(room.phase, 'results');
    assert.deepEqual(host.last('battle_end').result, result);
    assert.deepEqual(late.last('battle_end').result, result);
    assert.equal(host.last('room').phase, 'results');
    assert.equal(host.last('room').slots[0][0].ready, false);
    assert.equal(host.last('room').slots[0][0].hasFleet, true, 'fleets kept');
  });

  test('human absent at battle end becomes a normal bot with the same fleet', () => {
    const { room, host, clock, startMatch } = setup();
    const b = createFakeSession('b');
    room.join(b);
    readyUp(room, host);
    readyUp(room, b, VORRAX);
    room.start(host);
    clock.advance(5000);
    room.onDisconnect(b);
    startMatch.calls[0].end({ winner: 1, reason: 'elimination', ticks: 10, remainingValue: [0, 1], players: {}, mvp: null });
    const slot = room.toState('h').slots[1][0];
    assert.equal(slot.kind, 'bot');
    assert.equal(slot.difficulty, 'normal');
    assert.equal(slot.faction, 'vorrax');
    assert.deepEqual(room._debug.getBot(slot.playerId).fixedFleet, VORRAX);
    // host start in results → lobby; next countdown reuses the fixed fleet
    assert.equal(room.start(host).ok, true);
    assert.equal(room.phase, 'lobby');
    room.setReady(host, true);
    room.start(host);
    assert.deepEqual(room._debug.getBot(slot.playerId).fleet, VORRAX);
  });

  test('rematch: all connected slotted humans vote → lobby keeping fleets; results-phase guards', () => {
    const { room, host, clock, startMatch } = setup({ teamSize: 2 });
    const b = createFakeSession('b');
    room.join(b);
    const spec = createFakeSession('s');
    room.join(spec);
    room.pickSlot(spec, 0, 1);
    const w = createFakeSession('w');
    room.join(w); // spectator (team 1 slot 1 free? no: joins team 1 with fewer humans)
    assert.equal(room.toState('w').slots[1][1].playerId, 'w');
    for (const [s, f] of [[host, TERRAN], [b, VORRAX], [spec, LUMEN], [w, TERRAN]]) readyUp(room, s, f);
    assert.equal(room.rematch(host).code, ERR.WRONG_PHASE);
    room.start(host);
    clock.advance(5000);
    startMatch.calls[0].end({ winner: -1, reason: 'draw', ticks: 1, remainingValue: [0, 0], players: {}, mvp: null });
    assert.equal(room.phase, 'results');
    assert.equal(room.pickSlot(host, 1, 0).code, ERR.WRONG_PHASE);
    assert.equal(room.setReady(host, true).code, ERR.WRONG_PHASE);
    assert.equal(room.rematch(host).ok, true);
    assert.equal(room.rematch(host).ok, true, 'double vote is idempotent');
    assert.deepEqual(host.last('room').rematchVotes, ['h']);
    assert.equal(room.rematch(b).ok, true);
    assert.equal(room.phase, 'results');
    room.onDisconnect(w); // disconnected humans do not block
    assert.equal(room.phase, 'results');
    assert.equal(room.rematch(spec).ok, true);
    assert.equal(room.phase, 'lobby');
    assert.equal(startMatch.calls[0].stopped, true);
    const st = host.last('room');
    assert.equal(st.phase, 'lobby');
    assert.deepEqual(st.rematchVotes, []);
    assert.equal(st.slots[0][0].hasFleet, true);
    assert.equal(st.slots[0][0].ready, false);
    assert.equal(st.slots[1][0].hasFleet, true);
    assert.equal(st.slots[1][1].connected, false);
    // set_fleet allowed in results (prepare the next round)
  });

  test('set_fleet is accepted during results', () => {
    const { room, host, clock, startMatch } = setup();
    const b = createFakeSession('b');
    room.join(b);
    readyUp(room, host);
    readyUp(room, b, VORRAX);
    room.start(host);
    clock.advance(5000);
    startMatch.calls[0].end({ winner: 0, reason: 'elimination', ticks: 1, remainingValue: [1, 0], players: {}, mvp: null });
    assert.equal(room.setFleet(b, LUMEN).ok, true);
    assert.equal(room.toState('h').slots[1][0].faction, 'lumen');
  });
});

describe('room: disconnects, host migration, destruction', () => {
  test('lobby disconnect: slot kept 60 s (connected=false, ready cleared), host migrates immediately', () => {
    const { room, host, clock } = setup({ teamSize: 2 });
    const b = createFakeSession('b');
    room.join(b);
    const c = createFakeSession('c');
    room.join(c);
    readyUp(room, host);
    room.onDisconnect(host);
    assert.equal(room.hostId, 'b', 'oldest connected slotted human');
    let st = b.last('room');
    assert.equal(st.hostId, 'b');
    assert.equal(st.slots[0][0].kind, 'human');
    assert.equal(st.slots[0][0].connected, false);
    assert.equal(st.slots[0][0].ready, false);
    assert.equal(st.slots[0][0].isHost, false);
    assert.equal(st.slots[1][0].isHost, true);
    clock.advance(59_999);
    assert.equal(room.toState('b').slots[0][0].kind, 'human');
    clock.advance(1);
    st = room.toState('b');
    assert.equal(st.slots[0][0].kind, 'empty');
    assert.equal(room.memberCount, 2);
    assert.equal(host.roomCode, null);
    // the expired session cannot resume into the room
    assert.equal(room.onReconnect(host), false);
    // reconnect within the grace period restores the slot
    room.onDisconnect(c);
    clock.advance(30_000);
    assert.equal(room.onReconnect(c), true);
    assert.equal(room.toState('c').slots[0][1].connected, true);
    clock.advance(60_000);
    assert.equal(room.toState('c').slots[0][1].kind, 'human', 'grace timer cancelled by reconnect');
  });

  test('host leaving migrates host; host can be a spectator when no slotted human is connected', () => {
    const { room, host } = setup({ teamSize: 1 });
    const b = createFakeSession('b');
    room.join(b); // team 1 slot 0
    const spec = createFakeSession('s');
    room.join(spec); // spectator
    assert.equal(room.toState('b').slots[1][0].playerId, 'b');
    assert.deepEqual(room.toState('s').spectators.map((x) => x.id), ['s']);
    room.onDisconnect(b);
    room.leave(host);
    assert.equal(host.last('left').reason, 'left');
    assert.equal(host.roomCode, null);
    assert.equal(room.hostId, 's', 'only connected humans can inherit the host role');
    room.onReconnect(b);
    assert.equal(room.hostId, 's', 'reconnecting does not steal the host role');
    room.leave(spec);
    assert.equal(room.hostId, 'b');
    assert.equal(room.destroyed, false);
  });

  test('room without connected humans is destroyed after 60 s; without members immediately', () => {
    const { room, host, clock, destroyed } = setup();
    const b = createFakeSession('b');
    room.join(b);
    room.onDisconnect(host);
    room.onDisconnect(b);
    clock.advance(59_000);
    assert.equal(room.destroyed, false);
    room.onReconnect(b);
    clock.advance(10_000);
    assert.equal(room.destroyed, false, 'reconnect cancels destruction');
    room.onDisconnect(b);
    clock.advance(60_000);
    assert.equal(room.destroyed, true);
    assert.deepEqual(destroyed, ['ABCD']);
    assert.equal(host.roomCode, null);
    assert.equal(room.join(createFakeSession('z')).code, ERR.ROOM_NOT_FOUND);

    const s2 = setup();
    s2.room.leave(s2.host);
    assert.equal(s2.room.destroyed, true);
    assert.equal(s2.destroyed[0], 'ABCD');
  });

  test('battle keeps running when all humans drop; destroy stops the match and notifies', () => {
    const { room, host, clock, startMatch, destroyed } = setup();
    const b = createFakeSession('b');
    room.join(b);
    readyUp(room, host);
    readyUp(room, b, VORRAX);
    room.start(host);
    clock.advance(5000);
    room.onDisconnect(host);
    room.onDisconnect(b);
    clock.advance(60_000);
    assert.equal(room.phase, 'battle', 'battle continues to the end');
    assert.equal(startMatch.calls[0].stopped, false);
    assert.equal(room.memberCount, 2, 'seats are held until the battle ends');
    assert.equal(room.toState('h').slots[1][0].kind, 'human');
    room.onSessionExpired(b);
    assert.equal(room.toState('h').slots[1][0].kind, 'human');
    startMatch.calls[0].end({ winner: 0, reason: 'elimination', ticks: 1, remainingValue: [1, 0], players: {}, mvp: null });
    assert.equal(room.destroyed, true, 'nobody left: room destroyed at battle end');
    assert.deepEqual(destroyed, ['ABCD']);
  });

  test('explicit destroy sends left{room_closed} to everybody and stops the match', () => {
    const { room, host, clock, startMatch } = setup();
    const b = createFakeSession('b');
    room.join(b);
    readyUp(room, host);
    readyUp(room, b, VORRAX);
    room.start(host);
    clock.advance(5000);
    room.destroy('room_closed');
    assert.equal(startMatch.calls[0].stopped, true);
    assert.equal(host.last('left').reason, 'room_closed');
    assert.equal(b.last('left').reason, 'room_closed');
    assert.equal(b.roomCode, null);
    assert.equal(room.leave(host).code, ERR.NOT_IN_ROOM);
  });
});
