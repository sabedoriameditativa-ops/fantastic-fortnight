// World effects shared by abilities and the battle loop: persistent areas
// (acid cloud, singularity), spawned units, teleports, latches, kamikaze.

import { SHIPS, ABILITIES } from '../catalog.js';
import { TICK_RATE, DT } from '../constants.js';
import { queryBox, queryCircle, insertGrid } from './spatial.js';
import { makeShip, isTargetable } from './ship.js';
import { queueDamage, heal } from './damage.js';

export const MAX_LIVE_SHIPS = 800;
const PULSE = TICK_RATE / 2; // area damage ticks every 0.5 s

const buf = [];

/**
 * Create a persistent area. Emits ['area', id, kind, x, y, r, 1].
 * @param {object} o { kind, x, y, r, durationTicks, team, ownerId, dps, trueDamage, pull, acid }
 */
export function createArea(state, o) {
  const a = {
    id: state.nextAreaId++, kind: o.kind, x: o.x, y: o.y, r: o.r, team: o.team, ownerId: o.ownerId,
    dps: o.dps || 0, trueDamage: !!o.trueDamage, pull: o.pull || 0, acid: !!o.acid,
    startTick: state.tick, until: state.tick + o.durationTicks, alive: true,
  };
  state.areas.push(a);
  state.events.push(['area', a.id, a.kind, Math.round(a.x), Math.round(a.y), a.r, 1]);
  return a;
}

/** Advance areas: pull, periodic damage, acid flag; remove expired ones. */
export function tickAreas(state) {
  const areas = state.areas, tick = state.tick, ships = state.ships;
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    if (tick >= a.until) {
      state.events.push(['area', a.id, a.kind, Math.round(a.x), Math.round(a.y), a.r, 0]);
      areas.splice(i, 1); i--;
      continue;
    }
    queryCircle(state.grid, ships, a.x, a.y, a.r, buf, 1 - a.team);
    const pulse = (tick - a.startTick) % PULSE === 0;
    for (let k = 0; k < buf.length; k++) {
      const e = buf[k];
      if (!isTargetable(e, tick)) continue;
      if (a.acid) e.acidUntil = tick + 2;
      if (a.pull > 0 && !e.latch) {
        const dx = a.x - e.x, dy = a.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) {
          const step = Math.min(d, a.pull * DT);
          e.x += (dx / d) * step; e.y += (dy / d) * step;
        }
      }
      if (pulse && a.dps > 0) {
        queueDamage(state, a.ownerId, e.id, a.dps * 0.5, a.trueDamage ? 'true' : 'bio', AREA_OPTS);
      }
    }
  }
}
const AREA_OPTS = { ignoreDr: true, fromAbility: true };

/**
 * Spawn `count` units of `cls` around `caster`, respecting the per-source cap
 * and the global live-ship cap. Emits 'spawn' events.
 * @returns {number} units spawned
 */
export function spawnUnits(state, caster, cls, count, maxAlive, lifetimeSec) {
  const def = SHIPS[cls];
  if (!def) return 0;
  if (!caster.spawnAlive) caster.spawnAlive = {};
  const alive = caster.spawnAlive[cls] || 0;
  let n = Math.min(count, maxAlive - alive);
  const liveTotal = state.alive[0].length + state.alive[1].length;
  n = Math.min(n, MAX_LIVE_SHIPS - liveTotal);
  if (n <= 0) return 0;
  const tick = state.tick;
  const ring = caster.radius + def.radius + 12;
  const spread = Math.PI * 0.8;
  for (let i = 0; i < n; i++) {
    const ang = caster.heading + (n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1));
    let x = caster.x + Math.cos(ang) * ring, y = caster.y + Math.sin(ang) * ring;
    x = Math.min(state.world.w - def.radius, Math.max(def.radius, x));
    y = Math.min(state.world.h - def.radius, Math.max(def.radius, y));
    const id = state.nextId++;
    const s = makeShip({ id, cls, owner: caster.owner, team: caster.team, x, y, heading: caster.heading,
      source: caster.id, lifetimeEnd: tick + Math.round(lifetimeSec * TICK_RATE), tick });
    s.ai.targetId = caster.ai.targetId;
    s.ai.targetSince = tick;
    s.ai.nextThink = tick;
    s.ai.mode = 'approach';
    state.ships.push(s);
    state.alive[s.team].push(id);
    insertGrid(state.grid, id, x, y);
    caster.spawnAlive[cls] = (caster.spawnAlive[cls] || 0) + 1;
    const T = state.teams[s.team];
    s.ai.slotDx = x - T.anchorX; s.ai.slotDy = y - T.anchorY;
    registerShip(state, s);
    state.events.push(['spawn', id, cls, s.team, s.owner, Math.round(x * 10) / 10, Math.round(y * 10) / 10,
      Math.round(s.heading * 1000) / 1000, caster.id]);
  }
  return n;
}

