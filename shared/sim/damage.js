// Damage model (SPEC §2.3): queued damage applied in (srcId, sequence) order,
// shields → hull with type multipliers, flat DR (railgun ignores), disrupt,
// DoT, regeneration/repair, heals and the death phase (incl. passives).

import { DAMAGE_MULT, COMBAT, ABILITIES } from '../catalog.js';
import { TICK_RATE, DT } from '../constants.js';
import { insertionSortBy } from './math.js';
import { queryCircle } from './spatial.js';

const TRUE_MULT = { shield: 1, armored: 1, organic: 1, crystalline: 1, nanite: 1 };
const DOT_INTERVAL = TICK_RATE / 2; // DoT ticks every 0.5 s

/**
 * Queue damage from `srcId` to `dstId`. Applied later this tick by applyDamageQueue().
 * @param {object} state
 * @param {number} srcId   attacking ship id (0 = environment)
 * @param {number} dstId
 * @param {number} amount  raw damage after source multipliers
 * @param {string} type    weapon type or 'true'
 * @param {object} [o]     { ignoreDr, dot, shieldOnly, fromAbility, disruptSeconds }
 */
export function queueDamage(state, srcId, dstId, amount, type, o) {
  const q = state.dmgQueue;
  let e = q[state.dmgCount];
  if (!e) { e = { srcId: 0, dstId: 0, amount: 0, type: '', ignoreDr: false, dot: null, shieldOnly: false, fromAbility: false, disruptSeconds: 0, seq: 0, key: 0 }; q[state.dmgCount] = e; }
  e.srcId = srcId; e.dstId = dstId; e.amount = amount; e.type = type;
  e.ignoreDr = !!(o && o.ignoreDr); e.dot = (o && o.dot) || null; e.shieldOnly = !!(o && o.shieldOnly);
  e.fromAbility = !!(o && o.fromAbility); e.disruptSeconds = (o && o.disruptSeconds) || 0;
  e.seq = state.dmgCount;
  // sort key: sources of the tick's first team before the other team's, then srcId (sequence preserved by the stable sort)
  e.key = srcId > 0 && state.ships[srcId - 1].team !== state.firstTeam ? SECOND_TEAM_KEY + srcId : srcId;
  state.dmgCount++;
}

const SECOND_TEAM_KEY = 1 << 24;
const keySrc = (e) => e.key;

/** Apply all queued damage in (first team of the tick, srcId, sequence) order and clear the queue. */
export function applyDamageQueue(state) {
  const n = state.dmgCount;
  if (n === 0) return;
  const q = state.dmgQueue;
  insertionSortBy(q, n, keySrc);
  for (let i = 0; i < n; i++) {
    const e = q[i];
    applyDamage(state, e.srcId, e.dstId, e.amount, e.type, e);
  }
  state.dmgCount = 0;
}

/**
 * Apply one damage instance immediately (SPEC §2.3 formula).
 * @returns {number} total effective damage (shield + hull)
 */
export function applyDamage(state, srcId, dstId, raw, type, o) {
  const dst = state.ships[dstId - 1];
  if (!dst || !dst.alive || raw <= 0) return 0;
  const tick = state.tick, ev = state.events;
  const src = srcId > 0 ? state.ships[srcId - 1] : null;
  if (type === 'kinetic' && dst.targetedByTerran >= COMBAT.terranCoordinationShips) raw *= 1 + COMBAT.terranCoordinationBonus;
  if (state.suddenDeath) raw *= state.sdMul;
  const m = type === 'true' ? TRUE_MULT : DAMAGE_MULT[type];
  let shieldDmg = 0, hullDmg = 0;
  if (dst.extraShield > 0 || dst.shield > 0) {
    let s = raw * m.shield;
    if (dst.extraShield > 0) {
      const a = Math.min(dst.extraShield, s);
      dst.extraShield -= a; s -= a; shieldDmg += a;
    }
    if (s > 0 && dst.shield > 0) {
      const a = Math.min(dst.shield, s);
      dst.shield -= a; s -= a; shieldDmg += a;
      if (dst.shield <= 1e-9) {
        dst.shield = 0;
        ev.push(['sbreak', dst.id]);
        if (dst.faction === 'lumen' && tick >= dst.phaseReadyAt) { // Lúmen 'Fase' passive
          dst.untargetableUntil = Math.max(dst.untargetableUntil, tick + Math.round(COMBAT.lumenPhaseSeconds * TICK_RATE));
          dst.phaseReadyAt = tick + COMBAT.lumenPhaseCooldown * TICK_RATE;
        }
      }
    }
    dst.lastShieldHitTick = tick;
    raw = s / m.shield;
  }
  if (raw > 1e-9 && !(o && o.shieldOnly)) {
    let hull = raw * m[dst.hullType];
    if (type !== 'railgun' && !(o && o.ignoreDr)) {
      hull = Math.max(hull * COMBAT.armorFloor, hull - (dst.dr + dst.mod.drAdd));
    }
    hull = Math.max(COMBAT.minHullDamage, hull);
    dst.hp -= hull; dst.lastHullHitTick = tick; hullDmg = hull;
    if (o && o.dot) addDot(dst, srcId, o.dot, type, tick);
  }
  if (type === 'ion') disrupt(dst, tick, COMBAT.disruptSeconds, false); // any ion hit (shield or hull) disrupts
  if (o && o.disruptSeconds > 0) disrupt(dst, tick, o.disruptSeconds, true);
  if (shieldDmg > 0) ev.push(['hit', dst.id, Math.max(1, Math.round(shieldDmg)), type, 1]);
  if (hullDmg > 0) ev.push(['hit', dst.id, Math.max(1, Math.round(hullDmg)), type, 0]);
  const total = shieldDmg + hullDmg;
  dst.damageTaken += total;
  const ds = state.stats[dst.owner]; if (ds) ds.damageTaken += total;
  if (src) {
    src.damageDealt += total;
    const ss = state.stats[src.owner]; if (ss) ss.damageDealt += total;
  }
  if (dst.hp <= 0 && dst.killerId === 0) { dst.hp = 0; dst.killerId = srcId; }
  else if (dst.hp <= 0) dst.hp = 0;
  return total;
}

