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
