import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle, makeSnapshot } from '../../shared/sim/battle.js';
import { config1v1, scalePreset } from './helpers.js';

const PAIRS = [['ter_linha', 'vor_mare'], ['lum_catedral', 'fer_apagao'], ['vor_garras', 'lum_coro'], ['fer_ferro', 'ter_misseis']];

test('per-tick invariants hold across several full battles', () => {
  for (let k = 0; k < PAIRS.length; k++) {
    const [pa, pb] = PAIRS[k];
    const state = createBattle(config1v1(scalePreset(pa, 1500), scalePreset(pb, 1500), `inv-${k}`));
    const { w, h } = state.world;
    const dieCount = new Map();
    const projOpen = new Set();
    const spawned = new Set();
    let pendOutcomes = [0, 0, 0];
    while (!state.ended) {
      const ev = stepBattle(state);
      for (const e of ev) {
        switch (e[0]) {
          case 'die': dieCount.set(e[1], (dieCount.get(e[1]) || 0) + 1); break;
          case 'proj': assert.ok(!projOpen.has(e[1]), 'duplicate proj id'); projOpen.add(e[1]); break;
          case 'pend': assert.ok(projOpen.has(e[1]), 'pend without proj'); projOpen.delete(e[1]); pendOutcomes[e[2]]++; break;
          case 'hit': assert.ok(Number.isInteger(e[2]) && e[2] >= 1, 'hit amount integer ≥ 1'); assert.ok(e[4] === 0 || e[4] === 1); break;
          case 'spawn': spawned.add(e[1]); assert.ok(e[8] > 0, 'spawn has a source'); break;
          default: break;
        }
      }
      // ship invariants
      let alive0 = 0, alive1 = 0, purchased0 = 0, purchased1 = 0;
      for (const s of state.ships) {
        assert.ok(s.hp <= s.hpMax + 1e-9, `hp ${s.hp} > max ${s.hpMax}`);
        assert.ok(s.shield >= 0 && s.shield <= s.shieldMax + 1e-9, 'shield out of range');
        if (!s.alive) { assert.equal(s.hp, 0); continue; }
        assert.ok(s.hp > 0, 'alive ship with hp <= 0');
        assert.ok(s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h, `ship ${s.id} outside arena (${s.x},${s.y})`);
        assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy) && Number.isFinite(s.heading));
        if (s.team === 0) { alive0++; if (s.purchased) purchased0++; } else { alive1++; if (s.purchased) purchased1++; }
      }
      assert.equal(state.alive[0].length, alive0);
      assert.equal(state.alive[1].length, alive1);
      assert.equal(state.alivePurchased[0], purchased0);
      assert.equal(state.alivePurchased[1], purchased1);
      // alive lists sorted by id
      for (const list of state.alive) for (let i = 1; i < list.length; i++) assert.ok(list[i] > list[i - 1]);
      // snapshot only lists alive ships
      const snap = makeSnapshot(state);
      assert.equal(snap.s.length, alive0 + alive1);
    }
    // every dead ship has exactly one die event; no alive ship has one
    for (const s of state.ships) {
      if (!s.alive) assert.equal(dieCount.get(s.id) || 0, 1, `ship ${s.id} die events`);
      else assert.equal(dieCount.get(s.id) || 0, 0);
    }
    for (const id of dieCount.keys()) assert.ok(state.ships[id - 1] && !state.ships[id - 1].alive);
    // every projectile launched has ended, or is still in flight at the end
    assert.equal(projOpen.size, state.projAlive);
    assert.ok(pendOutcomes[0] + pendOutcomes[1] + pendOutcomes[2] > 0);
    // spawned ships exist and are cost 0
    for (const id of spawned) { const s = state.ships[id - 1]; assert.ok(s && !s.purchased && s.cost === 0 && s.source > 0); }
  }
});

test('stats are consistent with events', () => {
  const state = createBattle(config1v1(scalePreset('ter_atlas', 1500), scalePreset('vor_chuva', 1500), 'stats'));
  let hitTotal = 0;
  const deaths = [];
  while (!state.ended) for (const e of stepBattle(state)) { if (e[0] === 'hit') hitTotal += e[2]; if (e[0] === 'die') deaths.push(e); }
  const r = state.ended;
  const dealt = r.players.p1.damageDealt + r.players.p2.damageDealt;
  const taken = r.players.p1.damageTaken + r.players.p2.damageTaken;
  assert.ok(Math.abs(dealt - taken) <= 2);
  assert.ok(Math.abs(dealt - hitTotal) < hitTotal * 0.02 + 50, `dealt ${dealt} vs hits ${hitTotal}`);
  const purchasedDeaths = deaths.filter((e) => state.ships[e[1] - 1].purchased).length;
  assert.equal(r.players.p1.losses + r.players.p2.losses, purchasedDeaths);
  assert.equal(r.players.p1.shipsTotal, state.ships.filter((s) => s.purchased && s.owner === 'p1').length);
  assert.equal(r.players.p1.shipsAlive, state.ships.filter((s) => s.purchased && s.owner === 'p1' && s.alive).length);
  assert.ok(r.mvp && r.mvp.damageDealt > 0);
  // scalar fields are finite numbers; damageByType / lost are per-type / per-class maps (debrief data)
  for (const pid of ['p1', 'p2']) for (const k of Object.keys(r.players[pid])) {
    const v = r.players[pid][k];
    if (k === 'damageByType' || k === 'lost') assert.ok(v && typeof v === 'object');
    else assert.ok(Number.isFinite(v), `${pid}.${k}`);
  }
});
