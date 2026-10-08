// Computer fleet builder: random (facil), preset (normal) and counter
// (dificil / especialista). Isomorphic, deterministic given the rng.
// See docs/ARCHITECTURE.md §2.2 and docs/SPEC.md §3.6.

import { DEFAULT_BUDGET, FLEET_LIMITS } from './constants.js';
import {
  FACTION_IDS, SHIPS, SIZE_CLASS, PRESET_LIST, presetsOfFaction, shipsOfFaction,
} from './catalog.js';
import { AI_PROFILES, BOT_PERSONALITIES } from './aiProfiles.js';
import {
  presetFleet, autoComplete, validateFleet, normalizeFleet, sizeClassCap, weightedPick,
} from './fleet.js';

/** @typedef {import('./fleet.js').Fleet} Fleet */

export const BUILDERS = ['random', 'preset', 'counter'];

/** Even an inexperienced commander receives and spends the same allowance. */
export const RANDOM_SPEND_MIN = 0.9;
export const RANDOM_SPEND_MAX = 1;

/**
 * Enemy composition categories (cost shares) used by the counter builder.
 *   swarm      tiny + small share           (0..1, size shares sum to 1)
 *   line       medium share
 *   heavy      large + capital share
 *   mothership mothership share
 *   shield     share of cost in ships with a shield (all Lúmen, Terran large+)
 *   organic    share of cost in organic hulls (Vorrax)   — regenerates
 *   nanite     share of cost in nanite hulls (Ferrix)    — repairs
 */
export const COUNTER_CATEGORIES = ['swarm', 'line', 'heavy', 'mothership', 'shield', 'organic', 'nanite'];

/**
 * Hand-authored counter matrix: how well each preset does against one point
 * of enemy value in each category (higher = better). Derived from the catalog:
 * DAMAGE_MULT (laser ×1.3 organic / ×1.2 shield; plasma ×1.3 nanite / ×1.2
 * armored; bio ×1.4 nanite / ×0.4 shield; railgun ×1.4 crystalline, ignores
 * DR; torpedo ×1.4 armored; ion ×1.6 shield + disrupts regen), ACCURACY vs
 * size (railgun/laser poor vs tiny, flak great vs tiny) and the presets' roles
 * (flak/PD/carriers vs swarms; torpedoes/leeches/railguns vs heavies; EMP vs
 * shields and regenerating hulls).
 *
 *                      swarm line heavy moth shield organic nanite
 * @type {Record<string, Record<string, number>>}
 */
export const COUNTER_MATRIX = {
  // Terran
  ter_linha: { swarm: 0.5, line: 0.7, heavy: 0.6, mothership: 0.5, shield: 0.2, organic: 0.5, nanite: 0.4 },
  ter_atlas: { swarm: 0.9, line: 0.4, heavy: 0.6, mothership: 0.5, shield: 0.1, organic: 0.5, nanite: 0.3 },
  ter_misseis: { swarm: 0.2, line: 0.7, heavy: 0.9, mothership: 0.8, shield: 0.3, organic: 0.6, nanite: 0.4 },
  // Vorrax
  vor_mare: { swarm: 0.5, line: 0.5, heavy: 0.3, mothership: 0.3, shield: 0.1, organic: 0.4, nanite: 0.8 },
  vor_garras: { swarm: 0.3, line: 0.6, heavy: 0.9, mothership: 0.8, shield: 0.3, organic: 0.5, nanite: 0.7 },
  vor_chuva: { swarm: 0.7, line: 0.6, heavy: 0.5, mothership: 0.4, shield: 0.1, organic: 0.4, nanite: 0.8 },
  // Lúmen
  lum_coro: { swarm: 0.2, line: 0.6, heavy: 0.7, mothership: 0.8, shield: 0.6, organic: 0.8, nanite: 0.3 },
  lum_catedral: { swarm: 0.5, line: 0.7, heavy: 0.6, mothership: 0.5, shield: 0.5, organic: 0.7, nanite: 0.4 },
  lum_dissonancia: { swarm: 0.3, line: 0.6, heavy: 0.5, mothership: 0.6, shield: 0.9, organic: 0.6, nanite: 0.6 },
  // Ferrix
  fer_ferro: { swarm: 0.1, line: 0.5, heavy: 0.9, mothership: 0.9, shield: 0.5, organic: 0.4, nanite: 0.5 },
  fer_fabrica: { swarm: 0.7, line: 0.6, heavy: 0.5, mothership: 0.4, shield: 0.4, organic: 0.5, nanite: 0.7 },
  fer_apagao: { swarm: 0.3, line: 0.5, heavy: 0.5, mothership: 0.6, shield: 0.9, organic: 0.6, nanite: 0.6 },
  // Astral siege guns punish large targets; the screen doctrine handles swarms.
  ast_orbita: { swarm: 0.15, line: 0.7, heavy: 0.95, mothership: 0.95, shield: 0.5, organic: 0.4, nanite: 0.6 },
  ast_baluarte: { swarm: 0.8, line: 0.5, heavy: 0.45, mothership: 0.35, shield: 0.25, organic: 0.4, nanite: 0.3 },
};

