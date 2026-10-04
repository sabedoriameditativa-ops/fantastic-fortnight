import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { PRESET_LIST } from '../../shared/catalog.js';
import { scalePreset } from './helpers.js';

test('perf: 6v6 full preset fleets (budget 2500), 400 ticks, < 25 ms/tick (reports ms/tick)', () => {
  const ids = PRESET_LIST.map((p) => p.id);
  const players = [];
  for (let i = 0; i < 12; i++) {
    players.push({ id: `p${i}`, name: `P${i}`, team: i < 6 ? 0 : 1, isBot: true, ai: 'especialista', fleet: scalePreset(ids[i % ids.length], 2500) });
  }
  const state = createBattle({ seed: 'perf', players });
  const n = state.ships.length;
  // warm up JIT on a separate battle
  const warm = createBattle({ seed: 'warm', players });
  for (let i = 0; i < 60; i++) stepBattle(warm);
  const t0 = performance.now();
  let ticks = 0, maxAlive = 0;
  for (; ticks < 400 && !state.ended; ticks++) {
    stepBattle(state);
    maxAlive = Math.max(maxAlive, state.alive[0].length + state.alive[1].length);
  }
  const ms = (performance.now() - t0) / ticks;
  console.log(`perf: ${n} purchased ships (max alive ${maxAlive}), ${ticks} ticks, ${ms.toFixed(2)} ms/tick, ${state.projectiles.length} projectile slots`);
  assert.ok(n >= 300, `expected a big battle, got ${n} ships`);
  assert.ok(ms < 25, `${ms.toFixed(2)} ms/tick`);
});
