import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, makeSnapshot, hashState } from '../../shared/sim/battle.js';
import { FLAG, POS_SCALE, HP_SCALE } from '../../shared/constants.js';
import { config1v1, scalePreset } from './helpers.js';

test('snapshot quantization: ids, tenths of a unit, heading byte, permille hp/shield, flags', () => {
  const state = createBattle(config1v1(scalePreset('lum_coro', 1500), scalePreset('ter_linha', 1500), 'snap'));
  for (let i = 0; i < 5; i++) stepBattle(state);
  const s1 = state.ships[0];
  s1.heading = Math.PI / 2; s1.hp = s1.hpMax * 0.4567; s1.shield = s1.shieldMax * 0.123; s1.x = 123.46; s1.y = 77.74;
  s1.untargetableUntil = state.tick + 10; s1.ai.retreating = true;
  stepBattle(state); // flags are refreshed in the status phase
  const snap = makeSnapshot(state);
  assert.equal(snap.k, state.tick);
  const row = snap.s.find((r) => r[0] === 1);
  assert.equal(row.length, 7);
  assert.equal(row[1], Math.round(s1.x * POS_SCALE));
  assert.equal(row[2], Math.round(s1.y * POS_SCALE));
  assert.ok(Number.isInteger(row[3]) && row[3] >= 0 && row[3] < 256);
  assert.ok(Math.abs(row[3] - 64) <= 2, `heading byte ${row[3]} for PI/2`);
  assert.equal(row[4], Math.round((s1.hp / s1.hpMax) * HP_SCALE));
  assert.equal(row[5], Math.round((s1.shield / s1.shieldMax) * HP_SCALE));
  assert.ok(row[6] & FLAG.UNTARGETABLE);
  assert.ok(row[6] & FLAG.RETREATING);
  for (const r of snap.s) {
    assert.ok(r[4] >= 0 && r[4] <= HP_SCALE && r[5] >= 0 && r[5] <= HP_SCALE);
    assert.ok(Number.isInteger(r[1]) && Number.isInteger(r[2]) && Number.isInteger(r[6]));
  }
  // heading wraps: -PI/2 and 3PI/2 give the same byte
  s1.heading = -Math.PI / 2;
  const a = makeSnapshot(state).s.find((r) => r[0] === 1)[3];
  s1.heading = 3 * Math.PI / 2;
  const b = makeSnapshot(state).s.find((r) => r[0] === 1)[3];
  assert.equal(a, b);
  assert.ok(Math.abs(a - 192) <= 2);
});

test('shield broken flag and stationary/latched flags are exposed; dead ships are omitted', () => {
  const state = createBattle(config1v1(scalePreset('fer_fabrica', 1500), scalePreset('vor_garras', 1500), 'flags'));
  stepBattle(state);
  const s = state.ships[0];
  s.stationaryUntil = state.tick + 50;
  const sh = state.ships.find((x) => x.shieldMax > 0) || null;
  if (sh) sh.shield = 0;
  stepBattle(state);
  const snap = makeSnapshot(state);
  assert.ok(snap.s.find((r) => r[0] === s.id)[6] & FLAG.STATIONARY);
  if (sh) assert.ok(snap.s.find((r) => r[0] === sh.id)[6] & FLAG.SHIELD_BROKEN);
  const victim = state.ships[3];
  victim.hp = 0; victim.killerId = 1;
  stepBattle(state);
  assert.ok(!victim.alive);
  assert.ok(!makeSnapshot(state).s.some((r) => r[0] === victim.id));
  assert.equal(typeof hashState(state), 'string');
});
