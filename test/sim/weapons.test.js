import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { canShoot, reachRange, weaponRange, spawnProjectile, advanceProjectiles, fireWeapons } from '../../shared/sim/weapons.js';
import { applyDamageQueue } from '../../shared/sim/damage.js';
import { clearGrid, insertGrid } from '../../shared/sim/spatial.js';
import { SHIPS } from '../../shared/catalog.js';
import { config1v1 } from './helpers.js';

/** Re-index the ships after moving them by hand (stepBattle does this every tick). */
function reindex(state) {
  clearGrid(state.grid);
  for (const s of state.ships) if (s.alive) insertGrid(state.grid, s.id, s.x, s.y);
}

function pair(clsA, clsB, seed = 'wpn', extra = {}) {
  const a = { faction: SHIPS[clsA].faction, ships: [{ cls: clsA, count: 1 }] };
  const b = { faction: SHIPS[clsB].faction, ships: [{ cls: clsB, count: 1 }] };
  const state = createBattle(config1v1(a, b, seed, 'especialista', extra));
  return [state.ships[0], state.ships[1], state];
}

/** Keep a ship from shooting or casting (a passive target for positioning tests). */
function disarm(s) {
  for (const w of s.weapons) w.readyAt = 1e9;
  s.ability.readyAt = 1e9;
}

test('contact weapons measure range edge to edge: mandibles reach a large hull at centre distance 40 + both radii', () => {
  const [c, h, state] = pair('vor_carrapato', 'ter_hercules');
  const w = c.weapons[0];
  assert.ok(w.def.contact);
  assert.equal(reachRange(c, w, h), weaponRange(c, w) + c.radius + h.radius);
  state.tick = 1;
  h.x = 1000; h.y = 800;
  c.y = 800; c.heading = 0;
  c.x = h.x - (40 + c.radius + h.radius - 1);
  assert.ok(canShoot(c, w, h, state.tick), 'edge distance 39 ≤ 40');
  c.x = h.x - (40 + c.radius + h.radius + 1);
  assert.ok(!canShoot(c, w, h, state.tick), 'edge distance 41 > 40');
  // the spit (no contact) still measures centre to centre
  const spit = c.weapons[1];
  assert.equal(reachRange(c, spit, h), weaponRange(c, spit));
});

test('Carrapato actually bites a large target in a fight (mandible shots are a majority of its trigger pulls while latched or adjacent)', () => {
  let mandibles = 0, spit = 0, latchedBites = 0;
  for (const seed of [1, 2, 3]) {
    const [c, h, state] = pair('vor_carrapato', 'ter_hercules', `bite-${seed}`, { maxTicks: 1500 });
    disarm(h);
    while (!state.ended) {
      for (const e of stepBattle(state)) {
        if (e[0] === 'shot' && e[1] === c.id && e[3] === 0) { mandibles++; if (c.latch) latchedBites++; }
        if (e[0] === 'proj' && e[2] === c.id && e[4] === 1) spit++;
      }
    }
  }
  assert.ok(mandibles > 60, `mandible shots ${mandibles}`);
  assert.ok(latchedBites > 0, 'bites while latched');
  assert.ok(mandibles > spit * 0.5, `mandibles ${mandibles} vs spit ${spit}`);
});

