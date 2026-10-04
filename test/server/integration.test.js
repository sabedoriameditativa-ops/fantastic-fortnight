// Integration: real HTTP + WebSocket server (port 0) with shortened battles
// (FE_MAX_TICKS=300, FE_TICK_MS=5, FE_COUNTDOWN_MS=700) and real ws clients.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../server/index.js';
import { presetFleet } from '../../shared/fleet.js';
import { PROTOCOL_VERSION } from '../../shared/constants.js';
import { createTestClient, sleep } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_TICKS = 300;
const COUNTDOWN_MS = 700;

let server;
let url;
const clients = [];

function connect(name) {
  const c = createTestClient(url, name);
  clients.push(c);
  return c;
}

async function connectHello(name) {
  const c = connect(name);
  await c.open;
  const w = await c.hello();
  assert.equal(w.t, 'welcome', JSON.stringify(w));
  c.playerId = w.playerId;
  c.token = w.token;
  return c;
}

before(async () => {
  server = await startServer({ port: 0, maxTicks: MAX_TICKS, tickMs: 5, countdownMs: COUNTDOWN_MS, log: { log() {}, warn() {} } });
  url = `ws://127.0.0.1:${server.port}/`;
});

after(async () => {
  for (const c of clients) {
    try { await c.close(); } catch { /* ignore */ }
  }
  await server.close();
});

async function runBattle(host, others) {
  const all = [host, ...others];
  const cd = await Promise.all(all.map((c) => c.waitFor((m) => m.t === 'countdown')));
  for (const m of cd) {
    assert.equal(m.seconds, COUNTDOWN_MS / 1000);
    assert.ok(Number.isFinite(m.startAt));
  }
  const starts = await Promise.all(all.map((c) => c.waitFor((m) => m.t === 'battle_start', 10_000)));
  const ends = await Promise.all(all.map((c) => c.waitFor((m) => m.t === 'battle_end', 20_000)));
  return { starts, ends };
}

