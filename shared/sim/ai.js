// Ship AI (SPEC §3): per-tick targeting bookkeeping, team think (focus
// allocation, anchor, leash, phase), per-ship decide() (utility target
// scoring with hysteresis, retreat, movement mode, ability triggers) and the
// movement actuator computeDesired(). All randomness goes through state.rng.

import { TICK_RATE } from '../constants.js';
import { clamp, noise, angleDiff } from './math.js';
import { queryCircle } from './spatial.js';
import { getTables } from './tables.js';
import { isTargetable, ehp, maxSpeed } from './ship.js';
import { enemiesWithin, alliesWithin, nearestEnemy, nearestEnemyGlobal, orderedShips } from './queries.js';
import { ABILITY_REGISTRY } from './abilities.js';
import { weaponRange, reachRange } from './weapons.js';
import { ABILITIES } from '../catalog.js';

const KILL_HORIZON = 20;      // s of my dps needed for killability 0
const COMMIT_TICKS = 2 * TICK_RATE;
const HYSTERESIS = 1.25;
const ADVANCE_MAX_TICKS = 45 * TICK_RATE;
const MAX_RETREAT_TICKS = 10 * TICK_RATE;
const RETREAT_COOLDOWN_TICKS = 15 * TICK_RATE; // after ANY retreat ends, no new retreat for this long (real hysteresis)
const RETREAT_SHIELD_EXIT = 0.6;               // hulls that cannot regenerate leave retreat once shields are back to this fraction
const RETREAT_SHIELD_ENTRY = 0.3;              // ... and only start one once their shield is nearly gone (a full shield is nothing to recover)
const TINY_RETREAT_MIN_COST = 20;              // cheap tiny ships (larvae, Vetores) are expendable: they never retreat
const BILE_DIVE_HP = 0.5;                      // larvae dive into the nearest enemy (bile burst) below this hull fraction ...
const BILE_DIVE_RANGE = 250;                   // ... when one is this close
const FOCUS_SPILL_SECONDS = 2;                 // team focus: a target whose ehp the allocated dps kills within this time takes no further ships
const HEAVY_ALPHA = 100;                       // a main gun hitting for this much per trigger pull picks fallback targets worth the shot
const ORBIT_MAX_OFFSET = Math.PI / 3;          // fixed-arc divers never aim their orbit more than 60° off the target
const KITE_BACK_IN = 0.75, KITE_BACK_OUT = 0.85, KITE_FAR = 0.95; // kite band: back off below 0.75·R until past 0.85·R; close in beyond 0.95·R
const KITE_AWAY_ANGLE = (2 * Math.PI) / 3;     // a kiter whose heading is this far off the target is in its back-off run (hysteresis without extra state)
const KITE_ARC_MARGIN = Math.PI / 18;          // band strafe keeps the target 10° inside a fixed gun arc (heading lag on the spiral) ...
const KITE_STRAFE_MIN = (7 * Math.PI) / 18;    // ... and only strafes when that angle is ≥ 70° (arc ≥ 80°); narrower guns stand and face the target
const FACE_TURN_MAX = 0.5;                     // a fixed gun turns to take a shot only when the turn costs at most this fraction of its cooldown
const CARRIER_STANDOFF = 250;                  // carriers hold this far behind the front of the fighting line (SPEC §3.1) ...
const CARRIER_RANGE_CAP = 0.9;                 // ... but no farther from the nearest enemy than this fraction of their own gun range ...
const CARRIER_PULL_MAX = 125;                  // ... pulled toward it by at most this much (still well behind the front)
const CARRIER_DEAD_BAND = 40;                  // carriers only move once the backline point drifted this far
const ANCHOR_HOLD_FRAC = 0.85;                 // motherships hold at this fraction of their main weapon's range ...
const ANCHOR_BEHIND_FRONT = 60;                // ... and never advance past the front third of the fighting line (minus this margin)
const HOLD_BACK_IN = 0.45, HOLD_BACK_OUT = 0.6; // turret brawlers back off below 0.45·R until past 0.6·R (dead band against stacking)
const SHORT_PHASE_TICKS = 1.5 * TICK_RATE; // targets phased out for at most this long are kept

/** Scoring weights per role (design battle-ai §2.3, extended for striker/support/carrier). */
export const ROLE_WEIGHTS = {
  diver:   { range: 0.8, dmg: 1.0, kill: 0.9, value: 0.6, threat: 0.3, focus: 0.4, team: 0.6, protect: 0 },
  kiter:   { range: 1.2, dmg: 0.8, kill: 0.7, value: 0.4, threat: 0.9, focus: 0.6, team: 0.8, protect: 0 },
  brawler: { range: 1.2, dmg: 0.8, kill: 0.8, value: 0.5, threat: 0.7, focus: 0.8, team: 1.0, protect: 0 },
  striker: { range: 1.0, dmg: 1.2, kill: 0.8, value: 0.9, threat: 0.3, focus: 0.5, team: 0.6, protect: 0 },
  escort:  { range: 1.0, dmg: 0.6, kill: 0.6, value: 0.2, threat: 1.0, focus: 0.4, team: 0.4, protect: 1.2 },
  support: { range: 1.0, dmg: 0.6, kill: 0.5, value: 0.2, threat: 1.0, focus: 0.4, team: 0.4, protect: 1.2 },
  carrier: { range: 1.3, dmg: 0.7, kill: 0.6, value: 0.3, threat: 1.0, focus: 0.5, team: 0.6, protect: 0 },
  anchor:  { range: 1.3, dmg: 0.9, kill: 0.6, value: 0.7, threat: 0.6, focus: 0.8, team: 1.0, protect: 0 },
};

export const RETREAT_AT = { diver: 0.35, kiter: 0.4, brawler: 0.25, striker: 0.35, escort: 0.45, support: 0.45, carrier: 0.45, anchor: 0 };

const TORPEDO_SHIPS = new Set(['ter_hercules', 'vor_mandibula']);
/** Ships whose signature ability is a self-centered area: they hold closer than 0.7·range so it can land. */
const AREA_HOLD = { lum_ressonante: 0.9 * ABILITIES.dissonant_pulse.params.radius, fer_disruptor: 0.9 * ABILITIES.emp_pulse.params.radius };
const RAILGUN_SHIPS = new Set(['fer_sentinela', 'fer_ariete', 'fer_nucleo']);

