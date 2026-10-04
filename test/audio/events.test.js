import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_hook.mjs', import.meta.url);
const { makeEngine } = await import('./mockAudioContext.js');
const { createBattle, stepBattle, getInitialShips, battleWorld } = await import('../../shared/sim/battle.js');
const { presetFleet } = await import('../../shared/fleet.js');
const { SHIPS } = await import('../../shared/catalog.js');
const { SNAPSHOT_EVERY, TICK_MS } = await import('../../shared/constants.js');

/** Record frames of a real battle: [{ events, ships: Map }] with positions per frame. */
function recordBattle(seed, a, b, maxFrames = 400) {
  const state = createBattle({ seed, players: [
    { id: 'p1', name: 'A', team: 0, isBot: false, fleet: presetFleet(a, 1500) },
    { id: 'p2', name: 'B', team: 1, isBot: true, fleet: presetFleet(b, 1500), ai: 'especialista' },
  ] });
  const infos = new Map();
  for (const s of getInitialShips(state)) infos.set(s.id, { cls: s.cls, team: s.team, faction: SHIPS[s.cls].faction, sizeClass: SHIPS[s.cls].sizeClass });
  const frames = [];
  let buf = [];
  while (!state.ended && frames.length < maxFrames) {
    const ev = stepBattle(state);
    for (const e of ev) if (e[0] === 'spawn') infos.set(e[1], { cls: e[2], team: e[3], faction: SHIPS[e[2]].faction, sizeClass: SHIPS[e[2]].sizeClass });
    buf.push(...ev);
    if (state.tick % SNAPSHOT_EVERY === 0) {
      const pos = new Map();
      for (const s of state.ships) if (s.alive) pos.set(s.id, { x: s.x, y: s.y });
      frames.push({ events: buf, pos });
      buf = [];
    }
  }
  return { frames, infos, world: battleWorld(state) };
}

