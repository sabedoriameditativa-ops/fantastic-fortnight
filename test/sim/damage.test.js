import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { applyDamage, queueDamage, applyDamageQueue, disrupt, tickDots } from '../../shared/sim/damage.js';
import { DAMAGE_MULT, COMBAT } from '../../shared/catalog.js';
import { TICK_RATE } from '../../shared/constants.js';
import { config1v1 } from './helpers.js';

/** Battle with one Terran Hércules (id 1, team 0) vs one Lúmen Serafim (id 2, team 1), frozen at tick 1. */
function setup() {
  const a = { faction: 'terran', ships: [{ cls: 'ter_hercules', count: 1 }] };
  const b = { faction: 'lumen', ships: [{ cls: 'lum_serafim', count: 1 }] };
  const state = createBattle(config1v1(a, b, 'dmg'));
  state.tick = 1;
  state.events = [];
  return state;
}

test('shield absorbs with the shield multiplier and overflow continues to hull', () => {
  const state = setup();
  const t = state.ships[1]; // Serafim: hp 500, shield 700, crystalline, dr 0
  t.shield = 50;
  // laser 100 raw: shield mult 1.2 → 120 vs 50 shield → absorbed 50, leftover raw (120-50)/1.2 = 58.33 → hull ×0.6 = 35
  const total = applyDamage(state, 1, 2, 100, 'laser', null);
  assert.equal(t.shield, 0);
  assert.ok(Math.abs(t.hp - (500 - 35)) < 1e-6, `hp ${t.hp}`);
  assert.ok(Math.abs(total - 85) < 1e-6);
  assert.ok(state.events.some((e) => e[0] === 'sbreak' && e[1] === 2));
  assert.ok(state.events.some((e) => e[0] === 'hit' && e[1] === 2 && e[4] === 1 && e[2] === 50));
  assert.ok(state.events.some((e) => e[0] === 'hit' && e[1] === 2 && e[4] === 0 && e[2] === 35));
  // Lúmen phase passive: untargetable for 1 s after the first shield break
  assert.ok(t.untargetableUntil >= state.tick + TICK_RATE);
});

test('flat DR applies after multipliers with the 20% floor; railgun ignores DR', () => {
  const state = setup();
  const h = state.ships[0]; // Hércules: hp 800, shield 200, armored, dr 6
  h.shield = 0;
  // kinetic 10 vs armored: 10 × 0.8 = 8, minus dr 6 → 2 (floor 1.6) → 2
  applyDamage(state, 2, 1, 10, 'kinetic', null);
  assert.ok(Math.abs(h.hp - 798) < 1e-9);
  // kinetic 5: 4 − 6 → floor 0.8 → max(minHullDamage 1, 0.8) = 1
  applyDamage(state, 2, 1, 5, 'kinetic', null);
  assert.ok(Math.abs(h.hp - 797) < 1e-9);
  // railgun 10 vs armored 1.2 → 12, DR ignored
  applyDamage(state, 2, 1, 10, 'railgun', null);
  assert.ok(Math.abs(h.hp - 785) < 1e-9);
  // temporary DR from buffs stacks
  h.mod.drAdd = 10;
  applyDamage(state, 2, 1, 100, 'kinetic', null); // 80 − 16 = 64
  assert.ok(Math.abs(h.hp - 721) < 1e-9);
});

test('DoT ticks every 0.5 s and ignores DR', () => {
  const state = setup();
  const h = state.ships[0];
  h.shield = 0;
  // bio hit with dot {dps 3, duration 4}: bio vs armored 1.1 → 11 − 6 = 5
  applyDamage(state, 2, 1, 10, 'bio', { dot: { dps: 3, duration: 4 } });
  assert.ok(Math.abs(h.hp - 795) < 1e-9);
  assert.equal(h.dots.length, 1);
  let total = 0;
  for (let i = 0; i < 4 * TICK_RATE + 5; i++) {
    state.tick++;
    tickDots(state);
    applyDamageQueue(state);
  }
  // 8 ticks of 1.5 raw: bio ×1.1 → 1.65 each (no DR) = 13.2
  total = 795 - h.hp;
  assert.ok(Math.abs(total - 13.2) < 1e-6, `dot total ${total}`);
  assert.equal(h.dots.length, 0);
});