/** Create the per-team AI state. */
export function makeTeamState(team) {
  return {
    team, phase: 'advance', cx: 0, cy: 0, enemyCx: 0, enemyCy: 0, anchorId: 0, anchorX: 0, anchorY: 0,
    leash: 350, groupSpeed: 30, hasSupport: false, aliveCost: 0, nonCarriers: 0, lineEngaged: false, order: [],
    lineCx: 0, lineCy: 0, // cost-weighted centroid of the purchased non-carrier ships (the fighting line); carriers hold behind it
    frontDist: Infinity, // distance from the enemy centroid to the front third of the line (purchased non-diver/carrier/anchor ships); Infinity without such ships
  };
}

const frontBuf = [];

// ---------------------------------------------------------------------------
// Per tick bookkeeping
// ---------------------------------------------------------------------------

/**
 * Recompute targetedBy / targetedByTerran / incoming (2 s expected damage) /
 * incomingInterceptables, give target-less ships the nearest enemy (never
 * idle) and detect first contact.
 */
export function recomputeTargeting(state) {
  const ships = state.ships, tick = state.tick, T = getTables();
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s.alive) continue;
    s.targetedBy = 0; s.targetedByTerran = 0; s.incoming = 0; s.incomingInterceptables = 0;
  }
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s.alive) continue;
    let t = s.ai.targetId > 0 ? ships[s.ai.targetId - 1] : null;
    if (!t || !t.alive || t.team === s.team || (!isTargetable(t, tick) && t.untargetableUntil - tick > SHORT_PHASE_TICKS)) {
      t = ensureTarget(state, s);
    }
    if (!t) continue;
    if (!isTargetable(t, tick)) continue; // briefly phased: keep the target, weapons pick other enemies meanwhile
    t.targetedBy++;
    if (s.faction === 'terran') t.targetedByTerran++;
    const dx = t.x - s.x, dy = t.y - s.y;
    const d2 = dx * dx + dy * dy;
    const r = s.maxRange * 1.1;
    if (d2 <= r * r) {
      t.incoming += T.shipDps[s.clsIdx][t.clsIdx] * 2;
      if (!state.engaged) engage(state);
    }
  }
  const pool = state.projectiles;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (!p.alive) continue;
    const t = ships[p.dstId - 1];
    if (!t.alive) continue;
    if (p.hit) t.incoming += p.dmg;
    if (p.interceptable) t.incomingInterceptables++;
  }
}

/** Nearest targetable enemy within `R` with at least `minEhp` of hull+shield, else the nearest of all. */
function nearestEnemyWorth(state, s, R, minEhp) {
  enemiesWithin(state, s, R, qbuf);
  let best = null, bd = Infinity, any = null, ad = Infinity;
  for (let i = 0; i < qbuf.length; i++) {
    const e = qbuf[i];
    const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
    if (d2 < ad) { ad = d2; any = e; }
    if (d2 < bd && ehp(e) >= minEhp) { bd = d2; best = e; }
  }
  return best || any;
}

function engage(state) {
  state.engaged = true;
  state.engagedTick = state.tick;
  state.events.push(['phase', 'engage']);
}

/**
 * Pick the nearest targetable enemy as the ship's target (fallback between thinks). A ship whose main gun hits
 * for HEAVY_ALPHA or more (railguns, the Primordial beam) prefers the nearest enemy worth that shot (ehp of at
 * least half of it) so its next trigger pull does not go into a gnat that happens to be closest.
 */
