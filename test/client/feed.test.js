import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_sharedHook.mjs', import.meta.url);
const { createEmitter, createFeedBase, normalizeSpeed, SPEEDS } = await import('../../client/battle/feed.js');

describe('createEmitter', () => {
  test('emits to subscribers, supports unsubscribe during emit and isolates listener errors', () => {
    const em = createEmitter();
    const seen = [];
    const offA = em.on((v) => { seen.push('a' + v); offA(); });
    em.on(() => { throw new Error('boom'); });
    em.on((v) => seen.push('c' + v));
    const origError = console.error; console.error = () => {};
    try { em.emit(1); em.emit(2); } finally { console.error = origError; }
    assert.deepEqual(seen, ['a1', 'c1', 'c2']);
    assert.equal(em.size, 2);
    assert.equal(typeof em.on(null), 'function');
  });
});

describe('createFeedBase', () => {
  test('replays the last start to late subscribers until the battle ends', () => {
    const f = createFeedBase({ isLocal: true });
    const info = { seed: 1 };
    f.emitStart(info);
    const got = [];
    f.onStart((i) => got.push(i));
    assert.deepEqual(got, [info]);
    f.emitEnd({ winner: 0 });
    const late = [];
    f.onStart((i) => late.push(i));
    assert.deepEqual(late, [], 'no replay after the end');
    const ends = [];
    f.onEnd((r) => ends.push(r));
    assert.deepEqual(ends, [{ winner: 0 }], 'end is replayed');
    assert.equal(f.battleNo, 1);
  });

  test('status is replayed and only emitted on change', () => {
    const f = createFeedBase({ isLocal: false });
    const seen = [];
    f.onStatus((s) => seen.push(s));
    f.emitStatus('ok'); f.emitStatus('reconnecting'); f.emitStatus('reconnecting'); f.emitStatus('ok');
    assert.deepEqual(seen, ['ok', 'reconnecting', 'ok']);
    assert.equal(f.status, 'ok');
  });

  test('frames pass through untouched and clear() drops subscribers', () => {
    const f = createFeedBase({ isLocal: true });
    const frames = [];
    f.onFrame((x) => frames.push(x));
    const fr = { k: 2, s: [], e: [], at: 5 };
    f.emitFrame(fr);
    assert.equal(frames[0], fr);
    f.clear();
    f.emitFrame(fr);
    assert.equal(frames.length, 1);
  });
});

describe('normalizeSpeed', () => {
  test('accepts 0/1/2/4 and defaults to 1', () => {
    assert.deepEqual(SPEEDS, [0, 1, 2, 4]);
    for (const x of SPEEDS) assert.equal(normalizeSpeed(x), x);
    assert.equal(normalizeSpeed(3), 1);
    assert.equal(normalizeSpeed('2'), 2);
    assert.equal(normalizeSpeed(undefined), 1);
  });
});
