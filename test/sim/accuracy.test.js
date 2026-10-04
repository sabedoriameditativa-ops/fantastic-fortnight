import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../../shared/sim/battle.js';
import { hitChance, weaponRange } from '../../shared/sim/weapons.js';
import { getTables, CLASS_INDEX } from '../../shared/sim/tables.js';
import { ACCURACY, COMBAT, SHIP_LIST, SHIPS, DAMAGE_MULT } from '../../shared/catalog.js';
import { config1v1 } from './helpers.js';

function pair(clsA, clsB) {
  const a = { faction: SHIP_LIST.find((s) => s.id === clsA).faction, ships: [{ cls: clsA, count: 1 }] };
  const b = { faction: SHIP_LIST.find((s) => s.id === clsB).faction, ships: [{ cls: clsB, count: 1 }] };
  const state = createBattle(config1v1(a, b, 'acc'));
  return [state.ships[0], state.ships[1], state];
}

test('base accuracy table and Ferrix neural net bonus vs tiny/small', () => {
  const T = getTables();
  const vetor = CLASS_INDEX.fer_vetor, vespa = CLASS_INDEX.ter_vespa, larva = CLASS_INDEX.vor_larva, prom = CLASS_INDEX.ter_prometeu;
  assert.ok(Math.abs(T.acc[vetor][0][larva] - (ACCURACY.kinetic[0] + COMBAT.ferrixNeuralAccuracy)) < 1e-9);
  assert.ok(Math.abs(T.acc[vespa][0][larva] - ACCURACY.kinetic[0]) < 1e-9);
  assert.ok(Math.abs(T.acc[vetor][0][prom] - ACCURACY.kinetic[5]) < 1e-9, 'no bonus vs large');
  // torpedo cannot target tiny/small: zero
  const lanca = CLASS_INDEX.ter_lanca;
  assert.equal(T.acc[lanca][0][larva], 0);
  assert.equal(T.wdps[lanca][0][larva], 0);
  assert.ok(T.wdps[lanca][0][prom] > 0);
});

test('hitChance: range falloff 1.0 → 0.6, fast target −0.05, clamps to [0.05, 0.98]', () => {
  const [s, t] = pair('ter_orion', 'ter_hercules'); // kinetic cannon vs large: base 1.0
  const w = s.weapons[0];
  const R = weaponRange(s, w);
  t.vx = 0; t.vy = 0;
  assert.ok(Math.abs(hitChance(s, w, t, 0.5 * R) - COMBAT.maxHitChance) < 1e-9, 'clamped to 0.98 at full accuracy');
  assert.ok(Math.abs(hitChance(s, w, t, R) - 0.6) < 1e-9, 'edge of range');
  assert.ok(Math.abs(hitChance(s, w, t, 0.9 * R) - 0.8) < 1e-9, 'linear between 80% and 100%');
  t.vx = 200;
  assert.ok(Math.abs(hitChance(s, w, t, R) - 0.95 * 0.6) < 1e-9, 'fast target penalty (additive) then range factor');
  // railgun vs tiny with max range and speed penalty → clamp to 0.05
  const [r, larva] = pair('fer_sentinela', 'vor_larva');
  larva.vx = 200;
  const wr = r.weapons[0];
  // base railgun-vs-tiny + ferrix bonus − fast penalty, × rangeFalloffMin at max range
  const expected = (ACCURACY.railgun[0] + COMBAT.ferrixNeuralAccuracy - COMBAT.fastTargetPenalty) * COMBAT.rangeFalloffMin;
  assert.ok(Math.abs(hitChance(r, wr, larva, weaponRange(r, wr)) - expected) < 1e-9);
  larva.mod.evasion = 1;
  assert.equal(hitChance(r, wr, larva, 10), COMBAT.minHitChance);
});

test('contact weapons always hit; buffs extend range', () => {
  const [c, h] = pair('vor_carrapato', 'ter_hercules');
  const w = c.weapons[0];
  assert.ok(w.def.contact);
  assert.equal(hitChance(c, w, h, 40), 1);
  const base = weaponRange(c, c.weapons[1]);
  c.mod.rangeMul = 1.5;
  assert.ok(Math.abs(weaponRange(c, c.weapons[1]) - base * 1.5) < 1e-9);
  c.weapons[1].mod.rangeAdd = 100;
  assert.ok(Math.abs(weaponRange(c, c.weapons[1]) - (base * 1.5 + 100)) < 1e-9);
});

test('precomputed tables: hull/shield weighting and DR included', () => {
  const T = getTables();
  const herc = CLASS_INDEX.ter_hercules, serafim = CLASS_INDEX.lum_serafim, larva = CLASS_INDEX.vor_larva;
  // laser vs Serafim: shield 700 of 1200 ehp → 0.583×1.2 + 0.417×0.6 ≈ 0.95
  const harm = CLASS_INDEX.lum_harmonico;
  assert.ok(Math.abs(T.frac[harm][0][serafim] - (700 / 1200 * 1.2 + 500 / 1200 * 0.6)) < 1e-9);
  // heavy cannon vs Hércules: shield part (cap/ehp) × kinetic.shield, hull part × max(armorFloor, (dmg·armored − dr)/dmg)
  const H = SHIPS.ter_hercules, km = DAMAGE_MULT.kinetic, dmg = H.weapons[0].damage;
  const sf = H.shield.cap / (H.shield.cap + H.hp);
  const hullFrac = Math.max(dmg * km.armored * COMBAT.armorFloor, dmg * km.armored - H.dr) / dmg;
  const f = T.frac[herc][0][herc];
  assert.ok(Math.abs(f - (sf * km.shield + (1 - sf) * hullFrac)) < 1e-9);
  // larva has no shield: frac = hull mult only
  assert.ok(Math.abs(T.frac[herc][0][larva] - 1.0) < 1e-9);
  assert.ok(T.maxRange[herc] === 550 && T.rawDps[larva] > 0);
});
