import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBattle, summarize, scalePreset } from '../../shared/sim/harness.js';
import { MAX_TICKS } from '../../shared/constants.js';

// 32 seeds: with 16 the ±25 band fails by chance ≈ 4% of the time (identical fleets are a coin flip decided by early hit rolls)
test('mirror match sanity: a preset vs itself over 32 seeds (sides swapped) stays within 50% ± 25', () => {
  for (const id of ['vor_garras', 'lum_catedral']) {
    const fleet = scalePreset(id, 1500);
    const runs = [];
    for (let seed = 0; seed < 32; seed++) runs.push(runBattle(fleet, fleet, seed));
    const s = summarize(runs);
    assert.equal(s.n, 32);
    const decided = s.n - s.draws;
    const rate = decided > 0 ? s.winsA / decided : 0.5;
    assert.ok(rate >= 0.25 && rate <= 0.75, `${id}: side A win rate ${rate} (${s.winsA}/${decided})`);
    assert.ok(s.draws <= 8, `${id}: ${s.draws} draws`);
    for (const r of runs) assert.ok(r.ticks <= MAX_TICKS);
  }
});
