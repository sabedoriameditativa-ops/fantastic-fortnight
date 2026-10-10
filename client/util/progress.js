// Campaign rating of a finished battle (SPEC §4 progression): stars, score,
// what was missing for the next star and the player's share of the team's
// damage in team formats. Pure functions over the BattleResult / BattleStartInfo
// (no DOM, no storage) so the rules are unit-tested in Node.

import { fleetCost, fleetToArray } from '/shared/fleet.js';
import { SHIPS } from '/shared/catalog.js';
import { TICK_RATE } from '/shared/constants.js';

export const STAR_RULES = Object.freeze({
  valueFrac: 0.5,            // 2nd star: ≥ 50% of the fleet value remaining
  fastSeconds: 60,           // 3rd star: win in under 60 s of battle time…
  capitalClasses: ['capital', 'mothership'], // …or bring a capital/mothership and lose none
});
export const SCORE_TIME_PENALTY_PER_S = 4;   // score = remaining value + damage dealt − 4 × seconds

/** Campaign progress is recorded in 1v1 only; larger formats are skirmishes ('2v2'…'6v6'). */
export function formatOf(teamSize) {
  const n = Math.max(1, Math.min(6, Math.floor(Number(teamSize)) || 1));
  return `${n}v${n}`;
}
export function isCampaignFormat(teamSize) {
  return (Math.floor(Number(teamSize)) || 1) === 1;
}

/** Does a fleet carry a capital or mothership? */
export function fleetHasCapital(fleet) {
  return fleetToArray(fleet).some((cls) => SHIPS[cls] && STAR_RULES.capitalClasses.includes(SHIPS[cls].sizeClass));
}

/** Purchased capitals/motherships destroyed (from the result's per-class losses); null when the result has no per-class data. */
export function capitalsLost(ps) {
  if (!ps || !ps.lost || typeof ps.lost !== 'object') return null;
  let n = 0;
  for (const cls of Object.keys(ps.lost)) if (SHIPS[cls] && STAR_RULES.capitalClasses.includes(SHIPS[cls].sizeClass)) n += ps.lost[cls] | 0;
  return n;
}

/** Score of a player's battle: remaining value + damage dealt − time penalty (never negative). */
export function battleScore(ps, ticks, tickRate = TICK_RATE) {
  const seconds = (Number(ticks) || 0) / (tickRate || TICK_RATE);
  return Math.max(0, Math.round((ps.valueAlive || 0) + (ps.damageDealt || 0) - SCORE_TIME_PENALTY_PER_S * seconds));
}

/**
 * Rate the player's battle.
 * @param {{ result: object, start: object, myPlayerId: string }} o
 * @returns {{
 *   won: boolean, stars: 0|1|2|3, score: number, seconds: number, remainingFrac: number, fast: boolean,
 *   hadCapital: boolean, lostCapital: boolean|null, capitalIntact: boolean, missing: ('value'|'capital')[],
 *   contribution: { share: number, teamDamage: number, mates: number }|null, fleetValue: number,
 * }|null} null when the player is not in the battle
 */
export function rateBattle({ result, start, myPlayerId }) {
  const players = (start && start.players) || [];
  const me = players.find((p) => p.id === myPlayerId);
  const ps = result && result.players && result.players[myPlayerId];
  if (!me || !ps) return null;
  const tickRate = (start && start.tickRate) || TICK_RATE;
  const seconds = (Number(result.ticks) || 0) / tickRate;
  const won = result.winner === me.team;
  const fleetValue = fleetCost(me.fleet);
  const remainingFrac = fleetValue > 0 ? Math.max(0, Math.min(1, (ps.valueAlive || 0) / fleetValue)) : 0;
  const fast = seconds < STAR_RULES.fastSeconds;
  const hadCapital = fleetHasCapital(me.fleet);
  const lost = capitalsLost(ps);
  const lostCapital = lost === null ? null : lost > 0;
  const capitalIntact = hadCapital && lostCapital === false;
  const star2 = remainingFrac >= STAR_RULES.valueFrac;
  const star3 = fast || capitalIntact;
  const stars = won ? 1 + (star2 ? 1 : 0) + (star3 ? 1 : 0) : 0;
  const missing = [];
  if (won && !star2) missing.push('value');
  if (won && !star3) missing.push('capital');
  // team formats: share of the team's damage
  const mates = players.filter((p) => p.team === me.team);
  let contribution = null;
  if (mates.length > 1) {
    let teamDamage = 0;
    for (const p of mates) teamDamage += (result.players[p.id] && result.players[p.id].damageDealt) || 0;
    contribution = { share: teamDamage > 0 ? (ps.damageDealt || 0) / teamDamage : 0, teamDamage, mates: mates.length };
  }
  return { won, stars, score: battleScore(ps, result.ticks, tickRate), seconds, remainingFrac, fast, hadCapital, lostCapital, capitalIntact, missing, contribution, fleetValue };
}

/** Star glyphs for 0..3 stars ("★★☆"). */
export function starGlyphs(stars, max = 3) {
  const n = Math.max(0, Math.min(max, stars | 0));
  return '★'.repeat(n) + '☆'.repeat(max - n);
}
