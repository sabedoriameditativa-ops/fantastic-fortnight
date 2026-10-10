// Ability registry (SPEC §3.5): one entry per catalog ability id with
// trigger(ctx) → utility (cast when ≥ 1) and cast(ctx). Triggers may stash
// their chosen point/target on `me.ability` for the cast that follows.
// Difficulty knobs: thresholds are jittered by P.abilityNoise via th().

import { ABILITIES } from '../catalog.js';
import { TICK_RATE } from '../constants.js';
import { addEffect } from './ship.js';
import { heal, queueDamage } from './damage.js';
import { createArea, spawnUnits, teleportShip } from './effects.js';
import {
  enemiesWithin, alliesWithin, countEnemies, nearestEnemy, densestPoint, incomingInterceptablesNear, recentAllyDeathsNear,
} from './queries.js';
import { angleDiff, DEG } from './math.js';
import { weaponRange } from './weapons.js';

const buf = [];
const buf2 = [];
const dp = { x: 0, y: 0, count: 0, medPlus: 0, cost: 0 };

/** Threshold jitter: v × (1 + noise·U(−1,1)) using the sim RNG. */
function th(ctx, v) {
  const n = ctx.P.abilityNoise;
  if (n <= 0) return v;
  return v * (1 + n * (ctx.rng.next() * 2 - 1));
}

function dur(id) { return Math.round(ABILITIES[id].duration * TICK_RATE); }
function P(id) { return ABILITIES[id].params; }

function emitCast(ctx, targetId, x, y) {
  ctx.state.events.push(['cast', ctx.me.id, ctx.me.ability.id, targetId | 0, Math.round(x), Math.round(y)]);
}

function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

function spawnTrigger(ctx, cls, maxAlive, range) {
  const me = ctx.me;
  const alive = me.spawnAlive ? (me.spawnAlive[cls] || 0) : 0;
  if (alive >= maxAlive) return 0;
  if (ctx.tick < 60 && ctx.state.alive[1 - me.team].length > 0) return 1;
  return countEnemies(ctx.state, me, th(ctx, range)) >= 1 ? 1 : 0;
}

/** Direction (unit) away from the nearest threat; falls back to the own side. */
function fleeDir(ctx, out) {
  const me = ctx.me;
  const e = nearestEnemy(ctx.state, me, 600);
  let dx, dy;
  if (e) { dx = me.x - e.x; dy = me.y - e.y; } else { dx = me.team === 0 ? -1 : 1; dy = 0; }
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  out.x = dx / d; out.y = dy / d;
  return out;
}
const dirOut = { x: 0, y: 0 };

/**
 * Dive helper: when the ability is ready but no valid prey is in reach, steer
 * the ship toward the nearest enemy within `r` that satisfies `pred` by making
 * it the current target (the brawler/diver movement then closes in).
 */
function seekPrey(ctx, r, pred) {
  const { me, state } = ctx;
  enemiesWithin(state, me, r, buf2);
  let best = null, bd = Infinity;
  for (let i = 0; i < buf2.length; i++) {
    const e = buf2[i];
    if (!pred(e)) continue;
    const d = (e.x - me.x) * (e.x - me.x) + (e.y - me.y) * (e.y - me.y);
    if (d < bd) { bd = d; best = e; }
  }
  if (best && me.ai.targetId !== best.id) { me.ai.targetId = best.id; me.ai.targetSince = ctx.tick; }
}

/** Shield-only area pulse with disrupt (EMP family). */
function shieldPulse(ctx, radius, shieldDamage, disruptSeconds, extra) {
  const { state, me } = ctx;
  enemiesWithin(state, me, radius, buf);
  state.events.push(['aoe', Math.round(me.x), Math.round(me.y), radius, me.ability.id]);
  for (let i = 0; i < buf.length; i++) {
    const e = buf[i];
    queueDamage(state, me.id, e.id, shieldDamage, 'true', { shieldOnly: true, fromAbility: true, disruptSeconds });
    if (extra) extra(e);
  }
  emitCast(ctx, 0, me.x, me.y);
}

