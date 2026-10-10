import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { ABILITIES, FACTION_IDS, SHIPS } from '../../shared/catalog.js';
import { ABILITY_REGISTRY, PASSIVE_ABILITIES, missingAbilities } from '../../shared/sim/abilities.js';
import { config1v1, oneOfEachFleet } from './helpers.js';
import { addEffect, updateStatus } from '../../shared/sim/ship.js';
import { clearGrid, insertGrid } from '../../shared/sim/spatial.js';

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
const PREFERRED_OPPONENT = { countermeasures: 'terran', flak_curtain: 'terran', emp_pulse: 'vorrax', emp_storm: 'terran', leech: 'vorrax', aurora: 'lumen', reconstruction: 'terran' };

/**
 * Conditional defensive abilities whose trigger may legitimately never be met
 * in a given battle (the ship never gets hurt enough, nothing comes close):
 * such seeds count as satisfied unless the condition held for ≥ 5 consecutive
 * ticks while the ability was ready and the cast never happened.
 */
const OPPORTUNITY = {
  countermeasures: (state, s) => s.incomingInterceptables >= 1,
  molt: (state, s) => s.hp < 0.4 * s.hpMax,
  reconstruction: (state, s) => state.ships.filter((a) => a.alive && a.team === s.team && a.hp < 0.6 * a.hpMax && Math.hypot(a.x - s.x, a.y - s.y) <= 400).length >= 3,
  emp_pulse: (state, s) => state.ships.some((e) => e.alive && e.team !== s.team && e.untargetableUntil <= state.tick && Math.hypot(e.x - s.x, e.y - s.y) <= 150
    && ((e.shieldMax > 0 && e.shield >= 80) || (e.hullType === 'organic' && e.sizeIdx >= 2))),
};
const OPP_IDS = Object.keys(OPPORTUNITY);

