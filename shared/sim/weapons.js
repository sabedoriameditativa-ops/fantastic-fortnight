// Weapons (SPEC §2.2): firing conditions, hit roll at fire time, hitscan
// (incl. chain beams and telegraphed charge), projectiles (tracking, miss
// offsets, AoE, interceptable by point defense / flak curtain), piercing shot.

import { COMBAT, ABILITIES, SIZE_CLASS } from '../catalog.js';
import { TICK_RATE, DT } from '../constants.js';
import { angleDiff, clamp, DEG } from './math.js';
import { queryCircle } from './spatial.js';
import { getTables } from './tables.js';
import { isTargetable } from './ship.js';
import { queueDamage } from './damage.js';
import { orderedShips } from './queries.js';

const buf = [];
const coneBuf = [];
const MAX_RADIUS = SIZE_CLASS.mothership.radius;

/** Effective range of a weapon right now (buffs included). */
export function weaponRange(s, w) {
  return w.def.range * w.mod.rangeMul * s.mod.rangeMul + w.mod.rangeAdd;
}

/** Hit probability (SPEC §2.2) of weapon `w` of `s` against `t` at distance `d`. */
export function hitChance(s, w, t, d) {
  if (w.def.contact) return 1;
  const T = getTables();
  // additive mods (faction passive is baked into the table, fast target, evasion), then the range factor
  let p = T.acc[s.clsIdx][w.idx][t.clsIdx];
  const sp = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
  if (sp > COMBAT.fastTargetSpeed) p -= COMBAT.fastTargetPenalty;
  p -= t.mod.evasion;
  const R = weaponRange(s, w);
  const start = COMBAT.rangeFalloffStart * R;
  if (d > start && R > start) {
    const f = clamp((d - start) / (R - start), 0, 1);
    p *= 1 - (1 - COMBAT.rangeFalloffMin) * f;
  }
  return clamp(p, COMBAT.minHitChance, COMBAT.maxHitChance);
}

/**
 * Distance at which weapon `w` of `s` reaches ship `t`, centre to centre.
 * Contact weapons (mandibles) measure their range edge to edge, so the reach
 * grows with both hull radii; every other weapon measures centre to centre.
 */
export function reachRange(s, w, t) {
  const R = weaponRange(s, w);
  return w.def.contact ? R + s.radius + t.radius : R;
}

/** Can weapon `w` of `s` shoot at ship `t` right now (alive, targetable, size, range, arc)? */
export function canShoot(s, w, t, tick) {
  if (!t || t.team === s.team || !isTargetable(t, tick)) return false;
  if (t.sizeIdx < w.minTargetIdx) return false;
  const dx = t.x - s.x, dy = t.y - s.y;
  const R = reachRange(s, w, t);
  if (dx * dx + dy * dy > R * R) return false;
  if (w.arcRad < Math.PI) {
    const bearing = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(bearing, s.heading)) > w.arcRad) return false;
  }
  return true;
}

/**
 * Secondary target for a weapon whose ship target is not shootable: the enemy
 * in range/arc with the best expected effective damage per shot
 * (min(ehp, damage × fraction) × accuracy), ties broken by distance.
 */
function bestShootable(state, s, w) {
  const R = weaponRange(s, w) + (w.def.contact ? s.radius + MAX_RADIUS : 0); // contact: edge-to-edge reach (canShoot filters exactly)
  const T = getTables();
  const acc = T.acc[s.clsIdx][w.idx], frac = T.frac[s.clsIdx][w.idx];
  queryCircle(state.grid, state.ships, s.x, s.y, R, buf, 1 - s.team);
  let best = null, bestV = -1, bestD = Infinity;
  for (let i = 0; i < buf.length; i++) {
    const t = buf[i];
    if (!canShoot(s, w, t, state.tick)) continue;
    const v = Math.min(t.hp + t.shield + t.extraShield, w.def.damage * frac[t.clsIdx]) * acc[t.clsIdx];
    const d2 = (t.x - s.x) * (t.x - s.x) + (t.y - s.y) * (t.y - s.y);
    if (v > bestV || (v === bestV && d2 < bestD)) { bestV = v; bestD = d2; best = t; }
  }
  return best;
}

