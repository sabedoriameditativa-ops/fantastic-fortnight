import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { WebSocketServer } from 'ws';
register('./_sharedHook.mjs', import.meta.url);
const { createNetClient } = await import('../../client/battle/netClient.js');
const { memoryStore, KEYS } = await import('../../client/util/storage.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting'); await wait(10); } };

/** Minimal fake server speaking the ARCHITECTURE §4.2 protocol (subset). */
function fakeServer(port = 0) {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  const sessions = new Map(); // token → session
  const rooms = new Map();
  const received = [];
  let nextPlayer = 1, nextRoom = 0;
  const codes = ['ABCD', 'EFGH', 'JKLM'];
  const send = (ws, m) => { try { ws.send(JSON.stringify(m)); } catch { /* ignore */ } };
  const roomState = (room, you) => ({
    t: 'room', code: room.code, hostId: room.hostId, teamSize: room.teamSize, budget: room.budget, botDifficulty: 'normal', phase: room.phase,
    slots: room.slots, spectators: [], rematchVotes: [], you,
  });
  const pushRoom = (room) => { for (const s of room.members) if (s.ws) send(s.ws, roomState(room, s.playerId)); };
  wss.on('connection', (ws) => {
    let sess = null;
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      received.push(m);
      if (m.t === 'hello') {
        if (m.name === 'bad!') { send(ws, { t: 'error', code: 'BAD_NAME' }); ws.close(); return; }
        if (m.token && sessions.has(m.token)) sess = sessions.get(m.token);
        else { sess = { playerId: 'p' + nextPlayer++, token: 'tok-' + Math.random().toString(36).slice(2), name: m.name, room: null }; sessions.set(sess.token, sess); }
        sess.ws = ws;
        send(ws, { t: 'welcome', playerId: sess.playerId, token: sess.token, version: 1, serverTime: Date.now() });
        if (sess.room) send(ws, roomState(sess.room, sess.playerId));
        return;
      }
      if (!sess) return;
      const ack = () => send(ws, { t: 'ack', rid: m.rid });
      const err = (code, detail) => send(ws, { t: 'error', rid: m.rid, code, detail });
      switch (m.t) {
        case 'create_room': {
          const room = { code: codes[nextRoom++ % codes.length], hostId: sess.playerId, teamSize: m.teamSize, budget: m.budget, phase: 'lobby', members: [sess],
            slots: [[{ kind: 'human', playerId: sess.playerId, name: sess.name, ready: false, hasFleet: false, connected: true, isHost: true }], [{ kind: 'empty', ready: false, hasFleet: false, connected: false, isHost: false }]] };
          for (let i = 1; i < m.teamSize; i++) { room.slots[0].push({ kind: 'empty' }); room.slots[1].push({ kind: 'empty' }); }
          rooms.set(room.code, room); sess.room = room;
          pushRoom(room); // no ack: the room push is the response
          break;
        }
        case 'join_room': {
          const room = rooms.get(m.code);
          if (!room) { err('ROOM_NOT_FOUND'); break; }
          room.members.push(sess); sess.room = room;
          room.slots[1][0] = { kind: 'human', playerId: sess.playerId, name: sess.name, ready: false, hasFleet: false, connected: true, isHost: false };
          pushRoom(room);
          break;
        }
        case 'leave_room': { if (sess.room) { sess.room.members = sess.room.members.filter((x) => x !== sess); sess.room = null; } send(ws, { t: 'left', reason: 'left' }); break; }
        case 'set_fleet': {
          if (!m.fleet || !m.fleet.ships || !m.fleet.ships.length) { err('FLEET_INVALID', { code: 'FLEET_SHIP_COUNT', detail: { count: 0, min: 1, max: 40 } }); break; }
          const slot = sess.room.slots.flat().find((s) => s.playerId === sess.playerId); slot.hasFleet = true; slot.faction = m.fleet.faction;
          ack(); pushRoom(sess.room); break;
        }
        case 'ready': { const slot = sess.room.slots.flat().find((s) => s.playerId === sess.playerId); if (m.ready && !slot.hasFleet) { err('FLEET_MISSING'); break; } slot.ready = m.ready; ack(); pushRoom(sess.room); break; }
        case 'chat': { ack(); for (const s of sess.room.members) send(s.ws, { t: 'chat', from: sess.playerId, name: sess.name, text: m.text, ts: Date.now() }); break; }
        case 'ping': send(ws, { t: 'pong', c: m.c, s: Date.now() }); break;
        case 'rematch': setTimeout(() => err('WRONG_PHASE'), 450); break; // answered only after the client's timeout (late error test)
        case 'start': {
          const room = sess.room;
          if (room.hostId !== sess.playerId) { err('NOT_HOST'); break; }
          ack();
          for (const s of room.members) send(s.ws, { t: 'countdown', seconds: 1, startAt: Date.now() + 1000 });
          room.phase = 'battle'; pushRoom(room);
          const info = { t: 'battle_start', seed: 7, players: [], ships: [], world: { w: 2800, h: 1575 }, tickRate: 20, snapshotEvery: 2 };
          for (const s of room.members) send(s.ws, info);
          for (let k = 2; k <= 6; k += 2) for (const s of room.members) send(s.ws, { t: 'f', k, s: [[1, 100, 100, 0, 1000, 0, 0]], e: k === 6 ? [['end', 0, 'elimination']] : [] });
          for (const s of room.members) send(s.ws, { t: 'battle_end', result: { winner: 0, reason: 'elimination', ticks: 6, remainingValue: [1, 0], players: {}, mvp: null } });
          break;
        }
        default: err('BAD_MESSAGE');
      }
    });
  });
  return {
    wss, received, sessions, rooms,
    get url() { return `ws://127.0.0.1:${wss.address().port}`; },
    /** Drop every socket (simulates a network cut). */
    dropAll() { for (const c of wss.clients) c.terminate(); },
    close() { return new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }); },
  };
}

