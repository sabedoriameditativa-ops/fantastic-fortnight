import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, stepBattle } from '../../shared/sim/battle.js';
import { teamThink } from '../../shared/sim/ai.js';
import { getTables } from '../../shared/sim/tables.js';
import { clearGrid, insertGrid } from '../../shared/sim/spatial.js';
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
  // after the cooldown a new retreat is allowed (shield still broken), and it exits as soon as the shield is back
  // (hull cannot regenerate); that exit starts a cooldown of its own
  while (state.tick < prisma.ai.retreatBlockedUntil + 1) { stepBattle(state); prisma.hp = 0.3 * prisma.hpMax; prisma.shield = 0; }
  let again = -1;
  for (let i = 0; i < 40 && again < 0; i++) { stepBattle(state); prisma.hp = 0.3 * prisma.hpMax; prisma.shield = 0; if (prisma.ai.retreating) again = state.tick; }
  assert.ok(again > 0, 'retreat allowed again after the cooldown');
  prisma.shield = prisma.shieldMax;
  for (let i = 0; i < 12 && prisma.ai.retreating; i++) { stepBattle(state); prisma.hp = 0.3 * prisma.hpMax; }
  assert.ok(!prisma.ai.retreating, 'shield recovered → retreat over although the hull is still low');
  assert.ok(state.tick - again < 10 * 20, 'exited before the cap');
  assert.ok(prisma.ai.retreatBlockedUntil >= state.tick + 14 * 20, 'every exit starts the cooldown');
});

test('no retreat flip-flop: a regen-less hull at 30% with full shields never retreats, with broken shields at most once per cooldown', () => {
  const fleet = scalePreset('lum_coro', 1500);
  const state = createBattle(config1v1(fleet, fleet, 'retreat-flip'));
  for (let i = 0; i < 20; i++) stepBattle(state);
  const prisma = state.ships.find((s) => s.cls === 'lum_prisma' && s.team === 0);
  const enemy = state.ships.find((s) => s.team === 1);
  for (const s of state.ships) { disarm(s); if (s.team === 1) s.x = state.world.w - 150; } // nobody dies: the battle lasts the whole observation
  prisma.ai.targetId = enemy.id;
  // full shield: a hull that cannot heal has nothing to recover by retreating
  for (let i = 0; i < 20 * 20; i++) { prisma.hp = 0.3 * prisma.hpMax; prisma.shield = prisma.shieldMax; stepBattle(state); assert.ok(!prisma.ai.retreating, `retreated with a full shield at +${i}`); }
  // broken shield: one episode, exit on recovery, no re-entry for the cooldown even if the shield breaks again
  let entries = 0, was = false;
  const t0 = state.tick;
  for (let i = 0; i < 30 * 20; i++) {
    prisma.hp = 0.3 * prisma.hpMax;
    prisma.shield = prisma.ai.retreating ? prisma.shieldMax : 0; prisma.lastShieldHitTick = state.tick + 10000;
    stepBattle(state);
    if (prisma.ai.retreating && !was) entries++;
    was = prisma.ai.retreating;
  }
  assert.ok(entries >= 1, 'retreat entered with a broken shield');
  assert.ok(entries <= 2, `${entries} retreat entries in 30 s (≤ 1 per 15 s cooldown expected)`);
  assert.ok(state.tick - t0 >= 30 * 20);
});