function ensureTarget(state, s) {
  const R = Math.max(600, s.maxRange * 1.5);
  const w0 = s.weapons[0];
  const alpha = w0.def.damage * w0.def.salvo;
  let t = alpha >= HEAVY_ALPHA ? nearestEnemyWorth(state, s, R, alpha * 0.5) : nearestEnemy(state, s, R);
  if (!t) t = nearestEnemyGlobal(state, s, true);
  s.ai.targetId = t ? t.id : 0;
  s.ai.targetSince = state.tick;
  if (t && (s.ai.mode === 'idleAdvance' || s.ai.mode === 'hold' || s.ai.mode === 'approach' || s.ai.mode === 'orbit' || s.ai.mode === 'kite')) {
    s.ai.mode = s.role === 'diver' ? 'approach' : s.ai.mode === 'idleAdvance' ? 'hold' : s.ai.mode;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Team think
// ---------------------------------------------------------------------------

const qbuf = [];
const cand8 = [];
const candD = [];

/** Team-level coordination (SPEC §3.3), every 10 ticks, both teams on the same tick. */
export function teamThink(state, team) {
  const T = state.teams[team], ships = state.ships, tick = state.tick, TB = getTables();
  const ours = state.alive[team], theirs = state.alive[1 - team];
  // centroids (cost-weighted; spawned units weigh 10)
  let cx = 0, cy = 0, wsum = 0, cost = 0;
  let lx = 0, ly = 0, lw = 0;
  let anchor = null, anchorRank = -1;
  let groupSpeed = Infinity, hasSupport = false, nonCarriers = 0;
  for (let i = 0; i < ours.length; i++) {
    const s = ships[ours[i] - 1];
    const w = s.cost > 0 ? s.cost : 10;
    cx += s.x * w; cy += s.y * w; wsum += w; cost += s.cost;
    const rank = s.role === 'anchor' ? 3 : s.sizeIdx === 4 ? 2 : s.sizeIdx === 3 ? 1 : 0;
    if (rank > 0 && (rank > anchorRank || (rank === anchorRank && s.cost > anchor.cost))) { anchor = s; anchorRank = rank; }
    if (s.role !== 'diver' && s.purchased && s.speed < groupSpeed) groupSpeed = s.speed;
    if (s.role === 'support' || s.role === 'carrier') hasSupport = true;
    if (s.role !== 'carrier' && s.purchased) { nonCarriers++; lx += s.x * w; ly += s.y * w; lw += w; }
  }
  if (wsum > 0) { cx /= wsum; cy /= wsum; }
  // the fighting line excludes carriers: a carrier measuring its backline from a centroid it dominates would retreat without end
  if (lw > 0) { lx /= lw; ly /= lw; } else { lx = cx; ly = cy; }
  if (groupSpeed === Infinity) {
    for (let i = 0; i < ours.length; i++) groupSpeed = Math.min(groupSpeed, ships[ours[i] - 1].speed);
    if (groupSpeed === Infinity) groupSpeed = 30;
  }
  let ex = 0, ey = 0, ew = 0;
  for (let i = 0; i < theirs.length; i++) {
    const s = ships[theirs[i] - 1];
    const w = s.cost > 0 ? s.cost : 10;
    ex += s.x * w; ey += s.y * w; ew += w;
  }
  if (ew > 0) { ex /= ew; ey /= ew; } else { ex = team === 0 ? state.world.w : 0; ey = state.world.h / 2; }
  T.cx = cx; T.cy = cy; T.lineCx = lx; T.lineCy = ly; T.enemyCx = ex; T.enemyCy = ey; T.aliveCost = cost; T.hasSupport = hasSupport; T.nonCarriers = nonCarriers;
  T.groupSpeed = groupSpeed;
  // front of the line: the distance (to the enemy centroid) of the ship at the first third of the line ships sorted
  // nearest-first. Carriers hold behind it and the anchor never advances past it; a cost centroid would be dragged
  // back by the mothership itself and let carriers hide out of range (and the mothership lead the charge).
  frontBuf.length = 0;
  for (let i = 0; i < ours.length; i++) {
    const s = ships[ours[i] - 1];
    if (!s.purchased || s.role === 'diver' || s.role === 'carrier' || s.role === 'anchor') continue;
    frontBuf.push(Math.sqrt((s.x - ex) * (s.x - ex) + (s.y - ey) * (s.y - ey)));
  }
  if (frontBuf.length > 0) { frontBuf.sort((a, b) => a - b); T.frontDist = frontBuf[Math.floor(frontBuf.length / 3)]; }
  else T.frontDist = Infinity;
  // phase
  if (!state.engaged && tick >= ADVANCE_MAX_TICKS) engage(state);
  if (!state.engaged) { // first-contact check through the grid
    for (let i = 0; i < ours.length && !state.engaged; i++) {
      const s = ships[ours[i] - 1];
      queryCircle(state.grid, ships, s.x, s.y, s.maxRange * 1.1, qbuf, 1 - team);
      if (qbuf.length > 0) engage(state);
    }
  }
  T.phase = state.engaged ? 'engage' : 'advance';
  T.leash = T.phase === 'advance' ? 350 : 900;
  // is the line (non-divers) actually trading fire? divers hold formation until then
  let lineEngaged = false;
  for (let i = 0; i < ours.length && !lineEngaged; i++) {
    const s = ships[ours[i] - 1];
    if (s.role === 'diver' || s.ai.targetId <= 0) continue;
    const t = ships[s.ai.targetId - 1];
    const dx = t.x - s.x, dy = t.y - s.y;
    if (dx * dx + dy * dy <= s.maxRange * s.maxRange) lineEngaged = true;
  }
  T.lineEngaged = lineEngaged;
  // anchor: real ship or virtual point advancing with the group
  if (anchor) { T.anchorId = anchor.id; T.anchorX = anchor.x; T.anchorY = anchor.y; }
  else {
    T.anchorId = 0;
    if (T.phase === 'advance') {
      const dx = ex - T.anchorX, dy = ey - T.anchorY;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const step = Math.min(d, groupSpeed * 10 / TICK_RATE);
      T.anchorX += (dx / d) * step; T.anchorY += (dy / d) * step;
    } else { T.anchorX = cx; T.anchorY = cy; }
  }
  // focus allocation
  for (let i = 0; i < theirs.length; i++) ships[theirs[i] - 1].allocDps = 0;
  const order = T.order;
  order.length = 0;
  for (let i = 0; i < ours.length; i++) order.push(ships[ours[i] - 1]);
  order.sort((a, b) => (b.maxRange - a.maxRange) || (a.id - b.id));
  // global top-3 by cost/ehp (fallback when nothing is nearby)
  let g1 = null, g2 = null, g3 = null, v1 = -1, v2 = -1, v3 = -1;
  for (let i = 0; i < theirs.length; i++) {
    const e = ships[theirs[i] - 1];
    if (!isTargetable(e, tick)) continue;
    const v = (e.cost + 10) / Math.max(1, ehp(e));
    if (v > v1) { g3 = g2; v3 = v2; g2 = g1; v2 = v1; g1 = e; v1 = v; }
    else if (v > v2) { g3 = g2; v3 = v2; g2 = e; v2 = v; }
    else if (v > v3) { g3 = e; v3 = v; }
  }
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    const R = s.maxRange * 1.3;
    enemiesWithin(state, s, R, qbuf);
    // keep the 8 nearest
    let n = 0;
    for (let k = 0; k < qbuf.length; k++) {
      const e = qbuf[k];
      const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
      if (n < 8 || d2 < candD[n - 1]) {
        let j = n < 8 ? n : 7;
        while (j > 0 && candD[j - 1] > d2) { candD[j] = candD[j - 1]; cand8[j] = cand8[j - 1]; j--; }
        candD[j] = d2; cand8[j] = e;
        if (n < 8) n++;
      }
    }
    if (n === 0) { if (g1) cand8[n++] = g1; if (g2) cand8[n++] = g2; if (g3) cand8[n++] = g3; }
    // focus-fire limit by target value: a target whose ehp the dps already allocated kills within FOCUS_SPILL_SECONDS
    // is "saturated" and takes no further ships while an unsaturated candidate exists (the damage spills to the
    // next target instead of piling 8-10 ships on one hull)
    let best = null, bestScore = -1, bestSat = null, bestSatScore = -1, curScore = -1, curSat = false;
    for (let k = 0; k < n; k++) {
      const e = cand8[k];
      const ee = Math.max(1, ehp(e));
      const d = Math.sqrt((e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y));
      const proximity = 1 - clamp(d / R, 0, 0.8);
      let sc = ((e.cost + 10) / ee) * TB.shipEff[s.clsIdx][e.clsIdx] * Math.min(1, ee / Math.max(1, TB.alpha[s.clsIdx])) * proximity;
      sc *= 1 + Math.min(2, TB.rawDps[e.clsIdx] / 60); // dangerous enemies first
      const sat = e.allocDps * FOCUS_SPILL_SECONDS >= ee;
      if (sat) sc *= 0.3;
      const et = e.ai.targetId > 0 ? ships[e.ai.targetId - 1] : null;
      if (et && et.team === team && et.hp < 0.4 * et.hpMax) sc *= 1.5;
      if (e.id === s.ai.assignedId) { curScore = sc; curSat = sat; }
      if (!sat) { if (sc > bestScore) { bestScore = sc; best = e; } }
      else if (sc > bestSatScore) { bestSatScore = sc; bestSat = e; }
    }
    if (!best) { best = bestSat; bestScore = bestSatScore; }
    if (!best) { s.ai.assignedId = 0; continue; }
    if (curScore >= 0 && !curSat && bestScore < curScore * 1.3) best = ships[s.ai.assignedId - 1];
    s.ai.assignedId = best.id;
    best.allocDps += TB.shipDps[s.clsIdx][best.clsIdx];
  }
  // protectees: escorts guard the most valuable ally within 500 u; supports follow the fighting line (SPEC §3.3)
  for (let i = 0; i < ours.length; i++) {
    const s = ships[ours[i] - 1];
    if (s.role !== 'escort' && s.role !== 'support') continue;
    let best = null;
    if (s.role === 'support') best = lineProtectee(ships, ours, s, T);
    if (!best) {
      alliesWithin(state, s, 500, qbuf);
      best = pickProtectee(s, qbuf);
    }
    s.ai.protecteeId = best ? best.id : (T.anchorId && T.anchorId !== s.id ? T.anchorId : 0);
  }
}

const LINE_ROLES = { brawler: true, kiter: true, escort: true, striker: true };

/**
 * The medium+ ship of the fighting line (brawler/kiter/escort/striker) closest to the line centroid, searched over
 * the whole team: a support parks behind the middle of the line, where its auras reach the most hulls, instead of
 * chaining on another support (two Véus escorting each other drift away from the battle). Null without such a ship.
 */
function lineProtectee(ships, ours, s, T) {
  let best = null, bd = Infinity, bc = -1;
  for (let k = 0; k < ours.length; k++) {
    const a = ships[ours[k] - 1];
    if (a === s || a.sizeIdx < 2 || !LINE_ROLES[a.role]) continue;
    const d = (a.x - T.lineCx) * (a.x - T.lineCx) + (a.y - T.lineCy) * (a.y - T.lineCy);
    if (d < bd || (d === bd && a.cost > bc)) { best = a; bd = d; bc = a.cost; }
  }
  return best;
}

/** Worth of ally `a` as a protectee of `s`: the most valuable ally; a support never takes another support nor a tiny. */
function protecteeWorth(s, a) {
  if (a === s) return -1;
  if (s.role === 'support' && (a.role === 'support' || a.sizeIdx === 0)) return -1;
  return a.cost;
}

/** Best protectee of `s` among `list` (ties: nearest, as the grid order is x-sorted and would favour one side). */
function pickProtectee(s, list) {
  let best = null, bw = -1, bd = Infinity;
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    const w = protecteeWorth(s, a);
    if (w < 0) continue;
    const d = (a.x - s.x) * (a.x - s.x) + (a.y - s.y) * (a.y - s.y);
    if (w > bw || (w === bw && d < bd)) { best = a; bw = w; bd = d; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Per-ship decide()
// ---------------------------------------------------------------------------

const cands = [];
const candDist = [];
const ctx = { state: null, me: null, target: null, team: null, P: null, incoming: 0, tick: 0, rng: null };

function roleBias(me, t) {
  let b = 0;
  const sz = t.sizeIdx;
  if (me.weapons[0].minTargetIdx > sz) b -= 0.8; // main weapon cannot hit it
  switch (me.role) {
    case 'diver':
      if (me.cls === 'vor_carrapato') { b += sz >= 2 ? 0.6 : -0.4; }
      else { if (sz <= 1) b += 0.5; if (t.role === 'support' || t.role === 'carrier' || t.role === 'kiter') b += 0.5; if (sz >= 4) b -= 0.2; }
      break;
    case 'striker': if (sz >= 3) b += 0.8; else if (sz <= 1) b -= 0.6; break;
    case 'escort': if (sz === 0) b += 0.6; else if (sz === 1) b += 0.3; else if (sz >= 3) b -= 0.2; break;
    case 'kiter': if (RAILGUN_SHIPS.has(me.cls)) { if (sz >= 3) b += 0.4; else if (sz === 0) b -= 0.3; } break;
    case 'brawler':
      if (TORPEDO_SHIPS.has(me.cls) && sz >= 3) b += 0.3;
      else if (me.cls === 'fer_disruptor' && t.shieldMax > 0 && t.shield > 0.5 * t.shieldMax) b += 0.5;
      break;
    case 'carrier': if (RAILGUN_SHIPS.has(me.cls) && sz >= 3) b += 0.4; break;
    default: break;
  }
  return b;
}

function scoreTarget(state, me, t, W, P, TB) {
  const dx = t.x - me.x, dy = t.y - me.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const R = me.maxRange * me.mod.rangeMul;
  const rangeFit = d <= R ? 1 : Math.max(0, 1 - (d - R) / R);
  const e = Math.max(1, ehp(t));
  // overkill-aware: a shot bigger than the target's ehp wastes most of its damage
  const dmgMult = TB.shipEff[me.clsIdx][t.clsIdx] * Math.min(1, e / Math.max(1, TB.alpha[me.clsIdx]));
  const myDps = TB.shipDps[me.clsIdx][t.clsIdx];
  const killability = clamp(1 - e / (KILL_HORIZON * Math.max(1, myDps)), 0, 1);
  const value = t.cost / 100;
  let threat = TB.shipDps[t.clsIdx][me.clsIdx] / Math.max(1, ehp(me));
  if (t.ai.targetId === me.id) threat *= 2;
  else {
    const tt = t.ai.targetId > 0 ? state.ships[t.ai.targetId - 1] : null;
    threat *= tt && tt.team === me.team && (tt.x - me.x) * (tt.x - me.x) + (tt.y - me.y) * (tt.y - me.y) < 400 * 400 ? 1 : 0.5;
  }
  const overkill = P.overkillAvoid ? clamp((t.allocDps * 3 - e) / e, 0, 1) : 0;
  const focus = (Math.min(t.targetedBy, 4) / 4) * (1 - overkill);
  const teamPri = t.id === me.ai.assignedId ? 1 : 0;
  const protect = W.protect > 0 && me.ai.protecteeId && t.ai.targetId === me.ai.protecteeId ? 1 : 0;
  const sticky = t.id === me.ai.targetId ? 0.15 : 0;
  return W.range * rangeFit + W.dmg * dmgMult + W.kill * killability + W.value * value + W.threat * threat
    + W.focus * focus + W.team * P.teamWeight * teamPri + W.protect * protect + sticky + roleBias(me, t);
}

/** Gather ≤ 16 nearest targetable enemies within max(1.5R, 600) ∪ {assigned, current}. */
function gatherCandidates(state, me) {
  const ships = state.ships, tick = state.tick;
  enemiesWithin(state, me, Math.max(600, me.maxRange * 1.5), qbuf);
  let n = 0;
  for (let k = 0; k < qbuf.length; k++) {
    const e = qbuf[k];
    const d2 = (e.x - me.x) * (e.x - me.x) + (e.y - me.y) * (e.y - me.y);
    if (n < 16 || d2 < candDist[n - 1]) {
      let j = n < 16 ? n : 15;
      while (j > 0 && candDist[j - 1] > d2) { candDist[j] = candDist[j - 1]; cands[j] = cands[j - 1]; j--; }
      candDist[j] = d2; cands[j] = e;
      if (n < 16) n++;
    }
  }
  cands.length = n;
  const a = me.ai.assignedId > 0 ? ships[me.ai.assignedId - 1] : null;
  if (a && isTargetable(a, tick) && a.team !== me.team && cands.indexOf(a) < 0) cands.push(a);
  const c = me.ai.targetId > 0 ? ships[me.ai.targetId - 1] : null;
  if (c && c.alive && c.team !== me.team && (isTargetable(c, tick) || c.untargetableUntil - tick <= SHORT_PHASE_TICKS) && cands.indexOf(c) < 0) cands.push(c);
  if (cands.length === 0) { const g = nearestEnemyGlobal(state, me, true); if (g) cands.push(g); }
  return cands;
}

/** One AI decision for ship `s` (target, retreat, movement mode, ability). */
export function decide(state, s) {
  const tick = state.tick, ships = state.ships, rng = state.rng, TB = getTables();
  const P = state.profiles[s.owner];
  const T = state.teams[s.team];
  const W = ROLE_WEIGHTS[s.role] || ROLE_WEIGHTS.brawler;
  s.ai.nextThink = tick + P.thinkInterval;
  if (s.kamikaze) { // a diving larva only ever wants the nearest enemy
    const prey = nearestEnemy(state, s, 600) || nearestEnemyGlobal(state, s, true);
    if (prey && prey.id !== s.ai.targetId) { s.ai.targetId = prey.id; s.ai.targetSince = tick; }
    s.ai.retreating = false;
    s.ai.mode = 'kamikaze';
    return;
  }
  const list = gatherCandidates(state, s);
  // ---- target selection ----
  let cur = s.ai.targetId > 0 ? ships[s.ai.targetId - 1] : null;
  if (cur && (!cur.alive || cur.team === s.team || (!isTargetable(cur, tick) && cur.untargetableUntil - tick > SHORT_PHASE_TICKS))) cur = null;
  let curScore = -Infinity, best = cur, bestScore = -Infinity;
  if (cur) { curScore = scoreTarget(state, s, cur, W, P, TB) + noise(rng, P.scoreNoise); bestScore = curScore; }
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e === cur) continue;
    const sc = scoreTarget(state, s, e, W, P, TB) + noise(rng, P.scoreNoise);
    if (sc > bestScore) { bestScore = sc; best = e; }
  }
  if (P.randomTargetProb > 0 && list.length > 0 && rng.next() < P.randomTargetProb) {
    best = list[Math.floor(rng.next() * list.length)];
    bestScore = Infinity;
  }
  const committed = cur && tick - s.ai.targetSince < COMMIT_TICKS;
  if (best && best !== cur) {
    const switchOk = !cur || bestScore === Infinity || (!committed && bestScore > curScore * HYSTERESIS + 0.05);
    if (switchOk) { s.ai.targetId = best.id; s.ai.targetSince = tick; }
  } else if (!best) s.ai.targetId = 0;
  const t = s.ai.targetId > 0 ? ships[s.ai.targetId - 1] : null;
  // ---- retreat (hysteresis) ----
  // A retreat is a temporary pull-back (SPEC §3.1): it ends when the hull recovered (+0.2), when the ship is alone,
  // or by the 10 s cap; EVERY exit starts a cooldown (no new retreat for 15 s), otherwise a ship whose exit criterion
  // is already true on the next think (full shield, hull still low) would flip in and out of retreat at 5 Hz.
  // Hulls without regeneration (Lúmen, shielded Terran capitals) can only recover shields, so for them a lost shield
  // (< 30% of cap) is the entry condition and a recovered one (≥ 60%) the exit. Spawned units (cost 0) and cheap tiny
  // ships are expendable and never retreat; larvae dive instead (below).
  const expendable = !s.purchased || (s.sizeIdx === 0 && s.cost < TINY_RETREAT_MIN_COST);
  const canRetreat = P.retreat && s.role !== 'anchor' && !state.suddenDeath && !s.latch && !expendable && (s.regen > 0 || s.shieldMax > 0);
  if (canRetreat) {
    const frac = s.hp / s.hpMax, th = RETREAT_AT[s.role] || 0.3;
    const canHeal = s.regen > 0 || !!s.hot;
    if (!s.ai.retreating) {
      if (frac < th && tick >= s.ai.retreatBlockedUntil && (canHeal || s.shield < RETREAT_SHIELD_ENTRY * s.shieldMax)
        && alliesWithin(state, s, 600, qbuf).length > 0) { s.ai.retreating = true; s.ai.retreatSince = tick; } // alone = fight
    } else {
      const recovered = canHeal ? frac > th + 0.2 : s.shield >= RETREAT_SHIELD_EXIT * s.shieldMax;
      if (tick - s.ai.retreatSince > MAX_RETREAT_TICKS || recovered || alliesWithin(state, s, 600, qbuf).length === 0) {
        s.ai.retreating = false;
        s.ai.retreatBlockedUntil = tick + RETREAT_COOLDOWN_TICKS;
      }
    }
  } else s.ai.retreating = false;
  // ---- bile burst dive (larva passive): a hurt larva with an enemy close by rams it instead of fleeing ----
  if (s.ability.id === 'bile_burst' && s.hp < BILE_DIVE_HP * s.hpMax) {
    const prey = nearestEnemy(state, s, BILE_DIVE_RANGE);
    if (prey) {
      s.kamikaze = true;
      s.ai.targetId = prey.id; s.ai.targetSince = tick;
      s.ai.retreating = false;
      s.ai.mode = 'kamikaze';
      state.kamikazes.push(s.id);
      return;
    }
  }
  // ---- movement mode ----
  const ai = s.ai;
  if (s.kamikaze) ai.mode = 'kamikaze';
  else if (ai.retreating) { ai.mode = 'retreat'; safePoint(state, s, T); }
  else if (T.phase === 'advance' && P.formation) ai.mode = 'formation';
  else if (s.role === 'diver' && P.formation && !T.lineEngaged && tick - state.engagedTick < 10 * TICK_RATE
    && !(t && (t.x - s.x) * (t.x - s.x) + (t.y - s.y) * (t.y - s.y) <= 1.3 * 1.3 * s.maxRange * s.maxRange)) ai.mode = 'formation'; // divers wait for the line
  else if (!t) ai.mode = 'idleAdvance';
  else {
    const d = Math.sqrt((t.x - s.x) * (t.x - s.x) + (t.y - s.y) * (t.y - s.y));
    const kiting = P.kiting && !state.suddenDeath;
    switch (s.role) {
      case 'diver': ai.mode = gunDistance(s, t, d) > s.engageRange * s.mod.rangeMul ? 'approach' : 'orbit'; break;
      case 'brawler': ai.mode = 'hold'; break;
      case 'kiter': ai.mode = kiting ? 'kite' : 'hold'; break;
      case 'striker': {
        const w = s.weapons[0];
        ai.mode = w.readyAt <= tick + TICK_RATE || s.stealth ? 'approach' : kiting ? 'kite' : 'hold';
        break;
      }
      case 'escort': ai.mode = protecteeAlive(state, s) ? 'escortSlot' : 'hold'; break;
      case 'support': ai.mode = protecteeAlive(state, s) ? 'escortSlot' : (kiting ? 'kite' : 'hold'); break;
      case 'carrier': ai.mode = T.nonCarriers > 0 && !state.suddenDeath ? 'backline' : (kiting ? 'kite' : 'hold'); break;
      case 'anchor': ai.mode = 'hold'; break;
      default: ai.mode = 'hold';
    }
  }
  // ---- ability trigger ----
  const ab = s.ability;
  const impl = ABILITY_REGISTRY[ab.id];
  if (impl && !impl.passive && tick >= ab.readyAt && ab.pendingAt < 0 && s.stunUntil <= tick) {
    ctx.state = state; ctx.me = s; ctx.target = t; ctx.team = T; ctx.P = P; ctx.incoming = s.incoming; ctx.tick = tick; ctx.rng = rng;
    const u = impl.trigger(ctx);
    if (u >= 1) {
      if (P.abilityMiscastProb > 0 && rng.next() < P.abilityMiscastProb) ab.readyAt = tick + TICK_RATE; // miscast: re-evaluate in 1 s
      else ab.pendingAt = tick + P.abilityDelayTicks; // 0 → cast in this tick's cast phase
    }
  }
}

/** Distance the main weapon measures its range against: edge to edge for contact weapons, else centre to centre. */
function gunDistance(s, t, d) {
  return s.weapons[0].def.contact ? d - s.radius - t.radius : d;
}

/** Longest current range among the ship's guns that shoot ships (point defense excluded); 0 for a PD-only hull. */
function gunRange(s) {
  let R = 0;
  for (let i = 0; i < s.weapons.length; i++) {
    const w = s.weapons[i];
    if (!w.def.pd) R = Math.max(R, weaponRange(s, w));
  }
  return R;
}

function protecteeAlive(state, s) {
  const p = s.ai.protecteeId > 0 ? state.ships[s.ai.protecteeId - 1] : null;
  return !!(p && p.alive);
}

/** Retreat destination: nearest support/carrier ally, else a rear point behind the anchor. */
function safePoint(state, s, T) {
  const ships = state.ships, ours = state.alive[s.team];
  let best = null, bd = Infinity;
  for (let i = 0; i < ours.length; i++) {
    const a = ships[ours[i] - 1];
    if (a === s || (a.role !== 'support' && a.role !== 'carrier')) continue;
    const d2 = (a.x - s.x) * (a.x - s.x) + (a.y - s.y) * (a.y - s.y);
    if (d2 < bd) { bd = d2; best = a; }
  }
  if (best) { s.ai.px = best.x; s.ai.py = best.y; return; }
  let dx = T.anchorX - T.enemyCx, dy = T.anchorY - T.enemyCy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) { dx = s.team === 0 ? -1 : 1; dy = 0; } else { dx /= d; dy /= d; }
  s.ai.px = T.anchorX + dx * 200; s.ai.py = T.anchorY + dy * 200;
}

