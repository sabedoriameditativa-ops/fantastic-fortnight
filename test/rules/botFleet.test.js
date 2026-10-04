import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBotFleet, buildRandomFleet, enemyComposition, scorePreset, pickCounterPreset,
  COUNTER_MATRIX, COUNTER_CATEGORIES, counterMatrixCoversAllPresets, builderForDifficulty,
  RANDOM_SPEND_MIN, RANDOM_SPEND_MAX,
} from '../../shared/botFleet.js';
import { validateFleet, fleetCost, presetFleet, fleetSummary } from '../../shared/fleet.js';
import { DIFFICULTIES, BUDGETS } from '../../shared/constants.js';
import { FACTION_IDS, SHIPS, PRESET_LIST, PRESETS, presetsOfFaction } from '../../shared/catalog.js';
import { createRng } from '../../shared/rng.js';

const BUDGET_POINTS = Object.values(BUDGETS).map((b) => b.points);

const hasMothership = (fleet) => fleet.ships.some((e) => SHIPS[e.cls].sizeClass === 'mothership');

describe('buildBotFleet', () => {
  test('valid for 200 seeds × 4 difficulties × 4 factions × 3 budgets', () => {
    const enemyFleets = [presetFleet('lum_coro', 1500)];
    let n = 0;
    for (let seed = 0; seed < 200; seed++) {
      for (const difficulty of DIFFICULTIES) {
        for (const faction of FACTION_IDS) {
          for (const budget of BUDGET_POINTS) {
            const rng = createRng(`bot-${seed}-${difficulty}-${faction}-${budget}`);
            const fleet = buildBotFleet({ budget, difficulty, rng, faction, enemyFleets });
            const v = validateFleet(fleet, budget);
            assert.equal(v.ok, true, `${seed}/${difficulty}/${faction}/${budget}: ${v.code} ${JSON.stringify(v.detail)}`);
            assert.equal(fleet.faction, faction);
            n++;
          }
        }
      }
    }
    assert.equal(n, 200 * 4 * 4 * 3);
  });

  test('facil: random builder, spends 60–85% of the budget and never buys a mothership', () => {
    for (let seed = 0; seed < 300; seed++) {
      const faction = FACTION_IDS[seed % 4];
      const budget = BUDGET_POINTS[seed % 3];
      const fleet = buildBotFleet({ budget, difficulty: 'facil', rng: createRng(`facil-${seed}`), faction });
      assert.ok(!hasMothership(fleet), `seed ${seed}: no mothership`);
      const frac = fleetCost(fleet) / budget;
      assert.ok(frac >= RANDOM_SPEND_MIN - 1e-9 && frac <= RANDOM_SPEND_MAX + 1e-9, `seed ${seed}: spend ${frac}`);
    }
  });

  test('facil random fleets differ across seeds (it is actually random)', () => {
    const seen = new Set();
    for (let seed = 0; seed < 20; seed++) {
      seen.add(JSON.stringify(buildBotFleet({ budget: 1500, difficulty: 'facil', rng: createRng(`r${seed}`), faction: 'terran' })));
    }
    assert.ok(seen.size >= 15);
  });

  test('normal: preset of the faction scaled and auto-completed (near-full budget)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const faction = FACTION_IDS[seed % 4];
      const budget = BUDGET_POINTS[seed % 3];
      const fleet = buildBotFleet({ budget, difficulty: 'normal', rng: createRng(`n${seed}`), faction });
      assert.ok(fleetCost(fleet) >= budget * 0.9, `seed ${seed}: ${fleetCost(fleet)}/${budget}`);
      // the fleet contains the anchor of some preset of the faction (first entry)
      const anchors = presetsOfFaction(faction).map((p) => p.ships[0][0]).concat(presetsOfFaction(faction).map((p) => p.ships[1][0]));
      assert.ok(fleet.ships.some((e) => anchors.includes(e.cls)), `seed ${seed}: preset-shaped`);
    }
  });

  test('is deterministic given the rng seed', () => {
    for (const difficulty of DIFFICULTIES) {
      const o = { budget: 1500, difficulty, faction: 'vorrax', enemyFleets: [presetFleet('ter_atlas', 1500)] };
      const a = buildBotFleet({ ...o, rng: createRng('det') });
      const b = buildBotFleet({ ...o, rng: createRng('det') });
      assert.deepEqual(a, b, difficulty);
    }
  });

  test('picks a random faction when none is forced, deterministically', () => {
    const factions = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const f = buildBotFleet({ budget: 1500, difficulty: 'normal', rng: createRng(`f${seed}`) });
      assert.ok(FACTION_IDS.includes(f.faction));
      factions.add(f.faction);
    }
    assert.equal(factions.size, 4);
    assert.equal(buildBotFleet({ budget: 1500, difficulty: 'normal', rng: createRng('x') }).faction,
      buildBotFleet({ budget: 1500, difficulty: 'normal', rng: createRng('x') }).faction);
  });

  test('builder override and unknown difficulty fall back sensibly', () => {
    const r = buildBotFleet({ budget: 1500, difficulty: 'especialista', rng: createRng(1), faction: 'ferrix', builder: 'random' });
    assert.ok(!hasMothership(r));
    assert.ok(fleetCost(r) <= 1500 * RANDOM_SPEND_MAX);
    const u = buildBotFleet({ budget: 1500, difficulty: 'lendario', rng: createRng(1), faction: 'ferrix' });
    assert.equal(validateFleet(u, 1500).ok, true);
    assert.throws(() => buildBotFleet({ budget: 1500, difficulty: 'normal' }));
    assert.equal(builderForDifficulty('facil'), 'random');
    assert.equal(builderForDifficulty('normal'), 'preset');
    assert.equal(builderForDifficulty('dificil'), 'counter');
    assert.equal(builderForDifficulty('especialista'), 'counter');
    assert.equal(builderForDifficulty('???'), 'preset');
  });

  test('mustInclude puts the boss in the fleet for every builder (and decides the faction if none is forced)', () => {
    for (const [difficulty, cls, budget] of [['facil', 'vor_rainha', 1080], ['normal', 'lum_catedral', 1500], ['dificil', 'fer_mente', 1725], ['especialista', 'ter_prometeu', 2925]]) {
      for (let seed = 0; seed < 20; seed++) {
        const fleet = buildBotFleet({ budget, difficulty, rng: createRng(`boss${seed}`), mustInclude: [cls], enemyFleets: [presetFleet('vor_mare', 1500)] });
        assert.equal(fleet.faction, SHIPS[cls].faction);
        assert.ok(fleet.ships.some((e) => e.cls === cls), `${difficulty} seed ${seed}: includes ${cls}`);
        assert.equal(validateFleet(fleet, budget).ok, true);
      }
    }
    // forced boss of another faction than the forced faction is ignored
    const f = buildBotFleet({ budget: 1500, difficulty: 'normal', rng: createRng(2), faction: 'terran', mustInclude: ['vor_rainha'] });
    assert.equal(f.faction, 'terran');
    assert.ok(!f.ships.some((e) => e.cls === 'vor_rainha'));
  });
});

