// Battle simulation entry point (ARCHITECTURE §3): createBattle / stepBattle /
// makeSnapshot / getResult / hashState / runToEnd / battleWorld.
// Pure and deterministic: fixed timestep, one RNG stream, iteration in id order.

import { createRng } from '../rng.js';
import {
  MAX_TICKS, SUDDEN_DEATH_TICK, SUDDEN_DEATH_RAMP, SUDDEN_DEATH_RAMP_TICKS, worldSize, POS_SCALE, ANGLE_STEPS, HP_SCALE,
} from '../constants.js';
import { AI_PROFILES, HUMAN_AI_PROFILE, getAiProfile } from '../aiProfiles.js';
import { SHIPS } from '../catalog.js';
import { TAU } from './math.js';
import { createGrid, clearGrid, insertGrid } from './spatial.js';
import { makeShip, updateStatus } from './ship.js';
import { planDeployment } from './deploy.js';
import { moveShips } from './movement.js';
import { fireWeapons, advanceProjectiles, flakCurtains } from './weapons.js';
import { applyDamageQueue, tickDots, regenPhase, processDeaths } from './damage.js';
import { tickAreas, tickLatches, tickKamikaze, registerShip } from './effects.js';
import { makeTeamState, recomputeTargeting, teamThink, decide, executePendingCasts, computeDesired } from './ai.js';
import { orderedShips } from './queries.js';
import { makeStats, checkEnd } from './stats.js';

export { AI_PROFILES };

