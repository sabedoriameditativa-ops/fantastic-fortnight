// Ship AI (SPEC §3): per-tick targeting bookkeeping, team think (focus
// allocation, anchor, leash, phase), per-ship decide() (utility target
// scoring with hysteresis, retreat, movement mode, ability triggers) and the
// movement actuator computeDesired(). All randomness goes through state.rng.

import { TICK_RATE } from '../constants.js';
import { clamp, noise } from './math.js';
import { queryCircle } from './spatial.js';
import { getTables } from './tables.js';
import { isTargetable, ehp, maxSpeed } from './ship.js';
import { enemiesWithin, alliesWithin, nearestEnemy, nearestEnemyGlobal, orderedShips } from './queries.js';
import { ABILITY_REGISTRY } from './abilities.js';
import { ABILITIES } from '../catalog.js';

const KILL_HORIZON = 20;      // s of my dps needed for killability 0
const COMMIT_TICKS = 2 * TICK_RATE;
const HYSTERESIS = 1.25;
const ADVANCE_MAX_TICKS = 45 * TICK_RATE;
const MAX_RETREAT_TICKS = 10 * TICK_RATE;
const RETREAT_COOLDOWN_TICKS = 15 * TICK_RATE; // after a retreat ends by the time cap, no new retreat for this long
const RETREAT_SHIELD_EXIT = 0.6;               // hulls that cannot regenerate leave retreat once shields are back to this fraction
const ORBIT_MAX_OFFSET = Math.PI / 3;          // fixed-arc divers never aim their orbit more than 60° off the target
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
  };
}

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

function engage(state) {
  state.engaged = true;
  state.engagedTick = state.tick;
  state.events.push(['phase', 'engage']);
}

