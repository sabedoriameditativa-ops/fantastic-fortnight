#!/usr/bin/env node
// Headless battle simulator (ARCHITECTURE §6).
//
//   node tools/simulate.js --a <preset|cls:n,...> --b <...> [--seeds 50] [--budget 1500] [--ai especialista] [--json]
//   node tools/simulate.js --matrix --seeds 20          all presets × all presets
//   node tools/simulate.js --factions --seeds 20        faction × faction pooled over presets
//   node tools/simulate.js --difficulty --seeds 30      each difficulty vs a normal preset fleet
//   node tools/simulate.js --ladder normal --seeds 2    single-player ladder: every preset (player) vs each level's enemy
//   node tools/simulate.js --a ... --b ... --dump 7     write the events of seed 7 as JSONL (--out <dir>)
//
// Fleets of both sides are bots with the --ai difficulty (default especialista),
// sides are swapped on odd seeds so deployment bias cancels out.

import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBattle, summarize, scalePreset, fleetFromSpec } from '../shared/sim/harness.js';
import { PRESETS, PRESET_LIST, FACTION_IDS, FACTIONS } from '../shared/catalog.js';
import { DEFAULT_BUDGET, TICK_RATE, MAX_TICKS, SUDDEN_DEATH_TICK, DIFFICULTIES } from '../shared/constants.js';
import { AI_PROFILES } from '../shared/aiProfiles.js';
import { buildBotFleet } from '../shared/botFleet.js';
import { fleetCost, fleetShipCount } from '../shared/fleet.js';
import {
  levelInfo, enemyBudget, levelBuilder, levelPreset, levelEnemyAi, levelEnemyFaction, levelMustInclude, LAST_AUTHORED_LEVEL,
} from '../shared/levels.js';
import { createRng } from '../shared/rng.js';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

/** Thrown for bad command-line input; reported as `error: …` + usage, exit code 2. */
class UsageError extends Error {}

/**
 * Parse argv. Every value-taking flag must be followed by a value (not another
 * flag); --seeds/--budget/--maxTicks must be positive integers and --ai one of
 * the AI_PROFILES ids — a typo must not silently fall back to another profile
 * (shared/aiProfiles.js getAiProfile) or run zero battles with a success summary.
 */
function parseArgs(argv) {
  const o = { seeds: 10, budget: DEFAULT_BUDGET, ai: 'especialista', json: false, out: join(tmpdir(), 'frota-estelar') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || /^--?[a-zA-Z]/.test(v)) throw new UsageError(`${a} needs a value`);
      return v;
    };
    const posInt = () => {
      const v = next();
      if (!/^\d+$/.test(v) || parseInt(v, 10) <= 0) throw new UsageError(`${a} must be a positive integer, got "${v}"`);
      return parseInt(v, 10);
    };
    switch (a) {
      case '--a': o.a = next(); break;
      case '--b': o.b = next(); break;
      case '--seeds': o.seeds = posInt(); break;
      case '--budget': o.budget = posInt(); break;
      case '--ai': o.ai = next(); break;
      case '--json': o.json = true; break;
      case '--matrix': o.matrix = true; break;
      case '--factions': o.factions = true; break;
      case '--difficulty': o.difficulty = true; break;
      case '--ladder': {
        const v = next();
        if (v !== 'all' && !DIFFICULTIES.includes(v)) throw new UsageError(`--ladder must be one of ${DIFFICULTIES.join(', ')} or all, got "${v}"`);
        o.ladder = v; break;
      }
      case '--levels': {
        const v = next();
        const m = /^(\d+)-(\d+)$/.exec(v);
        if (!m || parseInt(m[1], 10) < 1 || parseInt(m[2], 10) < parseInt(m[1], 10)) throw new UsageError(`--levels must be a range like 1-15, got "${v}"`);
        o.levels = [parseInt(m[1], 10), parseInt(m[2], 10)]; break;
      }
      case '--dump': o.dump = next(); break;
      case '--out': o.out = next(); break;
      case '--maxTicks': o.maxTicks = posInt(); break;
      case '--help': case '-h': o.help = true; break;
      default: throw new UsageError(`Unknown argument: ${a}`);
    }
  }
  if (!AI_PROFILES[o.ai]) throw new UsageError(`--ai must be one of ${Object.keys(AI_PROFILES).join(', ')}, got "${o.ai}"`);
  return o;
}

// ---------------------------------------------------------------------------
// Fleet construction (uses shared/fleet.js when present, else the harness scaler)
// ---------------------------------------------------------------------------