test('a rolled AoE miss never damages its primary target and fizzles outside the splash radius', () => {
  const [m, f, state] = pair('vor_matriz', 'ter_falcao'); // spores: aoe 50
  const w = m.weapons[0];
  assert.ok(w.def.aoe > 0);
  state.tick = 1;
  m.x = 500; m.y = 500; f.x = 700; f.y = 500; f.vx = 0; f.vy = 0;
  reindex(state);
  disarm(m); disarm(f);
  const hp0 = f.hp, shield0 = f.shield;
  for (let k = 0; k < 6; k++) {
    const p = spawnProjectile(state, m, w, f, false, w.def.damage, k);
    assert.ok(Math.hypot(p.offX, p.offY) > w.def.aoe + f.radius, `fizzle offset ${Math.hypot(p.offX, p.offY)} outside aoe ${w.def.aoe} + radius`);
    let ended = false;
    for (let i = 0; i < 400 && !ended; i++) {
      state.tick++;
      state.events = [];
      advanceProjectiles(state);
      applyDamageQueue(state);
      ended = state.events.some((e) => e[0] === 'pend' && e[1] === p.id);
    }
    assert.ok(ended, 'projectile fizzled');
    assert.ok(state.events.some((e) => e[0] === 'aoe'), 'the fizzle still explodes (neighbours may be splashed)');
  }
  assert.equal(f.hp, hp0); assert.equal(f.shield, shield0);
  // a rolled hit with the same weapon does damage the primary
  const p = spawnProjectile(state, m, w, f, true, w.def.damage, 0);
  for (let i = 0; i < 400 && p.alive; i++) { state.tick++; state.events = []; advanceProjectiles(state); applyDamageQueue(state); }
  assert.ok(f.hp < hp0, 'hit damages the primary');
});

test('a neighbour inside the splash of a missed shot is still hit, the primary is not', () => {
  const a = { faction: 'vorrax', ships: [{ cls: 'vor_matriz', count: 1 }] };
  const b = { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 2 }] };
  const state = createBattle(config1v1(a, b, 'splash'));
  const [m, f1, f2] = state.ships;
  state.tick = 1;
  m.x = 500; m.y = 500; f1.x = 700; f1.y = 500; f2.x = 700; f2.y = 500 + f1.radius + 60; // f2 sits on the miss side (either side is within aoe 50 + 8 + radius... offset ≤ 14 + 58 + 20)
  for (const s of state.ships) { disarm(s); s.vx = 0; s.vy = 0; }
  const w = m.weapons[0];
  const p = spawnProjectile(state, m, w, f1, false, w.def.damage, 0);
  f2.y = 500 + p.offY * 0.5; f2.x = 700 + p.offX * 0.5; // halfway to the fizzle point: inside the splash, whichever side was rolled
  reindex(state);
  const hp1 = f1.hp, hp2 = f2.hp, sh2 = f2.shield;
  for (let i = 0; i < 400 && p.alive; i++) { state.tick++; state.events = []; advanceProjectiles(state); applyDamageQueue(state); }
  assert.equal(f1.hp, hp1, 'primary untouched');
  assert.ok(f2.hp < hp2 || f2.shield < sh2, 'neighbour splashed');
});

test('point defense never engages a projectile in the tick it was launched (spawnTick), but does from the next tick', () => {
  const [art, herc, state] = pair('ter_artemis', 'ter_hercules', 'pd');
  const flak = art.weapons[0];
  assert.ok(flak.def.pd);
  const tubes = herc.weapons[1];
  assert.ok(tubes.def.interceptable);
  state.tick = 1;
  art.x = 500; art.y = 500; herc.x = 700; herc.y = 500; // inside the flak range (320)
  for (const s of state.ships) { for (const w of s.weapons) w.readyAt = 1e9; s.ability.readyAt = 1e9; }
  state.rng = { next: () => 0 }; // every PD attempt succeeds
  // same tick: launch, then the PD ship fires in this tick's weapons phase
  const p = spawnProjectile(state, herc, tubes, art, true, 100, 0);
  assert.equal(p.spawnTick, state.tick);
  flak.readyAt = state.tick;
  state.events = [];
  fireWeapons(state);
  assert.ok(p.alive, 'not intercepted in the spawn tick');
  assert.ok(!state.events.some((e) => e[0] === 'pend' && e[1] === p.id && e[2] === 2));
  // next tick: engaged
  state.tick++;
  flak.readyAt = state.tick;
  state.events = [];
  fireWeapons(state);
  assert.ok(!p.alive, 'intercepted the tick after launch');
  assert.ok(state.events.some((e) => e[0] === 'pend' && e[1] === p.id && e[2] === 2));
});
