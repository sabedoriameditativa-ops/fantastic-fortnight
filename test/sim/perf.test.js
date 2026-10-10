import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { PRESET_LIST } from '../../shared/catalog.js';
import { scalePreset } from './helpers.js';

test('perf: 6v6 full preset fleets (budget 2500), 400 ticks, < 20 ms/tick (SPEC §8.9 target 10 ms; reports ms/tick)', () => {
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
  // skip the advance phase: measure 400 ticks of actual combat (from first contact)
  let skipped = 0;
  while (!state.engaged && !state.ended && skipped < 1500) { stepBattle(state); skipped++; }
  const t0 = performance.now();
  let ticks = 0, maxAlive = 0, maxProj = 0;
  for (; ticks < 400 && !state.ended; ticks++) {
    stepBattle(state);
    maxAlive = Math.max(maxAlive, state.alive[0].length + state.alive[1].length);
    maxProj = Math.max(maxProj, state.projAlive);
  }
  const ms = (performance.now() - t0) / ticks;
  console.log(`perf: ${n} purchased ships (max alive ${maxAlive}), ${ticks} combat ticks after ${skipped} advance ticks, ${ms.toFixed(2)} ms/tick, max ${maxProj} projectiles in flight`);
  assert.ok(n >= 300, `expected a big battle, got ${n} ships`);
  assert.ok(maxProj > 0, 'combat should have happened');
  assert.ok(ms < 20, `${ms.toFixed(2)} ms/tick`);
});