/**
 * Halt regen/repair for `seconds`. Weapon disrupts respect the immunity window;
 * ability disrupts always apply (both grant immunity after expiring).
 */
export function disrupt(dst, tick, seconds, fromAbility) {
  if (!fromAbility && dst.disruptImmuneUntil > tick) return;
  const until = tick + Math.round(seconds * TICK_RATE);
  if (until > dst.disruptedUntil) dst.disruptedUntil = until;
}

function addDot(dst, srcId, dot, type, tick) {
  const dots = dst.dots;
  for (let i = 0; i < dots.length; i++) {
    const d = dots[i];
    if (d.srcId === srcId) { d.until = tick + Math.round(dot.duration * TICK_RATE); d.dps = Math.max(d.dps, dot.dps); d.type = type; return; }
  }
  if (dots.length >= 12) return;
  dots.push({ srcId, dps: dot.dps, type, until: tick + Math.round(dot.duration * TICK_RATE), nextTick: tick + DOT_INTERVAL });
}

/** Queue DoT ticks (every 0.5 s, ignoring DR) and drop expired DoTs. */
export function tickDots(state) {
  const ships = state.ships, tick = state.tick;
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s.alive || s.dots.length === 0) continue;
    const dots = s.dots;
    for (let k = 0; k < dots.length; k++) {
      const d = dots[k];
      if (d.nextTick <= tick && d.nextTick <= d.until) {
        d.nextTick = tick + DOT_INTERVAL;
        queueDamage(state, d.srcId, s.id, d.dps * 0.5, d.type, DOT_OPTS);
      }
      if (d.until <= tick) { dots.splice(k, 1); k--; }
    }
  }
}
const DOT_OPTS = { ignoreDr: true };

/**
 * Restore hull or shield points, emitting a 'heal' event and counting stats.
 * @param {string} kind 'hull'|'shield'
 * @returns {number} amount actually restored
 */
export function heal(state, srcId, dst, amount, kind) {
  if (!dst.alive || dst.hp <= 0 || amount <= 0) return 0;
  let a;
  if (kind === 'shield') { a = Math.min(amount, dst.shieldMax - dst.shield); if (a <= 0) return 0; dst.shield += a; }
  else { a = Math.min(amount, dst.hpMax - dst.hp); if (a <= 0) return 0; dst.hp += a; }
  state.events.push(['heal', srcId, dst.id, Math.max(1, Math.round(a)), kind]);
  const owner = srcId > 0 ? state.ships[srcId - 1].owner : dst.owner;
  const st = state.stats[owner]; if (st) st.healing += a;
  return a;
}

const auraBuf = [];

