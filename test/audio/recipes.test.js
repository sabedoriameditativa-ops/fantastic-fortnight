import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_hook.mjs', import.meta.url);
const { makeEngine, reaches, paramsOf, MockSource } = await import('./mockAudioContext.js');
const { SFX_NAMES, UI_NAMES, RECIPES, makeRnd, MIN_GAIN } = await import('../../client/audio/recipes.js');
const { FACTION_IDS } = await import('../../shared/catalog.js');

const SIZES = [0, 1, 2, 3, 4];

function checkVoice(ctx, made, name, label) {
  assert.ok(made.length > 0, `${label}: created nodes`);
  const dest = ctx.destination;
  for (const n of made) {
    assert.ok(reaches(n, dest), `${label}: ${n.kind}#${n.id} reaches destination`);
    for (const p of paramsOf(n)) {
      for (const ev of p.events) {
        assert.ok(ev.t >= ctx.currentTime - 1e-9, `${label}: param event in the past`);
        if (ev.m === 'exp') assert.ok(ev.v > 0, `${label}: exponential ramp to ${ev.v}`);
      }
    }
    if (n instanceof MockSource) {
      assert.notEqual(n.started, null, `${label}: ${n.kind}#${n.id} started`);
      assert.notEqual(n.stopped, null, `${label}: ${n.kind}#${n.id} stopped`);
      assert.ok(n.stopped > n.started, `${label}: stop after start`);
      assert.ok(n.stopped - n.started <= 4.0, `${label}: source ≤ 4 s (${n.stopped - n.started})`);
    }
  }
  const envs = made.filter((n) => n.kind === 'gain' && n.gain.events.some((e) => e.m === 'exp'));
  for (const g of envs) {
    const last = g.gain.events.at(-1);
    assert.ok(last.m === 'tgt' && last.v === MIN_GAIN, `${label}: envelope ends with setTargetAtTime(1e-4)`);
  }
}

describe('SFX recipes (every name × faction × size)', () => {
  test('creates ≤ 16 nodes on screen (≤ 17 muffled), every source starts/stops, every node reaches destination', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setCamera(1000, 500, 800, 16 / 9);
    let worst = 0;
    for (const name of SFX_NAMES) {
      for (const faction of [...FACTION_IDS, null]) {
        for (const size of SIZES) {
          ctx.advance(0.4);
          engine.tick();
          const from = ctx.created.length;
          engine.play(name, { x: 1000, y: 500, size, faction, seed: 1000 * size + 7, count: 4, dur: 1.2, shieldPct: 0.4 });
          const made = ctx.since(from);
          const label = `${name}/${faction}/${size}`;
          checkVoice(ctx, made, name, label);
          assert.ok(made.length <= 16, `${label}: ${made.length} nodes`);
          worst = Math.max(worst, made.length);
        }
      }
    }
    assert.ok(worst >= 4);
    // muffled (off-screen) voice adds one lowpass
    ctx.advance(1);
    const from = ctx.created.length;
    engine.play('death', { x: 1000 + 800 * 1.6, y: 500, size: 4, faction: 'ferrix', seed: 3 });
    const made = ctx.since(from);
    assert.ok(made.some((n) => n.kind === 'biquad' && n.frequency.value < 19000), 'muffling lowpass present');
    assert.ok(made.length <= 17, `muffled: ${made.length} nodes`);
  });

  test('UI recipes play on the ui bus without spatialization', async () => {
    const { engine, ctx } = await makeEngine();
    for (const name of UI_NAMES) {
      ctx.advance(0.1);
      const from = ctx.created.length;
      engine.play(name);
      const made = ctx.since(from);
      checkVoice(ctx, made, name, name);
      assert.ok(made.every((n) => n.kind !== 'panner'), `${name}: no panner`);
      assert.ok(made.some((n) => n.outputs.includes(engine.buses.ui)), `${name}: on ui bus`);
      assert.ok(made.length <= 8);
    }
    assert.equal(engine.stats().ui, UI_NAMES.length);
  });

  test('every recipe honours the faction remaps (lumen never uses square/saw or white noise)', async () => {
    const { engine, ctx } = await makeEngine();
    for (const name of SFX_NAMES) {
      ctx.advance(0.2);
      const from = ctx.created.length;
      engine.play(name, { x: 0.1, y: 0.1, size: 2, faction: 'lumen', seed: 5 });
      for (const n of ctx.since(from)) {
        if (n.kind === 'osc') assert.ok(n.type !== 'square' && n.type !== 'sawtooth', `${name}: lumen osc ${n.type}`);
        if (n.kind === 'bufsrc') assert.notEqual(n.buffer, engine.noise.white, `${name}: lumen uses no white noise`);
      }
    }
  });

  test('deterministic jitter: same seed → identical automation, different seed → differs', async () => {
    const dump = async (seed) => {
      const { engine, ctx } = await makeEngine();
      const from = ctx.created.length;
      engine.play('shot.plasma', { x: 1, y: 1, size: 1, faction: 'vorrax', seed });
      return JSON.stringify(ctx.since(from).map((n) => [n.kind, n.type, paramsOf(n).map((p) => p.events)]));
    };
    assert.equal(await dump(123), await dump(123));
    assert.notEqual(await dump(123), await dump(124));
    const r1 = makeRnd(9), r2 = makeRnd(9);
    assert.equal(r1(0, 1), r2(0, 1));
  });

  test('cleanup: after the voice ends every node is disconnected and the pool is empty', async () => {
    const { engine, ctx } = await makeEngine();
    const from = ctx.created.length;
    for (const name of ['death', 'shield.break', 'shot.missile', 'cast.spawn']) engine.play(name, { x: 1, y: 1, size: 4, faction: 'vorrax', seed: 2 });
    assert.ok(engine.voices.length >= 4);
    ctx.advance(6);
    engine.tick();
    for (const n of ctx.since(from)) assert.equal(n.disconnected, true, `${n.kind}#${n.id} disconnected`);
    assert.equal(engine.voices.length, 0);
  });

  test('unknown names are counted as dropped and never throw', async () => {
    const { engine } = await makeEngine();
    engine.play('nope.nothing');
    engine.play('shot.unknownweapon', { x: 1, y: 1 });
    assert.equal(engine.stats().dropped, 2);
    assert.ok(RECIPES['shot.kinetic']);
  });
});
