// Debrief data in the BattleResult (shared/sim/stats.js): damage per weapon type,
// purchased ships lost per class and the top killer ship of each team.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, runToEnd } from '../../shared/sim/battle.js';
import { SHIPS } from '../../shared/catalog.js';
import { scalePreset } from './helpers.js';

const config = (seed = 'debrief') => ({ seed, players: [
  { id: 'p1', name: 'A', team: 0, isBot: true, ai: 'especialista', fleet: scalePreset('ter_atlas', 1500) },
  { id: 'p2', name: 'B', team: 1, isBot: true, ai: 'especialista', fleet: scalePreset('vor_chuva', 1500) },
] });

describe('result debrief data', () => {
  test('damageByType sums to damageDealt and only names weapon types that hit', () => {
    const r = runToEnd(config());
    for (const id of ['p1', 'p2']) {
      const ps = r.players[id];
      assert.ok(ps.damageByType && typeof ps.damageByType === 'object');
      const types = Object.keys(ps.damageByType);
      assert.ok(types.length >= 1, id);
      const sum = types.reduce((a, t) => a + ps.damageByType[t], 0);
      assert.ok(Math.abs(sum - ps.damageDealt) <= types.length, `${id}: Σ ${sum} vs ${ps.damageDealt} (rounding only)`);
      for (const t of types) assert.ok(Number.isInteger(ps.damageByType[t]) && ps.damageByType[t] > 0, `${id}.${t}`);
    }
    assert.ok(r.players.p1.damageByType.kinetic > 0, 'Terran autocannons hit');
    assert.ok(r.players.p2.damageByType.plasma > 0 || r.players.p2.damageByType.bio > 0, 'Vorrax plasma / bio hit');
  });

  test('lost counts purchased ships per class and matches losses; spawned units are excluded', () => {
    const state = createBattle(config());
    while (!state.ended) stepBattle(state);
    const r = state.ended;
    for (const id of ['p1', 'p2']) {
      const ps = r.players[id];
      const total = Object.values(ps.lost).reduce((a, b) => a + b, 0);
      assert.equal(total, ps.losses, `${id}: lost per class = losses`);
      const dead = state.ships.filter((s) => s.purchased && s.owner === id && !s.alive);
      for (const cls of Object.keys(ps.lost)) {
        assert.ok(SHIPS[cls], cls);
        assert.equal(ps.lost[cls], dead.filter((s) => s.cls === cls).length);
      }
      assert.equal(ps.lost.ter_vespa, undefined, 'launched squadrons (spawned, unpurchased) are not losses');
    }
  });

  test('killers: the ship with most kills per team (damage as tiebreak), null for a team without kills', () => {
    const state = createBattle(config());
    while (!state.ended) stepBattle(state);
    const r = state.ended;
    assert.ok(Array.isArray(r.killers) && r.killers.length === 2);
    for (let t = 0; t < 2; t++) {
      const best = state.ships.filter((s) => s.team === t && s.kills > 0).sort((a, b) => b.kills - a.kills || b.damageDealt - a.damageDealt)[0];
      if (!best) { assert.equal(r.killers[t], null); continue; }
      assert.equal(r.killers[t].shipId, best.id);
      assert.equal(r.killers[t].cls, best.cls);
      assert.equal(r.killers[t].kills, best.kills);
      assert.equal(r.killers[t].owner, best.owner);
      assert.equal(r.killers[t].damageDealt, Math.round(best.damageDealt));
    }
    assert.ok(r.killers[0] || r.killers[1], 'somebody killed something');
  });

  test('the debrief fields are deterministic (same seed → same maps)', () => {
    const a = runToEnd(config('det')), b = runToEnd(config('det'));
    assert.deepEqual(a.players.p1.damageByType, b.players.p1.damageByType);
    assert.deepEqual(a.players.p2.lost, b.players.p2.lost);
    assert.deepEqual(a.killers, b.killers);
  });
});