/** Well-mixed bit of the tick number (balanced over any stride of 1..16 ticks). */
function tickBit(t) {
  let h = Math.imul(t ^ (t >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h & 1;
}

/**
 * Validate a BattleConfig (throws on structural errors).
 * @param {object} config
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('BattleConfig required');
  if (!Array.isArray(config.players) || config.players.length < 1 || config.players.length > 12) throw new Error('players must be 1..12');
  const seen = new Set();
  for (const p of config.players) {
    if (!p || typeof p.id !== 'string' || seen.has(p.id)) throw new Error('players need unique string ids');
    seen.add(p.id);
    if (p.team !== 0 && p.team !== 1) throw new Error(`player ${p.id}: team must be 0 or 1`);
    if (!p.fleet || !Array.isArray(p.fleet.ships)) throw new Error(`player ${p.id}: fleet required`);
    for (const e of p.fleet.ships) if (!SHIPS[e.cls]) throw new Error(`player ${p.id}: unknown class ${e.cls}`);
  }
}

/**
 * Create a new battle state from a config.
 * @param {import('../../docs/ARCHITECTURE.md').BattleConfig} config
 * @returns {object} BattleState (plain object)
 */
export function createBattle(config) {
  validateConfig(config);
  const players = config.players;
  const perSide = Math.max(players.filter((p) => p.team === 0).length, players.filter((p) => p.team === 1).length, 1);
  const world = worldSize(perSide);
  const profiles = {};
  for (const p of players) profiles[p.id] = p.isBot ? getAiProfile(p.ai || 'normal') : HUMAN_AI_PROFILE;
  const state = {
    tick: 0, rng: createRng(config.seed ?? 1), config, world,
    ships: [], alive: [[], []], alivePurchased: [0, 0],
    projectiles: [], projFree: [], projAlive: 0, nextProjId: 1,
    areas: [], nextAreaId: 1,
    grid: createGrid(world.w, world.h),
    teams: [makeTeamState(0), makeTeamState(1)],
    stats: makeStats(players), events: [], nextId: 1,
    suddenDeath: false, sdMul: 1, ended: null, engaged: false, engagedTick: 0,
    maxTicks: config.maxTicks ?? MAX_TICKS, suddenDeathTick: config.suddenDeathTick ?? SUDDEN_DEATH_TICK,
    profiles, dmgQueue: [], dmgCount: 0, recentDeaths: [],
    auraSources: [], curtains: [], latchers: [], kamikazes: [], initialShips: [],
    firstTeam: 0, orderBuf: [], // per-tick processing order (alternates; see stepBattle / orderedShips)
  };
  const placed = planDeployment(players, world);
  for (const d of placed) {
    const id = state.nextId++;
    // slot = team-local deployment index: weapon cooldown offsets and the orbit side derive from it (not from
    // the global id) so that mirrored fleets get identical staggers on both sides (SPEC §8.2)
    const slot = state.alive[d.team].length;
    const s = makeShip({ id, cls: d.cls, owner: d.owner, team: d.team, x: d.x, y: d.y, heading: d.a, tick: 0, slot });
    s.ai.nextThink = slot % profiles[d.owner].thinkInterval;
    state.ships.push(s);
    state.alive[d.team].push(id);
    state.alivePurchased[d.team]++;
    const st = state.stats[d.owner]; st.shipsTotal++; st.shipsAlive++;
    registerShip(state, s);
    state.initialShips.push({ id, cls: d.cls, owner: d.owner, team: d.team, x: d.x, y: d.y, a: d.a });
  }
  rebuildGrid(state);
  for (let t = 0; t < 2; t++) {
    const T = state.teams[t];
    // seed the virtual anchor at the team's centroid before the first think
    const list = state.alive[t];
    let cx = 0, cy = 0;
    for (let i = 0; i < list.length; i++) { const s = state.ships[list[i] - 1]; cx += s.x; cy += s.y; }
    if (list.length) { T.anchorX = cx / list.length; T.anchorY = cy / list.length; }
    teamThink(state, t);
  }
  for (const s of state.ships) {
    const T = state.teams[s.team];
    s.ai.slotDx = s.x - T.anchorX; s.ai.slotDy = s.y - T.anchorY;
    updateStatus(s, 0);
  }
  state.events = [];
  return state;
}

function rebuildGrid(state) {
  clearGrid(state.grid);
  const ships = state.ships;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (s.alive) insertGrid(state.grid, s.id, s.x, s.y);
  }
}

/**
 * Initial purchased ships (deployment) for clients.
 * @returns {{id:number, cls:string, owner:string, team:0|1, x:number, y:number, a:number}[]}
 */
export function getInitialShips(state) {
  return state.initialShips.map((s) => ({ ...s }));
}

/** Arena size. */
export function battleWorld(state) {
  return { w: state.world.w, h: state.world.h };
}

/**
 * Advance exactly one tick.
 * @returns {any[][]} this tick's events (new array each call)
 */
export function stepBattle(state) {
  if (state.ended) return [];
  const events = [];
  state.events = events;
  state.tick++;
  const tick = state.tick, ships = state.ships;
  // the team that decides / casts / fires / moves first (and whose damage applies first) alternates from tick to
  // tick, so neither side has a systematic within-tick ordering edge (SPEC §8.2 mirror symmetry). A hashed tick bit
  // (not tick parity) so that it still alternates for ships that think every 4 / 8 / 16 ticks.
  state.firstTeam = tickBit(tick);
  rebuildGrid(state);
  recomputeTargeting(state);
  if (tick % 10 === 0) { teamThink(state, 0); teamThink(state, 1); } // both teams on the same tick: a staggered think let one side switch phase/leash first on every seed
  if (tick >= state.suddenDeathTick) {
    if (!state.suddenDeath) { state.suddenDeath = true; events.push(['phase', 'suddenDeath']); }
    state.sdMul = 1 + SUDDEN_DEATH_RAMP * Math.floor((tick - state.suddenDeathTick) / SUDDEN_DEATH_RAMP_TICKS);
  }
  for (let i = 0; i < ships.length; i++) { const s = ships[i]; if (s.alive) updateStatus(s, tick); }
  const ord = orderedShips(state);
  for (let i = 0; i < ord.length; i++) {
    const s = ord[i];
    if (s.ai.nextThink <= tick && s.stunUntil <= tick) decide(state, s);
  }
  executePendingCasts(state);
  moveShips(state, computeDesired);
  tickLatches(state);
  tickAreas(state);
  tickKamikaze(state);
  flakCurtains(state);
  fireWeapons(state);
  advanceProjectiles(state);
  tickDots(state);
  applyDamageQueue(state);
  processDeaths(state);
  regenPhase(state);
  pruneRecentDeaths(state);
  const result = checkEnd(state);
  if (result) {
    state.ended = result;
    events.push(['end', result.winner, result.reason]);
  }
  return events;
}

function pruneRecentDeaths(state) {
  const list = state.recentDeaths;
  if (list.length === 0) return;
  let drop = 0;
  while (drop < list.length && state.tick - list[drop].tick > 20) drop++;
  if (drop > 0) list.splice(0, drop);
}

/**
 * Quantized snapshot of alive ships.
 * @returns {{k:number, s:number[][]}}
 */
export function makeSnapshot(state) {
  const ships = state.ships;
  const s = [];
  for (let i = 0; i < ships.length; i++) {
    const sh = ships[i];
    if (!sh.alive) continue;
    let h = sh.heading % TAU;
    if (h < 0) h += TAU;
    const hq = Math.round((h / TAU) * ANGLE_STEPS) % ANGLE_STEPS;
    const hp = Math.max(0, Math.min(HP_SCALE, Math.round((sh.hp / sh.hpMax) * HP_SCALE)));
    const shq = sh.shieldMax > 0 ? Math.max(0, Math.min(HP_SCALE, Math.round(((sh.shield + sh.extraShield) / sh.shieldMax) * HP_SCALE))) : (sh.extraShield > 0 ? HP_SCALE : 0);
    s.push([sh.id, Math.round(sh.x * POS_SCALE), Math.round(sh.y * POS_SCALE), hq, hp, shq, sh.flags]);
  }
  return { k: state.tick, s };
}

/** The BattleResult once the battle ended, else null. */
export function getResult(state) {
  return state.ended;
}

/**
 * FNV-1a 32-bit hash over [tick, per ship: x, y, vx, vy, heading, hp, shield]
 * (Float64 bytes). Identical for identical (config, tick).
 * @returns {string} 8 hex chars
 */
export function hashState(state) {
  const ships = state.ships;
  const arr = new Float64Array(1 + ships.length * 7);
  arr[0] = state.tick;
  let k = 1;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    arr[k++] = s.x; arr[k++] = s.y; arr[k++] = s.vx; arr[k++] = s.vy; arr[k++] = s.heading; arr[k++] = s.hp; arr[k++] = s.shield;
  }
  const bytes = new Uint8Array(arr.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Run a whole battle headlessly.
 * @param {object} config BattleConfig
 * @param {{onTick?: (state: object, events: any[][]) => void}} [o]
 * @returns {object} BattleResult
 */
export function runToEnd(config, { onTick } = {}) {
  const state = createBattle(config);
  while (!state.ended) {
    const ev = stepBattle(state);
    if (onTick) onTick(state, ev);
  }
  return state.ended;
}
