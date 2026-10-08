import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../../shared/sim/battle.js';
import { decide } from '../../shared/sim/ai.js';
import { normalizeFleet } from '../../shared/fleet.js';
import { FORMATIONS, normalizePlanning } from '../../shared/planning.js';
import { clearGrid, insertGrid } from '../../shared/sim/spatial.js';

function fleet(planning) { return { faction: 'terran', planning, ships: [{ cls: 'ter_hercules', count: 2 }, { cls: 'ter_falcao', count: 6 }] }; }
function cfg(planning) { return { seed: 1, players: [{ id: 'a', team: 0, fleet: fleet(planning) }, { id: 'b', team: 1, fleet: fleet(planning) }] }; }

test('planning is bounded and survives fleet normalization together with the pilot reservation', () => {
  const plan = { formation: 'wedge', position: 'rear', priority: 'support' };
  assert.deepEqual(normalizeFleet({ ...fleet(plan), pilot: true }).planning, plan);
  assert.equal(normalizeFleet({ ...fleet(plan), pilot: true }).pilot, true);
  assert.deepEqual(normalizePlanning({ formation: 'typo', position: Infinity }), { formation: 'balanced', position: 'center', priority: 'balanced' });
});

test('formation and positioning alter deployment while preserving exact side mirroring', () => {
  const base = createBattle(cfg({ formation: 'balanced', position: 'center' }));
  for (const formation of Object.keys(FORMATIONS)) for (const position of ['front', 'center', 'rear']) {
    const st = createBattle(cfg({ formation, position })), left = st.ships.filter((s) => s.team === 0), right = st.ships.filter((s) => s.team === 1);
    for (let i = 0; i < left.length; i++) {
      assert.ok(Math.abs(left[i].x + right[i].x - st.world.w) < 1e-8);
      assert.equal(left[i].y, right[i].y);
      assert.ok(left[i].x >= left[i].radius && left[i].x <= st.world.w * 0.4);
    }
    if (formation !== 'balanced' || position !== 'center') assert.notDeepEqual(left.map((s) => [s.x, s.y]), base.ships.filter((s) => s.team === 0).map((s) => [s.x, s.y]));
  }
});

test('support priority affects actual target selection and is kept as a ship decision reason', () => {
  const st = createBattle(cfg({ priority: 'support' })), me = st.ships[0], enemies = st.ships.filter((s) => s.team === 1);
  me.x = 1000; me.y = 700; me.ai.targetId = 0; me.ai.assignedId = 0;
  for (const e of enemies) { e.x = 1200; e.y = 700; e.ai.targetId = me.id; }
  enemies[0].role = 'brawler'; enemies[1].role = 'support';
  clearGrid(st.grid); for (const s of st.ships) insertGrid(st.grid, s.id, s.x, s.y);
  decide(st, me);
  assert.equal(me.ai.targetId, enemies[1].id);
  assert.equal(me.planning.priority, 'support');
});
