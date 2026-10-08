// Deterministic mission rules, shared by the worker and authoritative server.
// This module never imports battle.js: the battle loop calls its lifecycle hooks.
import { MAX_TICKS, TICK_RATE } from './constants.js';
import { shipsOfFaction } from './catalog.js';
import { buildBotFleet } from './botFleet.js';
import { fleetCost } from './fleet.js';
import { makeShip } from './sim/ship.js';
import { planDeployment } from './sim/deploy.js';
import { registerShip, MAX_LIVE_SHIPS } from './sim/effects.js';
import { insertGrid } from './sim/spatial.js';
import { buildResult } from './sim/stats.js';

const TYPES = new Set(['escort', 'defense', 'survival', 'waves']);
const OBJECTIVE_HULL = { terran: 'ter_artemis', vorrax: 'vor_matriz', lumen: 'lum_harmonico', ferrix: 'fer_fabricador', astral: 'ast_guardiao' };
const bounded = (v, fallback, min, max) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

/** Called after initial deployment and before team/grid initialization. */
export function initCampaign(state) {
  const raw = state.config.campaign;
  if (!raw || !TYPES.has(raw.type)) { state.campaign = null; return null; }
  const team = raw.team === 1 ? 1 : 0;
  const owner = state.config.players.find((p) => p.team === team);
  if (!owner) throw new Error('campaign needs a player on the objective team');
  const c = state.campaign = {
    type: raw.type, team, wave: 1,
    totalWaves: Math.floor(bounded(raw.waveCount, raw.type === 'escort' ? 1 : 3, 1, 6)),
    durationTicks: Math.floor(bounded(raw.durationTicks, 90 * TICK_RATE, 1, MAX_TICKS)),
    waveIntervalTicks: Math.floor(bounded(raw.waveIntervalTicks, 30 * TICK_RATE, 1, MAX_TICKS)),
    reinforcementFraction: bounded(raw.reinforcementFraction, 0.45, 0.1, 1),
    nextWaveTick: 0, objectiveId: 0, goalX: state.world.w * (team === 0 ? 0.78 : 0.22),
    goalY: state.world.h / 2, completed: false, pending: [],
  };
  c.nextWaveTick = c.waveIntervalTicks;
  if (c.type === 'escort' || c.type === 'defense') {
    const cls = OBJECTIVE_HULL[owner.fleet.faction] || OBJECTIVE_HULL.terran;
    const s = makeShip({ id: state.nextId++, cls, owner: owner.id, team,
      x: state.world.w * (team === 0 ? 0.16 : 0.84), y: c.goalY,
      heading: team === 0 ? 0 : Math.PI, tick: state.tick, slot: state.alive[team].length });
    s.campaignObjective = true;
    s.purchased = false; s.cost = 0; s.role = 'anchor';
    s.hp = s.hpMax = 2400; s.shield = s.shieldMax = s.shieldRegen = 0;
    s.regen = 0; s.dr = 3; s.speed = c.type === 'escort' ? 42 : 0;
    s.mass = 2000; s.ability.id = null;
    // Preserve the weapon schema used by generic targeting heuristics.
    for (const w of s.weapons) w.readyAt = Number.MAX_SAFE_INTEGER;
    c.objectiveId = s.id;
    state.ships.push(s); state.alive[team].push(s.id);
    state.initialShips.push({ id: s.id, cls, owner: owner.id, team, x: s.x, y: s.y, a: s.heading, objective: c.type });
  }
  return c;
}

/** Return true when the mission owns this ship's movement. */
export function campaignDesired(state, ship, out) {
  const c = state.campaign;
  if (!c || ship.id !== c.objectiveId) return false;
  out.dx = c.goalX - ship.x; out.dy = c.goalY - ship.y;
  out.speed = c.type === 'escort' ? ship.speed * ship.mod.speedMul : 0;
  return true;
}

function queueWave(state) {
  const c = state.campaign;
  const enemies = state.config.players.filter((p) => p.team !== c.team).map((p) => {
    const minimum = Math.min(...shipsOfFaction(p.fleet.faction).map((s) => s.cost));
    const budget = Math.max(minimum, Math.floor(fleetCost(p.fleet) * c.reinforcementFraction));
    return { ...p, fleet: buildBotFleet({ budget, faction: p.fleet.faction,
      difficulty: p.ai, personality: p.personality, rng: state.rng,
      enemyFleets: state.config.players.filter((ally) => ally.team === c.team).map((ally) => ally.fleet) }) };
  });
  const placements = planDeployment(enemies, state.world);
  // Reinforcements enter at their rear edge, away from the original front line.
  for (const d of placements) {
    const rear = d.team === 0 ? 0.12 * state.world.w : 0.88 * state.world.w;
    d.x = rear + (d.x - (d.team === 0 ? 0.18 : 0.82) * state.world.w) * 0.45;
    c.pending.push(d);
  }
  c.wave++;
  c.nextWaveTick = state.tick + c.waveIntervalTicks;
  state.events.push(['campaign', 'wave', c.wave, c.totalWaves]);
}