/**
 * Cost-share composition of one or more enemy fleets over COUNTER_CATEGORIES.
 * Unknown classes are ignored. Returns all zeros (and total 0) when nothing is known.
 * @param {Fleet[]} fleets
 * @returns {{ total: number } & Record<string, number>}
 */
export function enemyComposition(fleets) {
  const comp = { total: 0 };
  for (const c of COUNTER_CATEGORIES) comp[c] = 0;
  if (!Array.isArray(fleets)) return comp;
  const sums = { swarm: 0, line: 0, heavy: 0, mothership: 0, shield: 0, organic: 0, nanite: 0 };
  let total = 0;
  for (const fleet of fleets) {
    if (!fleet || !Array.isArray(fleet.ships)) continue;
    for (const e of normalizeFleet(fleet).ships) {
      const ship = SHIPS[e.cls];
      if (!ship) continue;
      const v = ship.cost * e.count;
      total += v;
      const si = SIZE_CLASS[ship.sizeClass].index;
      if (si <= 1) sums.swarm += v;
      else if (si === 2) sums.line += v;
      else if (si <= 4) sums.heavy += v;
      else sums.mothership += v;
      if (ship.shield && ship.shield.cap > 0) sums.shield += v;
      if (ship.hullType === 'organic') sums.organic += v;
      if (ship.hullType === 'nanite') sums.nanite += v;
    }
  }
  comp.total = total;
  if (total > 0) for (const c of COUNTER_CATEGORIES) comp[c] = sums[c] / total;
  return comp;
}

/**
 * Score a preset against an enemy composition: Σ share_c × M[preset][c].
 * @param {string} presetId
 * @param {ReturnType<typeof enemyComposition>} comp
 * @returns {number}
 */
export function scorePreset(presetId, comp) {
  const row = COUNTER_MATRIX[presetId];
  if (!row) return 0;
  let score = 0;
  for (const c of COUNTER_CATEGORIES) score += (comp[c] || 0) * (row[c] || 0);
  return score;
}

/**
 * Pick the preset of a faction that best counters the enemy fleets.
 * Ties (within 1e-9) are broken with the rng. Returns null when no enemy
 * composition is known (caller falls back to a random preset).
 * @param {string} faction
 * @param {Fleet[]} enemyFleets
 * @param {{ next(): number, pick<T>(a: T[]): T }} rng
 * @returns {string|null}
 */