test('fixed-gun kiters keep shooting while kiting a chaser: ≥ 75% of the gun cadence, ready-but-silent on < 12% of kite ticks', () => {
  // before the fix a Cuspidor (90° arc) chased by a Hércules fired 0.01 shots/s (cadence 0.40) with its gun ready and
  // the enemy in range on 95% of its kite ticks: the band strafe ran on the exact tangent (target at the arc edge)
  // and the back-off run turned its back; the Sentinela (30°), Aríete (25°) and Véu (90°) likewise
  for (const [cls, foe] of [['vor_cuspidor', 'ter_hercules'], ['vor_cuspidor', 'ter_orion'], ['fer_sentinela', 'ter_hercules'], ['fer_ariete', 'vor_rainha'], ['lum_veu', 'ter_hercules']]) {
    let kiteTicks = 0, silent = 0, shots = 0, inRangeTicks = 0;
    for (const seed of [1, 2, 3]) {
      const a = { faction: SHIPS[cls].faction, ships: [{ cls, count: 1 }] };
      const b = { faction: SHIPS[foe].faction, ships: [{ cls: foe, count: 1 }] };
      const state = createBattle(config1v1(a, b, `kite-${cls}-${seed}`, 'especialista', { maxTicks: 1500 }));
      const s = state.ships[0], t = state.ships[1], w = s.weapons[0];
      assert.ok(w.arcRad <= Math.PI / 2, `${cls} has a fixed gun`);
      disarm(t);
      while (!state.ended) {
        const wasReady = w.readyAt <= state.tick + 1; // ready in the coming tick's weapons phase
        const ev = stepBattle(state);
        if (!s.alive || !t.alive) break;
        if (s.ai.mode !== 'kite') continue;
        kiteTicks++;
        const R = w.def.range * w.mod.rangeMul * s.mod.rangeMul + w.mod.rangeAdd;
        const inRange = Math.hypot(t.x - s.x, t.y - s.y) <= R;
        if (inRange) inRangeTicks++;
        const fired = ev.some((e) => (e[0] === 'shot' && e[1] === s.id && e[3] === 0) || (e[0] === 'proj' && e[2] === s.id && e[4] === 0));
        if (fired) shots++;
        else if (wasReady && inRange) silent++;
      }
    }
    assert.ok(kiteTicks > 1500, `${cls}: only ${kiteTicks} kite ticks`);
    const cadence = shots / (inRangeTicks / 20), max = 1 / SHIPS[cls].weapons[0].cooldown;
    assert.ok(cadence >= 0.75 * max, `${cls} vs ${foe}: ${cadence.toFixed(2)} shots/s in range (cadence ${max.toFixed(2)})`);
    assert.ok(silent < 0.12 * kiteTicks, `${cls} vs ${foe}: gun ready with the enemy in range but silent on ${(100 * silent / kiteTicks).toFixed(0)}% of kite ticks`);
  }
});

test('a fixed-gun kiter runs only from a threat it can outrun with the turn to shoot paid for; otherwise it stands and fires', () => {
  // Harmônico (60° lance firing every second, 100 u/s) vs a Hércules (65 u/s): running would cost it the shot on
  // every cooldown, so it holds its ground in the band and fires at full cadence
  let ready = 0, fired = 0, away = 0, kite = 0;
  for (const seed of [1, 2, 3]) {
    const a = { faction: 'lumen', ships: [{ cls: 'lum_harmonico', count: 1 }] };
    const b = { faction: 'terran', ships: [{ cls: 'ter_hercules', count: 1 }] };
    const state = createBattle(config1v1(a, b, `kite-stand-${seed}`, 'especialista', { maxTicks: 1500 }));
    const s = state.ships[0], t = state.ships[1], w = s.weapons[0];
    disarm(t);
    while (!state.ended) {
      const wasReady = w.readyAt <= state.tick + 1;
      const ev = stepBattle(state);
      if (!s.alive || !t.alive) break;
      if (s.ai.mode !== 'kite') continue;
      kite++;
      const bearing = Math.atan2(t.y - s.y, t.x - s.x);
      let off = Math.abs(bearing - s.heading); if (off > Math.PI) off = 2 * Math.PI - off;
      if (off > 2 * Math.PI / 3) away++;
      if (!wasReady || Math.hypot(t.x - s.x, t.y - s.y) > w.def.range) continue;
      ready++;
      if (ev.some((e) => e[0] === 'shot' && e[1] === s.id && e[3] === 0)) fired++;
    }
  }
  assert.ok(ready > 100 && kite > 1000, `${ready} ready ticks, ${kite} kite ticks`);
  assert.ok(fired >= 0.95 * ready, `fired on ${fired}/${ready} ready ticks`);
  assert.ok(away < 0.05 * kite, `turned its back on the target on ${(100 * away / kite).toFixed(0)}% of kite ticks`);
});

test('supports never escort another support: every Véu protectee is a non-support ally, a medium+ line ship when one lives', () => {
  for (const [pa, pb] of [['lum_catedral', 'ter_misseis'], ['lum_dissonancia', 'vor_chuva']]) {
    const state = createBattle(config1v1(scalePreset(pa, 1500), scalePreset(pb, 1500), `veu-${pa}`));
    let checked = 0;
    while (!state.ended && state.tick < 90 * 20) {
      stepBattle(state);
      for (const s of state.ships) {
        if (!s.alive || s.role !== 'support' || s.ai.protecteeId <= 0) continue;
        const p = state.ships[s.ai.protecteeId - 1];
        if (!p.alive) continue;
        checked++;
        assert.equal(p.team, s.team);
        assert.notEqual(p.role, 'support', `tick ${state.tick}: ${s.cls} ${s.id} escorts ${p.cls} ${p.id}`);
        assert.ok(p.sizeIdx > 0, 'never a tiny');
        const lineAlive = state.ships.some((a) => a.alive && a.team === s.team && a.sizeIdx >= 2 && ['brawler', 'kiter', 'escort', 'striker'].includes(a.role));
        if (lineAlive) assert.ok(p.sizeIdx >= 2 && ['brawler', 'kiter', 'escort', 'striker'].includes(p.role), `tick ${state.tick}: protectee ${p.cls} is not a medium+ line ship`);
      }
    }
    assert.ok(checked > 500, `${checked} protectee ticks checked`);
  }
});

