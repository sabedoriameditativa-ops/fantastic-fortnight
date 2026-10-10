import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  fleetCost, fleetShipCount, normalizeFleet, validateFleet, presetFleet, autoComplete, maxFleetValue,
  fleetSummary, fleetToArray, sizeClassCap, isFleetShape, FLEET_ERR, MAX_SINGLE_SHIP_FRACTION,
} from '../../shared/fleet.js';
import { FLEET_LIMITS, BUDGETS } from '../../shared/constants.js';
import { SHIPS, SIZE_CLASSES, SIZE_CLASS, PRESET_LIST, FACTION_IDS, shipsOfFaction, presetsOfFaction } from '../../shared/catalog.js';
import { createRng } from '../../shared/rng.js';

const BUDGET_POINTS = Object.values(BUDGETS).map((b) => b.points); // 800, 1500, 2500

/** Independent cap/budget checker (does not trust validateFleet). */
function assertWithinRules(fleet, budget, label) {
  assert.ok(FACTION_IDS.includes(fleet.faction), `${label}: faction`);
  const bySize = Object.fromEntries(SIZE_CLASSES.map((s) => [s, 0]));
  let cost = 0;
  let count = 0;
  for (const e of fleet.ships) {
    const ship = SHIPS[e.cls];
    assert.ok(ship, `${label}: known class ${e.cls}`);
    assert.equal(ship.faction, fleet.faction, `${label}: same faction`);
    assert.ok(Number.isInteger(e.count) && e.count > 0, `${label}: positive integer count`);
    bySize[ship.sizeClass] += e.count;
    cost += ship.cost * e.count;
    count += e.count;
  }
  assert.ok(cost <= budget, `${label}: cost ${cost} <= budget ${budget}`);
  assert.ok(count >= FLEET_LIMITS.minShips && count <= FLEET_LIMITS.maxShips, `${label}: ship count ${count}`);
  for (const sc of SIZE_CLASSES) {
    assert.ok(bySize[sc] <= sizeClassCap(fleet.faction, sc), `${label}: cap ${sc} ${bySize[sc]}`);
  }
  return { cost, count, bySize };
}

describe('fleetCost / fleetShipCount / normalizeFleet', () => {
  test('cost and count sum over entries, ignoring junk', () => {
    const fleet = { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 3 }, { cls: 'ter_orion', count: 2 }, null, { cls: 'nope', count: 5 }] };
    assert.equal(fleetCost(fleet), 3 * SHIPS.ter_vespa.cost + 2 * SHIPS.ter_orion.cost);
    assert.equal(fleetShipCount(fleet), 10); // unknown class still counts as ships (validation catches it)
    assert.equal(fleetCost(null), 0);
    assert.equal(fleetShipCount({ faction: 'x' }), 0);
  });

  test('normalizeFleet merges duplicates, drops count<=0 and sorts by catalog order', () => {
    const fleet = { faction: 'terran', ships: [
      { cls: 'ter_orion', count: 1 }, { cls: 'ter_vespa', count: 2 }, { cls: 'ter_orion', count: 2 },
      { cls: 'ter_falcao', count: 0 }, { cls: 'ter_lanca', count: -3 }, { cls: 'zzz_unknown', count: 1 },
    ] };
    const n = normalizeFleet(fleet);
    assert.deepEqual(n, { faction: 'terran', ships: [
      { cls: 'ter_vespa', count: 2 }, { cls: 'ter_orion', count: 3 }, { cls: 'zzz_unknown', count: 1 },
    ] });
    assert.notEqual(n, fleet);
    assert.deepEqual(normalizeFleet(null), { faction: '', ships: [] });
  });

  test('sizeClassCap applies the Vorrax tiny exception', () => {
    assert.equal(sizeClassCap('terran', 'tiny'), 24);
    assert.equal(sizeClassCap('vorrax', 'tiny'), 32);
    assert.equal(sizeClassCap('vorrax', 'small'), 24);
    assert.equal(sizeClassCap('lumen', 'mothership'), 1);
  });
});

