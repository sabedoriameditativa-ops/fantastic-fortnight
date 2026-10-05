// Derives, from the catalog, a sequence of fleet-builder "+" clicks that takes a
// faction's fleet over the budget while respecting the per-size-class and total
// caps the builder enforces (shared/fleet.js). Used by test-e2e/run.js so the
// over-budget case keeps working when ship costs or ids are retuned.

import { SHIP_LIST } from '../shared/catalog.js';
import { FLEET_LIMITS, DEFAULT_BUDGET } from '../shared/constants.js';
import { sizeClassCap } from '../shared/fleet.js';

/**
 * @param {string} faction
 * @param {number} [budget]
 * @returns {{ adds: string[], cost: number }} ship ids in click order (most expensive first) and the resulting cost
 * @throws when the caps make it impossible to exceed the budget
 */
export function overBudgetAdds(faction, budget = DEFAULT_BUDGET) {
  const ships = SHIP_LIST.filter((s) => s.faction === faction).sort((a, b) => b.cost - a.cost || (a.id < b.id ? -1 : 1));
  if (!ships.length) throw new Error(`unknown faction "${faction}"`);
  const bySize = {};
  const adds = [];
  let cost = 0;
  for (const s of ships) {
    const cap = sizeClassCap(faction, s.sizeClass);
    while ((bySize[s.sizeClass] || 0) < cap && adds.length < FLEET_LIMITS.maxShips && cost <= budget) {
      bySize[s.sizeClass] = (bySize[s.sizeClass] || 0) + 1;
      adds.push(s.id);
      cost += s.cost;
    }
    if (cost > budget) return { adds, cost };
  }
  throw new Error(`${faction}: the size-class caps do not allow a fleet above ${budget} pts (max ${cost})`);
}
