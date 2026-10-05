import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { applyDamage, queueDamage, applyDamageQueue, disrupt, tickDots, heal } from '../../shared/sim/damage.js';
import { spawnUnits } from '../../shared/sim/effects.js';
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

test('flat DR applies after multipliers with the armor floor; railgun ignores DR', () => {
  const state = setup();
  const h = state.ships[0]; // Hércules: armored, dr 6
  h.shield = 0;
  const floor = COMBAT.armorFloor, dr = h.dr, km = DAMAGE_MULT.kinetic.armored;
  let hp = h.hpMax;
  // kinetic 10 vs armored: 10 × 0.8 = 8, minus dr 6 → 2, but never below the floor fraction
  applyDamage(state, 2, 1, 10, 'kinetic', null);
  hp -= Math.max(10 * km * floor, 10 * km - dr);
  assert.ok(Math.abs(h.hp - hp) < 1e-9);
  // kinetic 5: 4 − 6 < 0 → floor, then at least minHullDamage
  applyDamage(state, 2, 1, 5, 'kinetic', null);
  hp -= Math.max(COMBAT.minHullDamage, Math.max(5 * km * floor, 5 * km - dr));
  assert.ok(Math.abs(h.hp - hp) < 1e-9);
  // railgun 10 vs armored 1.2 → 12, DR ignored
  applyDamage(state, 2, 1, 10, 'railgun', null);
  hp -= 10 * DAMAGE_MULT.railgun.armored;
  assert.ok(Math.abs(h.hp - hp) < 1e-9);
  // temporary DR from buffs stacks
  h.mod.drAdd = 10;
  applyDamage(state, 2, 1, 100, 'kinetic', null); // 80 − 16 = 64
  hp -= Math.max(100 * km * floor, 100 * km - dr - 10);
  assert.ok(Math.abs(h.hp - hp) < 1e-9);
});

test('DoT ticks every 0.5 s and ignores DR', () => {
  const state = setup();
  const h = state.ships[0];
  h.shield = 0;
  // bio hit with dot {dps 3, duration 4}: bio vs armored, minus dr 6 (floor applies)
  const bm = DAMAGE_MULT.bio.armored;
  const hp0 = h.hpMax - Math.max(10 * bm * COMBAT.armorFloor, 10 * bm - h.dr);
  applyDamage(state, 2, 1, 10, 'bio', { dot: { dps: 3, duration: 4 } });
  assert.ok(Math.abs(h.hp - hp0) < 1e-9);
  assert.equal(h.dots.length, 1);
  let total = 0;
  for (let i = 0; i < 4 * TICK_RATE + 5; i++) {
    state.tick++;
    tickDots(state);
    applyDamageQueue(state);
  }
  // 8 ticks of 1.5 raw × bio.armored each (no DR)
  total = hp0 - h.hp;
  assert.ok(Math.abs(total - 8 * 1.5 * bm) < 1e-6, `dot total ${total}`);
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

test('shields regenerate after the delay, organic hulls always, nanite after 2 s without hull damage', () => {
  const a = { faction: 'vorrax', ships: [{ cls: 'vor_mandibula', count: 1 }] };
  const b = { faction: 'ferrix', ships: [{ cls: 'fer_bastiao', count: 1 }] };
  const state = createBattle(config1v1(a, b, 'regen', 'especialista', { maxTicks: 10 }));
  const vor = state.ships[0], fer = state.ships[1];
  vor.hp = 100; fer.hp = 100;
  vor.ability.readyAt = 1e9; fer.ability.readyAt = 1e9; // passive regen only: no molt / reactive nanites heals
  // keep them apart so no damage is exchanged
  vor.x = 100; vor.y = 100; fer.x = 2700; fer.y = 1400;
  fer.lastHullHitTick = 0;
  stepBattle(state);
  assert.ok(vor.hp > 100, 'organic regen');
  assert.equal(fer.hp, 100, 'nanite waits 2 s');
  fer.lastHullHitTick = -1000;
  stepBattle(state);
  assert.ok(fer.hp > 100, 'nanite repairs after the delay');
  fer.disruptedUntil = state.tick + 100;
  const hp = fer.hp;
  stepBattle(state);
  assert.equal(fer.hp, hp, 'no repair while disrupted');
});

test('Vorrax hunger heals only on purchased kills and never in sudden death', () => {
  const a = { faction: 'vorrax', ships: [{ cls: 'vor_mandibula', count: 1 }] };
  const b = { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 3 }] };
  const state = createBattle(config1v1(a, b, 'hunger', 'especialista', { maxTicks: 5000, suddenDeathTick: 4000 }));
  const vor = state.ships[0];
  const [v1, v2, v3] = state.ships.slice(1);
  for (const s of state.ships) { s.x = s.team === 0 ? 100 : 2700; for (const w of s.weapons) w.readyAt = 1e9; s.ability.readyAt = 1e9; }
  vor.hp = 0.5 * vor.hpMax;
  const expect = vor.hpMax * COMBAT.vorraxHungerHeal;
  // purchased kill → heal
  let hp = vor.hp;
  v1.hp = 0; v1.killerId = vor.id;
  stepBattle(state);
  assert.ok(Math.abs(vor.hp - (hp + expect + vor.regen * (1 / TICK_RATE))) < 1e-6, 'purchased kill heals 5% (plus one tick of organic regen)');
  // spawned (free) victim → no heal
  const spawned = state.ships[spawnUnits(state, v2, 'ter_vespa', 1, 12, 40) > 0 ? state.ships.length - 1 : 0];
  assert.equal(spawned.purchased, false);
  spawned.x = 2700;
  hp = vor.hp;
  spawned.hp = 0; spawned.killerId = vor.id;
  stepBattle(state);
  assert.ok(Math.abs(vor.hp - (hp + vor.regen * (1 / TICK_RATE))) < 1e-6, 'spawned kill gives nothing');
  // sudden death → no heal even for a purchased kill
  state.tick = state.suddenDeathTick;
  stepBattle(state);
  assert.ok(state.suddenDeath);
  hp = vor.hp;
  v2.hp = 0; v2.killerId = vor.id;
  stepBattle(state);
  assert.equal(vor.hp, hp, 'no hunger heal in sudden death');
  assert.ok(v3.alive);
});

