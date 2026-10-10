// Golden regression fixture for the simulation: three fixed configurations whose state
// hashes (ticks 100 / 1000 / end) and outcome are pinned in golden.json. Any change to the
// catalog, the AI or the engine that alters a battle fails here on purpose, so balance and
// behavior changes are deliberate and reviewed, never accidental.
//
// Intentional change? Regenerate the fixture and commit it with the change:
//   node test/sim/golden.test.js --update
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBattle, stepBattle, hashState, getResult } from '../../shared/sim/battle.js';
import { PRESET_LIST } from '../../shared/catalog.js';
import { scalePreset } from './helpers.js';

const FIXTURE = fileURLToPath(new URL('./golden.json', import.meta.url));
const UPDATE = process.argv.includes('--update');

function presetFleet(id, budget) {
  if (!PRESET_LIST.some((p) => p.id === id)) throw new Error(`unknown preset ${id}`);
  return scalePreset(id, budget);
}

/** The pinned scenarios (ids are stable; do not reorder). */
export const SCENARIOS = [
  {
    id: '1v1-ter_linha-vs-vor_mare',
    config: {
      seed: 7,
      players: [
        { id: 'a', name: 'A', team: 0, isBot: true, ai: 'especialista', fleet: presetFleet('ter_linha', 1500) },
        { id: 'b', name: 'B', team: 1, isBot: true, ai: 'especialista', fleet: presetFleet('vor_mare', 1500) },
      ],
    },
  },
  {
    id: '2v2-mixed-factions',
    config: {
      seed: 11,
      players: [
        { id: 'a', name: 'A', team: 0, isBot: true, ai: 'especialista', fleet: presetFleet('lum_coro', 1500) },
        { id: 'b', name: 'B', team: 0, isBot: true, ai: 'normal', fleet: presetFleet('fer_ferro', 1500) },
        { id: 'c', name: 'C', team: 1, isBot: true, ai: 'dificil', fleet: presetFleet('ter_atlas', 1500) },
        { id: 'd', name: 'D', team: 1, isBot: true, ai: 'especialista', fleet: presetFleet('vor_garras', 1500) },
      ],
    },
  },
  {
    id: '6v6-all-presets-2500',
    config: {
      seed: 3,
      players: PRESET_LIST.slice(0, 12).map((p, i) => ({ id: `p${i}`, name: `P${i}`, team: i < 6 ? 0 : 1, isBot: true, ai: 'especialista', fleet: presetFleet(p.id, 2500) })),
    },
  },
];

/** Run a scenario to its end and collect the pinned values. */
export function runScenario(sc) {
  const state = createBattle(sc.config);
  const hashes = {};
  while (!state.ended) {
    stepBattle(state);
    if (state.tick === 100 || state.tick === 1000) hashes[`t${state.tick}`] = hashState(state);
  }
  hashes.end = hashState(state);
  const r = getResult(state);
  return { ...hashes, winner: r.winner, reason: r.reason, ticks: r.ticks };
}

function loadFixture() {
  try { return JSON.parse(readFileSync(FIXTURE, 'utf8')); } catch { return null; }
}

if (UPDATE) {
  const out = {};
  for (const sc of SCENARIOS) { out[sc.id] = runScenario(sc); console.log(sc.id, out[sc.id]); }
  writeFileSync(FIXTURE, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${FIXTURE}`);
} else {
  const fixture = loadFixture();
  test('golden fixture exists (node test/sim/golden.test.js --update to create it)', () => {
    assert.ok(fixture, `missing ${FIXTURE}`);
  });
  for (const sc of SCENARIOS) {
    test(`golden: ${sc.id} matches the pinned hashes and outcome`, () => {
      if (!fixture) return;
      const want = fixture[sc.id];
      assert.ok(want, `scenario ${sc.id} not in the fixture: run with --update`);
      const got = runScenario(sc);
      assert.deepEqual(got, want,
        `simulation outcome changed for ${sc.id}. If this change is intentional (balance, AI, engine), regenerate: node test/sim/golden.test.js --update`);
    });
  }
}