describe('NetClient', () => {
  let srv;
  before(async () => { srv = fakeServer(); await until(() => !!srv.wss.address()); });
  after(async () => { await srv.close(); });

  const opts = () => ({ store: memoryStore(), backoff: [40, 40, 40], pingIntervalMs: 0, requestTimeoutMs: 300 });

  test('connect → welcome, token persisted, room flow with rid/ack/error promises', async () => {
    const store = memoryStore();
    const c = createNetClient(srv.url, { ...opts(), store });
    const statuses = [];
    c.onStatus((s) => statuses.push(s));
    const { playerId } = await c.connect('Ana');
    assert.match(playerId, /^p\d+$/);
    assert.equal(c.playerId, playerId);
    assert.equal(store.getItem(KEYS.token), c.name && srv.sessions.get(store.getItem(KEYS.token)).token);
    assert.deepEqual(statuses, ['idle', 'connecting', 'ok']);
    assert.equal(c.feed.isLocal, false);

    const rooms = [];
    c.onRoom((r) => rooms.push(r));
    const room = await c.createRoom({ teamSize: 2, budget: 1500 });
    assert.equal(room.code, 'ABCD');
    assert.equal(room.you, playerId);
    assert.equal(room.hostId, playerId);
    assert.equal(rooms.length, 1, 'room push delivered to onRoom');
    assert.equal(c.room.code, 'ABCD');
    const sent = srv.received.find((m) => m.t === 'create_room');
    assert.ok(Number.isInteger(sent.rid) && sent.rid >= 1, 'requests carry an integer rid');

    const errors = [];
    c.onError((e) => errors.push(e));
    await assert.rejects(c.setFleet({ faction: 'terran', ships: [] }), (e) => e.code === 'FLEET_INVALID' && e.detail.code === 'FLEET_SHIP_COUNT');
    assert.equal(errors[0].code, 'FLEET_INVALID');
    await assert.rejects(c.setReady(true), (e) => e.code === 'FLEET_MISSING');
    const r2 = await c.setFleet({ faction: 'terran', ships: [{ cls: 'ter_falcao', count: 2 }] });
    assert.equal(r2.code, 'ABCD');
    assert.equal(c.room.slots[0][0].hasFleet, true);
    await c.setReady(true);
    assert.equal(c.room.slots[0][0].ready, true);

    const chats = [];
    c.onChat((m) => chats.push(m));
    await c.chat('olá');
    await until(() => chats.length === 1);
    assert.equal(chats[0].text, 'olá');
    assert.equal(chats[0].name, 'Ana');

    c.ping();
    await until(() => srv.received.some((m) => m.t === 'pong' || m.t === 'ping'));
    await wait(30);
    assert.ok(Number.isFinite(c.latencyMs) && c.latencyMs >= 0);

    await assert.rejects(c.rematch(), (e) => e.code === 'TIMEOUT');
    c.dispose();
    assert.equal(c.status, 'closed');
    await assert.rejects(c.chat('x'), (e) => e.code === 'DISCONNECTED');
  });

  test('second client joins by code; unknown code rejects with ROOM_NOT_FOUND; battle feed receives start/frames/end', async () => {
    const host = createNetClient(srv.url, opts());
    const guest = createNetClient(srv.url, opts());
    await host.connect('Host');
    await guest.connect('Guest');
    const room = await host.createRoom({ teamSize: 1, budget: 800 });
    await assert.rejects(guest.joinRoom('ZZZZ'), (e) => e.code === 'ROOM_NOT_FOUND');
    const joined = await guest.joinRoom(room.code.toLowerCase());
    assert.equal(joined.code, room.code);
    assert.equal(joined.slots[1][0].playerId, guest.playerId);
    await until(() => host.room && host.room.slots[1][0].kind === 'human');

    await assert.rejects(guest.start({ fillBots: true }), (e) => e.code === 'NOT_HOST');

    const events = [];
    const countdowns = [];
    guest.onCountdown((cd) => countdowns.push(cd));
    guest.feed.onStart((info) => events.push(['start', info.seed]));
    guest.feed.onFrame((f) => events.push(['frame', f.k, typeof f.at]));
    guest.feed.onEnd((r) => events.push(['end', r.winner]));
    await host.start({ fillBots: true });
    await until(() => events.some((e) => e[0] === 'end'));
    assert.deepEqual(events, [['start', 7], ['frame', 2, 'number'], ['frame', 4, 'number'], ['frame', 6, 'number'], ['end', 0]]);
    assert.equal(countdowns.length, 1);
    assert.equal(countdowns[0].seconds, 1);
    assert.equal(guest.feed.lastStart.isLocal, false);

    const lefts = [];
    guest.onLeft((r) => lefts.push(r));
    assert.ok(guest.feed.lastStart, 'battle known before leaving');
    await guest.leaveRoom();
    assert.deepEqual(lefts, ['left']);
    assert.equal(guest.room, null);
    assert.equal(guest.feed.lastStart, null, 'leaving the room forgets the battle');
    let replayed = false;
    guest.feed.onStart(() => { replayed = true; });
    assert.equal(replayed, false, 'no replay of a battle we walked out of');
    host.dispose(); guest.dispose();
  });

  test('reconnects with the session token after a dropped socket (backoff) and reports status', async () => {
    const store = memoryStore();
    const c = createNetClient(srv.url, { ...opts(), store });
    const statuses = [];
    const feedStatuses = [];
    c.onStatus((s) => statuses.push(s));
    c.feed.onStatus((s) => feedStatuses.push(s));
    const { playerId } = await c.connect('Ana');
    const created = await c.createRoom({ teamSize: 1, budget: 1500 });
    const token = store.getItem(KEYS.token);
    const hellosBefore = srv.received.filter((m) => m.t === 'hello').length;

    const pendingDuringDrop = c.chat('x');
    srv.dropAll();
    await assert.rejects(pendingDuringDrop, (e) => e.code === 'DISCONNECTED');
    await until(() => c.status === 'reconnecting');
    await assert.rejects(c.chat('y'), (e) => e.code === 'NOT_CONNECTED');
    await until(() => c.status === 'ok', 3000);
    const hellos = srv.received.filter((m) => m.t === 'hello');
    assert.equal(hellos.length, hellosBefore + 1);
    assert.equal(hellos[hellos.length - 1].token, token, 'hello carries the saved token');
    assert.equal(c.playerId, playerId, 'session resumed → same player id');
    assert.equal(c.room && c.room.code, created.code, 'room state re-pushed after resume');
    assert.deepEqual(statuses.slice(0, 3), ['idle', 'connecting', 'ok']);
    assert.ok(statuses.includes('reconnecting'));
    assert.equal(statuses[statuses.length - 1], 'ok');
    assert.deepEqual(feedStatuses.filter((s, i, a) => a.indexOf(s) === i), ['ok', 'reconnecting']);
    assert.equal(feedStatuses[feedStatuses.length - 1], 'ok');
    c.dispose();
  });

  test('gives up after the backoff schedule → status lost; reconnect() retries', async () => {
    const local = fakeServer();
    await until(() => !!local.wss.address());
    const c = createNetClient(local.url, { ...opts(), backoff: [20, 20], retryWindowMs: 0 });
    await c.connect('Ana');
    await local.close();
    await until(() => c.status === 'lost', 3000);
    assert.equal(c.status, 'lost');
    c.reconnect();
    assert.equal(c.status, 'reconnecting');
    await until(() => c.status === 'lost', 3000);
    c.dispose();
  });

  test('connect() after the backoff is exhausted rejects with CONNECT_FAILED instead of hanging', async () => {
    const local = fakeServer();
    await until(() => !!local.wss.address());
    const c = createNetClient(local.url, { ...opts(), backoff: [20, 20], retryWindowMs: 0 });
    await c.connect('Ana');
    await local.close();
    await until(() => c.status === 'lost', 3000);
    // the lobby's getNet() → connect() path after a lost connection
    const t0 = Date.now();
    await assert.rejects(c.connect('Ana'), (e) => e.code === 'CONNECT_FAILED');
    assert.ok(Date.now() - t0 < 2000, 'settled by the backoff schedule');
    assert.equal(c.status, 'lost');
    // a waiter queued while reconnecting is rejected too, and dispose() settles the rest
    const p = c.connect('Ana');
    await until(() => c.status === 'reconnecting');
    c.dispose();
    await assert.rejects(p, (e) => e.code === 'DISCONNECTED' || e.code === 'CONNECT_FAILED');
  });

  test('keeps retrying through the grace window (not just 5 tries) and recovers when the server is back', async () => {
    const local = fakeServer();
    await until(() => !!local.wss.address());
    const port = local.wss.address().port;
    const c = createNetClient(local.url, { ...opts(), backoff: [20, 20], retryWindowMs: 5000 });
    await c.connect('Ana');
    await local.close();
    await until(() => c.status === 'reconnecting', 2000);
    await new Promise((r) => setTimeout(r, 150));   // well past 2 x 20 ms: the old client would be 'lost' by now
    assert.equal(c.status, 'reconnecting', 'still trying while the server keeps the seat');
    const again = fakeServer(port);
    await until(() => !!again.wss.address());
    await until(() => c.status === 'ok', 4000);
    c.dispose();
    await again.close();
  });

  test('close code 4001 (session replaced by another tab) is terminal: status replaced, token forgotten, no ping-pong', async () => {
    const local = fakeServer();
    await until(() => !!local.wss.address());
    const store = new Map();
    const c = createNetClient(local.url, { ...opts(), store, backoff: [20, 20] });
    await c.connect('Ana');
    const serverWs = [...local.wss.clients][0];
    serverWs.close(4001, 'replaced');
    await until(() => c.status === 'replaced', 2000);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(c.status, 'replaced');
    assert.equal(local.wss.clients.size, 0, 'did not reconnect');
    assert.ok(!store.get('fe.token'), 'token cleared');
    c.dispose();
    await local.close();
  });

  test('a late error for a request that already timed out is surfaced as unsolicited (no rid)', async () => {
    const c = createNetClient(srv.url, opts());
    await c.connect('Ana');
    await c.createRoom({ teamSize: 1, budget: 800 });
    const errors = [];
    c.onError((e) => errors.push(e));
    await assert.rejects(c.rematch(), (e) => e.code === 'TIMEOUT');
    await until(() => errors.some((e) => e.code === 'WRONG_PHASE'), 2000);
    const late = errors.find((e) => e.code === 'WRONG_PHASE');
    assert.equal(late.rid, undefined, 'orphan errors carry no rid so app.js toasts them');
    c.dispose();
  });

  test('connect rejects when the server is unreachable or rejects the name', async () => {
    const c = createNetClient('ws://127.0.0.1:1', opts());
    await assert.rejects(c.connect('Ana'), (e) => e.code === 'CONNECT_FAILED');
    assert.equal(c.status, 'lost');
    c.dispose();
    const d = createNetClient(srv.url, opts());
    await assert.rejects(d.connect('bad!'), (e) => e.code === 'BAD_NAME');
    d.dispose();
  });
});