/** Fire every ready weapon of every alive ship (id order). */
export function fireWeapons(state) {
  const ships = state.ships, tick = state.tick;
  const ord = orderedShips(state); // this tick's team order (alternates per tick)
  for (let i = 0; i < ord.length; i++) {
    const s = ord[i];
    if (!s.alive || s.stunUntil > tick) continue;
    const target = s.ai.targetId > 0 ? ships[s.ai.targetId - 1] : null;
    const ws = s.weapons;
    for (let k = 0; k < ws.length; k++) {
      const w = ws[k];
      if (w.charging) { continueCharge(state, s, w); continue; }
      if (tick < w.readyAt) continue;
      if (w.def.pd && tryPointDefense(state, s, w)) continue;
      let t = target && canShoot(s, w, target, tick) ? target : null;
      if (!t) t = bestShootable(state, s, w);
      if (!t) continue;
      if (w.def.charge) {
        w.charging = t.id;
        w.chargeUntil = tick + Math.round(w.def.charge * TICK_RATE);
        state.events.push(['charge', s.id, w.idx, w.def.charge]);
        continue;
      }
      fireAt(state, s, w, t);
    }
  }
}

function continueCharge(state, s, w) {
  const tick = state.tick;
  const t = state.ships[w.charging - 1];
  if (!canShoot(s, w, t, tick) && !(t && t.alive && t.team !== s.team && t.sizeIdx >= w.minTargetIdx && withinLoose(s, w, t))) {
    w.charging = 0; w.readyAt = tick + 10; // cancelled: short re-aim delay
    return;
  }
  if (tick >= w.chargeUntil) {
    w.charging = 0;
    fireAt(state, s, w, t);
  }
}

function withinLoose(s, w, t) {
  const dx = t.x - s.x, dy = t.y - s.y;
  const R = weaponRange(s, w) * 1.1;
  if (dx * dx + dy * dy > R * R) return false;
  if (w.arcRad < Math.PI && Math.abs(angleDiff(Math.atan2(dy, dx), s.heading)) > w.arcRad * 1.2) return false;
  return true;
}

function setCooldown(state, s, w) {
  const cd = Math.max(1, Math.round((w.cdTicks * w.mod.cdMul * s.mod.cdMul) / s.mod.fireRateMul));
  w.readyAt = state.tick + cd;
}

/** Resolve one trigger pull of weapon `w` at target `t` (all salvo shots this tick). */
export function fireAt(state, s, w, t) {
  const tick = state.tick, rng = state.rng, ev = state.events;
  const d = Math.sqrt((t.x - s.x) * (t.x - s.x) + (t.y - s.y) * (t.y - s.y));
  const salvo = Math.max(1, Math.round(w.def.salvo * w.mod.salvoMul));
  let dmg = w.def.damage * s.mod.dmgMul * w.mod.dmgMul;
  if (w.def.type === 'torpedo' && s.stealthDmgMul > 1) { dmg *= s.stealthDmgMul; s.stealthDmgMul = 1; }
  if (s.pierceReady && w.def.type === 'railgun') {
    s.pierceReady = false;
    firePiercing(state, s, w, t, dmg * ABILITIES.piercing_shot.params.damageMul);
  } else {
    const p = hitChance(s, w, t, d);
    for (let k = 0; k < salvo; k++) {
      const hit = w.def.contact ? true : rng.next() < p;
      if (w.def.speed === 0) {
        ev.push(['shot', s.id, t.id, w.idx, hit ? 1 : 0]);
        if (hit) {
          queueDamage(state, s.id, t.id, dmg, w.def.type, w.def.dot ? { dot: w.def.dot } : null);
          if (w.def.chain) chainHits(state, s, w, t);
        }
      } else {
        spawnProjectile(state, s, w, t, hit, dmg, k);
      }
    }
  }
  if (s.stealth) { s.stealth = false; s.untargetableUntil = tick; }
  setCooldown(state, s, w);
}

function chainHits(state, s, w, t) {
  const c = w.def.chain;
  queryCircle(state.grid, state.ships, t.x, t.y, c.radius, coneBuf, 1 - s.team);
  const cands = [];
  for (let i = 0; i < coneBuf.length; i++) {
    const e = coneBuf[i];
    if (e === t || !isTargetable(e, state.tick)) continue;
    cands.push(e);
  }
  cands.sort((a, b) => {
    const da = (a.x - t.x) * (a.x - t.x) + (a.y - t.y) * (a.y - t.y);
    const db = (b.x - t.x) * (b.x - t.x) + (b.y - t.y) * (b.y - t.y);
    return da - db || a.id - b.id;
  });
  for (let i = 0; i < cands.length && i < c.targets; i++) {
    const e = cands[i];
    state.events.push(['shot', s.id, e.id, w.idx, 1]);
    queueDamage(state, s.id, e.id, c.damage * s.mod.dmgMul * w.mod.dmgMul, w.def.type, null);
  }
}

