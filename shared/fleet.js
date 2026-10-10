// Fleet rules: cost, normalization, validation, preset scaling, auto-complete,
// summaries and deployment expansion. Isomorphic (Node + browser), pure data in,
// pure data out. See docs/ARCHITECTURE.md §2.1 and docs/SPEC.md §1.

import { DEFAULT_BUDGET, FLEET_LIMITS } from './constants.js';
import {
  FACTIONS, FACTION_IDS, SHIPS, SHIP_LIST, SIZE_CLASSES, SIZE_CLASS, PRESETS,
  shipsOfFaction, shipDps, shipEhp,
} from './catalog.js';

/** @typedef {{ cls: string, count: number }} FleetEntry */
/** @typedef {{ faction: string, ships: FleetEntry[] }} Fleet */

/** Budget the preset counts in the catalog are authored for. */
export const PRESET_REFERENCE_BUDGET = 1500;

/**
 * Anchor rule: a single ship may not consume more than this fraction of the
 * budget (i.e. at least 45% must remain for escorts). This is what keeps a
 * 500-point mothership out of an 800-point Escaramuça fleet while still
 * allowing a 320-point capital (40%). Ships forced through `mustInclude`
 * (level bosses) bypass the rule.
 */
export const MAX_SINGLE_SHIP_FRACTION = 0.55;

export const FLEET_ERR = Object.freeze({
  BAD_SHAPE: 'FLEET_BAD_SHAPE',
  UNKNOWN_FACTION: 'FLEET_UNKNOWN_FACTION',
  UNKNOWN_CLASS: 'FLEET_UNKNOWN_CLASS',
  WRONG_FACTION: 'FLEET_WRONG_FACTION',
  OVER_BUDGET: 'FLEET_OVER_BUDGET',
  SHIP_COUNT: 'FLEET_SHIP_COUNT',
  CLASS_CAP: 'FLEET_CLASS_CAP',
});

const CATALOG_INDEX = new Map(SHIP_LIST.map((s, i) => [s.id, i]));

/**
 * Purchase cap for a size class in a faction (Vorrax get more tiny ships).
 * @param {string} faction
 * @param {string} sizeClass
 * @returns {number}
 */
export function sizeClassCap(faction, sizeClass) {
  const byFaction = FLEET_LIMITS.tinyCapByFaction;
  if (sizeClass === 'tiny' && byFaction && byFaction[faction] != null) return byFaction[faction];
  return FLEET_LIMITS.maxPerSizeClass[sizeClass] ?? 0;
}

/**
 * Total point cost of a fleet. Unknown classes cost 0; malformed input → 0.
 * @param {Fleet} fleet
 * @returns {number}
 */
export function fleetCost(fleet) {
  if (!fleet || !Array.isArray(fleet.ships)) return 0;
  let total = 0;
  for (const e of fleet.ships) {
    if (!e) continue;
    const ship = SHIPS[e.cls];
    const n = Number(e.count);
    if (ship && Number.isFinite(n) && n > 0) total += ship.cost * n;
  }
  return total;
}

/**
 * Number of purchased ships in a fleet (entries with count > 0).
 * @param {Fleet} fleet
 * @returns {number}
 */
