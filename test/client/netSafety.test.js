import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_sharedHook.mjs', import.meta.url);
const { createNetClient } = await import('../../client/battle/netClient.js');
const { memoryStore, KEYS } = await import('../../client/util/storage.js');

function mockClient(url = 'wss://game.example/', opts = {}) {
  let socket;
  class Socket {
    readyState = 1;
    sent = [];
    constructor() { socket = this; queueMicrotask(() => this.onopen?.()); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
    receive(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  }
  const c = createNetClient(url, { WebSocket: Socket, store: memoryStore(), pingIntervalMs: 0, requestTimeoutMs: 200, ...opts });
  return { c, socket: () => socket };
}

async function welcome(m, token = 'server-token', playerId = 'p1') {
  const p = m.c.connect('Ana');
  await Promise.resolve();
  m.socket().receive({ t: 'welcome', token, playerId });
  await p;
}

test('an arbitrary ws endpoint never receives an unscoped legacy token', async (t) => {
  const store = memoryStore();
  store.setItem(KEYS.token, 'legacy-game-secret');
  const m = mockClient('wss://other.example/', { store, location: { protocol: 'https:', host: 'game.example' } });
  t.after(() => m.c.dispose());
  await welcome(m);
  assert.equal(m.socket().sent[0].token, undefined);
  assert.equal(store.getItem(KEYS.token), 'legacy-game-secret', 'foreign endpoint cannot replace the legacy credential');
});

test('room pushes and unrelated acknowledgements cannot settle pending operations', async (t) => {
  const m = mockClient();
  t.after(() => m.c.dispose());
  await welcome(m);
  let settled = 0;
  const ready = m.c.setReady(true).then(() => settled++, (e) => { settled++; throw e; });
  const result = assert.rejects(ready, (e) => e.code === 'FLEET_MISSING');
  const rid = m.socket().sent.at(-1).rid;
  m.socket().receive({ t: 'room', code: 'ABCD', slots: [] });
  m.socket().receive({ t: 'ack', rid: rid + 1 });
  await Promise.resolve();
  assert.equal(settled, 0, 'room push is state, not a correlated reply');
  m.socket().receive({ t: 'error', rid, code: 'FLEET_MISSING' });
  await result;
});

test('a left push cannot confirm a leave that the server subsequently rejects', async (t) => {
  const m = mockClient();
  t.after(() => m.c.dispose());
  await welcome(m);
  const leaving = m.c.leaveRoom();
  const result = assert.rejects(leaving, (e) => e.code === 'NOT_IN_ROOM');
  const rid = m.socket().sent.at(-1).rid;
  m.socket().receive({ t: 'left', reason: 'room_closed' });
  m.socket().receive({ t: 'error', rid, code: 'NOT_IN_ROOM' });
  await result;
});

test('saved credentials resume only the exact canonical endpoint', async (t) => {
  const store = memoryStore();
  const a = mockClient('wss://game.example:443/', { store });
  const b = mockClient('wss://other.example/', { store });
  t.after(() => { a.c.dispose(); b.c.dispose(); });
  await welcome(a, 'game-secret');
  await welcome(b, 'other-secret');
  assert.equal(b.socket().sent[0].token, undefined, 'another endpoint gets a new session');
  const again = mockClient('wss://game.example/', { store });
  t.after(() => again.c.dispose());
  await welcome(again, 'rotated-game-secret');
  assert.equal(again.socket().sent[0].token, 'game-secret', 'canonical default port shares credentials');
  const route = mockClient('wss://game.example/other', { store });
  t.after(() => route.c.dispose());
  await welcome(route);
  assert.equal(route.socket().sent[0].token, undefined, 'other route cannot receive the credential');
});

test('legacy credentials migrate only to the default page endpoint', async (t) => {
  const store = memoryStore();
  store.setItem(KEYS.token, 'legacy-secret');
  const m = mockClient('wss://game.example/', { store, location: { protocol: 'https:', host: 'game.example' } });
  t.after(() => m.c.dispose());
  await welcome(m, 'rotated-secret');
  assert.equal(m.socket().sent[0].token, 'legacy-secret');
  assert.equal(store.getItem(KEYS.token), null);
  const again = mockClient('wss://game.example/', { store });
  t.after(() => again.c.dispose());
  await welcome(again);
  assert.equal(again.socket().sent[0].token, 'rotated-secret');
});

test('replacement closes stop automatic reconnect attempts', async (t) => {
  const m = mockClient(undefined, { backoff: [1, 1, 1] });
  t.after(() => m.c.dispose());
  await welcome(m);
  const old = m.socket();
  old.onclose({ code: 4001 });
  assert.equal(m.c.status, 'lost');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(m.socket(), old, 'no reconnect duel');
});

test('pilot transport uses current match and resumes sequence numbers from authoritative snapshots', async (t) => {
  const m = mockClient();
  t.after(() => m.c.dispose());
  await welcome(m);
  assert.equal(m.c.feed.controls.pilot({ manual: false }), false);
  m.socket().receive({ t: 'battle_start', matchId: 'match-a', players: [], ships: [] });
  m.socket().receive({ t: 'f', k: 20, s: [], p: [{ owner: 'p1', lastSeq: 500 }] });
  assert.equal(m.c.feed.controls.pilot({ manual: false }), true);
  assert.deepEqual(m.socket().sent.at(-1), { t: 'pilot_input', matchId: 'match-a', input: { manual: false, seq: 501 } });
  m.socket().receive({ t: 'battle_start', matchId: 'match-a', players: [], ships: [] });
  m.c.feed.controls.pilot({ manual: false });
  assert.equal(m.socket().sent.at(-1).input.seq, 502, 'same battle reconnect must not reset sequence');
  m.socket().receive({ t: 'battle_start', matchId: 'match-b', players: [], ships: [] });
  m.c.feed.controls.pilot({ manual: false });
  assert.equal(m.socket().sent.at(-1).input.seq, 1, 'a new battle has a fresh input sequence');
});
