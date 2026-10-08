import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenBucket, createSessionStore } from '../../server/session.js';
import { createFakeClock } from './helpers.js';

describe('token bucket', () => {
  test('allows burst then refills at the rate', () => {
    const clock = createFakeClock(0);
    const b = createTokenBucket(20, 40, clock.now);
    let ok = 0;
    for (let i = 0; i < 50; i++) if (b.take()) ok++;
    assert.equal(ok, 40, 'burst of 40');
    assert.equal(b.take(), false);
    clock.advance(100); // +2 tokens
    assert.equal(b.take(), true);
    assert.equal(b.take(), true);
    assert.equal(b.take(), false);
    clock.advance(10_000);
    assert.equal(Math.round(b.tokens()), 40, 'capped at burst');
  });

  test('chat bucket 1/s burst 1', () => {
    const clock = createFakeClock(0);
    const b = createTokenBucket(1, 1, clock.now);
    assert.equal(b.take(), true);
    assert.equal(b.take(), false);
    clock.advance(999);
    assert.equal(b.take(), false);
    clock.advance(1);
    assert.equal(b.take(), true);
  });
});

function fakeWs() {
  const ws = { readyState: 1, sent: [], closed: null, send(s) { ws.sent.push(s); }, close(code, reason) { ws.closed = { code, reason }; ws.readyState = 3; } };
  return ws;
}

describe('session store', () => {
  test('create → resume by token replaces the socket; unknown token → null', () => {
    const clock = createFakeClock(0);
    const expired = [];
    const store = createSessionStore({ graceMs: 60_000, clock, onExpire: (s) => expired.push(s.id) });
    const ws1 = fakeWs();
    const s = store.create('Ana', ws1);
    assert.match(s.id, /^p\d+$/);
    assert.ok(s.token.length >= 16);
    assert.equal(store.get(s.id), s);
    assert.equal(store.resume('nope', fakeWs()), null);
    assert.equal(store.resume(undefined, fakeWs()), null);
    const ws2 = fakeWs();
    assert.equal(store.resume(s.token, ws2), s);
    assert.equal(s.ws, ws2);
    assert.equal(ws1.closed.code, 4001, 'old socket closed as replaced');
    assert.equal(s.connected, true);
    assert.equal(s.send({ t: 'x' }), true);
    assert.deepEqual(JSON.parse(ws2.sent[0]), { t: 'x' });
  });

  test('detach starts the 60 s grace; expiry destroys the session and calls onExpire', () => {
    const clock = createFakeClock(0);
    const expired = [];
    const store = createSessionStore({ graceMs: 60_000, clock, onExpire: (s) => expired.push(s.id) });
    const ws1 = fakeWs();
    const s = store.create('Ana', ws1);
    assert.equal(store.detach(s, fakeWs()), false, 'a foreign socket does not detach');
    assert.equal(store.detach(s, ws1), true);
    assert.equal(s.connected, false);
    assert.equal(s.sendRaw('{}'), false, 'drops while disconnected');
    clock.advance(59_999);
    assert.equal(store.get(s.id), s);
    assert.deepEqual(expired, []);
    clock.advance(1);
    assert.equal(store.get(s.id), null);
    assert.deepEqual(expired, [s.id]);
    assert.equal(store.resume(s.token, fakeWs()), null, 'expired token cannot resume');
    assert.equal(store.size, 0);
  });

  test('resume within the grace cancels expiry', () => {
    const clock = createFakeClock(0);
    const expired = [];
    const store = createSessionStore({ graceMs: 60_000, clock, onExpire: (s) => expired.push(s.id) });
    const ws1 = fakeWs();
    const s = store.create('Ana', ws1);
    store.detach(s, ws1);
    clock.advance(30_000);
    const ws2 = fakeWs();
    assert.equal(store.resume(s.token, ws2), s);
    clock.advance(100_000);
    assert.deepEqual(expired, []);
    assert.equal(store.get(s.id), s);
    store.clear();
    assert.equal(store.size, 0);
  });
});

import { EventEmitter } from 'node:events';
import { attachConnection, createAddressLimiter, CLOSE, MAX_BUFFERED } from '../../server/session.js';
import { PROTOCOL_VERSION } from '../../shared/constants.js';