test('expendables never retreat: spawned units and cheap tiny ships fight on; hurt larvae dive instead of fleeing', () => {
  let spawnedTicks = 0, larvae = 0, dives = 0;
  for (const [pa, pb] of [['ter_linha', 'vor_mare'], ['fer_fabrica', 'lum_catedral']]) {
    const state = createBattle(config1v1(scalePreset(pa, 1500), scalePreset(pb, 1500), `expendable-${pa}`));
    const seen = new Set();
    while (!state.ended) {
      stepBattle(state);
      for (const s of state.ships) {
        if (!s.alive) continue;
        if (!s.purchased || (s.sizeIdx === 0 && s.cost < 20)) {
          if (!s.purchased) spawnedTicks++;
          assert.ok(!s.ai.retreating, `${s.cls} ${s.id} (purchased=${s.purchased}, cost ${s.cost}) retreats at tick ${state.tick}`);
        }
        if (s.cls === 'vor_larva' && !seen.has(s.id)) { seen.add(s.id); larvae++; }
        if (s.cls === 'vor_larva' && s.kamikaze && !seen.has(-s.id)) { seen.add(-s.id); dives++; assert.equal(s.ai.mode, 'kamikaze'); }
      }
    }
  }
  assert.ok(spawnedTicks > 2000, 'spawned units were observed');
  assert.ok(larvae > 20 && dives >= 0.2 * larvae, `${dives}/${larvae} larvae dove`);
});

test('a larva below half hull with an enemy within 250 u dives at the nearest enemy', () => {
  const a = { faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 1 }] };
  const b = { faction: 'terran', ships: [{ cls: 'ter_orion', count: 2 }] };
  const state = createBattle(config1v1(a, b, 'larva-dive', 'especialista', { maxTicks: 600 }));
  const larva = state.ships[0];
  for (const s of state.ships) if (s.team === 1) disarm(s);
  const near = state.ships[1], far = state.ships[2];
  near.x = larva.x + 200; near.y = larva.y; far.x = larva.x + 500; far.y = larva.y + 300;
  larva.ai.targetId = far.id;
  larva.hp = 0.45 * larva.hpMax;
  for (let i = 0; i < 8 && !larva.kamikaze; i++) stepBattle(state);
  assert.ok(larva.kamikaze, 'dive started');
  assert.equal(larva.ai.mode, 'kamikaze');
  assert.equal(larva.ai.targetId, near.id, 'dives at the nearest enemy, not the far target');
  assert.ok(!larva.ai.retreating);
  assert.ok(state.kamikazes.includes(larva.id));
  // the dive sticks and ends in a bile burst
  let died = false;
  while (!state.ended && !died) for (const e of stepBattle(state)) if (e[0] === 'die' && e[1] === larva.id) died = true;
  assert.ok(died, 'larva detonated');
});

test('motherships hold at ≥ 0.85× main-gun range and never lead the fleet; carriers that outrange the line fight from the backline', () => {
  const buf = [];
  // before the fix the Colmeia-Mãe was the closest line ship to the enemy on 51-57% of engaged ticks and the Núcleo
  // Fabril sat beyond its 600 u railguns behind a cost centroid its own mothership dragged back
  for (const [pa, pb, carriers] of [['ter_linha', 'vor_mare', false], ['lum_dissonancia', 'vor_chuva', false], ['fer_fabrica', 'lum_catedral', true]]) {
    const state = createBattle(config1v1(scalePreset(pa, 1500), scalePreset(pb, 1500), `anchor-${pa}`));
    const front = { ticks: 0, closest: 0 };
    const carrier = { ticks: 0, inRange: 0 };
    while (!state.ended) {
      stepBattle(state);
      if (!state.engaged) continue;
      for (let team = 0; team < 2; team++) {
        const T = state.teams[team];
        const line = state.alive[team].map((id) => state.ships[id - 1]).filter((s) => s.purchased && s.role !== 'diver' && s.role !== 'carrier');
        const anchor = line.find((s) => s.role === 'anchor');
        if (anchor && line.length >= 4) {
          const d = (s) => Math.hypot(T.enemyCx - s.x, T.enemyCy - s.y);
          front.ticks++;
          if (line.every((s) => s === anchor || d(s) >= d(anchor))) front.closest++;
        }
        for (const s of state.alive[team].map((id) => state.ships[id - 1])) {
          if (s.role !== 'carrier' || s.ai.mode !== 'backline') continue;
          carrier.ticks++;
          buf.length = 0;
          for (const id of state.alive[1 - team]) { const e = state.ships[id - 1]; if (Math.hypot(e.x - s.x, e.y - s.y) <= s.maxRange) { carrier.inRange++; break; } }
        }
      }
    }
    if (!carriers) {
      assert.ok(front.ticks > 500);
      assert.ok(front.closest / front.ticks < 0.25, `${pa} vs ${pb}: anchor is the closest line ship to the enemy on ${(100 * front.closest / front.ticks).toFixed(0)}% of engaged ticks`);
      continue;
    }
    assert.ok(carrier.ticks > 300);
    assert.ok(carrier.inRange / carrier.ticks > 0.4, `${pa} vs ${pb}: carriers in gun range on ${(100 * carrier.inRange / carrier.ticks).toFixed(0)}% of backline ticks`);
  }
});

