import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { AI_PROFILES } from '../../shared/aiProfiles.js';
import { config1v1, scalePreset, oneOfEachFleet } from './helpers.js';
import { SHIPS } from '../../shared/catalog.js';

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

/** Keep a ship from shooting or casting (a passive, still-moving target). */
function disarm(s) {
  for (const w of s.weapons) w.readyAt = 1e9;
  s.ability.readyAt = 1e9;
}

test('orbit keeps fixed-arc guns on target: every diver fires on ≥ 50% of the ticks its weapon is ready while in range of a large target', () => {
  const DIVERS = ['ter_vespa', 'lum_centelha', 'fer_vetor', 'vor_zangao', 'vor_larva'];
  for (const cls of DIVERS) {
    let ready = 0, fired = 0;
    for (const seed of [1, 2, 3]) {
      const a = { faction: SHIPS[cls].faction, ships: [{ cls, count: 1 }] };
      const b = { faction: 'terran', ships: [{ cls: 'ter_hercules', count: 1 }] };
      const state = createBattle(config1v1(a, b, `orbit-${cls}-${seed}`, 'especialista', { maxTicks: 1500 }));
      const s = state.ships[0], t = state.ships[1], w = s.weapons[0];
      assert.ok(w.arcRad < Math.PI / 2, `${cls} has a fixed narrow gun`);
      disarm(t);
      while (!state.ended) {
        const wasReady = w.readyAt <= state.tick + 1; // ready in the coming tick's weapons phase
        const ev = stepBattle(state);
        if (!s.alive || !t.alive) break;
        const R = w.def.range * w.mod.rangeMul * s.mod.rangeMul + w.mod.rangeAdd;
        if (!wasReady || Math.hypot(t.x - s.x, t.y - s.y) > R || s.ai.mode !== 'orbit') continue;
        ready++;
        if (ev.some((e) => (e[0] === 'shot' && e[1] === s.id && e[3] === 0) || (e[0] === 'proj' && e[2] === s.id && e[4] === 0))) fired++;
      }
    }
    assert.ok(ready > 100, `${cls}: only ${ready} ready-in-range orbit ticks`);
    assert.ok(fired >= 0.5 * ready, `${cls}: fired on ${fired}/${ready} ready ticks in orbit (${(100 * fired / ready).toFixed(0)}%)`);
  }
});

test('retreat ends by the time cap at most once per cooldown; hulls without regen exit on shield recovery', () => {
  const fleet = scalePreset('lum_coro', 1500);
  const state = createBattle(config1v1(fleet, fleet, 'retreat-cd'));
  for (let i = 0; i < 20; i++) stepBattle(state);
  const prisma = state.ships.find((s) => s.cls === 'lum_prisma' && s.team === 0);
  assert.equal(prisma.regen, 0);
  const enemy = state.ships.find((s) => s.team === 1);
  // keep the fight far away so the prisma is only ever hurt by hand
  for (const s of state.ships) if (s.team === 1) { s.x = state.world.w - 150; disarm(s); }
  prisma.ai.targetId = enemy.id;
  prisma.hp = 0.3 * prisma.hpMax; prisma.shield = 0; prisma.lastShieldHitTick = state.tick; // below the kiter threshold 0.4
  let entered = -1;
  for (let i = 0; i < 40 && entered < 0; i++) { stepBattle(state); if (prisma.ai.retreating) entered = state.tick; }
  assert.ok(entered > 0, 'retreat entered');
  prisma.shield = 0; prisma.lastShieldHitTick = state.tick + 10000; // shields kept broken: only the time cap can end this retreat
  while (prisma.ai.retreating && state.tick < entered + 12 * 20) { stepBattle(state); prisma.shield = 0; prisma.hp = 0.3 * prisma.hpMax; }
  assert.ok(!prisma.ai.retreating, 'retreat ended by the 10 s cap');
  assert.ok(state.tick - entered >= 10 * 20 && state.tick - entered <= 10 * 20 + 20, `cap hit after ${state.tick - entered} ticks`);
  assert.ok(prisma.ai.retreatBlockedUntil >= state.tick + 14 * 20, 'cooldown set');
  // still below the threshold: no new retreat episode during the cooldown
  for (let i = 0; i < 10 * 20; i++) { stepBattle(state); prisma.hp = 0.3 * prisma.hpMax; prisma.shield = 0; assert.ok(!prisma.ai.retreating, `re-entered retreat at +${i} ticks`); }
  // after the cooldown a new retreat is allowed, and it exits as soon as the shield is back (hull cannot regenerate)
  while (state.tick < prisma.ai.retreatBlockedUntil + 1) { stepBattle(state); prisma.hp = 0.3 * prisma.hpMax; }
  let again = -1;
  for (let i = 0; i < 40 && again < 0; i++) { stepBattle(state); prisma.hp = 0.3 * prisma.hpMax; if (prisma.ai.retreating) again = state.tick; }
  assert.ok(again > 0, 'retreat allowed again after the cooldown');
  prisma.shield = prisma.shieldMax;
  for (let i = 0; i < 12 && prisma.ai.retreating; i++) { stepBattle(state); prisma.hp = 0.3 * prisma.hpMax; }
  assert.ok(!prisma.ai.retreating, 'shield recovered → retreat over although the hull is still low');
  assert.ok(state.tick - again < 10 * 20, 'exited before the cap');
});
