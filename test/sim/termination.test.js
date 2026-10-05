import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { MAX_TICKS } from '../../shared/constants.js';
import { PRESET_LIST } from '../../shared/catalog.js';
import { config1v1, scalePreset } from './helpers.js';

test('every battle ends at or before MAX_TICKS with exactly one end event', () => {
  const ids = PRESET_LIST.map((p) => p.id);
  for (let i = 0; i < ids.length; i++) {
    const a = scalePreset(ids[i], 1500), b = scalePreset(ids[(i * 7 + 3) % ids.length], 1500);
    const state = createBattle(config1v1(a, b, `term-${i}`));
    let ends = 0, last = null;
    while (!state.ended) {
      const ev = stepBattle(state);
      for (const e of ev) if (e[0] === 'end') { ends++; last = e; }
      assert.ok(state.tick <= MAX_TICKS, 'tick overflow');
    }
    assert.equal(ends, 1);
    assert.equal(last[1], state.ended.winner);
    assert.equal(last[2], state.ended.reason);
    assert.ok(state.ended.ticks <= MAX_TICKS);
  }
});

test('1 ship vs 0 ships ends immediately by elimination', () => {
  const a = { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 1 }] };
  const b = { faction: 'vorrax', ships: [] };
  const state = createBattle(config1v1(a, b, 1));
  const ev = stepBattle(state);
  assert.ok(state.ended);
  assert.equal(state.ended.winner, 0);
  assert.equal(state.ended.reason, 'elimination');
  assert.deepEqual(ev[ev.length - 1], ['end', 0, 'elimination']);
  assert.equal(state.tick, 1);
});

test('hard stop at maxTicks with a winner by remaining value, draw when both wiped', () => {
  // two slow motherships far apart with a tiny maxTicks → timeout
  const a = { faction: 'terran', ships: [{ cls: 'ter_prometeu', count: 1 }] };
  const b = { faction: 'vorrax', ships: [{ cls: 'vor_colmeia', count: 1 }] };
  const state = createBattle(config1v1(a, b, 2, 'especialista', { maxTicks: 50 }));
  while (!state.ended) stepBattle(state);
  assert.equal(state.ended.ticks, 50);
  assert.ok(['timeout', 'draw'].includes(state.ended.reason));
  assert.equal(state.ended.remainingValue.length, 2);
  // mutual kill: two larvae at point blank both at 1 hp → both die → draw
  const la = { faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 1 }] };
  const s2 = createBattle(config1v1(la, la, 3));
  for (const s of s2.ships) { s.hp = 1; }
  s2.ships[0].x = 1000; s2.ships[0].y = 700; s2.ships[1].x = 1030; s2.ships[1].y = 700;
  for (const s of s2.ships) { s.weapons[0].readyAt = 0; s.ai.targetId = s.id === 1 ? 2 : 1; }
  let r = null;
  for (let i = 0; i < 200 && !r; i++) { stepBattle(s2); r = s2.ended; }
  assert.ok(r);
  assert.ok(r.winner === -1 ? r.reason === 'draw' : r.reason === 'elimination');
});

test('sudden death phase event fires once and damage ramps', () => {
  const a = scalePreset('fer_fabrica', 1500), b = scalePreset('lum_catedral', 1500);
  const state = createBattle(config1v1(a, b, 'sd', 'especialista', { suddenDeathTick: 100, maxTicks: 400 }));
  let sd = 0;
  while (!state.ended) for (const e of stepBattle(state)) if (e[0] === 'phase' && e[1] === 'suddenDeath') sd++;
  assert.equal(sd, 1);
  assert.ok(state.suddenDeath);
  assert.ok(state.sdMul >= 1);
});