function deployPending(state) {
  const c = state.campaign;
  const available = MAX_LIVE_SHIPS - state.alive[0].length - state.alive[1].length;
  const n = Math.min(available, c.pending.length);
  for (let i = 0; i < n; i++) {
    const d = c.pending[i], tick = state.tick;
    const s = makeShip({ id: state.nextId++, cls: d.cls, owner: d.owner, team: d.team,
      x: d.x, y: d.y, heading: d.a, tick, slot: state.alive[d.team].length });
    const T = state.teams[s.team];
    s.ai.slotDx = s.x - T.anchorX; s.ai.slotDy = s.y - T.anchorY;
    s.ai.nextThink = tick + 1;
    state.ships.push(s); state.alive[s.team].push(s.id); state.alivePurchased[s.team]++;
    state.stats[s.owner].shipsTotal++; state.stats[s.owner].shipsAlive++;
    registerShip(state, s); insertGrid(state.grid, s.id, s.x, s.y);
    state.events.push(['spawn', s.id, s.cls, s.team, s.owner, Math.round(s.x * 10) / 10,
      Math.round(s.y * 10) / 10, Math.round(s.heading * 1000) / 1000, 0]);
  }
  if (n > 0) c.pending.splice(0, n);
}

/** Called after damage/deaths. Reinforcement counts and ordering are seeded-free. */
export function tickCampaign(state) {
  const c = state.campaign;
  if (!c || state.alivePurchased[c.team] === 0) return;
  const objective = c.objectiveId ? state.ships[c.objectiveId - 1] : null;
  if (objective && (!objective.alive || objective.hp <= 0)) return;
  if (c.type === 'escort') {
    const crossed = c.team === 0 ? objective.x >= c.goalX : objective.x <= c.goalX;
    c.completed = crossed && Math.abs(objective.y - c.goalY) <= 120;
  } else if (c.type !== 'waves' && state.tick >= c.durationTicks) c.completed = true;
  if (c.completed) return;
  const cleared = c.type === 'waves' && state.alivePurchased[1 - c.team] === 0;
  if (c.wave < c.totalWaves && c.pending.length === 0 && (state.tick >= c.nextWaveTick || cleared)) queueWave(state);
  deployPending(state);
}

/** Mission results replace elimination checks until the mission resolves. */
export function campaignResult(state) {
  const c = state.campaign;
  if (!c) return null;
  const objective = c.objectiveId ? state.ships[c.objectiveId - 1] : null;
  let winner, reason;
  if (objective && (!objective.alive || objective.hp <= 0)) { winner = 1 - c.team; reason = 'objective_destroyed'; }
  else if (state.alivePurchased[c.team] === 0) { winner = 1 - c.team; reason = 'elimination'; }
  else if (c.completed) { winner = c.team; reason = c.type === 'escort' ? 'escort_complete' : `${c.type}_complete`; }
  else if (c.type === 'waves' && c.wave === c.totalWaves && c.pending.length === 0 && state.alivePurchased[1 - c.team] === 0) {
    winner = c.team; reason = 'waves_complete';
  } else if (state.tick >= state.maxTicks || (c.type === 'escort' && state.tick >= c.durationTicks)) {
    winner = 1 - c.team; reason = 'objective_timeout';
  } else return null;
  return { ...buildResult(state, reason, winner), campaign: campaignSnapshot(state) };
}

/** Small public status; pending placements and authoritative rules stay in the sim. */
export function campaignSnapshot(state) {
  const c = state.campaign;
  if (!c) return null;
  const ship = c.objectiveId ? state.ships[c.objectiveId - 1] : null;
  return {
    type: c.type, team: c.team, wave: c.wave, totalWaves: c.totalWaves,
    objectiveId: c.objectiveId, goalX: Math.round(c.goalX), goalY: Math.round(c.goalY),
    ticksLeft: Math.max(0, c.durationTicks - state.tick),
    objectiveHp: ship ? Math.max(0, Math.round(ship.hp / ship.hpMax * 1000)) : null,
  };
}