let fleetMod = null;
try { fleetMod = await import('../shared/fleet.js'); } catch { fleetMod = null; }

function presetFleet(presetId, budget) {
  if (fleetMod && typeof fleetMod.presetFleet === 'function') {
    try { return fleetMod.presetFleet(presetId, budget); } catch { /* fall back to the local scaler */ }
  }
  return scalePreset(presetId, budget);
}

/** "cls:n,cls:n" or a preset id → Fleet. */
function parseFleet(spec, budget) {
  if (PRESETS[spec]) return presetFleet(spec, budget);
  return fleetFromSpec(spec);
}

function pct(x) { return `${Math.round(x * 100)}%`.padStart(4); }

function progress(label, i, n) {
  if (process.stderr.isTTY) process.stderr.write(`\r${label} ${i}/${n}   `);
}

function pairRuns(fleetA, fleetB, seeds, o, label) {
  const runs = [];
  for (let s = 0; s < seeds; s++) {
    runs.push(runBattle(fleetA, fleetB, s, { aiA: o.ai, aiB: o.ai, maxTicks: o.maxTicks }));
    if (label) progress(label, s + 1, seeds);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function modeSingle(o) {
  const fa = parseFleet(o.a, o.budget), fb = parseFleet(o.b, o.budget);
  if (o.dump !== undefined) return modeDump(o, fa, fb);
  const runs = pairRuns(fa, fb, o.seeds, o, `${o.a} vs ${o.b}`);
  const s = summarize(runs);
  if (o.json) { console.log(JSON.stringify({ a: o.a, b: o.b, ...s, runs: runs.map((r) => ({ seed: runs.indexOf(r), winner: r.result.winner, reason: r.result.reason, ticks: r.ticks, aTeam: r.aTeam })) }, null, 2)); return; }
  console.log(`\n${o.a} vs ${o.b} (${s.n} seeds, ai=${o.ai}, budget=${o.budget})`);
  console.log(`  A wins ${s.winsA} (${pct(s.winRateA)})  B wins ${s.winsB}  draws ${s.draws}  timeouts ${s.timeouts}`);
  console.log(`  median ${s.medianSec.toFixed(1)} s  p95 ${s.p95Sec.toFixed(1)} s`);
}

function modeDump(o, fa, fb) {
  const seed = /^\d+$/.test(o.dump) ? parseInt(o.dump, 10) : o.dump;
  mkdirSync(o.out, { recursive: true });
  const file = join(o.out, `events-${String(seed).replace(/[^\w-]/g, '_')}.jsonl`);
  const lines = [];
  const r = runBattle(fa, fb, typeof seed === 'number' ? seed : 0, {
    aiA: o.ai, aiB: o.ai, maxTicks: o.maxTicks,
    onTick: (state, ev) => { if (ev.length) lines.push(JSON.stringify({ k: state.tick, e: ev })); },
  });
  lines.push(JSON.stringify({ result: r.result }));
  writeFileSync(file, lines.join('\n') + '\n');
  console.log(`wrote ${lines.length} lines to ${file}; winner ${r.result.winner} (${r.result.reason}) in ${(r.ticks / TICK_RATE).toFixed(1)} s`);
}

function modeMatrix(o) {
  const ids = PRESET_LIST.map((p) => p.id);
  const fleets = Object.fromEntries(ids.map((id) => [id, presetFleet(id, o.budget)]));
  const table = {};
  const all = [];
  let done = 0;
  for (const a of ids) {
    table[a] = {};
    for (const b of ids) {
      const runs = pairRuns(fleets[a], fleets[b], o.seeds, o);
      const s = summarize(runs);
      table[a][b] = s;
      all.push(...runs);
      progress('matrix', ++done, ids.length * ids.length);
    }
  }
  if (o.json) { console.log(JSON.stringify(table, null, 1)); return; }
  console.log(`\nPreset matrix (row win rate vs column, ${o.seeds} seeds each, ai=${o.ai})`);
  console.log(''.padEnd(16) + ids.map((id) => id.slice(0, 7).padStart(8)).join(''));
  for (const a of ids) console.log(a.padEnd(16) + ids.map((b) => pct(table[a][b].winRateA).padStart(8)).join(''));
  printPace(all);
}

function modeFactions(o) {
  const byFaction = Object.fromEntries(FACTION_IDS.map((f) => [f, PRESET_LIST.filter((p) => p.faction === f).map((p) => p.id)]));
  const fleets = Object.fromEntries(PRESET_LIST.map((p) => [p.id, presetFleet(p.id, o.budget)]));
  const table = {};
  const all = [];
  let done = 0;
  for (const fa of FACTION_IDS) {
    table[fa] = {};
    for (const fb of FACTION_IDS) {
      const runs = [];
      const pa = byFaction[fa], pb = byFaction[fb];
      for (let s = 0; s < o.seeds; s++) {
        const a = pa[s % pa.length], b = pb[Math.floor(s / pa.length) % pb.length];
        runs.push(runBattle(fleets[a], fleets[b], s, { aiA: o.ai, aiB: o.ai, maxTicks: o.maxTicks }));
      }
      table[fa][fb] = summarize(runs);
      all.push(...runs);
      progress('factions', ++done, FACTION_IDS.length * FACTION_IDS.length);
    }
  }
  if (o.json) { console.log(JSON.stringify(table, null, 1)); return; }
  console.log(`\nFaction matrix (row win rate vs column, ${o.seeds} seeds per cell pooled over presets, ai=${o.ai})`);
  console.log(''.padEnd(10) + FACTION_IDS.map((f) => f.padStart(8)).join('') + '   draws/timeouts');
  for (const fa of FACTION_IDS) {
    const row = FACTION_IDS.map((fb) => pct(table[fa][fb].winRateA).padStart(8)).join('');
    const dt = FACTION_IDS.map((fb) => `${table[fa][fb].draws}/${table[fa][fb].timeouts}`).join(' ');
    console.log(FACTIONS[fa].short.padEnd(10) + row + '   ' + dt);
  }
  printPace(all);
}

function modeDifficulty(o) {
  const ids = PRESET_LIST.map((p) => p.id);
  const results = {};
  const all = [];
  let done = 0;
  for (const d of DIFFICULTIES) {
    const mul = AI_PROFILES[d].budgetMul;
    const runs = [];
    for (let s = 0; s < o.seeds; s++) {
      const id = ids[s % ids.length];
      const enemy = presetFleet(id, Math.round(o.budget * mul));
      const opp = presetFleet(ids[(s * 5 + 3) % ids.length], o.budget);
      runs.push(runBattle(enemy, opp, s, { aiA: d, aiB: 'normal', maxTicks: o.maxTicks }));
    }
    results[d] = summarize(runs);
    all.push(...runs);
    progress('difficulty', ++done, DIFFICULTIES.length);
  }
  if (o.json) { console.log(JSON.stringify(results, null, 1)); return; }
  console.log(`\nDifficulty vs normal preset fleets (${o.seeds} seeds each; enemy budget × profile.budgetMul)`);
  for (const d of DIFFICULTIES) {
    const s = results[d];
    console.log(`  ${d.padEnd(13)} win ${pct(s.winRateA)}  draws ${s.draws}  timeouts ${s.timeouts}  median ${s.medianSec.toFixed(1)} s`);
  }
  printPace(all);
}

/**
 * Single-player ladder as the game plays it (client/util/spConfig.js): every
 * preset at --budget, driven by the 'especialista' AI like a human fleet, vs
 * the level's enemy (level budget, builder/preset, boss and AI tier) for each
 * of --seeds seeds; the player always deploys on team 0, as in the game.
 */
function ladderLevel(difficulty, n, o) {
  const level = levelInfo(n);
  const eb = enemyBudget(level, difficulty, o.budget);
  const builder = levelBuilder(level, difficulty);
  const ai = levelEnemyAi(level, difficulty);
  const byPreset = {};
  const runs = [];
  let spent = 0, ships = 0, suddenDeath = 0;
  for (const p of PRESET_LIST) {
    const fleet = presetFleet(p.id, o.budget);
    byPreset[p.id] = 0;
    for (let s = 0; s < o.seeds; s++) {
      const rng = createRng(`${n}-${difficulty}-${p.id}-${s}:setup`);
      const faction = levelEnemyFaction(level, rng);
      const enemy = buildBotFleet({
        budget: eb, difficulty, rng, faction, builder, presetId: levelPreset(level, faction),
        enemyFleets: [fleet], mustInclude: levelMustInclude(level, faction),
      });
      spent += fleetCost(enemy); ships += fleetShipCount(enemy);
      const r = runBattle(fleet, enemy, s, { aiA: 'especialista', aiB: ai, swapSides: false, maxTicks: o.maxTicks });
      if (r.aWon) byPreset[p.id]++;
      if (r.ticks >= SUDDEN_DEATH_TICK) suddenDeath++;
      runs.push(r);
    }
  }
  const s = summarize(runs);
  const losers = Object.keys(byPreset).filter((id) => byPreset[id] === 0);
  return {
    level: n, name: level.name, difficulty, enemyBudget: eb, builder, enemyAi: ai,
    enemySpent: Math.round(spent / runs.length), enemyShips: Math.round((ships / runs.length) * 10) / 10,
    n: s.n, winRate: s.winRateA, wins: s.winsA, suddenDeath, timeouts: s.timeouts, medianSec: s.medianSec,
    byPreset, presetsAtZero: losers,
  };
}

function modeLadder(o) {
  const diffs = o.ladder === 'all' ? DIFFICULTIES : [o.ladder];
  const [from, to] = o.levels || [1, LAST_AUTHORED_LEVEL];
  const out = {};
  let done = 0;
  for (const d of diffs) {
    out[d] = {};
    for (let n = from; n <= to; n++) {
      out[d][n] = ladderLevel(d, n, o);
      progress('ladder', ++done, diffs.length * (to - from + 1));
    }
  }
  if (o.json) { console.log(JSON.stringify(out, null, 1)); return; }
  console.log(`\nSingle-player ladder (${PRESET_LIST.length} presets × ${o.seeds} seeds per level, player AI especialista, budget ${o.budget})`);
  for (const d of diffs) {
    console.log(`\n${d}: level  budget (builder/ai)       spent  ships  player win  median   SD  TO  presets at 0 wins`);
    for (let n = from; n <= to; n++) {
      const r = out[d][n];
      console.log(`  L${String(n).padEnd(3)} ${String(r.enemyBudget).padStart(6)} (${r.builder.padEnd(7)}/${r.enemyAi.padEnd(12)}) ${String(r.enemySpent).padStart(5)}  ${String(r.enemyShips).padStart(5)}  ${pct(r.winRate).padStart(8)}  ${r.medianSec.toFixed(0).padStart(5)} s  ${String(r.suddenDeath).padStart(2)}  ${String(r.timeouts).padStart(2)}  ${r.presetsAtZero.join(',')}`);
    }
  }
}

function printPace(runs) {
  const s = summarize(runs);
  console.log(`\nPace over ${s.n} battles: median ${s.medianSec.toFixed(1)} s, p95 ${s.p95Sec.toFixed(1)} s, draws ${s.draws} (${pct(s.draws / Math.max(1, s.n))}), timeouts ${s.timeouts} (${pct(s.timeouts / Math.max(1, s.n))}), max ${MAX_TICKS / TICK_RATE} s`);
}

// ---------------------------------------------------------------------------

function usage() {
  return `Usage:
  node tools/simulate.js --a <preset|cls:n,...> --b <...> [--seeds N] [--budget P] [--ai ${Object.keys(AI_PROFILES).join('|')}] [--json]
  node tools/simulate.js --matrix --seeds N
  node tools/simulate.js --factions --seeds N
  node tools/simulate.js --difficulty --seeds N
  node tools/simulate.js --ladder <${DIFFICULTIES.join('|')}|all> [--levels 1-15] [--seeds N]
  node tools/simulate.js --a ... --b ... --dump <seed> [--out <dir>]
  (--seeds, --budget and --maxTicks are positive integers; --dump needs the seed)
Presets: ${PRESET_LIST.map((p) => p.id).join(', ')}`;
}

/** Usage errors (bad flags, unknown preset/class, …) → `error: …` + usage on stderr, exit 2. */
function fail(message) {
  console.error(`error: ${message}\n${usage()}`);
  process.exit(2);
}

let o;
try { o = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message); }
if (o.help) { console.log(usage()); process.exit(0); }
if (!o.matrix && !o.factions && !o.difficulty && !o.ladder && !(o.a && o.b)) fail('choose a mode: --a/--b, --matrix, --factions, --difficulty or --ladder');
const t0 = performance.now();
try {
  if (o.matrix) modeMatrix(o);
  else if (o.factions) modeFactions(o);
  else if (o.difficulty) modeDifficulty(o);
  else if (o.ladder) modeLadder(o);
  else modeSingle(o);
} catch (e) {
  // fleet parsing problems (unknown preset/class, mixed factions, bad count) are input errors, not crashes
  if (/^(Unknown class|Bad count|Fleet must be single faction|Unknown preset)/.test(e && e.message)) fail(e.message);
  throw e;
}
if (!o.json) console.log(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