export const ABILITY_REGISTRY = {
  // --- Terran ---------------------------------------------------------------
  afterburner: {
    trigger(ctx) {
      const { me, target } = ctx;
      const R = me.maxRange;
      if (target) { const d = dist(me, target); if (d > R + th(ctx, 100) && d < 3 * R) return 1; }
      if (me.ai.retreating && ctx.incoming > th(ctx, 0.3) * me.hp) return 1;
      if (me.targetedBy >= th(ctx, 3)) return 1;
      return 0;
    },
    cast(ctx) {
      const p = P('afterburner');
      addEffect(ctx.me, ctx.tick + dur('afterburner'), { speedMul: p.speedMul, turnMul: p.turnMul, boosted: true }, 'afterburner');
      emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  countermeasures: {
    trigger(ctx) { return ctx.me.incomingInterceptables >= 1 ? 1 : 0; },
    cast(ctx) {
      ctx.me.cmCharges = P('countermeasures').charges;
      ctx.me.cmUntil = ctx.tick + dur('countermeasures');
      emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  stealth_strike: {
    trigger(ctx) {
      const { me, state } = ctx;
      if (me.stealth) return 0;
      const w = me.weapons[0];
      if (w.readyAt > ctx.tick + 2 * TICK_RATE) return 0;
      enemiesWithin(state, me, th(ctx, 700), buf);
      let best = null, bd = Infinity; // nearest large+ (grid order is x-sorted: "first found" would favour one side)
      for (let i = 0; i < buf.length; i++) {
        const e = buf[i];
        if (e.sizeIdx < 3) continue;
        const d = dist(me, e);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) { me.ability.castTarget = best.id; return 1; }
      return 0;
    },
    cast(ctx) {
      const me = ctx.me;
      me.stealth = true;
      me.untargetableUntil = ctx.tick + dur('stealth_strike');
      me.stealthDmgMul = P('stealth_strike').damageMul;
      const t = me.ability.castTarget;
      if (t) { me.ai.targetId = t; me.ai.targetSince = ctx.tick; }
      emitCast(ctx, t | 0, me.x, me.y);
    },
  },
  flak_curtain: {
    trigger(ctx) {
      const { me, state } = ctx;
      if (incomingInterceptablesNear(state, me, 300) >= th(ctx, 3)) return 1;
      // a swarm: ≥ 3 tiny inside flak range, ≥ 4 closing within 450, or an ally within 300 being orbited by ≥ 2 tiny
      enemiesWithin(state, me, 450, buf);
      let near = 0, far = 0;
      for (let i = 0; i < buf.length; i++) {
        const e = buf[i];
        if (e.sizeIdx !== 0) continue;
        far++;
        if (dist(me, e) <= 320) near++;
      }
      if (near >= th(ctx, 3) || far >= th(ctx, 4)) return 1;
      if (far < 2) return 0;
      alliesWithin(state, me, 300, buf2);
      for (let i = 0; i < buf2.length; i++) {
        const a = buf2[i];
        let on = 0;
        for (let k = 0; k < buf.length; k++) if (buf[k].sizeIdx === 0 && dist(a, buf[k]) <= 120) on++;
        if (on >= 2) return 1;
      }
      return 0;
    },
    cast(ctx) {
      const me = ctx.me, p = P('flak_curtain');
      me.curtainUntil = ctx.tick + dur('flak_curtain');
      me.curtainLeft = p.intercepts;
      addEffect(me, me.curtainUntil, { wt: 'flak', wDmgMul: p.damageMul, boosted: true }, 'flak_curtain');
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  barrage_fire: {
    trigger(ctx) {
      const { me, state } = ctx;
      enemiesWithin(state, me, 520, buf);
      let med = 0;
      for (let i = 0; i < buf.length; i++) { if (buf[i].sizeIdx >= 2) med++; if (buf[i].sizeIdx >= 4) return 1; }
      return med >= th(ctx, 2) ? 1 : 0;
    },
    cast(ctx) {
      const p = P('barrage_fire');
      addEffect(ctx.me, ctx.tick + dur('barrage_fire'), { wt: 'missile', wSalvoMul: p.salvoMul, wCdMul: p.cooldownMul, boosted: true }, 'barrage_fire');
      emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  reactive_armor: {
    trigger(ctx) {
      const me = ctx.me;
      return me.hp < th(ctx, 0.6) * me.hpMax || me.targetedBy >= th(ctx, 3) ? 1 : 0;
    },
    cast(ctx) {
      const p = P('reactive_armor');
      addEffect(ctx.me, ctx.tick + dur('reactive_armor'), { drAdd: p.drAdd, shieldRegenMul: p.shieldRegenMul }, 'reactive_armor');
      emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  launch_squadron: {
    trigger(ctx) { const p = P('launch_squadron'); return spawnTrigger(ctx, p.spawn, p.maxAlive, 1000); },
    cast(ctx) {
      const p = P('launch_squadron');
      if (spawnUnits(ctx.state, ctx.me, p.spawn, p.count, p.maxAlive, p.lifetime) > 0) emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  siege_protocol: {
    trigger(ctx) {
      const { me, state, team } = ctx;
      if (countEnemies(state, me, 700) < th(ctx, 3)) return 0;
      alliesWithin(state, me, 600, buf);
      let cost = me.cost;
      for (let i = 0; i < buf.length; i++) cost += buf[i].cost;
      return cost >= th(ctx, 0.5) * Math.max(1, team.aliveCost) ? 1 : 0;
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('siege_protocol');
      alliesWithin(state, me, p.radius, buf);
      buf.push(me);
      const until = ctx.tick + dur('siege_protocol');
      for (let i = 0; i < buf.length; i++) addEffect(buf[i], until, { dmgMul: p.damageMul, fireRateMul: p.fireRateMul, boosted: true }, 'siege_protocol'); // keyed: overlapping casters refresh, never stack
      state.events.push(['aoe', Math.round(me.x), Math.round(me.y), p.radius, 'siege_protocol']);
      emitCast(ctx, 0, me.x, me.y);
    },
  },

  // --- Vorrax ---------------------------------------------------------------
  bile_burst: { passive: true, trigger() { return 0; }, cast() {} },
  frenzy: {
    trigger(ctx) { return recentAllyDeathsNear(ctx.state, ctx.me, th(ctx, 150), 10, 'vorrax') >= 1 ? 1 : 0; },
    cast(ctx) {
      const p = P('frenzy');
      addEffect(ctx.me, ctx.tick + dur('frenzy'), { fireRateMul: p.fireRateMul, speedMul: p.speedMul, boosted: true }, 'frenzy');
      emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  acid_cloud: {
    trigger(ctx) {
      const { me, state } = ctx, p = P('acid_cloud');
      densestPoint(state, me, me.maxRange, p.radius, dp);
      if (dp.count >= th(ctx, 2)) { me.ability.castX = dp.x; me.ability.castY = dp.y; return 1; }
      return 0;
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('acid_cloud');
      createArea(state, { kind: 'acid_cloud', x: me.ability.castX, y: me.ability.castY, r: p.radius, durationTicks: dur('acid_cloud'),
        team: me.team, ownerId: me.id, dps: p.dps, acid: true });
      emitCast(ctx, 0, me.ability.castX, me.ability.castY);
    },
  },
  leech: {
    trigger(ctx) {
      const { me, state } = ctx, p = P('leech');
      if (me.latch) return 0;
      enemiesWithin(state, me, th(ctx, p.range), buf);
      let best = null, bd = Infinity;
      for (let i = 0; i < buf.length; i++) {
        const e = buf[i];
        if (e.sizeIdx < 2) continue;
        const d = dist(me, e);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) { seekPrey(ctx, 400, (e) => e.sizeIdx >= 2); return 0; }
      me.ability.castTarget = best.id;
      return 1;
    },
    cast(ctx) {
      const { me, state } = ctx;
      const host = state.ships[me.ability.castTarget - 1];
      if (!host || !host.alive) return;
      const dx = me.x - host.x, dy = me.y - host.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const ring = host.radius + me.radius - 4;
      me.latch = { hostId: host.id, until: ctx.tick + dur('leech'), ox: (dx / d) * ring, oy: (dy / d) * ring, start: ctx.tick };
      host.latchedBy++;
      me.x = host.x + me.latch.ox; me.y = host.y + me.latch.oy;
      me.ai.targetId = host.id; me.ai.targetSince = ctx.tick;
      emitCast(ctx, host.id, host.x, host.y);
    },
  },
  spawn_brood: {
    trigger(ctx) { const p = P('spawn_brood'); return spawnTrigger(ctx, p.spawn, p.maxAlive, 900); },
    cast(ctx) {
      const p = P('spawn_brood');
      if (spawnUnits(ctx.state, ctx.me, p.spawn, p.count, p.maxAlive, p.lifetime) > 0) emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  molt: {
    trigger(ctx) { return ctx.me.hp < th(ctx, 0.4) * ctx.me.hpMax ? 1 : 0; },
    cast(ctx) {
      const { me, state } = ctx, p = P('molt');
      heal(state, me.id, me, me.hpMax * p.healFrac, 'hull');
      me.dots.length = 0;
      if (me.disruptedUntil > ctx.tick) { me.disruptedUntil = 0; me.disruptImmuneUntil = ctx.tick + 2 * TICK_RATE; }
      addEffect(me, ctx.tick + dur('molt'), { regenMul: p.regenMul }, 'molt');
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  war_pheromone: {
    trigger(ctx) {
      const { me, state } = ctx;
      if (countEnemies(state, me, 600) < 1) return 0;
      return alliesWithin(state, me, 500, buf).length >= th(ctx, 4) ? 1 : 0;
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('war_pheromone');
      alliesWithin(state, me, p.radius, buf);
      buf.push(me);
      const until = ctx.tick + dur('war_pheromone');
      for (let i = 0; i < buf.length; i++) addEffect(buf[i], until, { dmgMul: p.damageMul, regenMul: p.regenMul, boosted: true }, 'war_pheromone'); // keyed: overlapping casters refresh, never stack
      state.events.push(['aoe', Math.round(me.x), Math.round(me.y), p.radius, 'war_pheromone']);
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  endless_swarm: {
    trigger(ctx) {
      const p = P('endless_swarm');
      const u1 = spawnTrigger(ctx, p.spawn, p.maxAlive, 1200);
      const u2 = spawnTrigger(ctx, p.spawn2, p.maxAlive2, 1200);
      return Math.max(u1, u2);
    },
    cast(ctx) {
      const p = P('endless_swarm');
      const n = spawnUnits(ctx.state, ctx.me, p.spawn, p.count, p.maxAlive, p.lifetime)
        + spawnUnits(ctx.state, ctx.me, p.spawn2, p.count2, p.maxAlive2, p.lifetime);
      if (n > 0) emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },

  // --- Lúmen ----------------------------------------------------------------
  blink: {
    trigger(ctx) {
      const { me, target } = ctx;
      if (ctx.tick - me.ai.lastJumpTick < 2 * TICK_RATE) return 0;
      if (me.shield <= 0 && me.hp < me.hpMax) { fleeDir(ctx, dirOut); me.ability.castDx = dirOut.x; me.ability.castDy = dirOut.y; return 1; }
      if (target) {
        const d = dist(me, target);
        if (d > me.maxRange + th(ctx, 60)) {
          me.ability.castDx = (target.x - me.x) / d; me.ability.castDy = (target.y - me.y) / d;
          return 1;
        }
      }
      return 0;
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('blink');
      teleportShip(state, me, me.x + me.ability.castDx * p.distance, me.y + me.ability.castDy * p.distance);
      me.ai.lastJumpTick = ctx.tick;
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  shield_overload: {
    // shield < 20% of cap, or expected to drop below it within 2 s (expectedIncoming)
    trigger(ctx) {
      const me = ctx.me;
      if (me.shieldMax <= 0) return 0;
      const limit = th(ctx, 0.2) * me.shieldMax;
      return me.shield < limit || me.shield - ctx.incoming < limit ? 1 : 0;
    },
    cast(ctx) {
      const { me, state } = ctx;
      heal(state, me.id, me, me.shieldMax * P('shield_overload').restoreFrac, 'shield');
      me.lastShieldHitTick = -100000;
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  mantle: {
    trigger(ctx) {
      const { me, state } = ctx, p = P('mantle');
      alliesWithin(state, me, p.range, buf);
      let best = null;
      const frac = th(ctx, 0.3);
      for (let i = 0; i < buf.length; i++) {
        const a = buf[i];
        if (a.sizeIdx < 2 || a.shieldMax <= 0 || a.extraShield > 0) continue;
        if (a.shield >= frac * a.shieldMax) continue;
        if (!best || a.cost > best.cost || (a.cost === best.cost && dist(me, a) < dist(me, best))) best = a; // ties: nearest
      }
      if (!best) return 0;
      me.ability.castTarget = best.id;
      return 1;
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('mantle');
      const a = state.ships[me.ability.castTarget - 1];
      if (!a || !a.alive) return;
      a.extraShield = p.shield; a.extraShieldUntil = ctx.tick + dur('mantle');
      emitCast(ctx, a.id, a.x, a.y);
    },
  },
  prismatic_focus: {
    trigger(ctx) { return countEnemies(ctx.state, ctx.me, th(ctx, 520), 3) >= 1 ? 1 : 0; },
    cast(ctx) {
      const p = P('prismatic_focus');
      addEffect(ctx.me, ctx.tick + dur('prismatic_focus'), { w: p.weaponIndex, wDmgMul: p.damageMul, wRangeAdd: p.rangeAdd, boosted: true }, 'prismatic_focus');
      emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  dissonant_pulse: {
    trigger(ctx) {
      const { me, state } = ctx, p = P('dissonant_pulse');
      enemiesWithin(state, me, p.radius, buf);
      for (let i = 0; i < buf.length; i++) if (buf[i].sizeIdx >= 4) return 1;
      return buf.length >= th(ctx, 3) ? 1 : 0;
    },
    cast(ctx) {
      const p = P('dissonant_pulse'), tick = ctx.tick;
      shieldPulse(ctx, p.radius, p.shieldDamage, p.disruptSeconds, (e) => { e.slowUntil = tick + Math.round(p.slowSeconds * TICK_RATE); e.slowMul = p.slowMul; });
    },
  },
  phase_jump: {
    trigger(ctx) {
      const { me, state, team } = ctx;
      if (ctx.tick - me.ai.lastJumpTick < 2 * TICK_RATE) return 0;
      const sfrac = me.shieldMax > 0 ? me.shield / me.shieldMax : 0;
      if (sfrac < th(ctx, 0.25) && countEnemies(state, me, 300) >= 2) {
        let dx = me.x - team.enemyCx, dy = me.y - team.enemyCy;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        me.ability.castDx = dx / d; me.ability.castDy = dy / d; me.ability.castTarget = 0;
        return 1;
      }
      if (sfrac > th(ctx, 0.8) && countEnemies(state, me, 480) === 0) {
        enemiesWithin(state, me, 900, buf);
        let best = null;
        for (let i = 0; i < buf.length; i++) {
          const e = buf[i];
          if (e.sizeIdx >= 4 && (!best || e.cost > best.cost || (e.cost === best.cost && dist(me, e) < dist(me, best)))) best = e; // ties: nearest
        }
        if (best) {
          const dx = best.x - me.x, dy = best.y - me.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          me.ability.castDx = dx / d; me.ability.castDy = dy / d; me.ability.castTarget = best.id;
          me.ability.castDist = Math.max(0, Math.min(P('phase_jump').distance, d - me.maxRange * 0.7));
          return 1;
        }
      }
      return 0;
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('phase_jump');
      const d = me.ability.castTarget ? me.ability.castDist : p.distance;
      const dx = me.ability.castDx * d, dy = me.ability.castDy * d;
      alliesWithin(state, me, p.radius, buf);
      const group = buf.slice();
      for (let i = 0; i < group.length; i++) if (!group[i].latch) teleportShip(state, group[i], group[i].x + dx, group[i].y + dy);
      teleportShip(state, me, me.x + dx, me.y + dy);
      me.ai.lastJumpTick = ctx.tick;
      for (let i = 0; i < group.length; i++) group[i].ai.lastJumpTick = ctx.tick;
      emitCast(ctx, me.ability.castTarget | 0, me.x, me.y);
    },
  },
  aurora: {
    // utility proportional to the shield deficit: 3 allies below 50% (SPEC) or 2 with broken shields
    trigger(ctx) {
      const { me, state } = ctx;
      alliesWithin(state, me, 400, buf);
      buf.push(me);
      let low = 0, broken = 0;
      const frac = th(ctx, 0.5);
      for (let i = 0; i < buf.length; i++) {
        const a = buf[i];
        if (a.shieldMax <= 0) continue;
        if (a.shield < frac * a.shieldMax) low++;
        if (a.shield <= 0 && a.extraShield <= 0) broken++;
      }
      return Math.max(low / 3, broken / 2);
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('aurora');
      alliesWithin(state, me, p.radius, buf);
      buf.push(me);
      const until = ctx.tick + dur('aurora');
      for (let i = 0; i < buf.length; i++) {
        const a = buf[i];
        heal(state, me.id, a, p.shieldRestore, 'shield');
        addEffect(a, until, { shieldRegenMul: p.shieldRegenMul }, 'aurora'); // keyed: overlapping casters refresh, never stack
      }
      state.events.push(['aoe', Math.round(me.x), Math.round(me.y), p.radius, 'aurora']);
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  singularity: {
    trigger(ctx) {
      const { me, state } = ctx, p = P('singularity');
      densestPoint(state, me, p.range, p.radius, dp);
      if (dp.count >= th(ctx, 4) || dp.medPlus >= th(ctx, 2)) { me.ability.castX = dp.x; me.ability.castY = dp.y; return 1; }
      return 0;
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('singularity');
      createArea(state, { kind: 'singularity', x: me.ability.castX, y: me.ability.castY, r: p.radius, durationTicks: dur('singularity'),
        team: me.team, ownerId: me.id, dps: p.dps, trueDamage: true, pull: p.pullSpeed });
      emitCast(ctx, 0, me.ability.castX, me.ability.castY);
    },
  },

  // --- Ferrix ---------------------------------------------------------------
  overclock: {
    trigger(ctx) {
      const { me, state } = ctx;
      const t = me.ai.targetId;
      if (!t) return 0;
      alliesWithin(state, me, 400, buf);
      let n = 0;
      for (let i = 0; i < buf.length; i++) if (buf[i].cls === 'fer_vetor' && buf[i].ai.targetId === t) n++;
      return n >= th(ctx, 2) ? 1 : 0; // two OTHER Vetores on my target = the three of the catalog text
    },
    cast(ctx) {
      addEffect(ctx.me, ctx.tick + dur('overclock'), { fireRateMul: P('overclock').fireRateMul, boosted: true }, 'overclock');
      emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  turret_mode: {
    trigger(ctx) {
      const { me, state } = ctx;
      if (countEnemies(state, me, th(ctx, 250)) > 0) return 0;
      return countEnemies(state, me, me.maxRange * P('turret_mode').rangeMul) >= 1 ? 1 : 0;
    },
    cast(ctx) {
      const me = ctx.me, p = P('turret_mode');
      const until = ctx.tick + dur('turret_mode');
      me.stationaryUntil = until;
      addEffect(me, until, { rangeMul: p.rangeMul, dmgMul: p.damageMul, boosted: true }, 'turret_mode');
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  emp_pulse: {
    // utility = shield the pulse would strip (relative to its 80) + organic medium+ regen it would halt
    trigger(ctx) {
      const { me, state } = ctx, p = P('emp_pulse');
      enemiesWithin(state, me, th(ctx, p.radius), buf);
      let u = 0;
      for (let i = 0; i < buf.length; i++) {
        const e = buf[i];
        if (e.shieldMax > 0) u += Math.min(e.shield + e.extraShield, p.shieldDamage) / p.shieldDamage;
        if (e.hullType === 'organic' && e.sizeIdx >= 2) u += 1;
      }
      if (u < 1) seekPrey(ctx, 300, (e) => (e.shieldMax > 0 && e.shield + e.extraShield >= p.shieldDamage) || (e.hullType === 'organic' && e.sizeIdx >= 2));
      return u;
    },
    cast(ctx) { const p = P('emp_pulse'); shieldPulse(ctx, p.radius, p.shieldDamage, p.disruptSeconds, null); },
  },
  fabricate_drones: {
    trigger(ctx) { const p = P('fabricate_drones'); return spawnTrigger(ctx, p.spawn, p.maxAlive, 900); },
    cast(ctx) {
      const p = P('fabricate_drones');
      if (spawnUnits(ctx.state, ctx.me, p.spawn, p.count, p.maxAlive, p.lifetime) > 0) emitCast(ctx, 0, ctx.me.x, ctx.me.y);
    },
  },
  reactive_nanites: {
    trigger(ctx) { return ctx.me.hp < th(ctx, 0.35) * ctx.me.hpMax ? 1 : 0; },
    cast(ctx) {
      const { me, state } = ctx, p = P('reactive_nanites');
      heal(state, me.id, me, me.hpMax * p.healFrac, 'hull');
      me.repairUnderFireUntil = ctx.tick + dur('reactive_nanites');
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  piercing_shot: {
    trigger(ctx) {
      const { me, state, target } = ctx, p = P('piercing_shot');
      if (!target || me.pierceReady) return 0;
      const w = me.weapons[0];
      const R = weaponRange(me, w);
      const aim = Math.atan2(target.y - me.y, target.x - me.x);
      enemiesWithin(state, me, R, buf);
      let n = 0;
      const half = p.coneDeg * DEG;
      for (let i = 0; i < buf.length; i++) {
        const e = buf[i];
        if (e.sizeIdx < w.minTargetIdx) continue;
        if (Math.abs(angleDiff(Math.atan2(e.y - me.y, e.x - me.x), aim)) <= half) n++;
      }
      return n >= th(ctx, 2) ? 1 : 0;
    },
    cast(ctx) { ctx.me.pierceReady = true; emitCast(ctx, ctx.me.ai.targetId | 0, ctx.me.x, ctx.me.y); },
  },
  reconstruction: {
    // utility proportional to the hull deficit: 3 allies below 60% (SPEC) or 2 below 30%
    trigger(ctx) {
      const { me, state } = ctx;
      alliesWithin(state, me, 400, buf);
      buf.push(me);
      let low = 0, critical = 0;
      const frac = th(ctx, 0.6);
      for (let i = 0; i < buf.length; i++) {
        const a = buf[i];
        if (a.hp < frac * a.hpMax) low++;
        if (a.hp < 0.3 * a.hpMax) critical++;
      }
      return Math.max(low / 3, critical / 2);
    },
    cast(ctx) {
      const { me, state } = ctx, p = P('reconstruction');
      alliesWithin(state, me, p.radius, buf);
      buf.push(me);
      const ticks = dur('reconstruction');
      for (let i = 0; i < buf.length; i++) {
        const a = buf[i];
        a.hot = { perTick: (a.hpMax * p.healFrac) / ticks, until: ctx.tick + ticks, owner: me.owner };
      }
      state.events.push(['aoe', Math.round(me.x), Math.round(me.y), p.radius, 'reconstruction']);
      emitCast(ctx, 0, me.x, me.y);
    },
  },
  emp_storm: {
    trigger(ctx) {
      const { me, state } = ctx, p = P('emp_storm');
      enemiesWithin(state, me, p.radius, buf);
      let u = 0;
      for (let i = 0; i < buf.length; i++) if (buf[i].sizeIdx === 5) u = 1;
      if (buf.length >= th(ctx, 5)) u = 1;
      // worthwhile cluster just out of reach: close in (hold nearer) until the storm can land
      me.ai.holdOverride = 0;
      if (u < 1) {
        enemiesWithin(state, me, p.radius * 1.6, buf);
        let n = 0, mother = false;
        for (let i = 0; i < buf.length; i++) { n++; if (buf[i].sizeIdx === 5) mother = true; }
        if (n >= 5 || mother) me.ai.holdOverride = p.radius * 0.9;
      }
      return u;
    },
    cast(ctx) {
      const p = P('emp_storm'), until = ctx.tick + dur('emp_storm');
      shieldPulse(ctx, p.radius, p.shieldDamage, p.disruptSeconds, (e) => addEffect(e, until, { cdMul: p.cooldownMul }, 'emp_storm'));
    },
  },
};

/** Ability ids that never cast (handled as passives elsewhere). */
export const PASSIVE_ABILITIES = Object.keys(ABILITY_REGISTRY).filter((k) => ABILITY_REGISTRY[k].passive);

/** Get the registry entry for an ability id (throws on unknown ids). */
export function getAbility(id) {
  const a = ABILITY_REGISTRY[id];
  if (!a) throw new Error(`Unknown ability: ${id}`);
  return a;
}

/** Sanity check that every catalog ability has an implementation. */
export function missingAbilities() {
  return Object.keys(ABILITIES).filter((id) => !ABILITY_REGISTRY[id]);
}

