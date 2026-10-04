// Headless helpers shared by tools/simulate.js and the test suite: preset
// scaling (local fallback when shared/fleet.js is not available), fleet specs
// and a one-shot battle runner with side swapping.

import { createBattle, stepBattle } from './battle.js';
import { PRESETS, SHIPS, shipsOfFaction } from '../catalog.js';
import { FLEET_LIMITS, TICK_RATE } from '../constants.js';

function capFor(cls, faction) {
  const def = SHIPS[cls];
  if (def.sizeClass === 'tiny' && FLEET_LIMITS.tinyCapByFaction[faction]) return FLEET_LIMITS.tinyCapByFaction[faction];
  return FLEET_LIMITS.maxPerSizeClass[def.sizeClass];
}

/**
 * Scale a preset to a budget: buy in listed priority order, repeat cycles
 * while affordable, respect size-class caps and the ship count cap, never
 * exceed the budget. (Mirrors the shared/fleet.js contract.)
 * @param {string} presetId
 * @param {number} budget
 * @returns {{faction: string, ships: {cls: string, count: number}[]}}
 */
export function scalePreset(presetId, budget) {
  const p = PRESETS[presetId];
  if (!p) throw new Error(`Unknown preset: ${presetId}`);
  const counts = {}, sizeCount = {};
  let spent = 0, total = 0;
  const canBuy = (cls) => {
    const def = SHIPS[cls];
    if (spent + def.cost > budget || total + 1 > FLEET_LIMITS.maxShips) return false;
    return (sizeCount[def.sizeClass] || 0) < capFor(cls, p.faction);
  };
  const buy = (cls) => {
    const sc = SHIPS[cls].sizeClass;
    counts[cls] = (counts[cls] || 0) + 1; sizeCount[sc] = (sizeCount[sc] || 0) + 1; spent += SHIPS[cls].cost; total++;
  };
  for (const [cls, n] of p.ships) for (let i = 0; i < n; i++) if (canBuy(cls)) buy(cls);
  let progress = true;
  while (progress) {
    progress = false;
    for (const [cls] of p.ships) {
      if (SHIPS[cls].sizeClass === 'mothership') continue;
      if (canBuy(cls)) { buy(cls); progress = true; }
    }
  }
  return { faction: p.faction, ships: p.ships.filter(([cls]) => counts[cls]).map(([cls]) => ({ cls, count: counts[cls] })) };
}

/** "cls:n,cls:n" → Fleet (single faction). */
export function fleetFromSpec(spec) {
  const ships = [];
  let faction = null;
  for (const part of spec.split(',')) {
    const [cls, n] = part.split(':');
    if (!SHIPS[cls]) throw new Error(`Unknown class: ${cls}`);
    const count = parseInt(n || '1', 10);
    if (!(count > 0)) throw new Error(`Bad count for ${cls}`);
    if (faction && SHIPS[cls].faction !== faction) throw new Error('Fleet must be single faction');
    faction = SHIPS[cls].faction;
    ships.push({ cls, count });
  }
  return { faction, ships };
}

/** One ship of every class of a faction. */
export function oneOfEachFleet(faction) {
  return { faction, ships: shipsOfFaction(faction).map((s) => ({ cls: s.id, count: 1 })) };
}

/**
 * Run one battle to the end. Fleet `a` plays team 0 on even seeds and team 1
 * on odd seeds (so deployment-side bias cancels out over many seeds).
 * @returns {{ aWon: boolean, bWon: boolean, draw: boolean, ticks: number, timeout: boolean, result: object, aTeam: 0|1, state: object }}
 */
export function runBattle(fleetA, fleetB, seed, { aiA = 'especialista', aiB = 'especialista', maxTicks, suddenDeathTick, onTick, swapSides } = {}) {
  const swap = swapSides ?? ((typeof seed === 'number' ? seed : 0) % 2 === 1);
  const pa = { id: 'A', name: 'A', team: swap ? 1 : 0, isBot: true, ai: aiA, fleet: fleetA };
  const pb = { id: 'B', name: 'B', team: swap ? 0 : 1, isBot: true, ai: aiB, fleet: fleetB };
  const config = { seed, players: swap ? [pb, pa] : [pa, pb] };
  if (maxTicks) config.maxTicks = maxTicks;
  if (suddenDeathTick) config.suddenDeathTick = suddenDeathTick;
  const state = createBattle(config);
  while (!state.ended) {
    const ev = stepBattle(state);
    if (onTick) onTick(state, ev);
  }
  const r = state.ended;
  return { aWon: r.winner === pa.team, bWon: r.winner === pb.team, draw: r.winner === -1, ticks: r.ticks, timeout: r.reason === 'timeout', result: r, aTeam: pa.team, state };
}

/** Aggregate a list of runBattle() results. */
export function summarize(runs) {
  const n = runs.length;
  const wins = runs.filter((r) => r.aWon).length;
  const draws = runs.filter((r) => r.draw).length;
  const timeouts = runs.filter((r) => r.timeout).length;
  const ticks = runs.map((r) => r.ticks).sort((x, y) => x - y);
  const median = n ? ticks[Math.floor(n / 2)] : 0;
  const p95 = n ? ticks[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
  return { n, winRateA: n ? wins / n : 0, winsA: wins, winsB: n - wins - draws, draws, timeouts, medianSec: median / TICK_RATE, p95Sec: p95 / TICK_RATE };
}