test('ion hits disrupt regen, with immunity after expiry; ability disrupts bypass immunity', () => {
  const state = setup();
  const t = state.ships[1];
  t.shield = 100;
  applyDamage(state, 1, 2, 10, 'ion', null);
  assert.ok(t.disruptedUntil === state.tick + Math.round(COMBAT.disruptSeconds * TICK_RATE));
  // expire → immunity window
  state.tick = t.disruptedUntil;
  t.disruptImmuneUntil = 0;
  disrupt(t, state.tick, 1.5, false); // extends while still "disrupted" (same tick) is fine
  t.disruptedUntil = 0; t.disruptImmuneUntil = state.tick + 2 * TICK_RATE;
  disrupt(t, state.tick, 1.5, false);
  assert.equal(t.disruptedUntil, 0, 'weapon disrupt blocked by immunity');
  disrupt(t, state.tick, 4, true);
  assert.equal(t.disruptedUntil, state.tick + 4 * TICK_RATE, 'ability disrupt bypasses immunity');
});

test('damage queue applies in (srcId, sequence) order', () => {
  const state = setup();
  const order = [];
  const t = state.ships[1];
  t.shield = 0;
  // queue from src 2 then src 1; src 1 must apply first
  queueDamage(state, 2, 1, 1, 'true', null);
  queueDamage(state, 1, 2, 1, 'true', null);
  queueDamage(state, 1, 2, 2, 'true', null);
  applyDamageQueue(state);
  for (const e of state.events) if (e[0] === 'hit') order.push(e[1] + ':' + e[2]);
  assert.deepEqual(order, ['2:1', '2:2', '1:1']);
});

test('sudden death ramp multiplies damage; Terran coordination adds 10% kinetic', () => {
  const state = setup();
  const t = state.ships[1];
  t.shield = 0;
  state.suddenDeath = true; state.sdMul = 1.4;
  applyDamage(state, 1, 2, 10, 'true', null);
  assert.ok(Math.abs(500 - t.hp - 14) < 1e-9);
  state.suddenDeath = false; state.sdMul = 1;
  t.targetedByTerran = 3;
  const before = t.hp;
  applyDamage(state, 1, 2, 10, 'kinetic', null); // 10 × 1.1 × 1.3 crystalline = 14.3
  assert.ok(Math.abs(before - t.hp - 14.3) < 1e-9);
});

test('shields regenerate after the delay, organic hulls always, nanite after 3 s without hull damage', () => {
  const a = { faction: 'vorrax', ships: [{ cls: 'vor_mandibula', count: 1 }] };
  const b = { faction: 'ferrix', ships: [{ cls: 'fer_bastiao', count: 1 }] };
  const state = createBattle(config1v1(a, b, 'regen', 'especialista', { maxTicks: 10 }));
  const vor = state.ships[0], fer = state.ships[1];
  vor.hp = 100; fer.hp = 100;
  // keep them apart so no damage is exchanged
  vor.x = 100; vor.y = 100; fer.x = 2700; fer.y = 1400;
  fer.lastHullHitTick = 0;
  stepBattle(state);
  assert.ok(vor.hp > 100, 'organic regen');
  assert.equal(fer.hp, 100, 'nanite waits 3 s');
  fer.lastHullHitTick = -1000;
  stepBattle(state);
  assert.ok(fer.hp > 100, 'nanite repairs after the delay');
  fer.disruptedUntil = state.tick + 100;
  const hp = fer.hp;
  stepBattle(state);
  assert.equal(fer.hp, hp, 'no repair while disrupted');
});