describe('validateFleet error codes', () => {
  test('FLEET_BAD_SHAPE', () => {
    for (const bad of [null, 1, 'x', [], {}, { faction: 'terran' }, { faction: 1, ships: [] },
      { faction: 'terran', ships: {} }, { faction: 'terran', ships: [null] }, { faction: 'terran', ships: [{ cls: 1, count: 1 }] },
      { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 1.5 }] }, { faction: 'terran', ships: [{ cls: 'ter_vespa', count: -1 }] },
      { faction: 'terran', ships: [{ cls: 'ter_vespa', count: '2' }] }, { faction: 'terran', ships: [['ter_vespa', 2]] }]) {
      assert.equal(validateFleet(bad).code, FLEET_ERR.BAD_SHAPE, JSON.stringify(bad));
      assert.equal(isFleetShape(bad), false);
    }
  });

  test('FLEET_UNKNOWN_FACTION', () => {
    const r = validateFleet({ faction: 'klingon', ships: [{ cls: 'ter_vespa', count: 1 }] });
    assert.equal(r.ok, false);
    assert.equal(r.code, FLEET_ERR.UNKNOWN_FACTION);
  });

  test('FLEET_UNKNOWN_CLASS', () => {
    const r = validateFleet({ faction: 'terran', ships: [{ cls: 'ter_vespa', count: 1 }, { cls: 'ter_deathstar', count: 1 }] });
    assert.equal(r.code, FLEET_ERR.UNKNOWN_CLASS);
    assert.equal(r.detail.cls, 'ter_deathstar');
  });

  test('FLEET_WRONG_FACTION', () => {
    const r = validateFleet({ faction: 'terran', ships: [{ cls: 'vor_larva', count: 1 }] });
    assert.equal(r.code, FLEET_ERR.WRONG_FACTION);
    assert.equal(r.detail.cls, 'vor_larva');
  });

  test('FLEET_OVER_BUDGET', () => {
    const r = validateFleet({ faction: 'terran', ships: [{ cls: 'ter_prometeu', count: 1 }, { cls: 'ter_atlas', count: 2 }] }, 800);
    assert.equal(r.code, FLEET_ERR.OVER_BUDGET);
    assert.equal(r.detail.cost, SHIPS.ter_prometeu.cost + 2 * SHIPS.ter_atlas.cost);
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_prometeu', count: 1 }, { cls: 'ter_atlas', count: 2 }] }, 1500).ok, true);
  });

  test('FLEET_SHIP_COUNT (empty and > 40)', () => {
    assert.equal(validateFleet({ faction: 'terran', ships: [] }).code, FLEET_ERR.SHIP_COUNT);
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_vespa', count: 0 }] }).code, FLEET_ERR.SHIP_COUNT);
    const r = validateFleet({ faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 30 }, { cls: 'vor_zangao', count: 11 }] }, 2500);
    assert.equal(r.code, FLEET_ERR.SHIP_COUNT);
    assert.equal(r.detail.count, 41);
  });

  test('FLEET_CLASS_CAP per size class, with the Vorrax tiny exception', () => {
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_vespa', count: 25 }] }).code, FLEET_ERR.CLASS_CAP);
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_vespa', count: 24 }] }).ok, true);
    assert.equal(validateFleet({ faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 32 }] }).ok, true);
    assert.equal(validateFleet({ faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 33 }] }).code, FLEET_ERR.CLASS_CAP);
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_prometeu', count: 2 }] }, 2500).code, FLEET_ERR.CLASS_CAP);
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_atlas', count: 3 }] }, 2500).code, FLEET_ERR.CLASS_CAP);
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_hercules', count: 5 }] }, 2500).code, FLEET_ERR.CLASS_CAP);
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_orion', count: 13 }] }, 2500).code, FLEET_ERR.CLASS_CAP);
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_falcao', count: 25 }] }, 2500).code, FLEET_ERR.CLASS_CAP);
    // merged duplicates count toward the cap
    assert.equal(validateFleet({ faction: 'terran', ships: [{ cls: 'ter_prometeu', count: 1 }, { cls: 'ter_prometeu', count: 1 }] }, 2500).code, FLEET_ERR.CLASS_CAP);
  });

  test('ok result carries the normalized fleet', () => {
    const r = validateFleet({ faction: 'ferrix', ships: [{ cls: 'fer_vetor', count: 2 }, { cls: 'fer_mente', count: 1 }, { cls: 'fer_vetor', count: 1 }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.fleet.ships, [{ cls: 'fer_vetor', count: 3 }, { cls: 'fer_mente', count: 1 }]);
  });
});