describe('integration: real server', () => {
  test('/health over HTTP and welcome handshake', async () => {
    const h = await fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.json());
    assert.equal(h.ok, true);
    assert.equal(typeof h.rooms, 'number');
    assert.equal(typeof h.uptime, 'number');
    const c = connect('Hand');
    await c.open;
    c.send({ t: 'ping', c: 1 });
    const e = await c.next((m) => m.t === 'error');
    assert.equal(e.code, 'BAD_MESSAGE');
    assert.equal(e.detail, 'hello_first');
    const bad = await c.hello({ name: '' });
    assert.equal(bad.code, 'BAD_NAME');
    const w = await c.hello();
    assert.equal(w.t, 'welcome');
    assert.equal(w.version, PROTOCOL_VERSION);
    assert.match(w.playerId, /^p\d+$/);
    assert.ok(w.token.length > 10);
    c.send({ t: 'ping', c: 77 });
    const pong = await c.next((m) => m.t === 'pong');
    assert.equal(pong.c, 77);
    assert.equal(typeof pong.s, 'number');
    c.sendRaw('{not json');
    assert.equal((await c.next((m) => m.t === 'error')).code, 'BAD_MESSAGE');
    await c.close();
    const v = connect('Old');
    await v.open;
    const mismatch = await v.hello({ version: 99 });
    assert.equal(mismatch.code, 'VERSION_MISMATCH');
    await sleep(50);
    assert.equal(v.closed && v.closed.code, 4000);
  });

  test('1v1: create/join, fleets, ready, start → countdown → battle_start → frames → battle_end, identical frames', async () => {
    const a = await connectHello('Ana');
    const b = await connectHello('Bia');
    const created = await a.request({ t: 'create_room', teamSize: 1, budget: 1500 });
    const code = created.room.code;
    assert.match(code, /^[A-Z2-9]{4}$/);
    assert.equal(created.room.hostId, a.playerId);
    assert.equal(created.room.slots[0][0].playerId, a.playerId);
    const joined = await b.request({ t: 'join_room', code });
    assert.equal(joined.room.slots[1][0].playerId, b.playerId);
    assert.equal(joined.room.you, b.playerId);
    const push = await a.next((m) => m.t === 'room' && m.slots[1][0].kind === 'human');
    assert.equal(push.you, a.playerId);

    await assert.rejects(b.request({ t: 'ready', ready: true }), (e) => e.code === 'FLEET_MISSING');
    await assert.rejects(b.request({ t: 'start' }), (e) => e.code === 'NOT_HOST');
    await assert.rejects(a.request({ t: 'set_fleet', fleet: presetFleet('ter_linha', 2500) }), (e) => e.code === 'FLEET_INVALID' && e.detail.code === 'FLEET_OVER_BUDGET');
    const fleetA = presetFleet('ter_linha', 1500);
    const fleetB = presetFleet('lum_coro', 1500);
    await a.request({ t: 'set_fleet', fleet: fleetA });
    await b.request({ t: 'set_fleet', fleet: fleetB });
    const seen = await b.next((m) => m.t === 'room' && m.slots[0][0].hasFleet);
    assert.equal(seen.slots[0][0].faction, 'terran');
    assert.ok(!JSON.stringify(seen).includes('"ships"'), 'fleet hidden before battle');
    await a.request({ t: 'ready', ready: true });
    await assert.rejects(a.request({ t: 'start' }), (e) => e.code === 'NOT_ALL_READY' && e.detail.missing[0].reason === 'not_ready');
    await b.request({ t: 'ready', ready: true });
    await a.request({ t: 'start' });

    const { starts, ends } = await runBattle(a, [b]);
    const [sa, sb] = starts;
    assert.deepEqual(sa, sb);
    assert.equal(sa.players.length, 2);
    assert.deepEqual(sa.players.find((p) => p.id === b.playerId).fleet, fleetB, 'fleets revealed');
    assert.ok(sa.ships.length > 20);
    assert.equal(sa.ships[0].id, 1);
    assert.equal(sa.tickRate, 20);
    assert.equal(sa.snapshotEvery, 2);
    assert.ok(sa.world.w >= 2800);
    assert.equal(sa.dead, undefined);

    const [ea, eb] = ends;
    assert.deepEqual(ea.result, eb.result);
    assert.equal(ea.result.ticks, MAX_TICKS);
    assert.ok([0, 1, -1].includes(ea.result.winner));
    assert.ok(ea.result.players[a.playerId]);
    assert.equal(typeof ea.result.players[b.playerId].shipsTotal, 'number');

    const fa = a.all('f');
    const fb = b.all('f');
    assert.ok(fa.length >= 1);
    assert.equal(fa.length, MAX_TICKS / 2);
    assert.deepEqual(fa, fb, 'both clients receive identical frame sequences');
    assert.equal(fa[0].k, 2);
    assert.equal(fa[fa.length - 1].k, MAX_TICKS);
    for (let i = 1; i < fa.length; i++) assert.equal(fa[i].k, fa[i - 1].k + 2);
    assert.ok(fa[0].s.length === sa.ships.length);
    assert.ok(fa[0].s.every((row) => row.length === 7));
    const lastE = fa[fa.length - 1].e;
    assert.equal(lastE[lastE.length - 1][0], 'end');
    // message order: countdown < battle_start < frames < battle_end
    const idx = (t) => a.inbox.findIndex((m) => m.t === t);
    assert.ok(idx('countdown') < idx('battle_start') && idx('battle_start') < idx('f'));
    assert.ok(a.inbox.findIndex((m) => m.t === 'battle_end') > a.inbox.map((m) => m.t).lastIndexOf('f'));
    const roomAfter = await a.next((m) => m.t === 'room' && m.phase === 'results');
    assert.equal(roomAfter.slots[0][0].ready, false);
    assert.equal(roomAfter.slots[0][0].hasFleet, true);

    // rematch: both vote → lobby with fleets kept
    await a.request({ t: 'rematch' });
    const votes = await b.next((m) => m.t === 'room' && m.rematchVotes.length === 1);
    assert.deepEqual(votes.rematchVotes, [a.playerId]);
    await b.request({ t: 'rematch' });
    const lobbyAgain = await b.next((m) => m.t === 'room' && m.phase === 'lobby');
    assert.equal(lobbyAgain.slots[1][0].hasFleet, true);
    assert.equal(lobbyAgain.slots[1][0].ready, false);
    await a.request({ t: 'leave_room' });
    assert.equal((await a.next((m) => m.t === 'left')).reason, 'left');
    const migrated = await b.next((m) => m.t === 'room' && m.hostId === b.playerId);
    assert.equal(migrated.slots[0][0].kind, 'empty');
    await b.request({ t: 'leave_room' });
  });

  test('2v2: empty slots filled with bots via fillBots; spectator joins mid-battle and gets a sync', async () => {
    const a = await connectHello('Caio');
    const b = await connectHello('Duda');
    const { room } = await a.request({ t: 'create_room', teamSize: 2, budget: 800 });
    await a.request({ t: 'set_room', botDifficulty: 'facil' });
    await b.request({ t: 'join_room', code: room.code });
    await b.request({ t: 'pick_slot', team: 0, slot: 1 });
    await a.request({ t: 'add_bot', team: 1, slot: 0, difficulty: 'dificil', faction: 'vorrax' });
    await a.request({ t: 'set_fleet', fleet: presetFleet('fer_ferro', 800) });
    await b.request({ t: 'set_fleet', fleet: presetFleet('fer_fabrica', 800) });
    await a.request({ t: 'ready', ready: true });
    await b.request({ t: 'ready', ready: true });
    await assert.rejects(a.request({ t: 'start' }), (e) => e.code === 'NOT_ALL_READY' && e.detail.missing.some((m) => m.reason === 'empty'));
    await a.request({ t: 'start', fillBots: true });
    const cdRoom = await a.next((m) => m.t === 'room' && m.phase === 'countdown');
    assert.equal(cdRoom.slots[1][0].kind, 'bot');
    assert.equal(cdRoom.slots[1][0].faction, 'vorrax');
    assert.equal(cdRoom.slots[1][0].difficulty, 'dificil');
    assert.equal(cdRoom.slots[1][1].kind, 'bot');
    assert.equal(cdRoom.slots[1][1].difficulty, 'facil');
    assert.notEqual(cdRoom.slots[1][1].faction, 'vorrax', 'distinct factions on the same team');

    const spectatorPromise = (async () => {
      const s = await connectHello('Espectador');
      // join after the battle started
      await a.waitFor((m) => m.t === 'battle_start', 10_000);
      await a.waitFor((m) => m.t === 'f', 10_000);
      const j = await s.request({ t: 'join_room', code: room.code });
      assert.deepEqual(j.room.spectators.map((x) => x.id), [s.playerId]);
      assert.equal(j.room.phase, 'battle');
      const bs = await s.next((m) => m.t === 'battle_start');
      assert.ok(Array.isArray(bs.dead), 'reconnect-style sync has dead[]');
      assert.equal(bs.players.length, 4);
      const f = await s.next((m) => m.t === 'f');
      assert.ok(f.k >= 2);
      await s.next((m) => m.t === 'battle_end', 20_000);
      return s;
    })();

    const { starts, ends } = await runBattle(a, [b]);
    const s = await spectatorPromise;
    assert.equal(starts[0].players.length, 4);
    const bots = starts[0].players.filter((p) => p.isBot);
    assert.equal(bots.length, 2);
    assert.ok(bots.every((p) => p.team === 1 && p.fleet && p.fleet.ships.length > 0));
    assert.deepEqual(bots.map((p) => p.ai).sort(), ['dificil', 'facil']);
    assert.equal(bots.find((p) => p.ai === 'dificil').faction, 'vorrax');
    assert.deepEqual(ends[0].result, ends[1].result);
    assert.deepEqual(a.all('f'), b.all('f'));
    const sFrames = s.all('f');
    assert.equal(sFrames[sFrames.length - 1].k, MAX_TICKS);
    await a.request({ t: 'leave_room' });
    await b.request({ t: 'leave_room' });
    await s.request({ t: 'leave_room' });
  });

  test('reconnect with token resumes the session and the room; rate limit closes abusive sockets', async () => {
    const a = await connectHello('Eva');
    const { room } = await a.request({ t: 'create_room', teamSize: 1, budget: 1500 });
    await a.request({ t: 'set_fleet', fleet: presetFleet('vor_garras', 1500) });
    await a.close();
    const a2 = connect('Eva');
    await a2.open;
    const w = await a2.hello({ token: a.token });
    assert.equal(w.t, 'welcome');
    assert.equal(w.playerId, a.playerId, 'same player id after resume');
    const st = await a2.next((m) => m.t === 'room');
    assert.equal(st.code, room.code);
    assert.equal(st.slots[0][0].connected, true);
    assert.equal(st.slots[0][0].hasFleet, true);
    assert.equal(st.hostId, a.playerId);
    // a bogus token yields a fresh session
    const z = connect('Zed');
    await z.open;
    const wz = await z.hello({ token: 'nope' });
    assert.equal(wz.t, 'welcome');
    assert.notEqual(wz.playerId, a.playerId);

    // rate limit: 20 msg/s burst 40 → flood 200 pings
    for (let i = 0; i < 200; i++) z.send({ t: 'ping', c: i });
    const err = await z.next((m) => m.t === 'error' && m.code === 'RATE_LIMITED');
    assert.equal(err.code, 'RATE_LIMITED');
    await sleep(100);
    assert.equal(z.closed && z.closed.code, 4008, 'socket closed after repeated violations');
    assert.ok(z.all('pong').length <= 41);
    await a2.request({ t: 'leave_room' });
  });

  test('oversized message (>16 KB) is rejected', async () => {
    const c = await connectHello('Max');
    const big = { t: 'chat', text: 'x'.repeat(20_000), rid: 1 };
    c.send(big);
    await sleep(150);
    assert.ok(c.closed, 'ws closes the connection for frames above maxPayload');
    assert.equal(c.closed.code, 1009);
  });

  test('server process prints "listening <port>" and exits cleanly on SIGTERM', async () => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      env: { ...process.env, PORT: '0', FE_MAX_TICKS: '50' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no listening line: ' + out)), 8000);
      child.stdout.on('data', (d) => {
        out += d.toString();
        const m = out.match(/listening (\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      });
      child.on('exit', (code) => reject(new Error('exited early ' + code + ' ' + out)));
    });
    assert.ok(port > 0);
    const h = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
    assert.equal(h.ok, true);
    const c = createTestClient(`ws://127.0.0.1:${port}/`, 'Proc');
    await c.open;
    await c.hello();
    const exit = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGTERM');
    const code = await Promise.race([exit, sleep(5000).then(() => 'timeout')]);
    assert.equal(code, 0);
    await sleep(20);
    assert.ok(c.closed, 'clients are closed on shutdown');
    assert.equal(c.closed.code, 1001);
  });
});