describe('counter builder', () => {
  test('matrix covers every preset and category', () => {
    assert.equal(counterMatrixCoversAllPresets(), true);
    assert.equal(Object.keys(COUNTER_MATRIX).length, PRESET_LIST.length);
    for (const id of Object.keys(COUNTER_MATRIX)) assert.ok(PRESETS[id], id);
    for (const id of Object.keys(COUNTER_MATRIX)) for (const c of COUNTER_CATEGORIES) {
      const v = COUNTER_MATRIX[id][c];
      assert.ok(v >= 0 && v <= 1, `${id}.${c}`);
    }
  });

  test('enemyComposition computes cost shares', () => {
    const comp = enemyComposition([{ faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 10 }, { cls: 'vor_rainha', count: 1 }] }]);
    const larvae = 10 * SHIPS.vor_larva.cost, rainha = SHIPS.vor_rainha.cost;
    assert.equal(comp.total, larvae + rainha);
    assert.ok(Math.abs(comp.swarm - larvae / (larvae + rainha)) < 1e-9);
    assert.ok(Math.abs(comp.heavy - rainha / (larvae + rainha)) < 1e-9);
    assert.equal(comp.organic, 1);
    assert.equal(comp.shield, 0);
    assert.equal(comp.nanite, 0);
    assert.equal(comp.line + comp.mothership, 0);
    const shieldy = enemyComposition([{ faction: 'terran', ships: [{ cls: 'ter_hercules', count: 1 }, { cls: 'ter_vespa', count: 1 }] }]);
    assert.ok(Math.abs(shieldy.shield - SHIPS.ter_hercules.cost / (SHIPS.ter_hercules.cost + SHIPS.ter_vespa.cost)) < 1e-9);
    assert.equal(enemyComposition([]).total, 0);
    assert.equal(enemyComposition(null).total, 0);
    assert.equal(enemyComposition([{ faction: 'x', ships: [{ cls: 'nope', count: 3 }] }]).total, 0);
  });

  test('scorePreset is the share-weighted matrix row', () => {
    const comp = enemyComposition([{ faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 30 }] }]);
    assert.ok(Math.abs(scorePreset('ter_atlas', comp) - (COUNTER_MATRIX.ter_atlas.swarm + COUNTER_MATRIX.ter_atlas.organic)) < 1e-9);
    assert.equal(scorePreset('nope', comp), 0);
  });

  test('picks differently for different enemy compositions (every faction)', () => {
    const swarm = [{ faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 32 }, { cls: 'vor_zangao', count: 8 }] }];
    const heavyShield = [{ faction: 'terran', ships: [{ cls: 'ter_hercules', count: 4 }, { cls: 'ter_atlas', count: 1 }] }];
    const expected = { terran: ['ter_atlas', 'ter_misseis'], vorrax: ['vor_chuva', 'vor_garras'], lumen: ['lum_catedral', 'lum_dissonancia'], ferrix: ['fer_fabrica', 'fer_ferro'] };
    for (const faction of FACTION_IDS) {
      const a = pickCounterPreset(faction, swarm, createRng(1));
      const b = pickCounterPreset(faction, heavyShield, createRng(1));
      assert.equal(a, expected[faction][0], `${faction} vs swarm`);
      assert.equal(b, expected[faction][1], `${faction} vs heavy`);
    }
    // through buildBotFleet: dificil terran vs swarm → flak/carrier doctrine (Atlas present)
    const vsSwarm = buildBotFleet({ budget: 1500, difficulty: 'dificil', rng: createRng(3), faction: 'terran', enemyFleets: swarm });
    assert.ok(vsSwarm.ships.some((e) => e.cls === 'ter_atlas'));
    const vsHeavy = buildBotFleet({ budget: 1500, difficulty: 'especialista', rng: createRng(3), faction: 'terran', enemyFleets: heavyShield });
    assert.ok(vsHeavy.ships.some((e) => e.cls === 'ter_lanca') && vsHeavy.ships.find((e) => e.cls === 'ter_orion').count >= 4);
  });

  test('falls back to a random preset when no enemy fleets are known', () => {
    assert.equal(pickCounterPreset('lumen', [], createRng(1)), null);
    assert.equal(pickCounterPreset('lumen', undefined, createRng(1)), null);
    const ids = new Set();
    for (let seed = 0; seed < 30; seed++) {
      const f = buildBotFleet({ budget: 1500, difficulty: 'especialista', rng: createRng(`nf${seed}`), faction: 'lumen' });
      assert.equal(validateFleet(f, 1500).ok, true);
      ids.add(f.ships.map((e) => e.cls).join(','));
    }
    assert.ok(ids.size >= 2, 'different presets get picked');
  });

  test('ties are broken by the rng', () => {
    // An enemy with no cost → no composition → null; tie case: craft a composition where two rows score equally.
    const comp = enemyComposition([{ faction: 'terran', ships: [{ cls: 'ter_orion', count: 1 }] }]); // line=1
    // ter_linha.line (0.7) == ter_misseis.line (0.7) → tie
    assert.equal(scorePreset('ter_linha', comp), scorePreset('ter_misseis', comp));
    const picks = new Set();
    for (let seed = 0; seed < 30; seed++) picks.add(pickCounterPreset('terran', [{ faction: 'terran', ships: [{ cls: 'ter_orion', count: 1 }] }], createRng(seed)));
    assert.deepEqual([...picks].sort(), ['ter_linha', 'ter_misseis']);
  });
});

describe('buildRandomFleet', () => {
  test('handles tiny budgets by buying at least one ship and keeps within caps', () => {
    const f = buildRandomFleet('vorrax', 40, createRng(1));
    assert.ok(f.ships.length >= 1);
    assert.ok(fleetCost(f) <= 40);
    const g = buildRandomFleet('ferrix', 2500, createRng(2));
    assert.equal(validateFleet(g, 2500).ok, true);
    assert.ok(fleetSummary(g).count <= 40);
  });
});
