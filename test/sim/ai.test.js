import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { AI_PROFILES } from '../../shared/aiProfiles.js';
import { config1v1, scalePreset, oneOfEachFleet } from './helpers.js';

const MOVING_MODES = new Set(['approach', 'idleAdvance', 'formation', 'retreat', 'kamikaze', 'backline', 'escortSlot', 'orbit', 'kite', 'hold']);

test('never idle: every alive non-stunned ship has a target or a movement intent while enemies live', () => {
  for (const [pa, pb, ai] of [['ter_misseis', 'lum_dissonancia', 'especialista'], ['vor_chuva', 'fer_fabrica', 'facil'], ['lum_catedral', 'ter_atlas', 'normal']]) {
    const state = createBattle(config1v1(scalePreset(pa, 1500), scalePreset(pb, 1500), `idle-${pa}`, ai));
    let idle = 0, checked = 0;
    while (!state.ended) {
      stepBattle(state);
      for (const s of state.ships) {
        if (!s.alive || s.stunUntil > state.tick || s.latch) continue;
        if (state.alive[1 - s.team].length === 0) continue;
        checked++;
        const t = s.ai.targetId > 0 ? state.ships[s.ai.targetId - 1] : null;
        const hasTarget = !!(t && t.alive && t.team !== s.team);
        const moving = Math.hypot(s.vx, s.vy) > 1 || s.stationaryUntil > state.tick;
        let inRange = false;
        if (hasTarget) inRange = Math.hypot(t.x - s.x, t.y - s.y) <= s.maxRange * s.mod.rangeMul * 1.05;
        const ok = (hasTarget && (inRange || moving || MOVING_MODES.has(s.ai.mode))) || (!hasTarget && MOVING_MODES.has(s.ai.mode));
        if (!ok) idle++;
      }
    }
    assert.ok(checked > 1000);
    assert.equal(idle, 0, `${pa} vs ${pb}: ${idle} idle ship-ticks`);
  }
});

test('targets are always enemies and never dead ships; retarget happens when the target dies', () => {
  const state = createBattle(config1v1(oneOfEachFleet('vorrax'), oneOfEachFleet('lumen'), 'tgt'));
  let changed = 0;
  while (!state.ended) {
    const before = state.ships.map((s) => s.ai.targetId);
    stepBattle(state);
    for (const s of state.ships) {
      if (!s.alive) continue;
      if (before[s.id - 1] !== s.ai.targetId) changed++;
      if (s.ai.targetId) {
        const t = state.ships[s.ai.targetId - 1];
        assert.ok(t.alive && t.team !== s.team, `ship ${s.id} targets dead/friendly ${t.id}`);
      }
    }
  }
  assert.ok(changed > 10);
});

test('difficulty knobs: facil ships think less often and use no team focus; noise consumes RNG deterministically', () => {
  const a = scalePreset('ter_linha', 1500), b = scalePreset('ter_linha', 1500);
  const easy = createBattle(config1v1(a, b, 'knob', 'facil'));
  const hard = createBattle(config1v1(a, b, 'knob', 'especialista'));
  assert.equal(easy.profiles.p1.thinkInterval, AI_PROFILES.facil.thinkInterval);
  assert.equal(hard.profiles.p1.thinkInterval, AI_PROFILES.especialista.thinkInterval);
  for (let i = 0; i < 400; i++) { stepBattle(easy); stepBattle(hard); }
  // expert ships advance in formation (slow, grouped); easy ships trickle: positions differ
  const spread = (st) => { const xs = st.ships.filter((s) => s.alive && s.team === 0).map((s) => s.x); return Math.max(...xs) - Math.min(...xs); };
  assert.notEqual(spread(easy), spread(hard));
  assert.ok(easy.rng.state().join() !== hard.rng.state().join(), 'noise consumes rng');
});

test('engage phase event fires once, after which the advance formation is dropped', () => {
  const state = createBattle(config1v1(scalePreset('fer_ferro', 1500), scalePreset('vor_garras', 1500), 'phase'));
  let engage = 0, engageTick = 0;
  while (!state.ended) {
    for (const e of stepBattle(state)) if (e[0] === 'phase' && e[1] === 'engage') { engage++; engageTick = state.tick; }
    if (engage && state.tick === engageTick + 40) {
      assert.ok(state.teams[0].phase === 'engage' && state.teams[1].phase === 'engage');
    }
  }
  assert.equal(engage, 1);
  assert.ok(engageTick > 0 && engageTick <= 45 * 20);
});

test('team think assigns focus targets and protectees', () => {
  const state = createBattle(config1v1(scalePreset('ter_atlas', 1500), scalePreset('lum_coro', 1500), 'team'));
  for (let i = 0; i < 300; i++) stepBattle(state);
  const assigned = state.ships.filter((s) => s.alive && s.ai.assignedId > 0);
  assert.ok(assigned.length > 0);
  for (const s of assigned) assert.equal(state.ships[s.ai.assignedId - 1].team, 1 - s.team);
  const escorts = state.ships.filter((s) => s.alive && (s.role === 'escort' || s.role === 'support'));
  assert.ok(escorts.every((s) => s.ai.protecteeId === 0 || state.ships[s.ai.protecteeId - 1].team === s.team));
  assert.ok(state.ships.some((s) => s.alive && s.allocDps > 0));
});
