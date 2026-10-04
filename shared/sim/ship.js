// Ship entity factory and per-tick status (timed effects, modifiers, flags).
// Ships are plain objects; see makeShip() for the full field list.

import { SHIPS, SIZE_CLASS } from '../catalog.js';
import { TICK_RATE, FLAG } from '../constants.js';
import { DEG } from './math.js';
import { CLASS_INDEX, SIZE_INDEX, getTables } from './tables.js';

/** Default (neutral) modifier set. */
function neutralMods(m) {
  m.speedMul = 1; m.turnMul = 1; m.dmgMul = 1; m.fireRateMul = 1; m.rangeMul = 1;
  m.drAdd = 0; m.shieldRegenMul = 1; m.regenMul = 1; m.cdMul = 1; m.evasion = 0;
  return m;
}

function neutralWeaponMod(m) {
  m.dmgMul = 1; m.cdMul = 1; m.rangeAdd = 0; m.rangeMul = 1; m.salvoMul = 1;
  return m;
}

/**
 * Create a ship entity.
 * @param {object} o
 * @param {number} o.id
 * @param {string} o.cls
 * @param {string} o.owner
 * @param {0|1} o.team
 * @param {number} o.x
 * @param {number} o.y
 * @param {number} o.heading
 * @param {number} [o.source]        spawner id (spawned units)
 * @param {number} [o.lifetimeEnd]   tick at which a spawned unit expires (0 = never)
 * @param {number} [o.tick]          creation tick
 * @param {number} [o.slot]          team-local index (0-based) used for the cooldown stagger; defaults to id
 */
export function makeShip(o) {
  const def = SHIPS[o.cls];
  if (!def) throw new Error(`Unknown ship class: ${o.cls}`);
  const sc = SIZE_CLASS[def.sizeClass];
  const tables = getTables();
  const clsIdx = CLASS_INDEX[o.cls];
  const spawned = !!o.source;
  const tick = o.tick || 0;
  const weapons = def.weapons.map((w, idx) => {
    const cdTicks = Math.max(1, Math.round(w.cooldown * TICK_RATE));
    return {
      idx, def: w, cdTicks,
      readyAt: tick + (((o.slot ?? o.id) * 7) % cdTicks), // staggered by the team-local slot so mirrored fleets get identical offsets
      charging: 0,        // target id while charging a heavy beam
      chargeUntil: 0,
      mod: neutralWeaponMod({}),
      minTargetIdx: SIZE_INDEX[w.minTargetClass] ?? 0,
      arcRad: w.arc * DEG,
    };
  });
  const ship = {
    id: o.id, cls: o.cls, clsIdx, def, owner: o.owner, team: o.team, faction: def.faction,
    role: def.role, sizeClass: def.sizeClass, sizeIdx: SIZE_INDEX[def.sizeClass],
    cost: spawned ? 0 : def.cost, purchased: !spawned, source: o.source || 0,
    lifetimeEnd: o.lifetimeEnd || 0,
    x: o.x, y: o.y, vx: 0, vy: 0, heading: o.heading, radius: sc.radius, mass: sc.mass,
    hp: def.hp, hpMax: def.hp,
    shield: def.shield.cap, shieldMax: def.shield.cap, shieldRegen: def.shield.regen,
    shieldDelayTicks: Math.round(def.shield.delay * TICK_RATE),
    extraShield: 0, extraShieldUntil: 0,
    dr: def.dr, regen: def.regen, hullType: def.hullType,
    speed: def.speed, turnRate: def.turnRate * DEG, accel: def.accel,
    maxRange: tables.maxRange[clsIdx],
    engageRange: tables.engageRange[clsIdx], // dps-weighted range used for positioning
    alive: true, diedTick: 0, killerId: 0,
    weapons,
    ability: { id: def.ability, readyAt: 0, pendingAt: -1 }, // pendingAt: scheduled cast tick (-1 = none); triggers stash castX/castY/castTarget/castDx/castDy here
    fx: [],
    mod: neutralMods({}),
    // timers (ticks)
    disruptedUntil: 0, disruptImmuneUntil: 0, lastShieldHitTick: -100000, lastHullHitTick: -100000,
    acidUntil: 0, untargetableUntil: 0, stealth: false, phaseReadyAt: 0,
    cmCharges: 0, cmUntil: 0, stationaryUntil: 0, stunUntil: 0, slowUntil: 0, slowMul: 1,
    latch: null, latchedBy: 0, pierceReady: false, stealthDmgMul: 1, repairUnderFireUntil: 0,
    hot: null,                // heal over time { perTick, until }
    dots: [],
    kamikaze: false,
    spawnAlive: null,         // { cls: count } for spawner ships
    // AI
    ai: {
      targetId: 0, targetSince: 0, assignedId: 0, assignedScore: 0, protecteeId: 0,
      mode: 'idleAdvance', px: 0, py: 0, retreating: false, nextThink: tick,
      lastJumpTick: -1000, slotDx: 0, slotDy: 0, orbitSign: (o.id & 1) ? 1 : -1,
      fleeX: 0, fleeY: 0, lastTargetId: 0, holdOverride: 0, retreatSince: 0,
    },
    targetedBy: 0, targetedByTerran: 0, allocDps: 0, incoming: 0, incomingInterceptables: 0,
    flags: 0,
    damageDealt: 0, damageTaken: 0, kills: 0,
  };
  return ship;
}