/** Execute scheduled ability casts whose delay elapsed (re-validating the trigger). */
export function executePendingCasts(state) {
  const ships = state.ships, tick = state.tick;
  const ord = orderedShips(state); // this tick's team order (alternates per tick)
  for (let i = 0; i < ord.length; i++) {
    const s = ord[i];
    if (!s.alive) continue;
    const ab = s.ability;
    if (ab.pendingAt < 0 || ab.pendingAt > tick) continue;
    const impl = ABILITY_REGISTRY[ab.id];
    ab.pendingAt = -1;
    if (!impl || s.stunUntil > tick) continue;
    const P = state.profiles[s.owner];
    ctx.state = state; ctx.me = s; ctx.target = s.ai.targetId > 0 ? ships[s.ai.targetId - 1] : null;
    ctx.team = state.teams[s.team]; ctx.P = P; ctx.incoming = s.incoming; ctx.tick = tick; ctx.rng = state.rng;
    if (ctx.target && !ctx.target.alive) ctx.target = null;
    if (impl.trigger(ctx) < 1) continue; // condition vanished: no cooldown spent
    impl.cast(ctx);
    ab.readyAt = tick + Math.max(1, Math.round(ABILITIES[ab.id].cooldown * TICK_RATE));
  }
}

// ---------------------------------------------------------------------------
// Movement actuator
// ---------------------------------------------------------------------------

