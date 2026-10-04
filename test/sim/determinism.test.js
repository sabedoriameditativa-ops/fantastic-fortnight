import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, hashState, runToEnd, getResult, battleWorld, getInitialShips } from '../../shared/sim/battle.js';
import { config1v1, scalePreset } from './helpers.js';

function runWithHashes(config) {
  const state = createBattle(config);
  const hashes = {};
  const events = [];
  while (!state.ended) {
    const ev = stepBattle(state);
    if (ev.length) events.push(JSON.stringify([state.tick, ev]));
    if (state.tick === 100 || state.tick === 1000) hashes[state.tick] = hashState(state);
  }
  hashes.end = hashState(state);
  hashes.ticks = state.tick;
  return { hashes, events: events.join('\n'), result: state.ended };
}

test('same seed → identical hashes at ticks 100/1000/end and identical event stream', () => {
  const a = scalePreset('ter_linha', 1500), b = scalePreset('lum_coro', 1500);
  const r1 = runWithHashes(config1v1(a, b, 'det-1'));
  const r2 = runWithHashes(config1v1(a, b, 'det-1'));
  assert.deepEqual(r1.hashes, r2.hashes);
  assert.equal(r1.events, r2.events);
  assert.deepEqual(r1.result, r2.result);
  assert.ok(r1.hashes[100] && /^[0-9a-f]{8}$/.test(r1.hashes[100]));
});

test('different seeds → different hashes', () => {
  const a = scalePreset('vor_garras', 1500), b = scalePreset('fer_ferro', 1500);
  const r1 = runWithHashes(config1v1(a, b, 1));
  const r2 = runWithHashes(config1v1(a, b, 2));
  // tick 100 is still the deterministic advance phase (expert AI consumes no RNG before contact)
  assert.notEqual(r1.hashes[1000], r2.hashes[1000]);
  assert.notEqual(r1.hashes.end, r2.hashes.end);
  assert.notEqual(r1.events, r2.events);
});

test('two interleaved battles do not share state (no module-level leakage)', () => {
  const a = scalePreset('ter_misseis', 1500), b = scalePreset('vor_chuva', 1500);
  const solo = createBattle(config1v1(a, b, 'x'));
  for (let i = 0; i < 300; i++) stepBattle(solo);
  const s1 = createBattle(config1v1(a, b, 'x'));
  const s2 = createBattle(config1v1(b, a, 'y'));
  for (let i = 0; i < 300; i++) { stepBattle(s1); stepBattle(s2); }
  assert.equal(hashState(s1), hashState(solo));
});

test('runToEnd returns the same result as stepping manually and calls onTick each tick', () => {
  const a = scalePreset('fer_apagao', 1500), b = scalePreset('lum_dissonancia', 1500);
  let ticks = 0;
  const r = runToEnd(config1v1(a, b, 'rte'), { onTick: () => { ticks++; } });
  const state = createBattle(config1v1(a, b, 'rte'));
  while (!state.ended) stepBattle(state);
  assert.deepEqual(r, getResult(state));
  assert.equal(ticks, r.ticks);
  assert.deepEqual(battleWorld(state), { w: 2800, h: 1575 });
  const init = getInitialShips(state);
  assert.equal(init.length, state.ships.filter((s) => s.purchased).length);
  assert.equal(init[0].id, 1);
});

test('stepBattle after the end returns an empty array and keeps the state frozen', () => {
  const a = { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 2 }] };
  const b = { faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 1 }] };
  const state = createBattle(config1v1(a, b, 's'));
  while (!state.ended) stepBattle(state);
  const h = hashState(state), t = state.tick;
  assert.deepEqual(stepBattle(state), []);
  assert.equal(hashState(state), h);
  assert.equal(state.tick, t);
});