test('team focus spills: a target already allocated 2 s worth of killing dps takes no further ships while another candidate exists', () => {
  const a = { faction: 'terran', ships: [{ cls: 'ter_falcao', count: 6 }] };
  const b = { faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 1 }, { cls: 'vor_mandibula', count: 2 }] };
  const state = createBattle(config1v1(a, b, 'spill'));
  const falcons = state.ships.filter((s) => s.cls === 'ter_falcao'), larva = state.ships.find((s) => s.cls === 'vor_larva');
  const mands = state.ships.filter((s) => s.cls === 'vor_mandibula');
  // everyone inside every Falcão's candidate radius, the larva nearest (the most attractive target by cost/ehp)
  falcons.forEach((f, i) => { f.x = 1000; f.y = 700 + i * 40; });
  larva.x = 1200; larva.y = 800; mands[0].x = 1250; mands[0].y = 700; mands[1].x = 1250; mands[1].y = 900;
  clearGrid(state.grid); for (const s of state.ships) insertGrid(state.grid, s.id, s.x, s.y);
  teamThink(state, 0);
  const dps = getTables().shipDps[falcons[0].clsIdx][larva.clsIdx];
  assert.ok(dps > 0);
  const onLarva = falcons.filter((f) => f.ai.assignedId === larva.id).length;
  const cap = Math.ceil((larva.hp + larva.shield) / (2 * dps)); // ships whose 2 s of dps the larva's ehp absorbs
  assert.ok(onLarva >= 1 && onLarva <= cap, `${onLarva} Falcões on the larva (saturation after ${cap})`);
  assert.ok(falcons.every((f) => f.ai.assignedId === larva.id || mands.some((m) => m.id === f.ai.assignedId)), 'the rest spill to the Mandíbulas');
  assert.ok(falcons.some((f) => f.ai.assignedId !== larva.id), 'at least one ship spilled');
  // without another candidate the saturated target still takes everyone
  for (const m of mands) { m.x = 2600; m.y = 100; }
  clearGrid(state.grid); for (const s of state.ships) insertGrid(state.grid, s.id, s.x, s.y);
  teamThink(state, 0);
  assert.ok(falcons.every((f) => f.ai.assignedId === larva.id), 'nothing else in reach: all on the larva');
});

test('a heavy-alpha ship whose target died falls back to the nearest enemy worth its shot, not the nearest gnat', () => {
  const b = { faction: 'vorrax', ships: [{ cls: 'vor_larva', count: 2 }, { cls: 'vor_mandibula', count: 1 }] };
  const fallbackOf = (cls, seed) => {
    const state = createBattle(config1v1({ faction: 'terran', ships: [{ cls, count: 1 }] }, b, seed));
    const me = state.ships[0], larvae = state.ships.filter((s) => s.cls === 'vor_larva'), mand = state.ships.find((s) => s.cls === 'vor_mandibula');
    for (const s of state.ships) { disarm(s); s.ai.nextThink = 1e9; } // only the per-tick fallback picks targets
    larvae[0].x = me.x + 150; larvae[0].y = me.y; larvae[1].x = me.x + 250; larvae[1].y = me.y + 40; mand.x = me.x + 420; mand.y = me.y;
    clearGrid(state.grid); for (const s of state.ships) insertGrid(state.grid, s.id, s.x, s.y);
    me.ai.targetId = 0;
    stepBattle(state);
    return { target: me.ai.targetId, larva: larvae[0].id, mand: mand.id, alpha: me.weapons[0].def.damage * me.weapons[0].def.salvo };
  };
  const heavy = fallbackOf('ter_prometeu', 'alpha-fallback');
  assert.ok(heavy.alpha >= 100);
  assert.equal(heavy.target, heavy.mand, 'the railgun ship targets the Mandíbula 420 u away over two larvae in its face');
  const light = fallbackOf('ter_falcao', 'alpha-fallback-light'); // a 16-dmg autocannon simply takes the nearest
  assert.ok(light.alpha < 100);
  assert.equal(light.target, light.larva);
});
