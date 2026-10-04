import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashSeed } from '../shared/rng.js';

test('same seed produces identical sequences', () => {
  const a = createRng('battle-42');
  const b = createRng('battle-42');
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
});

test('different seeds produce different sequences', () => {
  const a = createRng(1);
  const b = createRng(2);
  let same = 0;
  for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
  assert.ok(same < 5);
});

test('next() stays within [0, 1) and is roughly uniform', () => {
  const rng = createRng('uniform');
  const buckets = new Array(10).fill(0);
  const n = 50000;
  for (let i = 0; i < n; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1);
    buckets[Math.floor(v * 10)]++;
  }
  for (const count of buckets) assert.ok(Math.abs(count - n / 10) < n * 0.01);
});

test('int() is inclusive of both bounds', () => {
  const rng = createRng('int');
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = rng.int(3, 7);
    assert.ok(v >= 3 && v <= 7);
    assert.equal(v, Math.floor(v));
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6, 7]);
});

test('pick and shuffle are deterministic', () => {
  const a = createRng('ps');
  const b = createRng('ps');
  const arrA = [1, 2, 3, 4, 5, 6];
  const arrB = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(a.shuffle(arrA), b.shuffle(arrB));
  assert.equal(a.pick(arrA), b.pick(arrB));
  assert.equal(a.pick([]), undefined);
});

test('hashSeed is stable and 32-bit', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  assert.ok(hashSeed('x') >= 0 && hashSeed('x') <= 0xffffffff);
  assert.equal(hashSeed(123), hashSeed('123'));
});