/** Fake ws with events: `close()` records the code and emits 'close' like the real one (asynchronously here: by hand). */
function fakeSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.sent = [];
  ws.closed = null;
  ws.bufferedAmount = 0;
  ws.send = (s) => ws.sent.push(JSON.parse(s));
  ws.close = (code, reason) => {
    if (ws.closed) return;
    ws.closed = { code, reason };
    ws.readyState = 3;
    ws.emit('close', code, Buffer.from(reason || ''));
  };
  ws.message = (obj) => ws.emit('message', Buffer.from(JSON.stringify(obj)), false);
  ws.last = (t) => [...ws.sent].reverse().find((m) => m.t === t) || null;
  return ws;
}

function fakeLobby() {
  const calls = [];
  return {
    calls,
    handleMessage(s, m) { calls.push(['msg', s.id, m.t]); },
    onDisconnect(s) { calls.push(['disconnect', s.id]); if (s.name === 'Boom') throw new Error('disconnect boom'); },
    onReconnect(s) { calls.push(['reconnect', s.id]); if (s.name === 'Boom') throw new Error('reconnect boom'); },
  };
}

describe('attachConnection', () => {
  test('a socket that never sends hello is closed after the handshake timeout; hello cancels it', () => {
    const clock = createFakeClock(0);
    const sessions = createSessionStore({ clock });
    const lobby = fakeLobby();
    const silent = fakeSocket();
    attachConnection(silent, { sessions, lobby, clock, log: { warn() {} }, handshakeMs: 10_000 });
    clock.advance(9_999);
    assert.equal(silent.closed, null);
    clock.advance(1);
    assert.equal(silent.closed.code, CLOSE.HANDSHAKE_TIMEOUT);
    assert.equal(sessions.size, 0, 'no session was ever created');

    const polite = fakeSocket();
    attachConnection(polite, { sessions, lobby, clock, log: { warn() {} }, handshakeMs: 10_000 });
    clock.advance(5_000);
    polite.message({ t: 'hello', name: 'Ana', version: PROTOCOL_VERSION });
    assert.equal(polite.last('welcome').playerId, 'p1');
    clock.advance(60_000);
    assert.equal(polite.closed, null, 'handshake timer cleared by hello');
    assert.equal(clock.pending(), 0, 'no stray timers');
  });

  test('per-address limiter refuses the N+1th concurrent socket with RATE_LIMITED and releases on close', () => {
    const clock = createFakeClock(0);
    const sessions = createSessionStore({ clock });
    const lobby = fakeLobby();
    const limiter = createAddressLimiter({ maxSockets: 2 });
    const opts = { sessions, lobby, clock, log: { warn() {} }, limiter, remoteAddress: '1.2.3.4' };
    const a = fakeSocket();
    const b = fakeSocket();
    const c = fakeSocket();
    attachConnection(a, opts);
    attachConnection(b, opts);
    attachConnection(c, opts);
    assert.equal(a.closed, null);
    assert.equal(b.closed, null);
    assert.equal(c.closed.code, CLOSE.TOO_MANY_CONNECTIONS);
    assert.deepEqual(c.last('error'), { t: 'error', code: 'RATE_LIMITED', detail: 'connections' });
    assert.equal(limiter.count('1.2.3.4'), 2);
    // a different address is independent; an unknown address is never limited
    const d = fakeSocket();
    attachConnection(d, { ...opts, remoteAddress: '5.6.7.8' });
    assert.equal(d.closed, null);
    const e = fakeSocket();
    attachConnection(e, { ...opts, remoteAddress: undefined });
    assert.equal(e.closed, null);
    // closing frees the slot (even for a socket that never said hello)
    a.close(1000, 'bye');
    assert.equal(limiter.count('1.2.3.4'), 1);
    const f = fakeSocket();
    attachConnection(f, opts);
    assert.equal(f.closed, null);
    assert.equal(limiter.count('1.2.3.4'), 2);
    assert.equal(clock.pending() > 0, true);
  });

  test('session.remoteAddress is recorded on hello and updated on resume', () => {
    const clock = createFakeClock(0);
    const sessions = createSessionStore({ clock });
    const lobby = fakeLobby();
    const a = fakeSocket();
    attachConnection(a, { sessions, lobby, clock, log: { warn() {} }, remoteAddress: '1.1.1.1' });
    a.message({ t: 'hello', name: 'Ana', version: PROTOCOL_VERSION });
    const w = a.last('welcome');
    const s = sessions.get(w.playerId);
    assert.equal(s.remoteAddress, '1.1.1.1');
    a.close(1000, '');
    const b = fakeSocket();
    attachConnection(b, { sessions, lobby, clock, log: { warn() {} }, remoteAddress: '2.2.2.2' });
    b.message({ t: 'hello', name: 'Ana', version: PROTOCOL_VERSION, token: w.token });
    assert.equal(b.last('welcome').playerId, w.playerId);
    assert.equal(s.remoteAddress, '2.2.2.2');
  });

  test('exceptions from lobby.onDisconnect / onReconnect are logged, not thrown', () => {
    const clock = createFakeClock(0);
    const sessions = createSessionStore({ clock });
    const lobby = fakeLobby();
    const warns = [];
    const log = { warn: (...a) => warns.push(a) };
    const a = fakeSocket();
    attachConnection(a, { sessions, lobby, clock, log });
    a.message({ t: 'hello', name: 'Boom', version: PROTOCOL_VERSION });
    const w = a.last('welcome');
    assert.doesNotThrow(() => a.close(1000, ''));
    assert.deepEqual(lobby.calls.at(-1), ['disconnect', w.playerId]);
    assert.equal(warns.length, 1);
    assert.match(String(warns[0][0]), /disconnect handler error/);
    const b = fakeSocket();
    attachConnection(b, { sessions, lobby, clock, log });
    assert.doesNotThrow(() => b.message({ t: 'hello', name: 'Boom', version: PROTOCOL_VERSION, token: w.token }));
    assert.equal(b.last('welcome').playerId, w.playerId, 'welcome still sent before the failing hook');
    assert.deepEqual(lobby.calls.at(-1), ['reconnect', w.playerId]);
    assert.equal(warns.length, 2);
    assert.match(String(warns[1][0]), /reconnect handler error/);
  });

  test('a stalled client (bufferedAmount above MAX_BUFFERED) is closed with BACKPRESSURE instead of silently starved', () => {
    const clock = createFakeClock(0);
    const sessions = createSessionStore({ clock });
    const ws = fakeSocket();
    const s = sessions.create('Ana', ws);
    assert.equal(s.send({ t: 'x' }), true);
    ws.bufferedAmount = MAX_BUFFERED + 1;
    assert.equal(s.send({ t: 'y' }), false);
    assert.equal(ws.closed.code, CLOSE.BACKPRESSURE);
    assert.equal(ws.sent.length, 1, 'the message that found the buffer full was not queued');
    assert.equal(s.send({ t: 'z' }), false, 'closed socket drops');
  });
});