/** Register a ship in the per-ability bookkeeping lists (aura sources, flak curtains, latchers). */
export function registerShip(state, s) {
  if (s.ability.id === 'endless_swarm') state.auraSources.push(s.id);
  else if (s.ability.id === 'flak_curtain') { state.curtains.push(s.id); s.curtainUntil = 0; s.curtainLeft = 0; }
  else if (s.ability.id === 'leech') state.latchers.push(s.id);
}

/**
 * Move a ship instantly to (x, y): clamps inside the arena and pushes it out
 * of other hulls. Latched parasites are shaken off (0.5 s stun).
 */
export function teleportShip(state, s, x, y) {
  const w = state.world.w, h = state.world.h, ships = state.ships;
  x = Math.min(w - s.radius, Math.max(s.radius, x));
  y = Math.min(h - s.radius, Math.max(s.radius, y));
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    queryBox(state.grid, x, y, s.radius + 90, buf);
    for (let i = 0; i < buf.length; i++) {
      const o = ships[buf[i] - 1];
      if (o === s || !o.alive) continue;
      const dx = x - o.x, dy = y - o.y;
      const minD = s.radius + o.radius + 2;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-6) { x += minD; } else { x += (dx / d) * (minD - d); y += (dy / d) * (minD - d); }
      moved = true;
    }
    x = Math.min(w - s.radius, Math.max(s.radius, x));
    y = Math.min(h - s.radius, Math.max(s.radius, y));
    if (!moved) break;
  }
  s.x = x; s.y = y;
  if (s.latchedBy > 0) detachAll(state, s);
}

function detachAll(state, host) {
  const ships = state.ships;
  for (let i = 0; i < ships.length; i++) {
    const o = ships[i];
    if (o.alive && o.latch && o.latch.hostId === host.id) { o.latch = null; o.stunUntil = state.tick + TICK_RATE / 2; }
  }
  host.latchedBy = 0;
}

/** Keep latched parasites glued to their host; drain + heal every 0.5 s; expire. */
export function tickLatches(state) {
  const ships = state.ships, tick = state.tick;
  const p = ABILITIES.leech.params;
  for (let i = 0; i < state.latchers.length; i++) {
    const s = ships[state.latchers[i] - 1];
    if (!s.alive || !s.latch) continue;
    const L = s.latch;
    const host = ships[L.hostId - 1];
    if (!host.alive || tick >= L.until) {
      s.latch = null; host.latchedBy = Math.max(0, host.latchedBy - 1);
      continue;
    }
    s.x = host.x + L.ox; s.y = host.y + L.oy; s.vx = host.vx; s.vy = host.vy;
    s.heading = Math.atan2(-L.oy, -L.ox);
    if ((tick - L.start) % PULSE === 0 && tick > L.start) {
      queueDamage(state, s.id, host.id, p.dps * 0.5, 'bio', LEECH_OPTS);
      heal(state, s.id, s, p.healPerSec * 0.5, 'hull');
    }
  }
}
const LEECH_OPTS = { ignoreDr: true, fromAbility: true };

/** Larvae diving in kamikaze mode detonate on contact with an enemy. */
export function tickKamikaze(state) {
  const ships = state.ships, tick = state.tick;
  for (let i = 0; i < state.kamikazes.length; i++) {
    const s = ships[state.kamikazes[i] - 1];
    if (!s.alive || !s.kamikaze) continue;
    queryCircle(state.grid, ships, s.x, s.y, s.radius + 60, buf, 1 - s.team);
    for (let k = 0; k < buf.length; k++) {
      const e = buf[k];
      if (!isTargetable(e, tick)) continue;
      const dx = e.x - s.x, dy = e.y - s.y;
      const reach = s.radius + e.radius + 6;
      if (dx * dx + dy * dy <= reach * reach) { s.hp = 0; s.killerId = 0; break; } // bile burst fires in the death phase
    }
  }
}
