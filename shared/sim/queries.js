// Reusable spatial/team queries for the AI and abilities. Output arrays are
// reused by the caller (pass your own `out`), results are deterministic.

import { queryCircle } from './spatial.js';
import { isTargetable } from './ship.js';

const scratch = [];

/**
 * Alive ships in this tick's processing order: the ships of `state.firstTeam`
 * (id ascending) then the other team's (id ascending). The first team alternates
 * every tick (see stepBattle) so neither side systematically acts first within a
 * tick (SPEC §8.2 mirror symmetry). Reuses state.orderBuf.
 */
export function orderedShips(state) {
  const ships = state.ships, out = state.orderBuf, ft = state.firstTeam;
  out.length = 0;
  for (let i = 0; i < ships.length; i++) { const s = ships[i]; if (s.alive && s.team === ft) out.push(s); }
  for (let i = 0; i < ships.length; i++) { const s = ships[i]; if (s.alive && s.team !== ft) out.push(s); }
  return out;
}

/** Alive enemies of `s` within r (targetable only unless `all`). */
export function enemiesWithin(state, s, r, out, all = false) {
  queryCircle(state.grid, state.ships, s.x, s.y, r, out, 1 - s.team);
  if (all) return out;
  let n = 0;
  for (let i = 0; i < out.length; i++) if (isTargetable(out[i], state.tick)) out[n++] = out[i];
  out.length = n;
  return out;
}

/** Alive allies of `s` within r, excluding `s` itself. */
export function alliesWithin(state, s, r, out) {
  queryCircle(state.grid, state.ships, s.x, s.y, r, out, s.team);
  let n = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== s) out[n++] = out[i];
  out.length = n;
  return out;
}

/** Count enemies within r with size index >= minSize (targetable). */
export function countEnemies(state, s, r, minSize = 0) {
  enemiesWithin(state, s, r, scratch);
  let n = 0;
  for (let i = 0; i < scratch.length; i++) if (scratch[i].sizeIdx >= minSize) n++;
  return n;
}

/** Nearest targetable enemy within maxR via the grid, else null. */
export function nearestEnemy(state, s, maxR) {
  enemiesWithin(state, s, maxR, scratch);
  let best = null, bd = Infinity;
  for (let i = 0; i < scratch.length; i++) {
    const e = scratch[i];
    const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
    if (d2 < bd) { bd = d2; best = e; }
  }
  return best;
}

/** Nearest alive enemy by full scan of the enemy alive list (fallback; ignores targetability if needed). */
export function nearestEnemyGlobal(state, s, requireTargetable = true) {
  const list = state.alive[1 - s.team], ships = state.ships;
  let best = null, bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    const e = ships[list[i] - 1];
    if (requireTargetable && !isTargetable(e, state.tick)) continue;
    const d2 = (e.x - s.x) * (e.x - s.x) + (e.y - s.y) * (e.y - s.y);
    if (d2 < bd) { bd = d2; best = e; }
  }
  return best;
}

const dpBuf = [];
/**
 * Densest enemy cluster: among enemies within searchR of `s` (up to 24 nearest
 * by grid order), pick the enemy whose clusterR-circle contains the most
 * enemies (ties: most cost, then lowest id).
 * @returns {{x:number,y:number,count:number,medPlus:number,cost:number}} (count 0 if none)
 */
export function densestPoint(state, s, searchR, clusterR, res) {
  enemiesWithin(state, s, searchR, dpBuf);
  res.x = s.x; res.y = s.y; res.count = 0; res.medPlus = 0; res.cost = 0;
  const n = Math.min(dpBuf.length, 24);
  const r2 = clusterR * clusterR;
  let bestD2 = Infinity; // ties (count, cost) go to the center nearest to `s`: grid order is x-sorted and would favour one side
  for (let i = 0; i < n; i++) {
    const c = dpBuf[i];
    let count = 0, med = 0, cost = 0;
    for (let k = 0; k < dpBuf.length; k++) {
      const e = dpBuf[k];
      const d2 = (e.x - c.x) * (e.x - c.x) + (e.y - c.y) * (e.y - c.y);
      if (d2 <= r2) { count++; cost += e.cost; if (e.sizeIdx >= 2) med++; }
    }
    const dc = (c.x - s.x) * (c.x - s.x) + (c.y - s.y) * (c.y - s.y);
    if (count > res.count || (count === res.count && (cost > res.cost || (cost === res.cost && dc < bestD2)))) {
      res.count = count; res.medPlus = med; res.cost = cost; res.x = c.x; res.y = c.y; bestD2 = dc;
    }
  }
  return res;
}

/** Enemy interceptable projectiles in flight toward allies (or self) within r of `s`. */
export function incomingInterceptablesNear(state, s, r) {
  const pool = state.projectiles, ships = state.ships;
  let n = 0;
  const r2 = r * r;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (!p.alive || !p.interceptable || p.team === s.team) continue;
    const t = ships[p.dstId - 1];
    if (!t.alive) continue;
    const d2 = (t.x - s.x) * (t.x - s.x) + (t.y - s.y) * (t.y - s.y);
    if (d2 <= r2) n++;
  }
  return n;
}

/** Deaths of team/faction within r of (x, y) in the last `window` ticks. */
export function recentAllyDeathsNear(state, s, r, window, faction) {
  const list = state.recentDeaths, tick = state.tick;
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    if (tick - d.tick > window) break;
    if (d.team !== s.team || (faction && d.faction !== faction)) continue;
    const dx = d.x - s.x, dy = d.y - s.y;
    if (dx * dx + dy * dy <= r * r) n++;
  }
  return n;
}