export function fleetShipCount(fleet) {
  if (!fleet || !Array.isArray(fleet.ships)) return 0;
  let total = 0;
  for (const e of fleet.ships) {
    if (!e) continue;
    const n = Number(e.count);
    if (typeof e.cls === 'string' && Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/**
 * Merge duplicate entries, drop entries with count <= 0 (counts are floored),
 * and sort by catalog order (unknown classes go last, sorted by id). Always
 * returns a fresh object; tolerant of malformed input.
 * @param {Fleet} fleet
 * @returns {Fleet}
 */
export function normalizeFleet(fleet) {
  const faction = fleet && typeof fleet.faction === 'string' ? fleet.faction : '';
  const counts = new Map();
  if (fleet && Array.isArray(fleet.ships)) {
    for (const e of fleet.ships) {
      if (!e || typeof e.cls !== 'string') continue;
      const n = Math.floor(Number(e.count));
      if (!Number.isFinite(n) || n <= 0) continue;
      counts.set(e.cls, (counts.get(e.cls) || 0) + n);
    }
  }
  const ships = [...counts].map(([cls, count]) => ({ cls, count }));
  ships.sort(compareEntries);
  return { faction, ships };
}

function compareEntries(a, b) {
  const ia = CATALOG_INDEX.get(a.cls);
  const ib = CATALOG_INDEX.get(b.cls);
  if (ia != null && ib != null) return ia - ib;
  if (ia != null) return -1;
  if (ib != null) return 1;
  return a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : 0;
}

/**
 * Structural check only (no catalog lookups): is this something shaped like a
 * fleet? Counts must be non-negative integers.
 * @param {any} fleet
 * @returns {boolean}
 */
export function isFleetShape(fleet) {
  if (!fleet || typeof fleet !== 'object' || Array.isArray(fleet)) return false;
  if (typeof fleet.faction !== 'string') return false;
  if (!Array.isArray(fleet.ships)) return false;
  for (const e of fleet.ships) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
    if (typeof e.cls !== 'string' || e.cls.length === 0) return false;
    if (!Number.isInteger(e.count) || e.count < 0) return false;
  }
  return true;
}

/**
 * Validate a fleet against the rules (SPEC §1) and a budget.
 * @param {Fleet} fleet
 * @param {number} [budget]
 * @returns {{ ok: true, fleet: Fleet } | { ok: false, code: string, detail?: any }}
 */
export function validateFleet(fleet, budget = DEFAULT_BUDGET) {
  if (!isFleetShape(fleet)) return { ok: false, code: FLEET_ERR.BAD_SHAPE };
  if (!FACTION_IDS.includes(fleet.faction)) {
    return { ok: false, code: FLEET_ERR.UNKNOWN_FACTION, detail: { faction: fleet.faction } };
  }
  const norm = normalizeFleet(fleet);
  for (const e of norm.ships) {
    const ship = SHIPS[e.cls];
    if (!ship) return { ok: false, code: FLEET_ERR.UNKNOWN_CLASS, detail: { cls: e.cls } };
    if (ship.faction !== norm.faction) {
      return { ok: false, code: FLEET_ERR.WRONG_FACTION, detail: { cls: e.cls, faction: ship.faction } };
    }
  }
  const count = fleetShipCount(norm);
  if (count < FLEET_LIMITS.minShips || count > FLEET_LIMITS.maxShips) {
    return {
      ok: false, code: FLEET_ERR.SHIP_COUNT,
      detail: { count, min: FLEET_LIMITS.minShips, max: FLEET_LIMITS.maxShips },
    };
  }
  const bySize = countBySize(norm);
  for (const sc of SIZE_CLASSES) {
    const cap = sizeClassCap(norm.faction, sc);
    if (bySize[sc] > cap) {
      return { ok: false, code: FLEET_ERR.CLASS_CAP, detail: { sizeClass: sc, count: bySize[sc], cap } };
    }
  }
  const cost = fleetCost(norm);
  const limit = Number.isFinite(budget) ? budget : Infinity;
  if (cost > limit) return { ok: false, code: FLEET_ERR.OVER_BUDGET, detail: { cost, budget: limit } };
  return { ok: true, fleet: norm };
}

function countBySize(fleet) {
  const bySize = {};
  for (const sc of SIZE_CLASSES) bySize[sc] = 0;
  for (const e of fleet.ships) {
    const ship = SHIPS[e.cls];
    if (ship) bySize[ship.sizeClass] += e.count;
  }
  return bySize;
}

// ---------------------------------------------------------------------------
// Builder helper: a mutable purchase ledger that enforces caps and budget.
// ---------------------------------------------------------------------------

/**
 * @param {string} faction
 * @param {number} budget
 * @param {Fleet} [base]  existing purchases to start from (same faction)
 */
function createLedger(faction, budget, base) {
  const counts = new Map();
  const bySize = {};
  for (const sc of SIZE_CLASSES) bySize[sc] = 0;
  let spent = 0;
  let total = 0;
  const ledger = {
    faction, budget,
    get spent() { return spent; },
    get total() { return total; },
    get remaining() { return budget - spent; },
    count(cls) { return counts.get(cls) || 0; },
    sizeCount(sc) { return bySize[sc]; },
    /** Can one more unit of `cls` be bought within `limit` (default: budget)? */
    canBuy(cls, limit = budget) {
      const ship = SHIPS[cls];
      if (!ship || ship.faction !== faction) return false;
      if (total >= FLEET_LIMITS.maxShips) return false;
      if (bySize[ship.sizeClass] >= sizeClassCap(faction, ship.sizeClass)) return false;
      return spent + ship.cost <= limit;
    },
    buy(cls) {
      const ship = SHIPS[cls];
      counts.set(cls, (counts.get(cls) || 0) + 1);
      bySize[ship.sizeClass] += 1;
      spent += ship.cost;
      total += 1;
    },
    /** Remove one unit of `cls`; returns false if none owned. */
    sell(cls) {
      const ship = SHIPS[cls];
      const n = counts.get(cls) || 0;
      if (!ship || n <= 0) return false;
      if (n === 1) counts.delete(cls); else counts.set(cls, n - 1);
      bySize[ship.sizeClass] -= 1;
      spent -= ship.cost;
      total -= 1;
      return true;
    },
    toFleet() {
      return normalizeFleet({ faction, ships: [...counts].map(([cls, count]) => ({ cls, count })) });
    },
  };
  if (base && Array.isArray(base.ships)) {
    for (const e of normalizeFleet(base).ships) {
      const ship = SHIPS[e.cls];
      if (!ship || ship.faction !== faction) continue;
      for (let i = 0; i < e.count; i++) {
        // Base purchases are taken as-is (they were validated upstream) but we
        // never let the ledger exceed hard caps, which would make it unfixable.
        if (total >= FLEET_LIMITS.maxShips) break;
        if (bySize[ship.sizeClass] >= sizeClassCap(faction, ship.sizeClass)) break;
        ledger.buy(e.cls);
      }
    }
  }
  return ledger;
}

/** Force-buy specific classes (bosses) ignoring the anchor rule but not caps/budget. */
function buyForced(ledger, mustInclude) {
  if (!Array.isArray(mustInclude)) return;
  for (const cls of mustInclude) {
    if (typeof cls !== 'string') continue;
    if (ledger.canBuy(cls)) ledger.buy(cls);
  }
}

/** Anchor rule check for the first unit of a class. */
function passesAnchorRule(ledger, cls) {
  const ship = SHIPS[cls];
  if (ledger.count(cls) > 0) return true;
  return ship.cost <= ledger.budget * MAX_SINGLE_SHIP_FRACTION;
}

/**
 * Scale a catalog preset to a budget.
 *
 * Algorithm (documented so the UI can explain it):
 *  0. `opts.mustInclude` classes are bought first (bosses), bypassing the anchor rule.
 *  1. Proportional pass, in the preset's priority order: each entry's target is
 *     `max(1, round(count × budget / 1500))`; buy up to the target while the
 *     budget and the size-class / total caps allow. An entry whose first unit
 *     would cost more than MAX_SINGLE_SHIP_FRACTION of the budget is skipped
 *     entirely (anchor rule) so small budgets keep enough escorts.
 *  2. Cycle pass: walk the list again and again buying one unit per entry per
 *     cycle while affordable and under caps, until a full cycle buys nothing.
 * The result never exceeds the budget or any cap, and always has ≥ 1 ship for
 * every preset at every official budget.
 *
 * @param {string} presetId
 * @param {number} [budget]
 * @param {{ mustInclude?: string[], base?: Fleet }} [opts]
 * @returns {Fleet}
 */
export function presetFleet(presetId, budget = DEFAULT_BUDGET, opts = {}) {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`Unknown preset: ${presetId}`);
  const ledger = createLedger(preset.faction, budget, opts.base);
  buyForced(ledger, opts.mustInclude);

  const scale = budget / PRESET_REFERENCE_BUDGET;
  // 1. proportional pass
  for (const [cls, count] of preset.ships) {
    if (!SHIPS[cls] || !passesAnchorRule(ledger, cls)) continue;
    const want = Math.max(1, Math.round(count * scale));
    while (ledger.count(cls) < want && ledger.canBuy(cls)) ledger.buy(cls);
  }
  // 2. cycle pass
  cyclePass(ledger, preset);
  // 3. slot-upgrade pass
  upgradePass(ledger, preset);
  return ledger.toFleet();
}

/** Buy one unit per preset entry per cycle while anything is affordable. */
function cyclePass(ledger, preset) {
  let progress = true;
  while (progress) {
    progress = false;
    for (const [cls] of preset.ships) {
      if (!SHIPS[cls] || !passesAnchorRule(ledger, cls)) continue;
      if (ledger.canBuy(cls)) { ledger.buy(cls); progress = true; }
    }
  }
}

/**
 * When the total-ship cap is hit with budget left (swarm presets at Guerra
 * Total, endless-mode enemies), trade the cheapest owned unit for a pricier
 * preset entry, walking the preset in priority order, until no trade fits;
 * then keep trading up through the whole faction roster, cheapest affordable
 * upgrade first (so unspent budget becomes real ships, not a number).
 */
function upgradePass(ledger, preset) {
  for (let guard = 0; guard < FLEET_LIMITS.maxShips * 4; guard++) {
    if (ledger.total < FLEET_LIMITS.maxShips) break;
    let cheapest = null;
    for (const [cls] of preset.ships) {
      if (ledger.count(cls) > 0 && SHIPS[cls] && (!cheapest || SHIPS[cls].cost <= SHIPS[cheapest].cost)) cheapest = cls;
    }
    if (!cheapest) break;
    let traded = false;
    for (const [cls] of preset.ships) {
      const ship = SHIPS[cls];
      if (!ship || ship.cost <= SHIPS[cheapest].cost || !passesAnchorRule(ledger, cls)) continue;
      ledger.sell(cheapest);
      if (ledger.canBuy(cls)) { ledger.buy(cls); traded = true; break; }
      ledger.buy(cheapest); // undo
    }
    if (!traded) break;
  }
  rosterUpgradePass(ledger);
}

/**
 * Trade the cheapest owned unit for the cheapest roster ship that is pricier
 * and fits (caps, budget, anchor rule, at most one mothership), repeating
 * while the fleet is at the ship cap with budget left. Each step is the
 * smallest affordable upgrade, so the fleet climbs from the cheapest hulls to
 * the most expensive ones gradually. Terminates: every trade raises the spent
 * total and the budget is finite.
 * @param {ReturnType<typeof createLedger>} ledger
 */
function rosterUpgradePass(ledger) {
  const roster = shipsOfFaction(ledger.faction).slice().sort((a, b) => a.cost - b.cost);
  for (let guard = 0; guard < FLEET_LIMITS.maxShips * 8; guard++) {
    if (ledger.total < FLEET_LIMITS.maxShips) break;
    let cheapest = null;
    for (const ship of roster) if (ledger.count(ship.id) > 0) { cheapest = ship; break; }
    if (!cheapest) break;
    let traded = false;
    for (const ship of roster) {
      if (ship.cost <= cheapest.cost) continue;
      if (ship.sizeClass === 'mothership' && ledger.sizeCount('mothership') > 0) continue;
      if (!passesAnchorRule(ledger, ship.id)) continue;
      ledger.sell(cheapest.id);
      if (ledger.canBuy(ship.id)) { ledger.buy(ship.id); traded = true; break; }
      ledger.buy(cheapest.id); // undo
    }
    if (!traded) break;
  }
}

/**
 * Most valuable fleet a faction can field: at most FLEET_LIMITS.maxShips
 * ships under the size-class caps, so this is the sum of the costliest
 * purchasable units (greedy by cost is optimal with a pure count cap). Any
 * budget above it is unspendable; the UI shows this instead of the formula.
 * @param {string} faction
 * @returns {number}
 */
export function maxFleetValue(faction) {
  const roster = shipsOfFaction(faction).slice().sort((a, b) => b.cost - a.cost);
  const bySize = {};
  let total = 0, value = 0;
  for (const ship of roster) {
    const cap = sizeClassCap(faction, ship.sizeClass);
    while (total < FLEET_LIMITS.maxShips && (bySize[ship.sizeClass] || 0) < cap) {
      bySize[ship.sizeClass] = (bySize[ship.sizeClass] || 0) + 1;
      total++; value += ship.cost;
    }
  }
  return value;
}

/** Relative desirability of each size class when auto-completing. */
const AUTOCOMPLETE_SIZE_WEIGHT = { tiny: 2, small: 4, medium: 3, large: 2, capital: 1, mothership: 0.5 };

/**
 * Fill the remaining budget with ships of the fleet's faction. Picks are
 * weighted (size-class preference × diversity: classes already owned in
 * numbers weigh less) and drawn from `rng`, so the result is deterministic for
 * a given rng state. A mothership is only considered when the fleet has none
 * and it passes the anchor rule. Stops when nothing affordable fits the caps;
 * if that is the 40-ship cap with budget left, the cheapest hulls are traded
 * up through the roster (see rosterUpgradePass) so the budget is really spent.
 *
 * @param {Fleet} fleet       validated or at least well-formed fleet
 * @param {number} budget
 * @param {{ next(): number }} [rng]  seeded RNG (shared/rng.js); omitted → deterministic midpoint picks
 * @returns {Fleet}
 */
export function autoComplete(fleet, budget = DEFAULT_BUDGET, rng) {
  const faction = fleet && typeof fleet.faction === 'string' ? fleet.faction : '';
  if (!FACTIONS[faction]) return normalizeFleet(fleet);
  const ledger = createLedger(faction, budget, fleet);
  const pool = shipsOfFaction(faction);
  const next = rng && typeof rng.next === 'function' ? () => rng.next() : () => 0.5;

  for (let guard = 0; guard < FLEET_LIMITS.maxShips + 1; guard++) {
    const candidates = [];
    const weights = [];
    let totalW = 0;
    for (const ship of pool) {
      if (!ledger.canBuy(ship.id)) continue;
      if (ship.sizeClass === 'mothership') {
        if (ledger.sizeCount('mothership') > 0 || !passesAnchorRule(ledger, ship.id)) continue;
      }
      const owned = ledger.count(ship.id);
      const w = AUTOCOMPLETE_SIZE_WEIGHT[ship.sizeClass] / (1 + owned / 4);
      candidates.push(ship.id);
      weights.push(w);
      totalW += w;
    }
    if (candidates.length === 0) break;
    ledger.buy(weightedPick(candidates, weights, totalW, next()));
  }
  // At the ship cap with budget left (endless-mode enemies, Guerra Total): trade up.
  rosterUpgradePass(ledger);
  return ledger.toFleet();
}

/**
 * Pick an item by weight using a uniform roll in [0, 1).
 * @template T
 * @param {T[]} items
 * @param {number[]} weights
 * @param {number} total
 * @param {number} roll
 * @returns {T}
 */
export function weightedPick(items, weights, total, roll) {
  let r = roll * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Display/heuristic summary of a fleet.
 * @param {Fleet} fleet
 * @returns {{ cost: number, count: number, bySize: Record<string, number>, ehp: number, dps: number }}
 */
export function fleetSummary(fleet) {
  const norm = normalizeFleet(fleet);
  const bySize = countBySize(norm);
  let ehp = 0;
  let dps = 0;
  for (const e of norm.ships) {
    const ship = SHIPS[e.cls];
    if (!ship) continue;
    ehp += shipEhp(ship) * e.count;
    dps += shipDps(ship) * e.count;
  }
  return { cost: fleetCost(norm), count: fleetShipCount(norm), bySize, ehp: round2(ehp), dps: round2(dps) };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Expand a fleet into class ids in deployment order: biggest size class first
 * (mothership → tiny), catalog order within a size class. Unknown classes are
 * dropped.
 * @param {Fleet} fleet
 * @returns {string[]}
 */
export function fleetToArray(fleet) {
  const norm = normalizeFleet(fleet);
  const entries = norm.ships.filter((e) => SHIPS[e.cls]);
  entries.sort((a, b) => {
    const da = SIZE_CLASS[SHIPS[a.cls].sizeClass].index;
    const db = SIZE_CLASS[SHIPS[b.cls].sizeClass].index;
    if (da !== db) return db - da;
    return CATALOG_INDEX.get(a.cls) - CATALOG_INDEX.get(b.cls);
  });
  const out = [];
  for (const e of entries) for (let i = 0; i < e.count; i++) out.push(e.cls);
  return out;
}

/**
 * An empty fleet for a faction (not valid: minShips is 1).
 * @param {string} faction
 * @returns {Fleet}
 */
export function emptyFleet(faction) {
  return { faction, ships: [] };
}
