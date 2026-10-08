import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, hashState } from '../../shared/sim/battle.js';
import { ABILITY_REGISTRY } from '../../shared/sim/abilities.js';
import { createArea, tickAreas } from '../../shared/sim/effects.js';
import { clearGrid, insertGrid } from '../../shared/sim/spatial.js';
import { presetFleet } from '../../shared/fleet.js';
import { updateStatus, addEffect } from '../../shared/sim/ship.js';
import { FACTIONS, SHIPS } from '../../shared/catalog.js';

function config() { return { seed: 'astral', players: [
  { id: 'a', team: 0, fleet: presetFleet('ast_orbita', 1500) }, { id: 'b', team: 1, fleet: presetFleet('fer_ferro', 1500) },
] }; }

test('advanced faction has separate control/support/siege roles and explicit counters', () => {
  assert.equal(FACTIONS.astral.advanced, true);
  assert.equal(SHIPS.ast_lanceta.role, 'kiter'); assert.equal(SHIPS.ast_guardiao.role, 'support');
  assert.equal(SHIPS.ast_arconte.sizeClass, 'mothership'); assert.equal(SHIPS.ast_arconte.cost, 650);
  assert.equal(SHIPS.ast_arconte.hullType, 'crystalline'); assert.equal(SHIPS.ast_arconte.regen, 0);
});

test('gravity well applies control without fictitious damage and Astral resists displacement', () => {
  const st = createBattle(config()); const targets = st.ships.filter((s) => s.team === 1).slice(0, 2);
  for (const s of st.ships) { s.x = 2400; s.y = 1400; }
  for (const s of targets) { s.x = 600; s.y = 500; }
  targets[1].faction = 'astral';
  clearGrid(st.grid); for (const s of st.ships) insertGrid(st.grid, s.id, s.x, s.y);
  createArea(st, { kind: 'gravity_well', x: 500, y: 500, r: 200, durationTicks: 100, team: 0, ownerId: 1, pull: 35, slowMul: 0.7 });
  tickAreas(st);
  assert.ok(Math.abs((600 - targets[1].x) / (600 - targets[0].x) - 0.7) < 1e-8);
  updateStatus(targets[0], st.tick); assert.equal(targets[0].mod.speedMul, 0.7); assert.equal(st.dmgCount, 0);
});

test('a weak gravity field cannot prolong a stronger snare, and slows never multiply', () => {
  const st = createBattle(config()), ship = st.ships[0];
  addEffect(ship, 5, { slowMul: 0.55 }, 'gravity_snare');
  addEffect(ship, 100, { slowMul: 0.7 }, 'gravity_well');
  updateStatus(ship, 1); assert.equal(ship.mod.speedMul, 0.55);
  updateStatus(ship, 5); assert.equal(ship.mod.speedMul, 0.7);
  updateStatus(ship, 100); assert.equal(ship.mod.speedMul, 1);
});

test('a whole Astral battle resolves with deterministic control abilities', () => {
  const a = createBattle(config()), b = createBattle(config()); const casts = new Set();
  while (!a.ended) {
    for (const ev of stepBattle(a)) if (ev[0] === 'cast') casts.add(ev[2]);
    stepBattle(b);
    if (a.tick % 100 === 0) assert.equal(hashState(a), hashState(b));
  }
  assert.deepEqual(a.ended, b.ended); assert.ok(casts.has('gravity_snare')); assert.ok(casts.has('gravity_well'));
});