/** Passive regeneration, nanite repair, shield regen, heals over time, auras. */
export function regenPhase(state) {
  const ships = state.ships, tick = state.tick;
  const passive = !state.suddenDeath;
  // Colmeia-Mãe aura: allies within auraRadius regen +auraRegen/s
  if (passive) {
    const p = ABILITIES.endless_swarm.params;
    for (let i = 0; i < state.auraSources.length; i++) {
      const src = ships[state.auraSources[i] - 1];
      if (!src.alive || src.disruptedUntil > tick) continue;
      queryCircle(state.grid, ships, src.x, src.y, p.auraRadius, auraBuf, src.team);
      for (let k = 0; k < auraBuf.length; k++) {
        const a = auraBuf[k];
        if (a.disruptedUntil > tick || a.hp >= a.hpMax || a.hp <= 0) continue;
        const add = Math.min(p.auraRegen * DT, a.hpMax - a.hp);
        a.hp += add;
        const st = state.stats[src.owner]; if (st) st.healing += add;
      }
    }
  }
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (!s.alive || s.hp <= 0) continue;
    const disrupted = s.disruptedUntil > tick;
    if (passive && !disrupted) {
      if (s.shieldMax > 0 && s.shield < s.shieldMax && s.acidUntil <= tick && tick - s.lastShieldHitTick >= s.shieldDelayTicks) {
        s.shield = Math.min(s.shieldMax, s.shield + s.shieldRegen * DT * s.mod.shieldRegenMul);
      }
      if (s.regen > 0 && s.hp < s.hpMax) {
        let ok = false;
        if (s.hullType === 'organic') ok = true;
        else if (s.hullType === 'nanite') ok = s.repairUnderFireUntil > tick || tick - s.lastHullHitTick >= COMBAT.naniteRepairDelay * TICK_RATE;
        if (ok) {
          const add = Math.min(s.regen * DT * s.mod.regenMul, s.hpMax - s.hp);
          s.hp += add;
          const st = state.stats[s.owner]; if (st) st.healing += add;
        }
      }
    }
    if (s.hot) {
      if (s.hot.until <= tick) s.hot = null;
      else if (s.hp < s.hpMax) {
        const add = Math.min(s.hot.perTick, s.hpMax - s.hp);
        s.hp += add;
        const st = state.stats[s.hot.owner]; if (st) st.healing += add;
      }
    }
  }
}

const bileBuf = [];

/**
 * Kill ships with hp <= 0 or expired lifetimes. Handles passives (bile burst,
 * hunger), latch detach, spawn bookkeeping and stats. Loops while bile bursts
 * cause further deaths.
 */
export function processDeaths(state) {
  const ships = state.ships, tick = state.tick;
  let again = true, guard = 0;
  while (again && guard++ < 50) {
    again = false;
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      if (!s.alive) continue;
      if (s.hp <= 0) killShip(state, s, s.killerId);
      else if (s.lifetimeEnd > 0 && tick >= s.lifetimeEnd) killShip(state, s, 0);
      else continue;
      again = true;
    }
    if (state.dmgCount > 0) applyDamageQueue(state);
  }
}

function killShip(state, s, killerId) {
  const tick = state.tick, ships = state.ships;
  s.alive = false; s.hp = 0; s.diedTick = tick; s.killerId = killerId;
  s.vx = 0; s.vy = 0;
  state.events.push(['die', s.id, killerId, Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10]);
  const list = state.alive[s.team];
  const idx = list.indexOf(s.id);
  if (idx >= 0) list.splice(idx, 1);
  if (s.purchased) {
    state.alivePurchased[s.team]--;
    const st = state.stats[s.owner]; if (st) { st.losses++; st.shipsAlive--; }
  }
  const killer = killerId > 0 ? ships[killerId - 1] : null;
  if (killer) {
    if (s.purchased) { killer.kills++; const ks = state.stats[killer.owner]; if (ks) ks.kills++; }
    if (killer.alive && killer.faction === 'vorrax' && killer.team !== s.team) {
      heal(state, killer.id, killer, killer.hpMax * COMBAT.vorraxHungerHeal, 'hull');
    }
  }
  // spawn bookkeeping
  if (s.source) {
    const src = ships[s.source - 1];
    if (src && src.spawnAlive && src.spawnAlive[s.cls] > 0) src.spawnAlive[s.cls]--;
  }
  // latch bookkeeping
  if (s.latch) { const host = ships[s.latch.hostId - 1]; if (host) host.latchedBy = Math.max(0, host.latchedBy - 1); s.latch = null; }
  if (s.latchedBy > 0) {
    for (let i = 0; i < ships.length; i++) {
      const o = ships[i];
      if (o.alive && o.latch && o.latch.hostId === s.id) { o.latch = null; o.stunUntil = tick + TICK_RATE / 2; }
    }
    s.latchedBy = 0;
  }
  // drop references to the dead ship (targets are refreshed next tick; charging beams cancel in the weapons phase)
  for (let i = 0; i < ships.length; i++) {
    const o = ships[i];
    if (!o.alive) continue;
    if (o.ai.targetId === s.id) { o.ai.targetId = 0; o.ai.lastTargetId = s.id; }
    if (o.ai.assignedId === s.id) o.ai.assignedId = 0;
    if (o.ai.protecteeId === s.id) o.ai.protecteeId = 0;
  }
  state.recentDeaths.push({ tick, x: s.x, y: s.y, team: s.team, faction: s.faction });
  // Vorrax larva: bile burst on death
  if (s.ability.id === 'bile_burst') {
    const p = ABILITIES.bile_burst.params;
    queryCircle(state.grid, ships, s.x, s.y, p.radius, bileBuf, 1 - s.team);
    if (bileBuf.length > 0) {
      state.events.push(['aoe', Math.round(s.x), Math.round(s.y), p.radius, 'bile_burst']);
      for (let k = 0; k < bileBuf.length; k++) queueDamage(state, s.id, bileBuf[k].id, p.damage, 'bio', null);
    }
  }
}