export function pickCounterPreset(faction, enemyFleets, rng, personality) {
  const comp = enemyComposition(enemyFleets);
  if (comp.total <= 0) return null;
  let best = -Infinity;
  let tied = [];
  for (const p of presetsOfFaction(faction)) {
    const doctrine = BOT_PERSONALITIES[personality];
    const s = scorePreset(p.id, comp) + (doctrine?.styles.includes(p.style) ? 0.15 : 0);
    if (s > best + 1e-9) { best = s; tied = [p.id]; } else if (Math.abs(s - best) <= 1e-9) tied.push(p.id);
  }
  if (tied.length === 0) return null;
  return tied.length === 1 ? tied[0] : rng.pick(tied);
}

/**
 * Build a computer fleet.
 * @param {Object} o
 * @param {number} o.budget
 * @param {'facil'|'normal'|'dificil'|'especialista'} o.difficulty
 * @param {{ next(): number, range(a:number,b:number): number, pick<T>(a:T[]): T }} o.rng
 * @param {string} [o.faction]              force a faction; otherwise rng.pick(FACTION_IDS)
 * @param {string} [o.personality]          doctrine, independently of intelligence and resources
 * @param {Fleet[]} [o.enemyFleets]         known enemy fleets (counter builder)
 * @param {'random'|'preset'|'counter'} [o.builder]  override the difficulty's builder
 * @param {string[]} [o.mustInclude]        class ids that must be in the fleet (bosses); they
 *                                          also decide the faction when none is forced
 * @returns {Fleet}   always valid for the budget
 */
export function buildBotFleet(o) {
  const rng = o.rng;
  if (!rng || typeof rng.next !== 'function') throw new Error('buildBotFleet: rng required');
  const budget = Number.isFinite(o.budget) && o.budget > 0 ? o.budget : DEFAULT_BUDGET;
  const profile = AI_PROFILES[o.difficulty] || AI_PROFILES.normal;
  const mustInclude = Array.isArray(o.mustInclude) ? o.mustInclude.filter((c) => typeof c === 'string' && SHIPS[c]) : [];

  let faction = FACTION_IDS.includes(o.faction) ? o.faction : null;
  if (!faction && mustInclude.length) faction = SHIPS[mustInclude[0]].faction;
  if (!faction) faction = rng.pick(FACTION_IDS);
  const forced = mustInclude.filter((c) => SHIPS[c].faction === faction);

  let builder = BUILDERS.includes(o.builder) ? o.builder : profile.builder;
  if (!BUILDERS.includes(builder)) builder = 'preset';

  let fleet;
  if (builder === 'random') {
    fleet = buildRandomFleet(faction, budget, rng, forced, o.personality);
  } else {
    let presetId = null;
    if (builder === 'counter') presetId = pickCounterPreset(faction, o.enemyFleets, rng, o.personality);
    if (!presetId) {
      const presets = presetsOfFaction(faction);
      const doctrine = BOT_PERSONALITIES[o.personality];
      const preferred = doctrine ? presets.filter((p) => doctrine.styles.includes(p.style)) : [];
      // Seeded variety within a doctrine; a minority of fleets surprise the player.
      presetId = rng.pick(preferred.length && rng.next() < 0.85 ? preferred : presets).id;
    }
    fleet = autoComplete(presetFleet(presetId, budget, { mustInclude: forced }), budget, rng);
  }

  // Assert validity; fall back to something safe rather than returning garbage.
  let v = validateFleet(fleet, budget);
  if (!v.ok) {
    fleet = presetFleet(presetsOfFaction(faction)[0].id, budget, { mustInclude: forced });
    v = validateFleet(fleet, budget);
    if (!v.ok) throw new Error(`buildBotFleet produced an invalid fleet: ${v.code}`);
  }
  return v.fleet;
}

/**
 * Random legal fleet: spends 90–100% of the budget, never a mothership (unless
 * forced). Picks are weighted by cost so points, not ship counts, are spread
 * across classes; when the 40-ship cap blocks the spend target the cheapest
 * unit is traded up (cost floor ratchets so the loop cannot oscillate).
 * @param {string} faction
 * @param {number} budget
 * @param {{ next(): number, range(a:number,b:number): number }} rng
 * @param {string[]} forced
 * @returns {Fleet}
 */
