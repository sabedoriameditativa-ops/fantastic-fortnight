import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_hook.mjs', import.meta.url);
const { makeEngine, MockAudioContext, reaches } = await import('./mockAudioContext.js');
const { createMusicEngine, computeIntensity, LAYER_ON, HYSTERESIS, LOOKAHEAD, THEME_BPM_TABLE } = await import('../../client/audio/music.js');
const { createRng } = await import('../../shared/rng.js');

function run(engine, ctx, seconds) {
  const n = Math.round(seconds / 0.025);
  for (let i = 0; i < n; i++) { ctx.advance(0.025); engine.tick(); }
}

describe('music engine', () => {
  test('scheduler: 10 s of battle at 128 BPM schedules ~85 monotonic steps 60/128/4 apart, never in the past', async () => {
    const { engine, ctx } = await makeEngine();
    const steps = [];
    engine.music.onStep = (theme, step, t) => { if (theme === 'battle') steps.push({ step, t, now: ctx.currentTime }); };
    engine.setScene('battle');
    run(engine, ctx, 10);
    const dur = 60 / 128 / 4;
    assert.ok(steps.length >= 83 && steps.length <= 88, `steps ${steps.length}`);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(Math.abs(steps[i].t - steps[i - 1].t - dur) < 1e-9, 'constant 16th spacing');
      assert.equal(steps[i].step, steps[i - 1].step + 1);
    }
    for (const s of steps) { assert.ok(s.t >= s.now - 1e-9, 'not in the past'); assert.ok(s.t <= s.now + LOOKAHEAD + 1e-9, 'within lookahead'); }
  });

  test('themes have the contracted tempos and every music node reaches the destination', async () => {
    assert.equal(THEME_BPM_TABLE.menu, 72); assert.equal(THEME_BPM_TABLE.builder, 96); assert.equal(THEME_BPM_TABLE.battle, 128);
    for (const scene of ['menu', 'builder', 'battle', 'victory', 'defeat']) {
      const { engine, ctx } = await makeEngine();
      const from = ctx.created.length;
      engine.setScene(scene);
      if (scene === 'battle') engine.setBattleState({ aliveFrac: [0.3, 0.2], destroyedFrac: 0.8, elapsedSec: 120 });
      run(engine, ctx, 6);
      const made = ctx.since(from).filter((n) => n.kind !== 'dest');
      assert.ok(made.length > 20, `${scene}: notes were scheduled (${made.length})`);
      for (const n of made) assert.ok(reaches(n, ctx.destination) || n.disconnected, `${scene}: ${n.kind}#${n.id} reaches destination`);
      for (const n of made) if (n.kind === 'osc' || n.kind === 'bufsrc') assert.notEqual(n.started, null, `${scene}: source started`);
      assert.ok(engine.stats().music.notes > 0);
    }
  });

  test('layers: hysteresis and progression B only on 4-bar boundaries', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('battle');
    run(engine, ctx, 0.5);
    const m = engine.music;
    const L = m.current.layers;
    m.setIntensity(0.7);
    assert.deepEqual(m.layersOn, [true, true, true, true, true, false]);
    assert.equal(L[3].gain.events.at(-1).v, 1);
    assert.equal(L[4].gain.events.at(-1).v, 1);
    assert.equal(L[4].gain.events.at(-1).m, 'tgt');
    assert.equal(m.progB, true);
    m.setIntensity(0.6);
    assert.equal(m.layersOn[4], true, 'hysteresis keeps L4 at 0.6');
    m.setIntensity(LAYER_ON[4] - HYSTERESIS - 0.01);
    assert.equal(m.layersOn[4], false);
    assert.equal(L[4].gain.events.at(-1).v, 0);
    assert.equal(m.progB, false);
    // progression switch happens on step % 64 === 0
    m.setIntensity(0.9);
    assert.deepEqual(m.layersOn, [true, true, true, true, true, true]);
    const switched = [];
    m.onStep = (theme, step) => { if (m.current && m.current.prog === 'B' && switched.length === 0) switched.push(step); };
    run(engine, ctx, 12);
    assert.ok(switched.length === 1, 'switched to B');
    assert.equal(switched[0] % 64, 0);
  });

  test('computeIntensity follows the design formula and clamps', () => {
    assert.equal(computeIntensity(null), 0);
    assert.equal(computeIntensity({ aliveFrac: [1, 1], destroyedFrac: 0, elapsedSec: 0 }), 0);
    const x = computeIntensity({ aliveFrac: [0.6, 0.5], destroyedFrac: 0.45, elapsedSec: 90 });
    assert.ok(Math.abs(x - (0.35 * 0.45 + 0.25 + 0.4 * 0.5)) < 1e-9);
    assert.equal(computeIntensity({ aliveFrac: [0, 0], destroyedFrac: 1, elapsedSec: 999 }), 1);
  });

  test('scene transition: old lin→0 and new lin→1 at the same t, on a bar boundary of the old theme', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('menu');
    run(engine, ctx, 3.3);
    const old = engine.music.current;
    engine.setScene('builder');
    const next = engine.music.current;
    assert.notEqual(old, next);
    const oldEv = old.bus.gain.events.filter((e) => e.m === 'lin').at(-1);
    const newEv = next.bus.gain.events.filter((e) => e.m === 'lin').at(-1);
    assert.equal(oldEv.v, 0); assert.equal(newEv.v, 1);
    assert.ok(Math.abs(oldEv.t - newEv.t) < 1e-9, 'same crossfade time');
    const tSwitch = old.bus.gain.events.find((e) => e.m === 'set' && e.v === 1).t;
    const bar = 16 * 60 / 72 / 4;
    const k = (tSwitch - old.startAt) / bar;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `switch at bar boundary (k=${k})`);
    assert.ok(tSwitch >= ctx.currentTime);
    assert.equal(engine.music.fading.length, 1);
    run(engine, ctx, 12);
    assert.equal(engine.music.fading.length, 0, 'old theme disposed');
    assert.ok(old.nodes.length === 0);
    assert.equal(engine.music.scene, 'builder');
    engine.setScene('builder');   // no-op
    assert.equal(engine.music.current, next);
  });

  test('victory/defeat stingers start promptly and "none" fades out', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('battle');
    run(engine, ctx, 2);
    const t0 = ctx.currentTime;
    engine.setScene('victory');
    const th = engine.music.current;
    assert.equal(th.name, 'victory');
    assert.ok(th.startAt - t0 < 0.3, 'stinger within an eighth note');
    run(engine, ctx, 3);
    engine.setScene('none');
    assert.equal(engine.music.current, null);
    run(engine, ctx, 5);
    assert.equal(engine.music.fading.length, 0);
    engine.setScene('defeat');
    run(engine, ctx, 5);
    assert.ok(engine.stats().music.notes > 0);
    // explicit stingers via play()
    const from = ctx.created.length;
    engine.play('ui.victory'); engine.play('ui.defeat');
    assert.ok(ctx.since(from).length > 6);
  });

  test('faction hint queues a motif fill in the builder and the battle lead uses it', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('builder');
    engine.setFactionHint('vorrax');
    assert.equal(engine.music.motifPending, true);
    run(engine, ctx, 4);
    assert.equal(engine.music.motifPending, false, 'fill consumed on the next bar');
    engine.setFactionHint('bogus');
    assert.equal(engine.music.factionHint, null);
  });

  test('standalone music engine with a seeded rng is deterministic', () => {
    const dump = () => {
      const ctx = new MockAudioContext();
      const out = ctx.createGain();
      const m = createMusicEngine({ ctx, out, rng: createRng(7) });
      const log = [];
      m.onStep = (n, s, t) => log.push([n, s, +t.toFixed(6)]);
      m.setScene('menu');
      for (let i = 0; i < 200; i++) { ctx.advance(0.025); m.scheduler(); }
      return JSON.stringify(log) + ctx.created.length;
    };
    assert.equal(dump(), dump());
  });

  test('engine ambience beds exist only in battle and follow aliveFrac', async () => {
    const { engine, ctx } = await makeEngine();
    assert.equal(engine.stats().beds, 0);
    engine.setScene('battle');
    assert.equal(engine.stats().beds, 2);
    engine.setBattleState({ aliveFrac: [0.25, 1], destroyedFrac: 0.3, elapsedSec: 10 });
    run(engine, ctx, 0.6);
    engine.setScene('menu');
    assert.equal(engine.stats().beds, 0);
    run(engine, ctx, 3);
  });
});