/** Pick the nearest targetable enemy as the ship's target (fallback). */
function ensureTarget(state, s) {
  let t = nearestEnemy(state, s, Math.max(600, s.maxRange * 1.5));
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

/** Team-level coordination (SPEC §3.3), every 10 ticks, teams staggered. */
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
    let best = null, bestScore = -1, curScore = -1;
    for (let k = 0; k < n; k++) {
      const e = cand8[k];
      const ee = Math.max(1, ehp(e));
      const d = Math.sqrt((e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y));
      const proximity = 1 - clamp(d / R, 0, 0.8);
      let sc = ((e.cost + 10) / ee) * TB.shipEff[s.clsIdx][e.clsIdx] * Math.min(1, ee / Math.max(1, TB.alpha[s.clsIdx])) * proximity;
      sc *= 1 + Math.min(2, TB.rawDps[e.clsIdx] / 60); // dangerous enemies first
      sc *= e.allocDps * 3 < ee ? 1 : 0.3;
      const et = e.ai.targetId > 0 ? ships[e.ai.targetId - 1] : null;
      if (et && et.team === team && et.hp < 0.4 * et.hpMax) sc *= 1.5;
      if (e.id === s.ai.assignedId) curScore = sc;
      if (sc > bestScore) { bestScore = sc; best = e; }
    }
    if (!best) { s.ai.assignedId = 0; continue; }
    if (curScore >= 0 && bestScore < curScore * 1.3) best = ships[s.ai.assignedId - 1];
    s.ai.assignedId = best.id;
    best.allocDps += TB.shipDps[s.clsIdx][best.clsIdx];
  }
  // protectees for escorts/supports: highest-cost ally within 500, else the anchor
  for (let i = 0; i < ours.length; i++) {
    const s = ships[ours[i] - 1];
    if (s.role !== 'escort' && s.role !== 'support') continue;
    alliesWithin(state, s, 500, qbuf);
    let best = null;
    for (let k = 0; k < qbuf.length; k++) {
      const a = qbuf[k];
      if (s.role === 'support' && (a.role === 'anchor' || a.role === 'carrier') && qbuf.length > 1) continue; // supports follow the fighting line
      if (!best || a.cost > best.cost) best = a;
      else if (a.cost === best.cost) { // ties: nearest (grid order is x-sorted and would favour one side)
        const da = (a.x - s.x) * (a.x - s.x) + (a.y - s.y) * (a.y - s.y), db = (best.x - s.x) * (best.x - s.x) + (best.y - s.y) * (best.y - s.y);
        if (da < db) best = a;
      }
    }
    if (!best && qbuf.length > 0) best = qbuf[0];
    s.ai.protecteeId = best ? best.id : (T.anchorId && T.anchorId !== s.id ? T.anchorId : 0);
  }
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
  // or by the time cap, after which a cooldown blocks the next one so a ship that cannot heal does not flee for the
  // rest of the battle in back-to-back episodes. Hulls without regeneration (Lúmen, shielded Terran capitals) can
  // only recover shields, so for them a recovered shield (≥ 60% of cap) is the exit criterion instead.
  const canRetreat = P.retreat && s.role !== 'anchor' && !state.suddenDeath && !s.kamikaze && !s.latch && (s.regen > 0 || s.shieldMax > 0);
  if (canRetreat) {
    const frac = s.hp / s.hpMax, th = RETREAT_AT[s.role] || 0.3;
    if (!s.ai.retreating && frac < th && tick >= s.ai.retreatBlockedUntil) {
      if (alliesWithin(state, s, 600, qbuf).length > 0) { s.ai.retreating = true; s.ai.retreatSince = tick; } // alone = fight
    } else if (s.ai.retreating) {
      const recovered = s.regen > 0 || s.hot ? frac > th + 0.2 : s.shield >= RETREAT_SHIELD_EXIT * s.shieldMax;
      if (tick - s.ai.retreatSince > MAX_RETREAT_TICKS) { s.ai.retreating = false; s.ai.retreatBlockedUntil = tick + RETREAT_COOLDOWN_TICKS; }
      else if (recovered) s.ai.retreating = false;
      else if (alliesWithin(state, s, 600, qbuf).length === 0) s.ai.retreating = false;
    }
  } else s.ai.retreating = false;
  // ---- bile burst dive (larva passive) ----
  if (s.ability.id === 'bile_burst' && !s.kamikaze && s.hp < 0.2 * s.hpMax && t) {
    s.kamikaze = true;
    state.kamikazes.push(s.id);
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
      let holdAt = AREA_HOLD[s.cls] !== undefined ? Math.min(0.7 * R, AREA_HOLD[s.cls]) : 0.7 * R;
      if (ai.holdOverride > 0 && ai.holdOverride < holdAt) holdAt = ai.holdOverride; // e.g. closing in for an EMP storm
      if (d > holdAt) {
        speed = cap;
        if (s.role === 'anchor') { // anchors advance with the team toward the enemy mass, slowly
          speed = cap * 0.6;
          const ex = T.enemyCx - s.x, ey = T.enemyCy - s.y;
          if (ex * ex + ey * ey > 200 * 200) { dx = ex; dy = ey; }
        }
      } else speed = 0;
      break;
    }
    case 'kite': {
      const tx = t.x - s.x, ty = t.y - s.y;
      const d = Math.sqrt(tx * tx + ty * ty) || 1;
      const nx = tx / d, ny = ty / d;
      const px = -ny * ai.orbitSign, py = nx * ai.orbitSign;
      // narrow-arc guns must face the target to fire: such kiters stand in the band and only
      // back away from threats they can actually outrun
      const narrow = s.weapons[0].arcRad < Math.PI / 2;
      if (d < 0.75 * R && (!narrow || t.speed < s.speed * 0.95)) { dx = -nx + px * 0.6; dy = -ny + py * 0.6; speed = cap; }
      else if (d > 0.95 * R) { dx = nx; dy = ny; speed = cap; }
      else if (narrow) { dx = nx; dy = ny; speed = 0; }
      else { dx = px; dy = py; speed = cap * 0.6; }
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
      break;
    }
    case 'backline': {
      const th = nearestEnemy(state, s, 200);
      if (th) { dx = s.x - th.x; dy = s.y - th.y; speed = cap; break; }
      let ex = T.enemyCx - T.lineCx, ey = T.enemyCy - T.lineCy;
      const ed = Math.sqrt(ex * ex + ey * ey) || 1;
      const px = T.lineCx - (ex / ed) * 250, py = T.lineCy - (ey / ed) * 250; // 250 u behind the fighting line (SPEC §3.1)
      dx = px - s.x; dy = py - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      speed = Math.min(cap, d * 2);
      if (d < 6 && t) { dx = t.x - s.x; dy = t.y - s.y; speed = 0; }
      break;
    }
    case 'retreat': {
      dx = ai.px - s.x; dy = ai.py - s.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      speed = d > 40 ? cap : 0;
      if (speed === 0 && t) { dx = t.x - s.x; dy = t.y - s.y; }
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
