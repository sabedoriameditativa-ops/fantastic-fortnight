import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandFleet, planDeployment } from '../../shared/sim/deploy.js';
import { createBattle } from '../../shared/sim/battle.js';
import { worldSize, SPAWN_X_FRACTION } from '../../shared/constants.js';
import { SHIPS } from '../../shared/catalog.js';
import { scalePreset } from './helpers.js';

test('expandFleet orders by size class (big first) then catalog order, repeating counts', () => {
  const fleet = { faction: 'terran', ships: [{ cls: 'ter_vespa', count: 2 }, { cls: 'ter_prometeu', count: 1 }, { cls: 'ter_falcao', count: 1 }, { cls: 'ter_lanca', count: 1 }] };
  assert.deepEqual(expandFleet(fleet), ['ter_prometeu', 'ter_falcao', 'ter_lanca', 'ter_vespa', 'ter_vespa']);
  assert.deepEqual(expandFleet({ faction: 'terran', ships: [{ cls: 'ter_vespa', count: 0 }] }), []);
});

test('deployment: team 0 left facing +x, team 1 mirrored, columns by size from the rear, inside lanes, no overlap', () => {
  const players = [
    { id: 'a', team: 0, fleet: scalePreset('ter_linha', 1500) },
    { id: 'b', team: 0, fleet: scalePreset('vor_mare', 1500) },
    { id: 'c', team: 1, fleet: scalePreset('lum_coro', 1500) },
    { id: 'd', team: 1, fleet: scalePreset('fer_ferro', 1500) },
  ];
  const world = worldSize(2);
  const placed = planDeployment(players, world);
  assert.equal(placed.length, players.reduce((n, p) => n + p.fleet.ships.reduce((m, e) => m + e.count, 0), 0));
  for (const s of placed) {
    const r = SHIPS[s.cls].radius;
    assert.ok(s.x >= r && s.x <= world.w - r && s.y >= r && s.y <= world.h - r, `inside arena ${s.cls}`);
    if (s.team === 0) { assert.equal(s.a, 0); assert.ok(s.x < world.w / 2); } else { assert.equal(s.a, Math.PI); assert.ok(s.x > world.w / 2); }
  }
  // lanes: player a in the top half, player b in the bottom half (team 0 has two lanes)
  const ay = placed.filter((s) => s.owner === 'a').map((s) => s.y), by = placed.filter((s) => s.owner === 'b').map((s) => s.y);
  assert.ok(Math.max(...ay) <= world.h / 2 + 1e-9 && Math.min(...by) >= world.h / 2 - 1e-9);
  // columns: rear-most class at SPAWN_X_FRACTION·W, bigger classes closer to the own edge
  const a = placed.filter((s) => s.owner === 'a');
  const xOf = (cls) => a.filter((s) => s.cls === cls).map((s) => s.x);
  assert.ok(Math.abs(Math.min(...xOf('ter_prometeu')) - SPAWN_X_FRACTION * world.w) < 1e-9);
  assert.ok(Math.min(...xOf('ter_hercules')) > Math.max(...xOf('ter_prometeu')));
  assert.ok(Math.min(...xOf('ter_vespa')) > Math.max(...xOf('ter_falcao')));
  // mirrored: team 1 columns advance toward -x
  const c = placed.filter((s) => s.owner === 'c');
  const cx = (cls) => c.filter((s) => s.cls === cls).map((s) => s.x);
  assert.ok(Math.max(...cx('lum_centelha')) < Math.min(...cx('lum_luz_primordial')));
  // no initial overlaps
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const p = placed[i], q = placed[j];
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    assert.ok(d >= SHIPS[p.cls].radius + SHIPS[q.cls].radius - 1e-6, `overlap ${p.cls}/${q.cls} d=${d}`);
  }
});

test('createBattle validates config and assigns sequential ids in deployment order', () => {
  assert.throws(() => createBattle({ seed: 1, players: [] }));
  assert.throws(() => createBattle({ seed: 1, players: [{ id: 'x', team: 2, fleet: { ships: [] } }] }));
  assert.throws(() => createBattle({ seed: 1, players: [{ id: 'x', team: 0, fleet: { ships: [{ cls: 'nope', count: 1 }] } }] }));
  const state = createBattle({ seed: 1, players: [
    { id: 'h', name: 'H', team: 0, isBot: false, fleet: scalePreset('vor_garras', 800) },
    { id: 'b', name: 'B', team: 1, isBot: true, ai: 'facil', fleet: scalePreset('ter_atlas', 800) },
  ] });
  state.ships.forEach((s, i) => assert.equal(s.id, i + 1));
  assert.equal(state.profiles.h.id, 'especialista', 'humans get the expert profile');
  assert.equal(state.profiles.b.id, 'facil');
  assert.deepEqual(state.world, worldSize(1));
});
