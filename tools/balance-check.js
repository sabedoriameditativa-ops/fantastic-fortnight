#!/usr/bin/env node
// Balance harness: runs the headless simulator's matrix, faction, difficulty
// and single-player ladder modes (as `npm run balance`) and prints pass/fail
// against docs/SPEC.md §8 plus the ladder band of §4. Opt-in (not part of
// `npm test`: it runs ~5,000 battles, a few minutes on four cores).
//
//   node tools/balance-check.js [--matrix-seeds 20] [--faction-seeds 24] [--difficulty-seeds 40]
//                               [--ladder-seeds 2] [--ladder normal] [--json] [--quick]
//
// The four modes run as parallel `tools/simulate.js --json` subprocesses, so
// the numbers are exactly what the simulator prints. Exit code 1 when any
// criterion fails, 2 on usage errors, 3 when a subprocess fails.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESET_LIST, PRESETS, FACTION_IDS } from '../shared/catalog.js';
import { DIFFICULTIES, MAX_TICKS, TICK_RATE } from '../shared/constants.js';
import { LAST_AUTHORED_LEVEL } from '../shared/levels.js';

const SIMULATE = resolve(dirname(fileURLToPath(import.meta.url)), 'simulate.js');

/**
 * Acceptance bands (SPEC §8.3–8.6 and the §4 ladder band). Pair/faction rates
 * pool both orderings of a pair, so a 20-seed matrix cell is judged on 40
 * battles and a 24-seed faction cell on 48.
 */
export const CRITERIA = {
  pair: { min: 0.15, max: 0.85 },            // §8.4 per preset pair (hard counters allowed, stomps not)
  faction: { min: 0.35, max: 0.65 },         // §8.3 faction vs faction pooled over presets
  pace: { medianMin: 60, medianMax: 160, timeoutFrac: 0.10 }, // §8.5
  difficulty: { especialistaMin: 0.70, facilMax: 0.35 },       // §8.6 (+ monotonic)
  ladder: {                                   // §4: pooled preset win rate on Normal, player AI especialista
    normal: { 1: [0.85, 1.0], 8: [0.35, 0.80], 13: [0.25, 1.0], 14: [0.25, 1.0], 15: [0.25, 1.0] },
    neverAllLose: true,                       // no level where every preset loses every seed
  },
};

function parseArgs(argv) {
  const o = { matrixSeeds: 20, factionSeeds: 24, difficultySeeds: 40, ladderSeeds: 2, ladder: 'normal', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const posInt = () => {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v) || parseInt(v, 10) <= 0) throw new Error(`${a} must be a positive integer`);
      return parseInt(v, 10);
    };
    switch (a) {
      case '--matrix-seeds': o.matrixSeeds = posInt(); break;
      case '--faction-seeds': o.factionSeeds = posInt(); break;
      case '--difficulty-seeds': o.difficultySeeds = posInt(); break;
      case '--ladder-seeds': o.ladderSeeds = posInt(); break;
      case '--ladder': {
        const v = argv[++i];
        if (!DIFFICULTIES.includes(v)) throw new Error(`--ladder must be one of ${DIFFICULTIES.join(', ')}`);
        o.ladder = v; break;
      }
      case '--quick': o.matrixSeeds = 4; o.factionSeeds = 8; o.difficultySeeds = 8; o.ladderSeeds = 1; break;
      case '--json': o.json = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }
  return o;
}

function usage() {
  return `Usage: node tools/balance-check.js [--matrix-seeds N] [--faction-seeds N] [--difficulty-seeds N] [--ladder-seeds N] [--ladder <difficulty>] [--quick] [--json]
Runs tools/simulate.js --matrix / --factions / --difficulty / --ladder in parallel and checks docs/SPEC.md §8 + the §4 ladder band.`;
}

/** Run `tools/simulate.js --json <args>` and parse its stdout. */
function simulate(args) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [SIMULATE, '--json', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', rej);
    child.on('close', (code) => {
      if (code !== 0) return rej(new Error(`simulate.js ${args.join(' ')} exited ${code}: ${err.trim()}`));
      try { res(JSON.parse(out)); } catch (e) { rej(new Error(`simulate.js ${args.join(' ')}: bad JSON (${e.message})`)); }
    });
  });
}

const pct = (x) => `${Math.round(x * 100)}%`;

/** Pooled win rate of a vs b over both orderings of a matrix/faction table. */
function pooled(table, a, b) {
  const ab = table[a][b], ba = table[b][a];
  const wins = ab.winsA + ba.winsB, n = ab.n + ba.n;
  return { rate: n ? wins / n : 0.5, n };
}

/**
 * Evaluate the four result tables against CRITERIA.
 * @returns {{ checks: {id:string, ok:boolean, detail:string}[], ok: boolean }}
 */