test('1v1 one-of-each-class: every non-passive ability casts in ≥ 80% of 10 seeds (conditional ones: whenever their trigger is met)', () => {
  const SEEDS = 10;
  const cache = new Map(); // "fa|fb" → per seed { casts: Set<abilityId>, opportunity: Set<abilityId> }
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
      const casts = new Set(), opportunity = new Set();
      const streak = {};
      const watched = state.ships.filter((s) => OPP_IDS.includes(s.ability.id));
      while (!state.ended) {
        for (const e of stepBattle(state)) if (e[0] === 'cast') casts.add(e[2]);
        for (const s of watched) {
          const id = s.ability.id;
          const open = s.alive && state.tick >= s.ability.readyAt && OPPORTUNITY[id](state, s);
          streak[id] = open ? (streak[id] || 0) + 1 : 0;
          if (streak[id] >= 5) opportunity.add(id);
        }
      }
      runs.push({ casts, opportunity });
    }
    cache.set(key, runs);
    return runs;
  };
  const failures = [];
  for (const id of Object.keys(ABILITIES)) {
    if (PASSIVE_ABILITIES.includes(id)) continue;
    const faction = Object.values(SHIPS).find((s) => s.ability === id).faction;
    const satisfied = (r) => r.casts.has(id) || (OPPORTUNITY[id] && !r.opportunity.has(id));
    let hits = 0;
    if (PREFERRED_OPPONENT[id]) {
      for (const r of castsFor(faction, PREFERRED_OPPONENT[id])) if (satisfied(r)) hits++;
    } else {
      // rotation: seed i fights FACTION_IDS[i % 4] (including the mirror) → 10 seeds total
      for (let i = 0; i < SEEDS; i++) if (satisfied(castsFor(faction, FACTION_IDS[i % 4])[i])) hits++;
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

test('keyed effects refresh instead of stacking: overlapping auras never multiply', () => {
  const a = { faction: 'vorrax', ships: [{ cls: 'vor_rainha', count: 2 }, { cls: 'vor_zangao', count: 4 }] };
  const b = { faction: 'terran', ships: [{ cls: 'ter_orion', count: 3 }] };
  const state = createBattle(config1v1(a, b, 'aura', 'especialista', { maxTicks: 2400 }));
  const z = state.ships.find((s) => s.cls === 'vor_zangao');
  const p = ABILITIES.war_pheromone.params;
  // unit: two casts of the same ability on one ship → one effect, the longer expiry wins, mods unchanged
  addEffect(z, 100, { dmgMul: p.damageMul, regenMul: p.regenMul, boosted: true }, 'war_pheromone');
  addEffect(z, 120, { dmgMul: p.damageMul, regenMul: p.regenMul, boosted: true }, 'war_pheromone');
  assert.equal(z.fx.filter((f) => f.key === 'war_pheromone').length, 1);
  assert.equal(z.fx.find((f) => f.key === 'war_pheromone').until, 120);
  updateStatus(z, 50);
  assert.ok(Math.abs(z.mod.dmgMul - p.damageMul) < 1e-9);
  // unkeyed effects still stack (different abilities combine)
  addEffect(z, 120, { dmgMul: 1.1 }, 'other');
  updateStatus(z, 50);
  assert.ok(Math.abs(z.mod.dmgMul - p.damageMul * 1.1) < 1e-9);
  z.fx.length = 0;
  // end to end: two Rainhas in the same fight never push an ally above a single pheromone's damage multiplier
  let casts = 0, maxDmg = 1;
  while (!state.ended) {
    for (const e of stepBattle(state)) if (e[0] === 'cast' && e[2] === 'war_pheromone') casts++;
    for (const s of state.ships) if (s.alive && s.team === 0) maxDmg = Math.max(maxDmg, s.mod.dmgMul);
  }
  assert.ok(casts >= 2, `pheromone casts ${casts}`);
  assert.ok(maxDmg <= p.damageMul + 1e-9, `dmgMul reached ${maxDmg}`);
});

/** Trigger context for `me` in `state` (as decide() builds it). */
function triggerCtx(state, me) {
  const t = me.ai.targetId > 0 ? state.ships[me.ai.targetId - 1] : null;
  return { state, me, target: t, team: state.teams[me.team], P: state.profiles[me.owner], incoming: me.incoming, tick: state.tick, rng: state.rng };
}
function place(s, x, y) { s.x = x; s.y = y; }
function regrid(state) { clearGrid(state.grid); for (const s of state.ships) if (s.alive) insertGrid(state.grid, s.id, s.x, s.y); }

test('flak_curtain triggers on the swarms it is designed for: 3 tiny in flak range, 4 closing within 450, or an ally being orbited by 2', () => {
  const a = { faction: 'terran', ships: [{ cls: 'ter_artemis', count: 1 }, { cls: 'ter_orion', count: 1 }] };
  const b = { faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 4 }] };
  const state = createBattle(config1v1(a, b, 'flak-trigger'));
  const art = state.ships[0], orion = state.ships[1], larvae = state.ships.slice(2);
  const trig = ABILITY_REGISTRY.flak_curtain.trigger;
  place(art, 1000, 800); place(orion, 1000, 1500); // ally far away
  for (const l of larvae) place(l, 3000, 3000);
  regrid(state);
  assert.equal(trig(triggerCtx(state, art)), 0, 'nothing around');
  place(larvae[0], 1200, 800); place(larvae[1], 1250, 820); regrid(state);
  assert.equal(trig(triggerCtx(state, art)), 0, 'two tiny within 320 is not a swarm');
  place(larvae[2], 1100, 900); regrid(state);
  assert.equal(trig(triggerCtx(state, art)), 1, 'three tiny within 320');
  // four closing within 450 but outside 320
  for (const l of larvae) place(l, 3000, 3000);
  place(larvae[0], 1400, 800); place(larvae[1], 1000, 1200); place(larvae[2], 600, 800); regrid(state);
  assert.equal(trig(triggerCtx(state, art)), 0, 'three at 400 u');
  place(larvae[3], 1000, 400); regrid(state);
  assert.equal(trig(triggerCtx(state, art)), 1, 'four closing within 450');
  // an ally within 300 orbited by two tiny
  for (const l of larvae) place(l, 3000, 3000);
  place(orion, 1200, 800); place(larvae[0], 1250, 850); place(larvae[1], 1150, 760); regrid(state);
  assert.equal(trig(triggerCtx(state, art)), 1, 'ally being orbited');
});

test('overclock triggers with two OTHER Vetores on the same target (three in all, as the catalog says)', () => {
  const a = { faction: 'ferrix', ships: [{ cls: 'fer_vetor', count: 3 }] };
  const b = { faction: 'terran', ships: [{ cls: 'ter_orion', count: 1 }] };
  const state = createBattle(config1v1(a, b, 'overclock-trigger'));
  const [v1, v2, v3, orion] = state.ships;
  place(v1, 1000, 800); place(v2, 1100, 800); place(v3, 1000, 900); place(orion, 1500, 800); regrid(state);
  v1.ai.targetId = orion.id; v2.ai.targetId = orion.id; v3.ai.targetId = 0;
  const trig = ABILITY_REGISTRY.overclock.trigger;
  assert.equal(trig(triggerCtx(state, v1)), 0, 'one other Vetor on my target');
  v3.ai.targetId = orion.id;
  assert.equal(trig(triggerCtx(state, v1)), 1, 'two other Vetores on my target');
  place(v3, 1000, 1300); regrid(state); // beyond 400 u
  assert.equal(trig(triggerCtx(state, v1)), 0, 'a pack member too far away does not count');
});
