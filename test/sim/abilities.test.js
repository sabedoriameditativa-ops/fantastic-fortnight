import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { ABILITIES, FACTION_IDS, SHIPS } from '../../shared/catalog.js';
import { ABILITY_REGISTRY, PASSIVE_ABILITIES, missingAbilities } from '../../shared/sim/abilities.js';
import { config1v1, oneOfEachFleet } from './helpers.js';

test('every catalog ability has a registry entry with trigger and cast', () => {
  assert.deepEqual(missingAbilities(), []);
  for (const id of Object.keys(ABILITIES)) {
    assert.equal(typeof ABILITY_REGISTRY[id].trigger, 'function');
    assert.equal(typeof ABILITY_REGISTRY[id].cast, 'function');
  }
  assert.deepEqual(PASSIVE_ABILITIES, ['bile_burst']);
});

/**
 * Some triggers can only be satisfied by particular enemies (countermeasures and
 * flak curtain need enemy missiles; EMP pulse needs shields or organic hulls;
 * aurora/leech need a sustained line fight), so those abilities are scored in
 * the matchup where their trigger is possible; every other ability is scored
 * over a rotation of all four opponent factions (including the mirror).
 */
const PREFERRED_OPPONENT = { countermeasures: 'terran', flak_curtain: 'terran', emp_pulse: 'lumen', emp_storm: 'terran', leech: 'vorrax', aurora: 'lumen', reconstruction: 'terran' };

test('1v1 one-of-each-class: every non-passive ability casts in ≥ 80% of 10 seeds', () => {
  const SEEDS = 10;
  const cache = new Map(); // "fa|fb" → Set<abilityId>[] per seed
  const castsFor = (fa, fb) => {
    const key = `${fa}|${fb}`;
    if (cache.has(key)) return cache.get(key);
    const runs = [];
    for (let seed = 0; seed < SEEDS; seed++) {
      const swap = seed % 2 === 1;
      const state = createBattle({ seed: `ab-${fa}-${fb}-${seed}`, players: [
        { id: 'a', name: 'A', team: swap ? 1 : 0, isBot: true, ai: 'especialista', fleet: oneOfEachFleet(fa) },
        { id: 'b', name: 'B', team: swap ? 0 : 1, isBot: true, ai: 'especialista', fleet: oneOfEachFleet(fb) },
      ] });
      const seen = new Set();
      while (!state.ended) for (const e of stepBattle(state)) if (e[0] === 'cast') seen.add(e[2]);
      runs.push(seen);
    }
    cache.set(key, runs);
    return runs;
  };
  const failures = [];
  for (const id of Object.keys(ABILITIES)) {
    if (PASSIVE_ABILITIES.includes(id)) continue;
    const faction = Object.values(SHIPS).find((s) => s.ability === id).faction;
    let hits = 0;
    if (PREFERRED_OPPONENT[id]) {
      for (const seen of castsFor(faction, PREFERRED_OPPONENT[id])) if (seen.has(id)) hits++;
    } else {
      // rotation: seed i fights FACTION_IDS[i % 4]; take seeds i ≡ k (mod 4) from matchup k → 10 seeds total
      for (let i = 0; i < SEEDS; i++) if (castsFor(faction, FACTION_IDS[i % 4])[i].has(id)) hits++;
    }
    if (hits < 0.8 * SEEDS) failures.push(`${id}: ${hits}/${SEEDS}`);
  }
  assert.deepEqual(failures, [], `abilities below 80%: ${failures.join(', ')}`);
});

test('spawned units: cost 0, source set, maxAlive respected, lifetime expiry emits die with killer 0', () => {
  const a = { faction: 'ferrix', ships: [{ cls: 'fer_fabricador', count: 2 }] };
  const b = { faction: 'terran', ships: [{ cls: 'ter_prometeu', count: 1 }] };
  const state = createBattle(config1v1(a, b, 'spawn', 'especialista', { maxTicks: 2000 }));
  const expiries = [];
  let maxAliveSeen = 0;
  while (!state.ended) {
    for (const e of stepBattle(state)) if (e[0] === 'die' && e[2] === 0) expiries.push(e[1]);
    for (const src of state.ships) {
      if (src.spawnAlive) for (const n of Object.values(src.spawnAlive)) { assert.ok(n <= 9); maxAliveSeen = Math.max(maxAliveSeen, n); }
    }
  }
  const spawned = state.ships.filter((s) => s.source);
  assert.ok(spawned.length > 0);
  for (const s of spawned) { assert.equal(s.cost, 0); assert.equal(s.cls, 'fer_vetor'); assert.ok(s.lifetimeEnd > 0); }
  assert.ok(maxAliveSeen > 0);
  // spawned units never count for victory: the battle only ends when purchased ships die or by timeout
  assert.ok(state.ended.reason === 'timeout' || state.alivePurchased[0] === 0 || state.alivePurchased[1] === 0);
});

test('teleports stay inside the arena and blink moves the ship ~200 u', () => {
  const a = { faction: 'lumen', ships: [{ cls: 'lum_centelha', count: 3 }] };
  const b = { faction: 'terran', ships: [{ cls: 'ter_orion', count: 2 }] };
  const state = createBattle(config1v1(a, b, 'blink', 'especialista', { maxTicks: 1500 }));
  const { w, h } = state.world;
  let blinks = 0;
  while (!state.ended) {
    const before = state.ships.map((s) => [s.x, s.y]);
    for (const e of stepBattle(state)) if (e[0] === 'cast' && e[2] === 'blink') {
      blinks++;
      const s = state.ships[e[1] - 1];
      assert.ok(s.x >= s.radius - 1e-6 && s.x <= w - s.radius + 1e-6 && s.y >= s.radius - 1e-6 && s.y <= h - s.radius + 1e-6);
      const d = Math.hypot(s.x - before[s.id - 1][0], s.y - before[s.id - 1][1]);
      assert.ok(d > 100 && d < 260, `blink distance ${d}`);
    }
  }
  assert.ok(blinks > 0);
});

test('leech latches a Carrapato onto a medium+ host and drains it', () => {
  const a = { faction: 'vorrax', ships: [{ cls: 'vor_carrapato', count: 1 }] };
  const b = { faction: 'terran', ships: [{ cls: 'ter_hercules', count: 1 }] };
  const state = createBattle(config1v1(a, b, 'leech', 'especialista', { maxTicks: 2400 }));
  let latchedTicks = 0, leechCasts = 0;
  while (!state.ended) {
    for (const e of stepBattle(state)) if (e[0] === 'cast' && e[2] === 'leech') { leechCasts++; assert.equal(e[3], 2); }
    const c = state.ships[0];
    if (c.latch) { latchedTicks++; const host = state.ships[c.latch.hostId - 1]; assert.ok(Math.hypot(host.x - c.x, host.y - c.y) < host.radius + c.radius + 1); }
  }
  assert.ok(leechCasts >= 1);
  assert.ok(latchedTicks > 0);
});