describe('presetFleet', () => {
  test('every preset fits every official budget and respects caps', () => {
    for (const p of PRESET_LIST) {
      for (const budget of BUDGET_POINTS) {
        const f = presetFleet(p.id, budget);
        const { cost, count } = assertWithinRules(f, budget, `${p.id}@${budget}`);
        assert.equal(validateFleet(f, budget).ok, true);
        assert.equal(f.faction, p.faction);
        assert.ok(count >= 3, `${p.id}@${budget}: at least a few ships (${count})`);
        assert.ok(cost >= budget * 0.7, `${p.id}@${budget}: uses most of the budget (${cost})`);
      }
    }
  });

  test('at the reference budget the mothership/capital of the preset is bought', () => {
    for (const p of PRESET_LIST) {
      const f = presetFleet(p.id, 1500);
      const first = p.ships[0][0];
      assert.ok(f.ships.some((e) => e.cls === first), `${p.id}: has ${first}`);
    }
  });

  test('anchor rule: no ship above 55% of the budget (no mothership at 800)', () => {
    for (const p of PRESET_LIST) {
      const f = presetFleet(p.id, 800);
      for (const e of f.ships) assert.ok(SHIPS[e.cls].cost <= 800 * MAX_SINGLE_SHIP_FRACTION, `${p.id}: ${e.cls}`);
      assert.ok(!f.ships.some((e) => SHIPS[e.cls].sizeClass === 'mothership'), `${p.id}: no mothership at 800`);
    }
    // at 1500 the motherships are back
    assert.ok(presetFleet('ter_linha', 1500).ships.some((e) => e.cls === 'ter_prometeu'));
  });

  test('scales up at 2500 (more ships than at 1500) and swarm presets trade up at the 40-ship cap', () => {
    for (const p of PRESET_LIST) {
      const small = fleetSummary(presetFleet(p.id, 1500));
      const big = fleetSummary(presetFleet(p.id, 2500));
      assert.ok(big.cost > small.cost, `${p.id}: spends more at 2500`);
    }
    const mare = fleetSummary(presetFleet('vor_mare', 2500));
    assert.equal(mare.count, 40);
    assert.ok(mare.cost >= 2300, `vor_mare@2500 should trade larvae up, got ${mare.cost}`);
  });

  test('endless budgets: past the 40-ship cap the upgrade pass keeps trading up through the whole roster', () => {
    // a swarm preset at a deep endless budget climbs out of its own entries into larger hulls
    const costAt = (id, budget) => fleetSummary(presetFleet(id, budget)).cost;
    for (const id of ['vor_mare', 'fer_ferro', 'ter_misseis', 'lum_dissonancia']) {
      const c2500 = costAt(id, 2500), c3500 = costAt(id, 3500), c5000 = costAt(id, 5000);
      assert.ok(c3500 > c2500, `${id}: 3500 buys more than 2500 (${c2500} → ${c3500})`);
      assert.ok(c5000 >= c3500, `${id}: never regresses (${c3500} → ${c5000})`);
      const f = presetFleet(id, 5000);
      assert.equal(fleetShipCount(f), 40, `${id}@5000 is at the ship cap`);
      assert.equal(validateFleet(f, 5000).ok, true);
      assert.ok(f.ships.filter((e) => SHIPS[e.cls].sizeClass === 'mothership').reduce((s, e) => s + e.count, 0) <= 1);
      const sizes = new Set(f.ships.map((e) => SHIPS[e.cls].sizeClass));
      assert.ok(sizes.has('large') || sizes.has('capital'), `${id}@5000 upgraded into heavy hulls (${[...sizes]})`);
    }
    // the climb is gradual: between 2500 and 3500 the fleet keeps most of its mid-size hulls
    const mare3500 = fleetSummary(presetFleet('vor_mare', 3500));
    assert.ok(mare3500.bySize.tiny + mare3500.bySize.small >= 10, `vor_mare@3500 still a swarm (${JSON.stringify(mare3500.bySize)})`);
    // the ceiling: the most valuable 40-ship fleet of the faction; the bot flow
    // (presetFleet → autoComplete) approaches it for every preset
    for (const f of FACTION_IDS) {
      const max = maxFleetValue(f);
      assert.ok(max > 3000 && max <= 40 * 520, `${f}: ${max}`);
      for (const p of presetsOfFaction(f)) {
        const alone = fleetSummary(presetFleet(p.id, 20000));
        assert.ok(alone.cost <= max, `${p.id}@20000: ${alone.cost} ≤ ${max}`);
        const huge = fleetSummary(autoComplete(presetFleet(p.id, 20000), 20000, createRng(p.id)));
        assert.equal(huge.count, 40, `${p.id}@20000 fills the cap`);
        assert.ok(huge.cost <= max && huge.cost >= max * 0.85, `${p.id}@20000 approaches the ceiling (${huge.cost}/${max})`);
        assert.equal(validateFleet(autoComplete(presetFleet(p.id, 20000), 20000, createRng(p.id)), 20000).ok, true);
      }
    }
  });

  test('maxFleetValue is the greedy costliest fleet under the caps (hand check for Terran)', () => {
    const t = shipsOfFaction('terran');
    const cost = (id) => t.find((s) => s.id === id).cost;
    // 1 mothership + 2 capitals + 4 large + 12 medium (the costlier medium first) + 21 of the costlier small = 40 ships
    const expected = cost('ter_prometeu') + 2 * cost('ter_atlas') + 4 * cost('ter_hercules') + 12 * cost('ter_orion') + 21 * cost('ter_falcao');
    assert.equal(maxFleetValue('terran'), expected);
    assert.ok(maxFleetValue('vorrax') > 0 && maxFleetValue('lumen') > 0 && maxFleetValue('ferrix') > 0);
  });

  test('mustInclude forces the boss in even when the anchor rule would skip it', () => {
    const f = presetFleet('vor_mare', 800, { mustInclude: ['vor_colmeia'] });
    assert.ok(f.ships.some((e) => e.cls === 'vor_colmeia'));
    assertWithinRules(f, 800, 'forced');
    // wrong-faction or unknown forced classes are ignored
    const g = presetFleet('ter_linha', 1500, { mustInclude: ['vor_rainha', 'nope'] });
    assert.ok(!g.ships.some((e) => e.cls === 'vor_rainha'));
    assertWithinRules(g, 1500, 'forced-ignored');
  });

  test('is deterministic and rejects unknown presets', () => {
    assert.deepEqual(presetFleet('lum_coro', 1500), presetFleet('lum_coro', 1500));
    assert.throws(() => presetFleet('nope', 1500));
  });
});