export function evaluate({ matrix, factions, difficulty, ladder }, o = {}) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  const ids = PRESET_LIST.map((p) => p.id);

  // §8.4 preset pairs
  if (matrix) {
    const bad = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const { rate, n } = pooled(matrix, ids[i], ids[j]);
      if (rate < CRITERIA.pair.min || rate > CRITERIA.pair.max) bad.push(`${ids[i]} vs ${ids[j]} ${pct(rate)} (${n})`);
    }
    add('pairs', bad.length === 0, bad.length ? `${bad.length} pair(s) outside ${pct(CRITERIA.pair.min)}–${pct(CRITERIA.pair.max)}: ${bad.join('; ')}` : `all ${(ids.length * (ids.length - 1)) / 2} pairs within ${pct(CRITERIA.pair.min)}–${pct(CRITERIA.pair.max)}`);
    // §8.2 mirrors (the diagonal): side A within 50% ± tol, tol = max(15, two binomial σ) for this seed count
    const nMirror = matrix[ids[0]][ids[0]].n;
    const tol = Math.max(0.15, 2 * Math.sqrt(0.25 / Math.max(1, nMirror)));
    const mirrors = ids.filter((id) => Math.abs(matrix[id][id].winRateA - 0.5) > tol).map((id) => `${id} ${pct(matrix[id][id].winRateA)}`);
    add('mirrors', mirrors.length === 0, mirrors.length ? `mirror side bias beyond ±${pct(tol)}: ${mirrors.join('; ')}` : `mirror matches within 50% ± ${pct(tol)} (${nMirror} seeds)`);
    // §8.5 pace over the matrix
    const all = [];
    for (const a of ids) for (const b of ids) all.push(matrix[a][b]);
    const n = all.reduce((s, c) => s + c.n, 0);
    const timeouts = all.reduce((s, c) => s + c.timeouts, 0);
    const medians = all.map((c) => c.medianSec).sort((x, y) => x - y);
    const median = medians[Math.floor(medians.length / 2)];
    const paceOk = median >= CRITERIA.pace.medianMin && median <= CRITERIA.pace.medianMax && timeouts / n <= CRITERIA.pace.timeoutFrac;
    add('pace', paceOk, `median of cell medians ${median.toFixed(0)} s (band ${CRITERIA.pace.medianMin}–${CRITERIA.pace.medianMax}), timeouts ${timeouts}/${n} (max ${MAX_TICKS / TICK_RATE} s)`);
  }

  // §8.3 factions
  if (factions) {
    const bad = [];
    for (let i = 0; i < FACTION_IDS.length; i++) for (let j = i + 1; j < FACTION_IDS.length; j++) {
      const { rate, n } = pooled(factions, FACTION_IDS[i], FACTION_IDS[j]);
      if (rate < CRITERIA.faction.min || rate > CRITERIA.faction.max) bad.push(`${FACTION_IDS[i]} vs ${FACTION_IDS[j]} ${pct(rate)} (${n})`);
    }
    add('factions', bad.length === 0, bad.length ? `outside ${pct(CRITERIA.faction.min)}–${pct(CRITERIA.faction.max)}: ${bad.join('; ')}` : `every faction pair within ${pct(CRITERIA.faction.min)}–${pct(CRITERIA.faction.max)}`);
  }

  // §8.6 difficulty
  if (difficulty) {
    const rates = DIFFICULTIES.map((d) => difficulty[d].winRateA);
    let mono = true;
    for (let i = 1; i < rates.length; i++) if (rates[i] <= rates[i - 1]) mono = false;
    const ok = mono && rates[DIFFICULTIES.length - 1] >= CRITERIA.difficulty.especialistaMin && rates[0] <= CRITERIA.difficulty.facilMax;
    add('difficulty', ok, DIFFICULTIES.map((d, i) => `${d} ${pct(rates[i])}`).join(' < ') + ` (facil ≤ ${pct(CRITERIA.difficulty.facilMax)}, especialista ≥ ${pct(CRITERIA.difficulty.especialistaMin)}, monotonic)`);
  }

  // §4 ladder band
  if (ladder) {
    const d = o.ladder || 'normal';
    const rows = ladder[d] || {};
    const band = CRITERIA.ladder[d] || {};
    const bad = [];
    for (const [lv, [lo, hi]] of Object.entries(band)) {
      const r = rows[lv];
      if (!r) continue;
      if (r.winRate < lo || r.winRate > hi) bad.push(`L${lv} ${pct(r.winRate)} (band ${pct(lo)}–${pct(hi)})`);
    }
    const allLose = Object.values(rows).filter((r) => r.wins === 0).map((r) => `L${r.level}`);
    const okBand = bad.length === 0;
    const okAll = !CRITERIA.ladder.neverAllLose || allLose.length === 0;
    const curve = Object.values(rows).map((r) => `L${r.level} ${pct(r.winRate)}`).join(' ');
    add('ladder', okBand && okAll, `${d}: ${curve}` + (bad.length ? ` | outside band: ${bad.join('; ')}` : '') + (allLose.length ? ` | every preset loses at ${allLose.join(', ')}` : ''));
  }

  return { checks, ok: checks.every((c) => c.ok) };
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}\n${usage()}`); process.exit(2); }
  if (o.help) { console.log(usage()); return; }
  const t0 = performance.now();
  const jobs = {
    matrix: simulate(['--matrix', '--seeds', String(o.matrixSeeds)]),
    factions: simulate(['--factions', '--seeds', String(o.factionSeeds)]),
    difficulty: simulate(['--difficulty', '--seeds', String(o.difficultySeeds)]),
    ladder: simulate(['--ladder', o.ladder, '--levels', `1-${LAST_AUTHORED_LEVEL}`, '--seeds', String(o.ladderSeeds)]),
  };
  let results;
  try {
    const [matrix, factions, difficulty, ladder] = await Promise.all([jobs.matrix, jobs.factions, jobs.difficulty, jobs.ladder]);
    results = { matrix, factions, difficulty, ladder };
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(3);
  }
  const { checks, ok } = evaluate(results, o);
  const secs = ((performance.now() - t0) / 1000).toFixed(0);
  if (o.json) { console.log(JSON.stringify({ ok, checks, seeds: o, seconds: Number(secs) }, null, 1)); }
  else {
    console.log(`Balance check (matrix ${o.matrixSeeds}, factions ${o.factionSeeds}, difficulty ${o.difficultySeeds}, ladder ${o.ladder} ×${o.ladderSeeds} seeds; ${PRESET_LIST.length} presets, ${Object.keys(PRESETS).length} entries) — ${secs} s`);
    for (const c of checks) console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.id}: ${c.detail}`);
    console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
