// Post-battle debrief computations (results screen): ships lost by class,
// damage by weapon type against the enemy hull, top killers and generated
// tips. Pure functions over BattleResult / BattleStartInfo; tips are returned
// as { id, params } descriptors that the screen formats with T.progress.tips.

import { SHIPS, FACTIONS, DAMAGE_MULT, WEAPON_TYPES } from '/shared/catalog.js';
import { fleetToArray } from '/shared/fleet.js';
import { STAR_RULES } from './progress.js';

/** Hull types of the enemy team, most common first. */
export function enemyHulls(start, myTeam) {
  const count = new Map();
  for (const p of (start && start.players) || []) {
    if (p.team === myTeam) continue;
    const f = FACTIONS[p.faction];
    if (f) count.set(f.hull, (count.get(f.hull) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
}

/** Damage multiplier of a weapon type against a hull (1 for unknown / 'true' damage). */
export function multVs(type, hull) {
  const m = DAMAGE_MULT[type];
  return m && hull && Number.isFinite(m[hull]) ? m[hull] : 1;
}

/** Weapon types sorted by multiplier against a hull: [[type, mult], …]. */
export function bestTypesVs(hull) {
  return WEAPON_TYPES.map((w) => [w, multVs(w, hull)]).sort((a, b) => b[1] - a[1]);
}

/**
 * A player's purchased ships by class: [{ cls, total, lost, alive }], fleet order.
 * `lost` is null when the result carries no per-class losses (older servers).
 */
export function shipsByClass(player, ps) {
  const totals = new Map();
  for (const cls of fleetToArray(player.fleet)) totals.set(cls, (totals.get(cls) || 0) + 1);
  const known = !!(ps && ps.lost && typeof ps.lost === 'object');
  return [...totals.entries()].map(([cls, total]) => {
    const lost = known ? Math.min(total, ps.lost[cls] | 0) : null;
    return { cls, total, lost, alive: lost === null ? null : total - lost };
  });
}

/**
 * Damage rows of a player: [{ type, dmg, frac, mult }] sorted by damage, `mult` vs `hull` (null without a hull).
 * @param {object} ps  result.players[id]
 */
export function damageRows(ps, hull) {
  const by = (ps && ps.damageByType) || {};
  const total = Object.values(by).reduce((a, b) => a + (Number(b) || 0), 0);
  return Object.keys(by)
    .map((type) => ({ type, dmg: Number(by[type]) || 0, frac: total > 0 ? (Number(by[type]) || 0) / total : 0, mult: hull && type !== 'true' ? multVs(type, hull) : null }))
    .filter((r) => r.dmg > 0)
    .sort((a, b) => b.dmg - a.dmg);
}

/** Top killer ship of each team: [{ team, cls, owner, ownerName, kills, damageDealt }|null, …] (from result.killers). */
export function topKillers(result, start) {
  const out = [null, null];
  const ks = Array.isArray(result && result.killers) ? result.killers : [];
  for (let t = 0; t < 2; t++) {
    const k = ks[t];
    if (!k || !SHIPS[k.cls]) continue;
    const owner = ((start && start.players) || []).find((p) => p.id === k.owner);
    out[t] = { team: t, cls: k.cls, owner: k.owner, ownerName: owner ? owner.name : k.owner, kills: k.kills | 0, damageDealt: k.damageDealt | 0 };
  }
  return out;
}

const fmtMult = (m) => `×${m.toFixed(1).replace('.', ',')}`;
const fmtPct = (f) => String(Math.round(Math.max(0, Math.min(1, f)) * 100));
const fmtClock = (s) => { const v = Math.max(0, Math.floor(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };

/**
 * One or two tips for the player, most useful first: { id, params } to format with T.progress.tips[id].
 * @param {{ result: object, start: object, myPlayerId: string, rating: object|null, hullNames?: Record<string,string>, typeNames?: Record<string,string> }} o
 */
export function buildTips({ result, start, myPlayerId, rating, hullNames = {}, typeNames = {} }, max = 2) {
  const tips = [];
  const players = (start && start.players) || [];
  const me = players.find((p) => p.id === myPlayerId);
  const ps = result && result.players && result.players[myPlayerId];
  if (!me || !ps) return tips;
  const hull = enemyHulls(start, me.team)[0] || null;
  const hullName = hull ? (hullNames[hull] || hull) : '';
  const typeName = (t) => typeNames[t] || t;
  const best = hull ? bestTypesVs(hull)[0] : null;
  const rows = damageRows(ps, hull);

  // 1. a weapon type that carried ≥ 25% of the damage but is weak against the enemy hull
  const weak = rows.find((r) => r.frac >= 0.25 && r.mult !== null && r.mult < 0.95);
  if (weak && best && best[0] !== weak.type) {
    tips.push({ id: 'weakWeapon', params: { type: typeName(weak.type), mult: fmtMult(weak.mult), hull: hullName, best: typeName(best[0]), bestMult: fmtMult(best[1]) } });
  }
  // 2. an enemy ship that killed 3+ ships
  const killers = topKillers(result, start);
  const enemyKiller = killers[1 - me.team];
  if (enemyKiller && enemyKiller.kills >= 3) {
    tips.push(best
      ? { id: 'killer', params: { ship: SHIPS[enemyKiller.cls].name, n: enemyKiller.kills, best: typeName(best[0]), bestMult: fmtMult(best[1]), hull: hullName } }
      : { id: 'killerNoHull', params: { ship: SHIPS[enemyKiller.cls].name, n: enemyKiller.kills } });
  }
  // 3. a capital/mothership was lost
  if (rating && rating.lostCapital) {
    const lostCls = Object.keys(ps.lost || {}).find((cls) => SHIPS[cls] && STAR_RULES.capitalClasses.includes(SHIPS[cls].sizeClass));
    if (lostCls) tips.push({ id: 'lostCapital', params: { ship: SHIPS[lostCls].name } });
  }
  // 4/5. what the next star needs, or why the battle was lost
  if (rating && rating.won) {
    if (rating.missing.includes('value')) tips.push({ id: 'star2', params: { pct: fmtPct(rating.remainingFrac), need: fmtPct(STAR_RULES.valueFrac) } });
    if (rating.missing.includes('capital') && !rating.hadCapital) tips.push({ id: 'star3', params: { time: fmtClock(rating.seconds), fast: STAR_RULES.fastSeconds } });
  } else if (rating && !rating.won) {
    if (result.reason === 'timeout') tips.push({ id: 'timeout', params: {} });
    else if (best) tips.push({ id: 'defeat', params: { best: typeName(best[0]), bestMult: fmtMult(best[1]), hull: hullName } });
  }
  return tips.slice(0, max);
}
