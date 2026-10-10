// tools/balance-check.js: the pass/fail evaluation against SPEC §8 + the §4 ladder band is
// pure and cheap to test; the sims themselves are opt-in (`npm run balance`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, CRITERIA } from '../../tools/balance-check.js';
import { PRESET_LIST, FACTION_IDS } from '../../shared/catalog.js';
import { DIFFICULTIES } from '../../shared/constants.js';

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools/balance-check.js');
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 60_000 });

const cell = (winRateA, n = 20, medianSec = 70, timeouts = 0) => {
  const winsA = Math.round(winRateA * n);
  return { n, winRateA, winsA, winsB: n - winsA - 0, draws: 0, timeouts, medianSec, p95Sec: medianSec * 1.6 };
};

function balancedTables() {
  const ids = PRESET_LIST.map((p) => p.id);
  const matrix = {};
  for (const a of ids) { matrix[a] = {}; for (const b of ids) matrix[a][b] = cell(0.5); }
  const factions = {};
  for (const a of FACTION_IDS) { factions[a] = {}; for (const b of FACTION_IDS) factions[a][b] = cell(0.5, 24); }
  const difficulty = Object.fromEntries(DIFFICULTIES.map((d, i) => [d, cell([0.05, 0.45, 0.6, 0.8][i], 40)]));
  const ladder = { normal: {} };
  const curve = [0.95, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5, 0.5, 0.5, 0.45, 0.4, 0.4, 0.35, 0.3];
  curve.forEach((w, i) => { ladder.normal[i + 1] = { level: i + 1, winRate: w, wins: Math.round(w * 24), n: 24 }; });
  return { matrix, factions, difficulty, ladder };
}

test('evaluate passes a balanced set of tables and reports every criterion', () => {
  const r = evaluate(balancedTables());
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.deepEqual(r.checks.map((c) => c.id), ['pairs', 'mirrors', 'pace', 'factions', 'difficulty', 'ladder']);
});

test('evaluate fails on a stomp pair (pooled over both orders), a faction out of band, a non-monotonic difficulty curve or an unwinnable level', () => {
  const t = balancedTables();
  const [a, b] = PRESET_LIST.map((p) => p.id);
  t.matrix[a][b] = cell(1.0); t.matrix[b][a] = cell(0.0); // a beats b 40/40
  let r = evaluate(t);
  assert.equal(r.checks.find((c) => c.id === 'pairs').ok, false);
  assert.match(r.checks.find((c) => c.id === 'pairs').detail, new RegExp(`${a} vs ${b} 100%`));
  // a pooled 85% is still inside the band
  t.matrix[a][b] = cell(0.9); t.matrix[b][a] = cell(0.2);
  assert.equal(evaluate(t).checks.find((c) => c.id === 'pairs').ok, true);

  const t2 = balancedTables();
  t2.factions.terran.vorrax = cell(0.8, 24); t2.factions.vorrax.terran = cell(0.3, 24); // pooled 75%
  r = evaluate(t2);
  assert.equal(r.checks.find((c) => c.id === 'factions').ok, false);

  const t3 = balancedTables();
  t3.difficulty.dificil = cell(0.3, 40);
  assert.equal(evaluate(t3).checks.find((c) => c.id === 'difficulty').ok, false);
  const t4 = balancedTables();
  t4.difficulty.especialista = cell(0.65, 40);
  assert.equal(evaluate(t4).checks.find((c) => c.id === 'difficulty').ok, false);

  const t5 = balancedTables();
  t5.ladder.normal[14] = { level: 14, winRate: 0, wins: 0, n: 24 };
  r = evaluate(t5);
  assert.equal(r.checks.find((c) => c.id === 'ladder').ok, false);
  assert.match(r.checks.find((c) => c.id === 'ladder').detail, /every preset loses at L14/);
  const t6 = balancedTables();
  t6.ladder.normal[1] = { level: 1, winRate: 0.6, wins: 14, n: 24 };
  assert.equal(evaluate(t6).checks.find((c) => c.id === 'ladder').ok, false, 'L1 below the band');

  const t7 = balancedTables();
  for (const a2 of Object.keys(t7.matrix)) for (const b2 of Object.keys(t7.matrix[a2])) t7.matrix[a2][b2] = cell(0.5, 20, 30);
  assert.equal(evaluate(t7).checks.find((c) => c.id === 'pace').ok, false, 'battles too short');
});

test('mirror tolerance widens at low seed counts and the ladder band matches the SPEC §4 text', () => {
  const t = balancedTables();
  const id = PRESET_LIST[0].id;
  t.matrix[id][id] = cell(0.75, 4);
  assert.equal(evaluate(t).checks.find((c) => c.id === 'mirrors').ok, true, '3/4 at 4 seeds is noise');
  t.matrix[id][id] = cell(0.75, 40);
  assert.equal(evaluate(t).checks.find((c) => c.id === 'mirrors').ok, false, '30/40 is a side bias');
  assert.deepEqual(CRITERIA.ladder.normal[1], [0.85, 1.0]);
  assert.equal(CRITERIA.ladder.normal[13][0], 0.25);
  assert.equal(CRITERIA.pair.min, 0.15);
  assert.equal(CRITERIA.faction.max, 0.65);
});

test('CLI: --help exits 0, bad arguments exit 2', () => {
  assert.equal(run('--help').status, 0);
  const r = run('--matrix-seeds', 'x');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /must be a positive integer/);
  assert.equal(run('--ladder', 'nope').status, 2);
  assert.equal(run('--bogus').status, 2);
});