describe('autoComplete', () => {
  test('never exceeds budget or caps and only adds ships of the faction', () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = createRng(`ac-${seed}`);
      const faction = FACTION_IDS[seed % FACTION_IDS.length];
      const budget = BUDGET_POINTS[seed % BUDGET_POINTS.length];
      const pool = shipsOfFaction(faction).filter((s) => s.sizeClass !== 'mothership');
      const start = normalizeFleet({ faction, ships: [{ cls: pool[seed % pool.length].id, count: 1 }] });
      const f = autoComplete(start, budget, rng);
      const { cost, bySize } = assertWithinRules(f, budget, `autoComplete ${faction}@${budget}#${seed}`);
      assert.ok(cost >= budget - 60, `fills the budget (${cost}/${budget})`);
      assert.ok(bySize.mothership <= 1);
      for (const e of start.ships) {
        const kept = f.ships.find((x) => x.cls === e.cls);
        assert.ok(kept && kept.count >= e.count, 'keeps the existing ships');
      }
    }
  });

  test('is deterministic for the same rng seed and tolerates bad input', () => {
    const a = autoComplete({ faction: 'ferrix', ships: [] }, 1500, createRng(5));
    const b = autoComplete({ faction: 'ferrix', ships: [] }, 1500, createRng(5));
    assert.deepEqual(a, b);
    assert.equal(validateFleet(a, 1500).ok, true);
    assert.deepEqual(autoComplete({ faction: 'nope', ships: [] }, 1500, createRng(1)), { faction: 'nope', ships: [] });
  });

  test('stops when nothing fits: a full fleet at its own cost is unchanged; with budget left it trades the cheapest hulls up', () => {
    const full = { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 24 }, { cls: 'ter_falcao', count: 16 }] };
    assert.deepEqual(autoComplete(full, fleetCost(full), createRng(9)), normalizeFleet(full));
    const up = autoComplete(full, 2500, createRng(9));
    assert.equal(fleetShipCount(up), 40);
    assert.ok(fleetCost(up) > fleetCost(full) && fleetCost(up) <= 2500, `trades up (${fleetCost(up)})`);
    assert.ok(up.ships.find((e) => e.cls === 'ter_vespa').count < 24, 'the cheapest hulls were traded');
    assert.equal(validateFleet(up, 2500).ok, true);
    assert.deepEqual(up, autoComplete(full, 2500, createRng(1)), 'the upgrade pass is deterministic (no rng)');
  });
});