test('concurrent resumes consume the token once and old sockets cannot dispatch commands', () => {
  const clock = createFakeClock(0);
  const sessions = createSessionStore({ clock });
  const lobby = fakeLobby();
  const opts = { sessions, lobby, clock, log: { warn() {} } };
  const a = fakeSocket();
  attachConnection(a, opts);
  a.message({ t: 'hello', name: 'Ana', version: PROTOCOL_VERSION });
  const first = a.last('welcome');
  const b = fakeSocket();
  attachConnection(b, opts);
  b.message({ t: 'hello', name: 'Ana', version: PROTOCOL_VERSION, token: first.token });
  assert.equal(b.last('welcome').playerId, first.playerId);
  assert.notEqual(b.last('welcome').token, first.token, 'resume rotates the bearer token');
  assert.ok(!lobby.calls.some((c) => c[0] === 'disconnect'), 'replacing transport must not change lobby readiness');
  const c = fakeSocket();
  attachConnection(c, opts);
  c.message({ t: 'hello', name: 'Ana', version: PROTOCOL_VERSION, token: first.token });
  assert.notEqual(c.last('welcome').playerId, first.playerId, 'replayed token cannot take over again');
  assert.equal(b.closed, null, 'first resume remains connected');
  a.message({ t: 'start', rid: 1 });
  assert.ok(!lobby.calls.some((call) => call[0] === 'msg'), 'buffered messages from old transport are ignored');
});

test('profile-bound sessions need both the WS token and the same authenticated cookie', () => {
  const store = createSessionStore();
  const first = store.create('Ana', fakeWs(), 'profile-a');
  const token = first.token;
  assert.equal(store.resume(token, fakeWs()), null);
  assert.equal(store.resume(token, fakeWs(), 'profile-b'), null);
  assert.equal(first.token, token, 'failed attempts must not consume the owner credential');
  assert.equal(store.resume(token, fakeWs(), 'profile-a'), first);
  store.clear();
});
