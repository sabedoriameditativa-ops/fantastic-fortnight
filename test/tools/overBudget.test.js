import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overBudgetAdds } from '../../test-e2e/overBudget.js';
import { SHIPS, FACTION_IDS } from '../../shared/catalog.js';
import { FLEET_LIMITS, DEFAULT_BUDGET } from '../../shared/constants.js';
import { sizeClassCap } from '../../shared/fleet.js';

test('overBudgetAdds exceeds the budget while respecting the builder caps, for every faction', () => {
  for (const faction of FACTION_IDS) {
    const { adds, cost } = overBudgetAdds(faction, DEFAULT_BUDGET);
    assert.ok(cost > DEFAULT_BUDGET, `${faction}: ${cost} > ${DEFAULT_BUDGET}`);
    assert.equal(cost, adds.reduce((s, id) => s + SHIPS[id].cost, 0));
    assert.ok(adds.length <= FLEET_LIMITS.maxShips);
    const by = {};
    for (const id of adds) { const sc = SHIPS[id].sizeClass; by[sc] = (by[sc] || 0) + 1; assert.ok(by[sc] <= sizeClassCap(faction, sc), `${faction}: cap of ${sc}`); }
    // the last add is the one that crossed the budget: without it the fleet was still affordable
    assert.ok(cost - SHIPS[adds[adds.length - 1]].cost <= DEFAULT_BUDGET);
    for (const id of adds) assert.equal(SHIPS[id].faction, faction);
  }
});

test('overBudgetAdds throws when the caps cannot exceed the budget', () => {
  assert.throws(() => overBudgetAdds('terran', 1e9), /do not allow/);
  assert.throws(() => overBudgetAdds('nope'), /unknown faction/);
});
