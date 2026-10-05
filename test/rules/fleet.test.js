import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  fleetCost, fleetShipCount, normalizeFleet, validateFleet, presetFleet, autoComplete,
  fleetSummary, fleetToArray, sizeClassCap, isFleetShape, FLEET_ERR, MAX_SINGLE_SHIP_FRACTION,
} from '../../shared/fleet.js';
import { FLEET_LIMITS, BUDGETS } from '../../shared/constants.js';
import { SHIPS, SIZE_CLASSES, SIZE_CLASS, PRESET_LIST, FACTION_IDS, shipsOfFaction } from '../../shared/catalog.js';
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
    assert.equal(r.detail.cost, 500 + 640);
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

  test('stops when nothing fits (full fleet unchanged)', () => {
    const full = { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 24 }, { cls: 'ter_falcao', count: 16 }] };
    const f = autoComplete(full, 2500, createRng(9));
    assert.deepEqual(f, normalizeFleet(full));
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