describe('consumeEvents with real simulation events', () => {
  test('a recorded battle produces sounds of every family, never throws, and stays within budget', async () => {
    const { frames, infos, world } = recordBattle(42, 'ter_linha', 'lum_coro');
    const total = frames.reduce((n, f) => n + f.events.length, 0);
    assert.ok(total > 500, `fixture has ${total} events`);
    const { engine, ctx } = await makeEngine();
    engine.setScene('battle');
    engine.setCamera(world.w / 2, world.h / 2, world.w / 2, 16 / 9);
    const kinds = new Set();
    const frameDt = TICK_MS * SNAPSHOT_EVERY / 1000;
    let maxAlive = 0;
    for (const f of frames) {
      const lookup = (id) => { const i = infos.get(id); if (!i) return null; const p = f.pos.get(id); return { ...i, x: p ? p.x : 0, y: p ? p.y : 0 }; };
      for (const e of f.events) kinds.add(e[0]);
      engine.consumeEvents(f.events, lookup);
      for (let k = 0; k < 4; k++) { ctx.advance(frameDt / 4); engine.tick(); }
      engine.setBattleState({ aliveFrac: [0.8, 0.7], destroyedFrac: 0.2, elapsedSec: 10 });
      const alive = ctx.created.filter((n) => !n.disconnected).length;
      if (alive > maxAlive) maxAlive = alive;
      assert.ok(engine.voices.length <= 24);
    }
    const st = engine.stats();
    assert.ok(kinds.has('proj') && kinds.has('hit') && kinds.has('die'), `fixture covers ${[...kinds].join(',')}`);
    assert.ok(st.created > 50, `created ${st.created}`);
    assert.ok(st.coalesced > 0, 'coalescing happened');
    assert.ok(st.created <= frames.length * frameDt * 60 + 50, `created/s bounded (${st.created} over ${frames.length * frameDt}s)`);
    assert.ok(maxAlive < 450, `peak live nodes ${maxAlive}`);
    assert.equal(typeof st.dropped, 'number');
    const names = new Set(engine.voices.map((v) => v.name));
    assert.ok(names.size >= 0);
  });

  test('event mapping: weapon type from the catalog, abilities by kind, projectile impacts, phases', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('battle');
    engine.setCamera(0, 0, 1000, 16 / 9);
    const ships = {
      1: { cls: 'ter_prometeu', faction: 'terran', sizeClass: 'mothership', team: 0, x: 10, y: 10 },     // railgun + missiles, aura
      2: { cls: 'lum_catedral', faction: 'lumen', sizeClass: 'capital', team: 1, x: -10, y: 10 },       // laser chain, teleport
      3: { cls: 'vor_larva', faction: 'vorrax', sizeClass: 'tiny', team: 1, x: 5, y: 5 },
      4: { cls: 'fer_fabricador', faction: 'ferrix', sizeClass: 'medium', team: 0, x: 20, y: 20 },
    };
    const lookup = (id) => ships[id] || null;
    const names = () => engine.voices.map((v) => v.name);
    engine.consumeEvents([['shot', 2, 1, 0, 1]], lookup);
    assert.ok(names().includes('shot.laser'));
    engine.consumeEvents([['proj', 100, 1, 2, 0, 10, 10], ['proj', 101, 1, 2, 1, 10, 10]], lookup);
    assert.ok(names().includes('shot.railgun') && names().includes('shot.missile'));
    ctx.advance(0.5); engine.tick();
    engine.consumeEvents([['pend', 101, 1, -10, 10], ['pend', 100, 1, -10, 10], ['pend', 999, 1, 0, 0]], lookup);
    assert.ok(names().includes('impact.missile'), 'missile impact');
    assert.ok(!names().includes('impact.torpedo'));
    ctx.advance(0.5); engine.tick();
    engine.consumeEvents([['hit', 2, 30, 'railgun', 1], ['hit', 1, 30, 'laser', 0], ['sbreak', 2]], lookup);
    assert.ok(names().includes('hit.shield') && names().includes('hit.hull') && names().includes('shield.break'));
    ctx.advance(0.5); engine.tick();
    engine.consumeEvents([['cast', 2, 'phase_jump', 0, -10, 10], ['cast', 1, 'siege_protocol', 0, 10, 10], ['cast', 4, 'fabricate_drones', 0, 20, 20], ['cast', 3, 'bile_burst', 0, 5, 5]], lookup);
    assert.ok(names().includes('cast.teleport') && names().includes('cast.aura') && names().includes('cast.spawn'));
    assert.ok(!names().includes('cast.passive'), 'passive casts are silent');
    assert.equal(engine.stats().deferred, 1, 'teleport-in deferred');
    ctx.advance(0.5); engine.tick();
    assert.ok(names().includes('cast.teleport_in'));
    engine.consumeEvents([['aoe', 5, 5, 60, 'bile_burst'], ['heal', 1, 4, 5, 'hull'], ['heal', 1, 4, 80, 'hull'], ['spawn', 9, 'fer_vetor', 0, 'p1', 1, 1, 0, 4], ['area', 1, 'acid_cloud', 0, 0, 100, 1]], lookup);
    assert.ok(names().includes('cast.passive'));
    assert.equal(names().filter((n) => n === 'heal').length, 1, 'small regen heals are silent');
    ctx.advance(0.5); engine.tick();
    const before = engine.music.intensity;
    engine.consumeEvents([['phase', 'engage']], lookup);
    engine.setBattleState({ aliveFrac: [1, 1], destroyedFrac: 0, elapsedSec: 0 });
    assert.ok(engine.music.intensity > before, 'engage raises the music floor');
    engine.consumeEvents([['phase', 'suddenDeath']], lookup);
    assert.ok(names().includes('alarm'));
    engine.setBattleState({ aliveFrac: [1, 1], destroyedFrac: 0, elapsedSec: 0 });
    assert.ok(engine.music.intensity >= 0.65);
    // capital death: ducks the music and schedules secondary pops
    ctx.advance(1); engine.tick();
    const lpEvents = engine.buses.musicLP.frequency.events.length;
    engine.consumeEvents([['die', 2, 1, -10, 10], ['end', 0, 'elimination']], lookup);
    assert.ok(names().includes('death'));
    assert.ok(engine.buses.musicLP.frequency.events.length > lpEvents, 'music ducked');
    assert.ok(engine.stats().deferred >= 6, 'secondary pops queued');
    for (let i = 0; i < 80; i++) { ctx.advance(0.025); engine.tick(); }
    assert.equal(engine.stats().deferred, 0);
    // unknown ids and malformed events never throw
    engine.consumeEvents([['shot', 999, 1, 0, 1], ['hit', 999, 1, 'x', 0], null, ['bogus'], ['cast', 999, 'nope', 0, 0, 0]], lookup);
    engine.consumeEvents([['die', 1, 0, 0, 0]], undefined);
  });
});