/**
 * A ship with a fixed-arc main gun that is ready while an enemy is within its reach turns to face that enemy for
 * the shot (the weapons phase of this tick fires once the arc is met), provided the turn costs at most half the
 * gun's cooldown (a 60° laser firing every second is not worth a 150° about-face while fleeing). Writes the
 * direction to `out.dx/dy` and returns true; false when the gun is a turret, not ready, nothing is in reach, or
 * the enemy is already inside the arc (the gun fires this tick anyway, the ship can keep moving).
 */
function faceForShot(state, s, t, tick, out) {
  const w0 = s.weapons[0];
  if (w0.arcRad >= Math.PI || w0.charging || w0.readyAt > tick) return false;
  let foe = t && t.alive && isTargetable(t, tick) && t.sizeIdx >= w0.minTargetIdx
    && (t.x - s.x) * (t.x - s.x) + (t.y - s.y) * (t.y - s.y) <= reachRange(s, w0, t) ** 2 ? t : null;
  if (!foe) foe = nearestEnemy(state, s, weaponRange(s, w0));
  if (!foe) return false;
  const dx = foe.x - s.x, dy = foe.y - s.y;
  const off = Math.abs(angleDiff(Math.atan2(dy, dx), s.heading)) - w0.arcRad;
  if (off <= 0) return false;
  if (off / (s.turnRate * s.mod.turnMul) > FACE_TURN_MAX * w0.cdTicks / TICK_RATE) return false;
  out.dx = dx; out.dy = dy;
  return true;
}