export function buildRandomFleet(faction, budget, rng, forced = [], personality) {
  const upper = Math.floor(budget * RANDOM_SPEND_MAX);
  const target = Math.floor(budget * rng.range(RANDOM_SPEND_MIN, RANDOM_SPEND_MAX - 0.05));
  const pool = shipsOfFaction(faction).filter((s) => s.sizeClass !== 'mothership');
  const counts = new Map();
  const bySize = {};
  for (const s of pool) bySize[s.sizeClass] = 0;
  bySize.mothership = 0;
  let spent = 0;
  let total = 0;
  const buy = (ship) => {
    counts.set(ship.id, (counts.get(ship.id) || 0) + 1);
    bySize[ship.sizeClass] += 1; spent += ship.cost; total += 1;
  };
  const canBuy = (ship, limit) =>
    total < FLEET_LIMITS.maxShips && bySize[ship.sizeClass] < sizeClassCap(faction, ship.sizeClass) && spent + ship.cost <= limit;

  for (const cls of forced) {
    const ship = SHIPS[cls];
    if (ship && canBuy(ship, budget)) buy(ship);
  }

  let costFloor = 0;
  for (let guard = 0; guard < 400 && spent < target; guard++) {
    const cands = [];
    const weights = [];
    let totalW = 0;
    for (const ship of pool) {
      if (ship.cost <= costFloor || !canBuy(ship, upper)) continue;
      const preferred = personality === 'swarm' ? ship.sizeClass === 'tiny' || ship.role === 'carrier'
        : personality === 'aggressive' ? ['diver', 'brawler', 'striker'].includes(ship.role)
          : personality === 'defensive' ? ['escort', 'support', 'carrier'].includes(ship.role)
            : personality === 'artillery' ? ['kiter', 'anchor'].includes(ship.role) : false;
      const weight = ship.cost * (preferred ? 3 : 1);
      cands.push(ship); weights.push(weight); totalW += weight;
    }
    if (cands.length === 0) {
      // Trade the cheapest owned unit up, if the fleet is full and something pricier would fit.
      if (total < FLEET_LIMITS.maxShips) break;
      let cheapest = null;
      for (const ship of pool) if (counts.get(ship.id) > 0 && (!cheapest || ship.cost < cheapest.cost)) cheapest = ship;
      if (!cheapest) break;
      const n = counts.get(cheapest.id);
      if (n === 1) counts.delete(cheapest.id); else counts.set(cheapest.id, n - 1);
      bySize[cheapest.sizeClass] -= 1; spent -= cheapest.cost; total -= 1;
      costFloor = cheapest.cost;
      continue;
    }
    buy(weightedPick(cands, weights, totalW, rng.next()));
  }
  if (total === 0) {
    // Degenerate budgets (below the cheapest ship within the spend range): buy the cheapest ship.
    const cheapest = pool.reduce((a, b) => (b.cost < a.cost ? b : a));
    buy(cheapest);
  }
  return normalizeFleet({ faction, ships: [...counts].map(([cls, count]) => ({ cls, count })) });
}

/**
 * Convenience for UIs/tools: the builder a difficulty uses by default.
 * @param {string} difficulty
 * @returns {'random'|'preset'|'counter'}
 */
export function builderForDifficulty(difficulty) {
  const p = AI_PROFILES[difficulty];
  return p && BUILDERS.includes(p.builder) ? p.builder : 'preset';
}

/** All preset ids known to the counter matrix (sanity hook for tests). */
export function counterMatrixCoversAllPresets() {
  return PRESET_LIST.every((p) => COUNTER_MATRIX[p.id] && COUNTER_CATEGORIES.every((c) => typeof COUNTER_MATRIX[p.id][c] === 'number'));
}

