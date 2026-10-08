import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../../shared/sim/battle.js';
import { applyDamage, queueDamage, applyDamageQueue, regenPhase, processDeaths } from '../../shared/sim/damage.js';
import { tickLatches } from '../../shared/sim/effects.js';
import { decide, teamThink, recomputeTargeting } from '../../shared/sim/ai.js';
import { clearGrid, insertGrid } from '../../shared/sim/spatial.js';
import { fireWeapons } from '../../shared/sim/weapons.js';
import { config1v1 } from './helpers.js';

const fleet = (faction, cls, count = 1) => ({ faction, ships: [{ cls, count }] });

test('overkill and later queued hits count only remaining hull and shields', () => {
  const st = createBattle(config1v1(fleet('terran', 'ter_hercules'), fleet('lumen', 'lum_serafim'), 1));
  const target = st.ships[1];
  target.hp = 3; target.shield = 7; target.extraShield = 4;
  assert.equal(applyDamage(st, 1, 2, 100000, 'true'), 14);
  queueDamage(st, 1, 2, 100000, 'true'); applyDamageQueue(st);
  assert.equal(st.stats.p1.damageDealt, 14);
  assert.equal(st.stats.p2.damageTaken, 14);
  assert.equal(target.hp, 0);
});

test('reconstruction pauses during disruption and resumes only before its original expiry', () => {
  const st = createBattle(config1v1(fleet('terran', 'ter_hercules'), fleet('terran', 'ter_hercules'), 1));
  const s = st.ships[0]; s.hp = 100; s.hot = { perTick: 5, owner: 'p1', until: 10 };
  st.tick = 1; s.disruptedUntil = 5; regenPhase(st);
  assert.equal(s.hp, 100);
  st.tick = 5; regenPhase(st); assert.equal(s.hp, 105);
  st.tick = 10; regenPhase(st); assert.equal(s.hp, 105); assert.equal(s.hot, null);
});

test('disruption also blocks continuous leech and hunger healing', () => {
  const st = createBattle(config1v1(fleet('vorrax', 'vor_carrapato'), fleet('terran', 'ter_hercules'), 1));
  const [s, t] = st.ships; s.hp = 100; s.disruptedUntil = 100;
  s.latch = { hostId: t.id, until: 100, ox: -80, oy: 0, start: 0 }; st.tick = 10;
  tickLatches(st); assert.equal(s.hp, 100); assert.ok(st.dmgCount > 0, 'disruption blocks healing, not the attack');
  t.hp = 0; t.killerId = s.id; processDeaths(st); assert.equal(s.hp, 100);
});

test('low hull with recovered shields cannot alternate retreat every think', () => {
  const st = createBattle(config1v1(fleet('lumen', 'lum_prisma', 2), fleet('terran', 'ter_hercules'), 1));
  const s = st.ships[0]; s.hp = s.hpMax * 0.1; s.shield = s.shieldMax;
  for (let tick = 1; tick < 100; tick += 4) {
    st.tick = tick; decide(st, s);
    assert.equal(s.ai.retreating, false, `unnecessary retreat at ${tick}`);
  }
  s.shield = 0; st.tick = 100; decide(st, s); assert.equal(s.ai.retreating, true);
  s.shield = s.shieldMax; st.tick += 4; decide(st, s); assert.equal(s.ai.retreating, false);
  s.shield = 0; st.tick += 4; decide(st, s); assert.equal(s.ai.retreating, false, 'recovery exit has cooldown');
});

test('a charged beam cancels when its target phases before release', () => {
  const st = createBattle(config1v1(fleet('lumen', 'lum_prisma'), fleet('lumen', 'lum_serafim'), 1));
  const [s, t] = st.ships; const w = s.weapons[0];
  s.x = 500; s.y = 500; t.x = 600; t.y = 500; s.heading = 0;
  st.tick = 20; w.charging = t.id; w.chargeUntil = 20; t.untargetableUntil = 30;
  for (const ship of st.ships) for (const other of ship.weapons) if (other !== w) other.readyAt = 1000;
  fireWeapons(st);
  assert.equal(w.charging, 0);
  assert.equal(st.dmgCount, 0);
  assert.equal(st.events.some((e) => e[0] === 'shot'), false);
});

test('supports never form a cyclic retreat by protecting other supports', () => {
  const st = createBattle(config1v1({ faction: 'astral', ships: [{ cls: 'ast_guardiao', count: 3 }, { cls: 'ast_lanceta', count: 2 }] }, fleet('terran', 'ter_hercules'), 1));
  for (const s of st.ships.filter((ship) => ship.team === 0 && ship.role === 'support')) {
    assert.equal(st.ships[s.ai.protecteeId - 1]?.cls, 'ast_lanceta');
  }
  for (const s of st.ships) if (s.cls === 'ast_lanceta') { s.alive = false; st.alive[0].splice(st.alive[0].indexOf(s.id), 1); }
  teamThink(st, 0);
  for (const s of st.ships.filter((ship) => ship.team === 0 && ship.alive)) assert.equal(s.ai.protecteeId, 0);
});

test('unarmed objectives and manually aimed pilots add no fictitious focus or damage threat', () => {
  const st = createBattle(config1v1(fleet('terran', 'ter_falcao'), fleet('terran', 'ter_hercules'), 1,
    'especialista', { campaign: { type: 'defense' } }));
  const target = st.ships.find((s) => s.team === 1), objective = st.ships.find((s) => s.campaignObjective), ally = st.ships[0];
  ally.x = 100; ally.y = 100; ally.pilotControl = { manual: true };
  objective.x = 1000; objective.y = 700; target.x = 1100; target.y = 700;
  clearGrid(st.grid); for (const s of st.ships) insertGrid(st.grid, s.id, s.x, s.y);
  recomputeTargeting(st); teamThink(st, 0);
  assert.equal(target.incoming, 0); assert.equal(target.targetedBy, 0); assert.equal(target.targetedByTerran, 0);
  assert.equal(objective.ai.assignedId, 0); assert.equal(ally.ai.assignedId, 0);
});
