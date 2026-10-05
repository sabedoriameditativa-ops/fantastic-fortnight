import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./_hook.mjs', import.meta.url);
const { makeEngine } = await import('./mockAudioContext.js');
const { MAX_VOICES, spatialize } = await import('../../client/audio/index.js');

describe('voice pool, coalescing, rate limits', () => {
  test('voice cap: distinct keys never exceed 24 voices; capital death always steals the lowest priority', async () => {
    const { engine, ctx } = await makeEngine();
    const factions = ['terran', 'vorrax', 'lumen', 'ferrix'];
    const names = ['hit.hull', 'shot.laser', 'shot.plasma', 'shot.bio', 'shot.kinetic', 'shot.flak', 'shot.autocannon'];   // decreasing priority
    let i = 0;
    for (const n of names) for (const f of factions) for (const s of [0, 1]) { engine.play(n, { x: 1, y: 1, size: s, faction: f, seed: i++ }); }
    assert.ok(engine.voices.length <= MAX_VOICES);
    assert.equal(engine.voices.length, MAX_VOICES);
    const st = engine.stats();
    assert.ok(st.dropped > 0, 'low priority refused when full');
    const victim = engine.voices.reduce((a, b) => (b.priority < a.priority ? b : a));
    const before = engine.voices.length;
    engine.play('death', { x: 1, y: 1, size: 4, faction: 'terran', seed: 99 });
    assert.ok(engine.voices.some((v) => v.name === 'death'), 'capital death accepted');
    assert.equal(engine.voices.length, before);
    assert.ok(!engine.voices.includes(victim), 'victim removed');
    const ev = victim.gain.gain.events;
    assert.ok(ev.some((e) => e.m === 'cancel') && ev.at(-1).m === 'tgt' && ev.at(-1).v === 0, 'victim faded out');
    assert.ok(victim.sources.every((s) => s.stopped !== null && s.stopped <= ctx.currentTime + 0.06));
    // the stolen voice stays wired until its fade has played: no synchronous disconnect (click)
    assert.equal(victim.gain.disconnected, false, 'victim graph still connected right after the steal');
    assert.ok(victim.v.nodes.length > 0, 'nodes retained for the fade');
    ctx.advance(0.06);  // sources stop at now+0.05 → onended → cleanup
    assert.equal(victim.gain.disconnected, true, 'victim released after the fade');
    assert.equal(victim.v.nodes.length, 0);
    // gcVoices is the backstop when onended never fires
    engine.play('death', { x: 1, y: 1, size: 4, faction: 'vorrax', seed: 100 });
    const v2 = engine.voices.reduce((a, b) => (b.priority < a.priority ? b : a));
    engine.play('death', { x: 2, y: 2, size: 4, faction: 'lumen', seed: 101 });
    if (!engine.voices.includes(v2)) {
      for (const s of v2.sources) s.onended = null;
      ctx.advance(0.3); engine.tick();
      assert.equal(v2.gain.disconnected, true, 'gc cleans a stolen voice whose onended never fired');
    }
  });

  test('duck re-entry: a second capital death inside an active duck does not snap the music filter back to 20 kHz', async () => {
    const { engine, ctx } = await makeEngine();
    engine.setScene('battle');
    const lookup = (id) => ({ cls: 'x', faction: 'terran', sizeClass: 'capital', team: 0, x: 1, y: 1 });
    const f = engine.buses.musicLP.frequency;
    engine.consumeEvents([['die', 1, 0, 1, 1]], lookup);
    const n0 = f.events.length;
    assert.ok(f.events.slice(0, n0).some((e) => e.m === 'set' && e.v === 20000), 'first duck starts from 20 kHz');
    ctx.advance(0.15); engine.tick();
    engine.consumeEvents([['die', 2, 0, 1, 1]], lookup);
    const second = f.events.slice(n0);
    assert.ok(second.length > 0, 'second duck scheduled');
    assert.ok(!second.some((e) => e.m === 'set' && e.v === 20000), `re-entry must not jump to 20 kHz: ${JSON.stringify(second)}`);
    assert.ok(second.some((e) => e.m === 'exp' && e.v === 20000), 'release ramp rescheduled');
    // after the duck is over a new death starts a fresh duck from 20 kHz again
    ctx.advance(2); engine.tick();
    const n1 = f.events.length;
    engine.consumeEvents([['die', 3, 0, 1, 1]], lookup);
    assert.ok(f.events.slice(n1).some((e) => e.m === 'set' && e.v === 20000));
  });

  test('coalescing: 40 cannon shots within 30 ms → one voice boosted ≤ 2.2×; 31 ms apart → two voices', async () => {
    const { engine, ctx } = await makeEngine();
    for (let i = 0; i < 40; i++) engine.play('shot.kinetic', { x: 1, y: 1, size: 1, faction: 'terran', seed: i });
    const voices = engine.voices.filter((v) => v.name === 'shot.kinetic');
    assert.equal(voices.length, 1);
    const st = engine.stats();
    assert.equal(st.coalesced, 39);
    assert.equal(st.created, 1);
    const expected = Math.min(2.2, 1 + 0.35 * Math.log2(40));
    assert.ok(Math.abs(voices[0].coalesceMul - expected) < 1e-9);
    assert.equal(voices[0].gain.gain.events.at(-1).m, 'tgt');
    assert.ok(Math.abs(voices[0].gain.gain.events.at(-1).v - expected) < 1e-9);
    ctx.advance(0.031);
    engine.play('shot.kinetic', { x: 1, y: 1, size: 1, faction: 'terran', seed: 77 });
    assert.equal(engine.voices.filter((v) => v.name === 'shot.kinetic').length, 2);
    // different faction / size → different key
    engine.play('shot.kinetic', { x: 1, y: 1, size: 3, faction: 'terran', seed: 78 });
    assert.equal(engine.voices.filter((v) => v.name === 'shot.kinetic').length, 3);
  });

  test('rate limit: hit.hull sustains ≤ 12/s (burst of 6) under a 100/s stream', async () => {
    const { engine, ctx } = await makeEngine();
    let created = 0;
    for (let i = 0; i < 300; i++) {
      const before = engine.stats().created;
      engine.play('hit.hull', { x: 1, y: 1, size: 2, faction: 'ferrix', seed: i });
      created += engine.stats().created - before;
      ctx.advance(0.01);
      engine.tick();
    }
    assert.ok(created <= 3 * 12 + 6, `created ${created}`);
    assert.ok(created >= 30, `created ${created}`);
    assert.ok(engine.stats().dropped > 0);
  });

  test('spatialization: center → pan 0 gain 1; 2·hw right → pan 0.8, gain ≈ 0.29, muffled; far away → no nodes', async () => {
    const cam = { cx: 100, cy: 100, hw: 500, aspect: 16 / 9 };
    let s = spatialize(100, 100, cam);
    assert.equal(s.pan, 0); assert.equal(s.gain, 1); assert.equal(s.lpHz, 20000);
    s = spatialize(100 + 2 * 500, 100, cam);
    assert.ok(Math.abs(s.pan - 0.8) < 1e-9);
    assert.ok(Math.abs(s.gain - 1 / (1 + 1.5)) < 1e-9);
    assert.ok(s.lpHz < 20000 && s.lpHz >= 900);
    const { engine, ctx } = await makeEngine();
    engine.setCamera(100, 100, 500, 16 / 9);
    let from = ctx.created.length;
    engine.play('shot.kinetic', { x: 100 + 2 * 500, y: 100, size: 1, faction: 'terran', seed: 1 });
    const made = ctx.since(from);
    const panner = made.find((n) => n.kind === 'panner');
    assert.ok(Math.abs(panner.pan.value - 0.8) < 1e-9);
    assert.ok(made.some((n) => n.kind === 'biquad' && n.type === 'lowpass' && n.frequency.value < 20000 && n.outputs.includes(panner)));
    from = ctx.created.length;
    engine.play('shot.kinetic', { x: 100 + 20 * 500, y: 100, size: 1, faction: 'terran', seed: 2 });
    assert.equal(ctx.since(from).length, 0, 'culled before any node');
    assert.equal(engine.stats().culled, 1);
    // small hits off-screen are culled even when audible-ish
    from = ctx.created.length;
    engine.play('hit.hull', { x: 100 + 1.3 * 500, y: 100, size: 0, faction: 'terran', seed: 3 });
    assert.equal(ctx.since(from).length, 0);
    // left side pans left
    from = ctx.created.length;
    engine.play('shot.plasma', { x: 100 - 400, y: 100, size: 1, faction: 'lumen', seed: 4 });
    assert.ok(ctx.since(from).find((n) => n.kind === 'panner').pan.value < 0);
  });

  test('stats report voices/created/coalesced/dropped and the peak', async () => {
    const { engine } = await makeEngine();
    const names = ['shot.torpedo', 'shot.railgun', 'shot.missile', 'death', 'shield.break'];
    for (let i = 0; i < 5; i++) engine.play(names[i], { x: 1, y: 1, size: i, faction: 'terran', seed: i });
    const st = engine.stats();
    assert.equal(st.voices, 5);
    assert.equal(st.created, 5);
    assert.equal(st.maxVoices, 5);
    assert.equal(typeof st.coalesced, 'number');
    assert.equal(typeof st.dropped, 'number');
  });
});
