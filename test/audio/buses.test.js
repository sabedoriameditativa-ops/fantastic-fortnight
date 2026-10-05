import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_hook.mjs', import.meta.url);
const { makeEngine, reaches } = await import('./mockAudioContext.js');
const { MUSIC_TRIM } = await import('../../client/audio/index.js');

describe('audio buses', () => {
  test('init builds sfx→comp→master→limiter→destination, ui and music→lowpass paths plus the shared reverb', async () => {
    const { engine, ctx } = await makeEngine();
    assert.equal(engine.isReady(), true);
    assert.equal(ctx.state, 'running');
    assert.ok(ctx.resumes >= 1, 'resume() called inside init');
    const b = engine.buses;
    assert.ok(b.sfx.outputs.includes(b.sfxComp));
    assert.ok(b.sfxComp.outputs.includes(b.master));
    assert.ok(b.ui.outputs.includes(b.master));
    assert.ok(b.music.outputs.includes(b.musicLP));
    assert.ok(b.musicLP.outputs.includes(b.master));
    assert.ok(b.master.outputs.includes(b.limiter));
    assert.ok(b.limiter.outputs.includes(ctx.destination));
    assert.ok(b.reverb.outputs.includes(b.reverbReturn));
    assert.ok(reaches(b.reverbReturn, ctx.destination));
    assert.equal(b.limiter.ratio.value, 20);
    assert.equal(b.limiter.threshold.value, -3);
    assert.equal(b.musicLP.type, 'lowpass');
    assert.ok(b.reverb.buffer && b.reverb.buffer.numberOfChannels === 2, 'synthetic IR loaded');
    assert.ok(engine.noise.white && engine.noise.pink && engine.noise.brown && engine.noise.crackle, 'noise bank built');
  });

  test('init is idempotent and resumes a suspended context', async () => {
    const { engine, ctx } = await makeEngine();
    const n = ctx.created.length;
    ctx.state = 'suspended';
    await engine.init();
    assert.equal(ctx.state, 'running');
    assert.equal(ctx.created.length, n, 'no new nodes on re-init');
  });

  test('setVolume schedules v² on the bus and muting zeroes master', async () => {
    const { engine } = await makeEngine();
    engine.setVolume('sfx', 0.5);
    const ev = engine.buses.sfx.gain.events.at(-1);
    assert.equal(ev.m, 'tgt');
    assert.ok(Math.abs(ev.v - 0.25) < 1e-9);
    engine.setMuted(true);
    assert.equal(engine.buses.master.gain.events.at(-1).v, 0);
    engine.setMuted(false);
    assert.ok(engine.buses.master.gain.events.at(-1).v > 0);
  });

  test('before init: play is a no-op, scene is queued and applied on init', async () => {
    const { engine, ctx } = await makeEngine({ init: false });
    assert.equal(engine.isReady(), false);
    engine.play('ui.click');
    engine.setScene('menu');
    engine.setVolume('music', 0.3);
    assert.equal(ctx.created.length, 0);
    await engine.init();
    assert.equal(engine.music.scene, 'menu');
    assert.ok(Math.abs(engine.buses.music.gain.events.at(-1).v - 0.09 * MUSIC_TRIM) < 1e-9);
  });

  test('init survives a missing AudioContext', async () => {
    const { createAudioEngine } = await import('../../client/audio/index.js');
    const e = createAudioEngine({ createContext: () => null, storage: null, document: null, setInterval: () => 1, clearInterval: () => {} });
    await e.init();
    assert.equal(e.isReady(), false);
    e.play('ui.click');
    e.setScene('battle');
    e.consumeEvents([['die', 1, 0, 0, 0]], () => null);
    assert.equal(e.stats().created, 0);
  });

  test('visibilitychange ducks music and pauses the sequencer; resume restores', async () => {
    const { engine, ctx, doc } = await makeEngine();
    engine.setScene('menu');
    for (let i = 0; i < 20; i++) { ctx.advance(0.025); engine.tick(); }
    let steps = 0;
    engine.music.onStep = () => { steps++; };
    doc.setHidden(true);
    assert.equal(engine.music.paused, true);
    assert.equal(engine.buses.music.gain.events.at(-1).v, 0);
    for (let i = 0; i < 80; i++) { ctx.advance(0.025); engine.tick(); }
    assert.equal(steps, 0, 'no steps while hidden');
    doc.setHidden(false);
    assert.equal(engine.music.paused, false);
    assert.ok(engine.buses.music.gain.events.at(-1).v > 0);
    for (let i = 0; i < 20; i++) { ctx.advance(0.025); engine.tick(); }
    assert.ok(steps > 0, 'sequencer resumed');
    assert.ok(engine.music.current.nextNoteTime >= ctx.currentTime - 0.03, 'no catch-up burst');
  });

  test('dispose stops everything and closes the context', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('battle');
    engine.setCamera(0, 0, 1000, 1.78);
    engine.play('death', { x: 10, y: 10, size: 4, faction: 'terran' });
    engine.dispose();
    assert.equal(ctx.closed, true);
    assert.equal(engine.isReady(), false);
  });
});