describe('fleetSummary / fleetToArray', () => {
  test('summary counts by size and sums cost/ehp/dps', () => {
    const s = fleetSummary({ faction: 'lumen', ships: [{ cls: 'lum_prisma', count: 2 }, { cls: 'lum_catedral', count: 1 }] });
    assert.equal(s.cost, 2 * SHIPS.lum_prisma.cost + SHIPS.lum_catedral.cost);
    assert.equal(s.count, 3);
    assert.deepEqual(s.bySize, { tiny: 0, small: 2, medium: 0, large: 0, capital: 1, mothership: 0 });
    assert.equal(s.ehp, 2 * (SHIPS.lum_prisma.hp + SHIPS.lum_prisma.shield.cap) + (SHIPS.lum_catedral.hp + SHIPS.lum_catedral.shield.cap));
    assert.ok(s.dps > 0);
  });

  test('fleetToArray expands in deployment order: big → small, catalog order within size', () => {
    const arr = fleetToArray({ faction: 'terran', ships: [
      { cls: 'ter_vespa', count: 2 }, { cls: 'ter_lanca', count: 1 }, { cls: 'ter_falcao', count: 1 },
      { cls: 'ter_prometeu', count: 1 }, { cls: 'ter_orion', count: 1 }, { cls: 'ter_artemis', count: 1 },
    ] });
    assert.deepEqual(arr, ['ter_prometeu', 'ter_artemis', 'ter_orion', 'ter_falcao', 'ter_lanca', 'ter_vespa', 'ter_vespa']);
    for (let i = 1; i < arr.length; i++) {
      assert.ok(SIZE_CLASS[SHIPS[arr[i - 1]].sizeClass].index >= SIZE_CLASS[SHIPS[arr[i]].sizeClass].index);
    }
    assert.equal(fleetToArray(presetFleet('vor_garras', 1500)).length, fleetShipCount(presetFleet('vor_garras', 1500)));
  });
});