/**
 * Can a kiter with a fixed gun afford to run from `t`? Only when the ground it gains over one cooldown beats what
 * the threat recovers while the kiter turns around to shoot and back (turret kiters always can).
 */
function canBackOff(s, t) {
  const w0 = s.weapons[0];
  if (w0.arcRad >= Math.PI) return true;
  const turnSec = 2 * (Math.PI - w0.arcRad) / (s.turnRate * s.mod.turnMul);
  return (s.speed - t.speed) * (w0.cdTicks / TICK_RATE) > t.speed * turnSec;
}

/**
 * Translate the ship's intent into a desired direction and speed for this tick.
 * @param {object} state
 * @param {object} s
 * @param {{dx:number,dy:number,speed:number}} out
 */
export function computeDesired(state, s, out) {
  const ships = state.ships, tick = state.tick, T = state.teams[s.team];
  const cap = maxSpeed(s, tick);
  const ai = s.ai;
  let t = ai.targetId > 0 ? ships[ai.targetId - 1] : null;
  if (t && !t.alive) t = null;
  let mode = ai.mode;
  if (cap <= 0) { if (t) { out.dx = t.x - s.x; out.dy = t.y - s.y; } out.speed = 0; return; }
  if (!t && (mode === 'approach' || mode === 'hold' || mode === 'kite' || mode === 'orbit' || mode === 'kamikaze')) mode = 'idleAdvance';
  const R = s.engageRange * s.mod.rangeMul; // positioning uses the dps-weighted range
  let dx = 0, dy = 0, speed = 0;
  switch (mode) {
    case 'approach': case 'kamikaze': {
      dx = t.x - s.x; dy = t.y - s.y; speed = cap; break;
    }
    case 'hold': {
      dx = t.x - s.x; dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (s.role === 'anchor') {
        // motherships hold at 0.85× their main weapon's range (not the dps-weighted engage range, which the short
        // secondary guns pull in) and advance slowly toward the enemy mass only while the fighting line is ahead
        // (with no line left the mothership is the line and advances on its own)
        let holdAt = Math.max(0.7 * R, ANCHOR_HOLD_FRAC * weaponRange(s, s.weapons[0]));
        // an ability asked to close in (EMP storm on a cluster just out of reach): that is a deliberate
        // push, so it overrides both the stand-off and the "stay behind the front" rule
        const closingIn = ai.holdOverride > 0 && ai.holdOverride < holdAt;
        if (closingIn) holdAt = ai.holdOverride;
        const ex = T.enemyCx - s.x, ey = T.enemyCy - s.y;
        const ed = Math.sqrt(ex * ex + ey * ey);
        const behindFront = T.frontDist === Infinity || ed > T.frontDist + ANCHOR_BEHIND_FRONT;
        if (d > holdAt && ed > 200 && (behindFront || closingIn)) { dx = closingIn ? dx : ex; dy = closingIn ? dy : ey; speed = cap * 0.6; }
        else speed = 0;
        break;
      }
      let holdAt = AREA_HOLD[s.cls] !== undefined ? Math.min(0.7 * R, AREA_HOLD[s.cls]) : 0.7 * R;
      if (ai.holdOverride > 0 && ai.holdOverride < holdAt) holdAt = ai.holdOverride; // e.g. closing in for an EMP storm
      if (d > holdAt) { speed = cap; break; }
      // turret brawlers keep a stand-off instead of driving through their target (and each other): back off below
      // 0.45·R until past 0.6·R (scaled with a tighter area hold), the heading being the memory of the run;
      // fixed-gun brawlers would lose their shot, so they only stop
      const backIn = holdAt * (HOLD_BACK_IN / 0.7), backOut = holdAt * (HOLD_BACK_OUT / 0.7);
      if (s.weapons[0].arcRad >= Math.PI && ai.holdOverride <= 0 && !state.suddenDeath
        && (d < backIn || (d < backOut && Math.abs(angleDiff(Math.atan2(dy, dx), s.heading)) > KITE_AWAY_ANGLE))) {
        dx = -dx; dy = -dy; speed = cap * 0.6;
      } else speed = 0;
      break;
    }
    case 'kite': {
      const tx = t.x - s.x, ty = t.y - s.y;
      const d = Math.sqrt(tx * tx + ty * ty) || 1;
      const nx = tx / d, ny = ty / d;
      const px = -ny * ai.orbitSign, py = nx * ai.orbitSign;
      const w0 = s.weapons[0];
      // a fixed gun (arc < 180°) must face the target to fire: such a kiter runs only from a threat it outruns by
      // enough to pay for turning around to shoot (canBackOff), and turns for the shot whenever the gun is ready
      // with an enemy in reach; the back-off has a dead band (0.75·R → 0.85·R) with the heading as its memory
      const backing = (d < KITE_BACK_IN * R
        || (d < KITE_BACK_OUT * R && Math.abs(angleDiff(Math.atan2(ty, tx), s.heading)) > KITE_AWAY_ANGLE)) && canBackOff(s, t);
      if (faceForShot(state, s, t, tick, out)) { dx = out.dx; dy = out.dy; speed = 0; }
      else if (backing) { dx = -nx + px * 0.6; dy = -ny + py * 0.6; speed = cap; }
      else if (d > KITE_FAR * R) { dx = nx; dy = ny; speed = cap; }
      else {
        // in the band: strafe for evasion with the target kept inside the gun arc (pure tangent for turrets, a
        // spiral 10° inside the arc for fixed guns); a gun too narrow for a near-tangential strafe would be driven
        // straight at the target, so its ship stands and faces it instead
        const a = w0.arcRad >= Math.PI ? Math.PI / 2 : w0.arcRad - KITE_ARC_MARGIN;
        if (a >= KITE_STRAFE_MIN) {
          const ca = Math.cos(a), sa = Math.sin(a) * ai.orbitSign;
          dx = nx * ca - ny * sa; dy = ny * ca + nx * sa; speed = cap * 0.6;
        } else { dx = nx; dy = ny; speed = 0; }
      }
      break;
    }
    case 'orbit': {
      const tx = t.x - s.x, ty = t.y - s.y;
      const d = Math.sqrt(tx * tx + ty * ty) || 1;
      const nx = tx / d, ny = ty / d;
      const w0 = s.weapons[0];
      const outside = gunDistance(s, t, d) > 0.6 * R;
      if (w0.arcRad >= Math.PI) { // turret: free strafing run, drifting out again inside the ring
        const k = outside ? 0.8 : -0.3;
        dx = -ny * ai.orbitSign + nx * k; dy = nx * ai.orbitSign + ny * k; speed = cap;
      } else {
        // fixed gun: the heading follows the steering direction, so the orbit is a spiral whose angle off the target
        // stays inside the weapon arc (the target is then within arc whenever the ship is roughly on course). Inside
        // the ring the ship keeps facing the target and only creeps in; separation pushes it back out.
        const a = Math.min(0.7 * w0.arcRad, ORBIT_MAX_OFFSET);
        const ca = Math.cos(a), sa = Math.sin(a) * ai.orbitSign;
        dx = nx * ca - ny * sa; dy = ny * ca + nx * sa;
        speed = outside ? cap : cap * 0.35;
      }
      break;
    }
    case 'escortSlot': {
      const a = ships[ai.protecteeId - 1];
      if (!a || !a.alive) { if (t) { dx = t.x - s.x; dy = t.y - s.y; speed = cap; } break; }
      let ex = T.enemyCx - a.x, ey = T.enemyCy - a.y;
      const ed = Math.sqrt(ex * ex + ey * ey) || 1;
      ex /= ed; ey /= ed;
      const front = s.role === 'escort' ? 1 : -1;
      const off = a.radius + s.radius + 60;
      const side = ai.orbitSign * (s.radius + 16); // team-local, mirror-symmetric side (see makeShip)
      const sx = a.x + ex * off * front - ey * side, sy = a.y + ey * off * front + ex * side;
      dx = sx - s.x; dy = sy - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      speed = Math.min(cap, d * 2);
      if (d < 6 && t) { dx = t.x - s.x; dy = t.y - s.y; speed = 0; }
      else if (d < 80 && faceForShot(state, s, t, tick, out)) { dx = out.dx; dy = out.dy; speed = 0; } // near the slot: take the shot, then catch up
      break;
    }
    case 'backline': {
      const th = nearestEnemy(state, s, 200);
      if (th) { dx = s.x - th.x; dy = s.y - th.y; speed = cap; break; }
      // the backline point lies on the enemy-centroid → line-centroid axis, CARRIER_STANDOFF behind the front of
      // the line (SPEC §3.1); when that leaves the nearest enemy beyond 0.9× the carrier's gun range AND the carrier
      // outranges that enemy, the point is pulled toward it (so the guns fire from safety) by at most
      // CARRIER_PULL_MAX, i.e. always well behind the front; a carrier a line ship outguns (a Matriz's 300 u spores
      // against 450 u autocannons) or one with point defense only stays put, its worth being what it launches; a
      // dead band keeps the carrier from chasing every wobble of the point
      let ux = T.lineCx - T.enemyCx, uy = T.lineCy - T.enemyCy;
      const ud = Math.sqrt(ux * ux + uy * uy);
      if (ud < 1) { ux = s.team === 0 ? -1 : 1; uy = 0; } else { ux /= ud; uy /= ud; }
      const front = T.frontDist < Infinity ? T.frontDist : ud;
      let px = T.enemyCx + ux * (front + CARRIER_STANDOFF), py = T.enemyCy + uy * (front + CARRIER_STANDOFF);
      const Rw = CARRIER_RANGE_CAP * gunRange(s);
      const e = Rw > 0 ? nearestEnemy(state, s, 3 * Rw) : null;
      if (e && e.maxRange * e.mod.rangeMul < Rw) {
        const ex = e.x - px, ey = e.y - py;
        const de = Math.sqrt(ex * ex + ey * ey) || 1;
        const pull = Math.min(de - Rw, CARRIER_PULL_MAX);
        if (pull > 0) { px += (ex / de) * pull; py += (ey / de) * pull; }
      }
      dx = px - s.x; dy = py - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const moving = s.vx * s.vx + s.vy * s.vy > 15 * 15;
      if (d > CARRIER_DEAD_BAND || (moving && d > 10)) speed = Math.min(cap, d * 1.5);
      else { speed = 0; if (t) { dx = t.x - s.x; dy = t.y - s.y; } }
      break;
    }
    case 'retreat': {
      dx = ai.px - s.x; dy = ai.py - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      speed = d > 40 ? cap : 0;
      if (speed === 0 && t) { dx = t.x - s.x; dy = t.y - s.y; }
      else if (faceForShot(state, s, t, tick, out)) { dx = out.dx; dy = out.dy; speed = 0; } // a retreating ship keeps shooting (design battle-ai §2.4)
      break;
    }
    case 'formation': {
      if (T.anchorId === s.id) {
        dx = T.enemyCx - s.x; dy = T.enemyCy - s.y; speed = Math.min(cap, T.groupSpeed);
      } else {
        const sx = T.anchorX + ai.slotDx, sy = T.anchorY + ai.slotDy;
        dx = sx - s.x; dy = sy - s.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        speed = Math.min(cap, d * 2);
        if (d < 4) { dx = T.enemyCx - s.x; dy = T.enemyCy - s.y; speed = 0; }
      }
      break;
    }
    default: { // idleAdvance
      dx = T.enemyCx - s.x; dy = T.enemyCy - s.y; speed = cap * 0.5;
      if (dx * dx + dy * dy < 100 * 100 && t) { dx = t.x - s.x; dy = t.y - s.y; speed = 0; }
    }
  }
  // leash toward the anchor for non-divers
  if (s.role !== 'diver' && mode !== 'formation' && mode !== 'retreat' && T.anchorId !== s.id) {
    const ax = T.anchorX - s.x, ay = T.anchorY - s.y;
    const ad2 = ax * ax + ay * ay;
    if (ad2 > T.leash * T.leash) {
      const ad = Math.sqrt(ad2);
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      dx = dx / l + (ax / ad) * 0.8; dy = dy / l + (ay / ad) * 0.8;
      speed = Math.max(speed, cap * 0.5);
    }
  }
  out.dx = dx; out.dy = dy; out.speed = speed;
}