function firePiercing(state, s, w, t, dmg) {
  const p = ABILITIES.piercing_shot.params;
  const R = weaponRange(s, w);
  const aim = Math.atan2(t.y - s.y, t.x - s.x);
  const half = p.coneDeg * DEG;
  queryCircle(state.grid, state.ships, s.x, s.y, R, coneBuf, 1 - s.team);
  const picked = [];
  for (let i = 0; i < coneBuf.length; i++) {
    const e = coneBuf[i];
    if (e === t) continue;
    if (!isTargetable(e, state.tick) || e.sizeIdx < w.minTargetIdx) continue;
    if (Math.abs(angleDiff(Math.atan2(e.y - s.y, e.x - s.x), aim)) > half) continue;
    picked.push(e);
  }
  picked.sort((a, b) => {
    const da = (a.x - s.x) * (a.x - s.x) + (a.y - s.y) * (a.y - s.y);
    const db = (b.x - s.x) * (b.x - s.x) + (b.y - s.y) * (b.y - s.y);
    return da - db || a.id - b.id;
  });
  const d = Math.sqrt((t.x - s.x) * (t.x - s.x) + (t.y - s.y) * (t.y - s.y));
  const hit = state.rng.next() < hitChance(s, w, t, d);
  spawnProjectile(state, s, w, t, hit, dmg, 0);
  for (let i = 0; i < picked.length && i < p.maxTargets - 1; i++) spawnProjectile(state, s, w, picked[i], true, dmg, i + 1);
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

function allocProjectile(state) {
  const pool = state.projectiles;
  let p;
  if (state.projFree.length > 0) p = pool[state.projFree.pop()];
  else {
    p = { slot: pool.length, id: 0, alive: false, srcId: 0, dstId: 0, team: 0, weaponIdx: 0, type: '', dmg: 0, x: 0, y: 0,
      speed: 0, hit: false, aoe: 0, dot: null, interceptable: false, offX: 0, offY: 0, aimX: 0, aimY: 0, ttl: 0, claimedTick: -1, spawnTick: 0 };
    pool.push(p);
  }
  return p;
}

/** Launch a projectile from `s` toward `t` with a pre-rolled outcome. */
export function spawnProjectile(state, s, w, t, hit, dmg, k) {
  const p = allocProjectile(state);
  p.id = state.nextProjId++;
  p.alive = true; p.srcId = s.id; p.dstId = t.id; p.team = s.team; p.weaponIdx = w.idx; p.type = w.def.type;
  p.dmg = dmg; p.x = s.x; p.y = s.y; p.speed = w.def.speed; p.hit = hit; p.aoe = w.def.aoe; p.dot = w.def.dot;
  p.interceptable = w.def.interceptable; p.claimedTick = -1; p.spawnTick = state.tick;
  if (hit) { p.offX = 0; p.offY = 0; }
  else { // miss: fly to an offset point beside the target and fizzle there (outside the splash radius for AoE)
    const dx = t.x - s.x, dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const side = ((p.id + k) & 1) ? 1 : -1;
    const off = t.radius + Math.max(24, w.def.aoe + 8) + (p.id % 3) * 10;
    p.offX = (-dy / d) * off * side; p.offY = (dx / d) * off * side;
  }
  p.aimX = t.x + p.offX; p.aimY = t.y + p.offY;
  p.ttl = Math.ceil((w.def.range / w.def.speed) * 2.5 * TICK_RATE) + TICK_RATE;
  state.projAlive++;
  state.events.push(['proj', p.id, s.id, t.id, w.idx, Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10]);
  return p;
}

function endProjectile(state, p, outcome) {
  p.alive = false;
  state.projAlive--;
  state.projFree.push(p.slot);
  state.events.push(['pend', p.id, outcome, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
}

/** Destroy a projectile by interception (outcome 2). */
export function interceptProjectile(state, p) {
  endProjectile(state, p, 2);
}

/** Advance every projectile one tick, resolving impacts into the damage queue. */
export function advanceProjectiles(state) {
  const pool = state.projectiles, ships = state.ships;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (!p.alive) continue;
    const t = ships[p.dstId - 1];
    if (t.alive) { p.aimX = t.x + p.offX; p.aimY = t.y + p.offY; }
    const dx = p.aimX - p.x, dy = p.aimY - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const step = p.speed * DT;
    const reach = p.hit && t.alive ? t.radius + 6 : 8;
    if (d <= step + reach) {
      if (d > reach && d > 1e-9) { const f = (d - reach) / d; p.x += dx * f; p.y += dy * f; }
      impact(state, p, t);
      continue;
    }
    p.x += (dx / d) * step; p.y += (dy / d) * step;
    if (--p.ttl <= 0) {
      if (p.aoe > 0) explode(state, p, null, p.hit ? null : t);
      endProjectile(state, p, 0);
    }
  }
}

function impact(state, p, t) {
  if (p.hit && t.alive) {
    if (p.interceptable && t.cmCharges > 0) { t.cmCharges--; endProjectile(state, p, 0); return; }
    if (p.aoe > 0) explode(state, p, t);
    else queueDamage(state, p.srcId, t.id, p.dmg, p.type, p.dot ? { dot: p.dot } : null);
    endProjectile(state, p, 1);
  } else { // rolled miss: the fizzle splash may hit neighbours but never the primary target (SPEC §2.2)
    if (p.aoe > 0) explode(state, p, null, p.hit ? null : t);
    endProjectile(state, p, 0);
  }
}

const aoeBuf = [];

/**
 * Splash damage around the projectile: `primary` (a rolled hit) takes full
 * damage, everyone else within aoe takes the falloff amount, `skip` (the
 * primary target of a rolled miss) takes nothing.
 */
function explode(state, p, primary, skip) {
  const ships = state.ships;
  queryCircle(state.grid, ships, p.x, p.y, p.aoe, aoeBuf, 1 - p.team);
  state.events.push(['aoe', Math.round(p.x), Math.round(p.y), p.aoe, p.type]);
  const edge = COMBAT.aoeEdgeFalloff;
  for (let i = 0; i < aoeBuf.length; i++) {
    const e = aoeBuf[i];
    if (e === skip) continue;
    let mul;
    if (e === primary) mul = 1;
    else {
      const d = Math.sqrt((e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y));
      mul = 1 - (1 - edge) * clamp(d / p.aoe, 0, 1);
    }
    queueDamage(state, p.srcId, e.id, p.dmg * mul, p.type, p.dot ? { dot: p.dot } : null);
  }
  if (primary && aoeBuf.indexOf(primary) < 0) queueDamage(state, p.srcId, primary.id, p.dmg, p.type, p.dot ? { dot: p.dot } : null);
}

// ---------------------------------------------------------------------------
// Point defense
// ---------------------------------------------------------------------------

/** PD weapon: shoot the nearest unclaimed enemy interceptable projectile in range. */
function tryPointDefense(state, s, w) {
  const pool = state.projectiles, tick = state.tick;
  const R = weaponRange(s, w);
  let best = null, bestD = R * R;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    if (!p.alive || !p.interceptable || p.team === s.team || p.claimedTick === tick || p.spawnTick === tick) continue; // launched this tick: engageable from the next one regardless of processing order
    const d2 = (p.x - s.x) * (p.x - s.x) + (p.y - s.y) * (p.y - s.y);
    if (d2 <= bestD) { bestD = d2; best = p; }
  }
  if (!best) return false;
  best.claimedTick = tick;
  const salvo = Math.max(1, Math.round(w.def.salvo * w.mod.salvoMul));
  for (let k = 0; k < salvo; k++) {
    if (state.rng.next() < COMBAT.pdInterceptChance) { interceptProjectile(state, best); break; }
  }
  setCooldown(state, s, w);
  return true;
}

/** Flak curtain (Ártemis): intercept enemy interceptables within the radius, up to the charge count. */
export function flakCurtains(state) {
  const ships = state.ships, pool = state.projectiles, tick = state.tick;
  const p = ABILITIES.flak_curtain.params;
  for (let i = 0; i < state.curtains.length; i++) {
    const s = ships[state.curtains[i] - 1];
    if (!s.alive || s.curtainUntil <= tick || s.curtainLeft <= 0) continue;
    for (let k = 0; k < pool.length && s.curtainLeft > 0; k++) {
      const pr = pool[k];
      if (!pr.alive || !pr.interceptable || pr.team === s.team || pr.spawnTick === tick) continue;
      const d2 = (pr.x - s.x) * (pr.x - s.x) + (pr.y - s.y) * (pr.y - s.y);
      if (d2 > p.radius * p.radius) continue;
      interceptProjectile(state, pr);
      s.curtainLeft--;
    }
  }
}