test('sudden death ends the reconstruction heal-over-time and the leech drain heal; one-shot ability heals still apply', () => {
  const a = { faction: 'vorrax', ships: [{ cls: 'vor_carrapato', count: 1 }] };
  const b = { faction: 'ferrix', ships: [{ cls: 'fer_bastiao', count: 1 }] };
  const state = createBattle(config1v1(a, b, 'sd-heal', 'especialista', { maxTicks: 5000, suddenDeathTick: 4000 }));
  const car = state.ships[0], bas = state.ships[1];
  for (const s of state.ships) { for (const w of s.weapons) w.readyAt = 1e9; s.ability.readyAt = 1e9; }
  car.x = 100; car.y = 100; bas.x = 2700; bas.y = 1400;
  // heal over time works before sudden death
  bas.hp = 100;
  bas.hot = { perTick: 2, until: state.tick + 1000, owner: 'p2' };
  stepBattle(state);
  assert.ok(bas.hp >= 102, 'hot ticks before sudden death');
  state.tick = state.suddenDeathTick;
  stepBattle(state);
  assert.ok(state.suddenDeath);
  assert.equal(bas.hot, null, 'hot dropped at sudden death');
  const hp = bas.hp;
  stepBattle(state);
  assert.equal(bas.hp, hp, 'no passive repair nor hot in sudden death');
  // leech: the drain still damages the host, the parasite no longer heals
  car.hp = 200;
  car.latch = { hostId: bas.id, until: state.tick + 1000, ox: -(bas.radius + car.radius - 4), oy: 0, start: state.tick + 1 - 10 };
  bas.latchedBy = 1;
  const hostEhp = bas.hp + bas.shield, parHp = car.hp;
  stepBattle(state); // (tick - start) % 10 === 0 on the next tick → one drain pulse
  assert.ok(bas.hp + bas.shield < hostEhp, 'drain still hurts the host');
  assert.equal(car.hp, parHp, 'no leech heal in sudden death');
  // one-shot heals are allowed
  heal(state, car.id, car, 50, 'hull');
  assert.equal(car.hp, parHp + 50);
});