/**
 * Add a timed effect to a ship. Props are multiplicative (…Mul), additive
 * (drAdd, rangeAdd) or weapon-scoped (w: weapon index, wt: weapon type).
 * @param {object} ship
 * @param {number} until tick (exclusive) at which the effect expires
 * @param {object} props
 */
export function addEffect(ship, until, props) {
  const fx = Object.assign({ until, boosted: false, w: -1, wt: null }, props);
  ship.fx.push(fx);
  return fx;
}

/**
 * Expire effects and recompute aggregate modifiers for one ship.
 * @param {object} s
 * @param {number} tick
 */
export function updateStatus(s, tick) {
  const m = neutralMods(s.mod);
  const ws = s.weapons;
  for (let i = 0; i < ws.length; i++) neutralWeaponMod(ws[i].mod);
  let boosted = false;
  const fx = s.fx;
  let n = fx.length;
  for (let i = 0; i < n; i++) {
    const f = fx[i];
    if (f.until <= tick) { fx[i] = fx[n - 1]; fx.length = --n; i--; continue; }
    if (f.speedMul) m.speedMul *= f.speedMul;
    if (f.turnMul) m.turnMul *= f.turnMul;
    if (f.dmgMul) m.dmgMul *= f.dmgMul;
    if (f.fireRateMul) m.fireRateMul *= f.fireRateMul;
    if (f.rangeMul) m.rangeMul *= f.rangeMul;
    if (f.drAdd) m.drAdd += f.drAdd;
    if (f.shieldRegenMul) m.shieldRegenMul *= f.shieldRegenMul;
    if (f.regenMul) m.regenMul *= f.regenMul;
    if (f.cdMul) m.cdMul *= f.cdMul;
    if (f.evasion) m.evasion += f.evasion;
    if (f.boosted) boosted = true;
    if (f.w >= 0 || f.wt) {
      for (let k = 0; k < ws.length; k++) {
        const w = ws[k];
        if (f.w >= 0 ? k === f.w : w.def.type === f.wt) {
          const wm = w.mod;
          if (f.wDmgMul) wm.dmgMul *= f.wDmgMul;
          if (f.wCdMul) wm.cdMul *= f.wCdMul;
          if (f.wRangeAdd) wm.rangeAdd += f.wRangeAdd;
          if (f.wRangeMul) wm.rangeMul *= f.wRangeMul;
          if (f.wSalvoMul) wm.salvoMul *= f.wSalvoMul;
        }
      }
    }
  }
  if (s.slowUntil > tick) m.speedMul *= s.slowMul;
  if (s.extraShield > 0 && s.extraShieldUntil <= tick) s.extraShield = 0;
  if (s.cmUntil <= tick) s.cmCharges = 0;
  if (s.stealth && s.untargetableUntil <= tick) s.stealth = false;
  if (s.disruptedUntil > 0 && s.disruptedUntil <= tick) {
    s.disruptedUntil = 0;
    s.disruptImmuneUntil = tick + 2 * TICK_RATE;
  }
  // flags
  let fl = 0;
  if (s.untargetableUntil > tick) fl |= FLAG.UNTARGETABLE;
  if (s.disruptedUntil > tick) fl |= FLAG.DISRUPTED;
  if (boosted) fl |= FLAG.BOOSTED;
  if (s.ai.retreating) fl |= FLAG.RETREATING;
  if (s.shieldMax > 0 && s.shield <= 0) fl |= FLAG.SHIELD_BROKEN;
  if (s.latch || s.latchedBy > 0) fl |= FLAG.LATCHED;
  if (s.stationaryUntil > tick) fl |= FLAG.STATIONARY;
  for (let i = 0; i < ws.length; i++) if (ws[i].charging) { fl |= FLAG.CASTING; break; }
  if (s.ability.pendingAt >= 0) fl |= FLAG.CASTING;
  s.flags = fl;
}

/** True when weapons may be aimed at this ship right now. */
export function isTargetable(s, tick) {
  return s.alive && s.untargetableUntil <= tick;
}

/** Current effective max speed (u/s). */
export function maxSpeed(s, tick) {
  if (s.stationaryUntil > tick || s.stunUntil > tick) return 0;
  return s.speed * s.mod.speedMul;
}

/** Effective hp + shields (for AI heuristics). */
export function ehp(s) {
  return s.hp + s.shield + s.extraShield;
}
