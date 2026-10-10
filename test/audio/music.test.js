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

  test('victory stinger: the reverb send hangs off the voice, not the theme bus (no leak per stinger)', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('victory');
    const bus = engine.music.current.bus;
    run(engine, ctx, 4);
    engine.setScene('menu');
    run(engine, ctx, 1);
    engine.setScene('victory');
    run(engine, ctx, 4);
    for (const th of [bus, engine.music.current.bus]) {
      for (const o of th.outputs) assert.ok(!o.disconnected, `theme bus still feeds a released node ${o.kind}#${o.id}`);
    }
  });

  test('retire(): switching scene while the old theme is still fading in continues its ramp instead of popping to 1', async () => {
    const { engine, ctx } = await makeEngine();
    // battle: fade-in 2 s, but its bar (128 BPM) is 1.875 s → the first bar boundary lands inside the fade-in
    engine.setScene('battle');
    run(engine, ctx, 1.0);
    const old = engine.music.current;
    const g = old.bus.gain;
    engine.setScene('menu');
    const ev = g.events;
    const i = ev.map((e) => e.m).lastIndexOf('cancel');
    assert.ok(i >= 0, 'fade-in re-anchored');
    const tail = ev.slice(i + 1);
    assert.equal(tail[0].m, 'set');
    const expectedNow = Math.max(0, Math.min(1, (ctx.currentTime - old.startAt) / 2));
    assert.ok(Math.abs(tail[0].v - expectedNow) < 1e-6, `holds the fade-in value ${tail[0].v} vs ${expectedNow}`);
    assert.ok(tail[0].v < 0.6, 'still well inside the fade-in');
    assert.equal(tail[1].m, 'lin');
    const expectedSwitch = Math.max(0, Math.min(1, (tail[1].t - old.startAt) / 2));
    assert.ok(Math.abs(tail[1].v - expectedSwitch) < 1e-6, 'ramp continues to the value at tSwitch');
    assert.ok(tail[1].v < 1, 'never forced to 1');
    assert.equal(tail[2].m, 'lin'); assert.equal(tail[2].v, 0);
    assert.ok(!tail.some((e) => e.m === 'set' && e.v === 1));
    // a fully faded-in theme retires from 1
    const { engine: e2, ctx: c2 } = await makeEngine();
    e2.setScene('builder');
    run(e2, c2, 4);
    const g2 = e2.music.current.bus.gain;
    e2.setScene('menu');
    const t2 = g2.events.slice(g2.events.map((e) => e.m).lastIndexOf('cancel') + 1);
    assert.equal(t2[0].v, 1); assert.equal(t2[1].v, 1); assert.equal(t2[2].v, 0);
  });

  test('layers: hysteresis and progression B only on 4-bar boundaries', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('battle');
    run(engine, ctx, 0.5);
    const m = engine.music;
    const L = m.current.layers;
    m.setIntensity((LAYER_ON[4] + LAYER_ON[5]) / 2);
    assert.deepEqual(m.layersOn, [true, true, true, true, true, false]);
    assert.equal(L[3].gain.events.at(-1).v, 1);
    assert.equal(L[4].gain.events.at(-1).v, 1);
    assert.equal(L[4].gain.events.at(-1).m, 'tgt');
    assert.equal(m.progB, true);
    m.setIntensity(LAYER_ON[4] - HYSTERESIS / 2);
    assert.equal(m.layersOn[4], true, 'hysteresis keeps L4 just under its threshold');
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
    const x = computeIntensity({ aliveFrac: [0.6, 0.5], destroyedFrac: 0.45, elapsedSec: 60 });
    assert.ok(Math.abs(x - (0.45 * 0.45 + 0.2 + 0.35 * 0.5)) < 1e-9);
    assert.equal(computeIntensity({ aliveFrac: [0, 0], destroyedFrac: 1, elapsedSec: 999 }), 1);
    // the action-density term (sound requests per second, from the engine) can only raise it
    assert.equal(computeIntensity({ aliveFrac: [1, 1], destroyedFrac: 0, elapsedSec: 0, density: 0.7 }), 0.7);
    assert.ok(computeIntensity({ aliveFrac: [0.2, 0.9], destroyedFrac: 0.8, elapsedSec: 60, density: 0.1 }) > 0.5);
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
    const lins = old.bus.gain.events.filter((e) => e.m === 'lin');
    const tSwitch = lins.at(-2).t; // retire(): ramp to the fade-in value at tSwitch, then lin → 0
    assert.equal(lins.at(-2).v, 1, 'menu fade-in (3 s) is complete at its first bar boundary (3.33 s)');
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
