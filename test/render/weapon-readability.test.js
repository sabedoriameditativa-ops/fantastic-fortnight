import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createParticles } from '../../client/battle/render/particles.js';
import { createProjectiles } from '../../client/battle/render/projectiles.js';
import { createBeams } from '../../client/battle/render/beams.js';

function recorder() {
  const calls = [], properties = {};
  return { calls, ctx: new Proxy({}, {
    get: (_, key) => key in properties ? properties[key] : (...args) => calls.push([key, ...args]),
    set: (_, key, value) => { properties[key] = value; calls.push(['set', key, value]); return true; },
  }) };
}
class Canvas {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    const gradient = { addColorStop() {} };
    return new Proxy({}, { get: (_, key) => key === 'createRadialGradient' || key === 'createLinearGradient' ? () => gradient : () => {} });
  }
}
const saved = globalThis.OffscreenCanvas;
before(() => { globalThis.OffscreenCanvas = Canvas; });
after(() => { globalThis.OffscreenCanvas = saved; });
const camera = {
  zoom: 1, vx: 0, vy: 0, vw: 1280, vh: 720,
  visibleRect: () => ({ x0: 0, y0: 0, x1: 1280, y1: 720 }),
  worldToScreenX: x => x, worldToScreenY: y => y,
};
const shot = (kind, id = 1) => ({ id, kind, x: 100, y: 100, tx: 600, ty: 100, dstId: 0, col: '#75bbf3', colB: '#f4f6ff', speed: 100, now: 0 });

test('reduced motion freezes decorative projectile flicker but retains flight', () => {
  const shots = createProjectiles({ particles: createParticles(64) });
  for (const [id, kind] of ['missile', 'torpedo', 'ltorpedo', 'plasma', 'spore', 'ion'].entries()) shots.launch(shot(kind, id));
  const first = recorder(), later = recorder();
  shots.draw(first.ctx, camera, 1, 100, 1, { reducedMotion: true });
  shots.draw(later.ctx, camera, 1, 999, 1, { reducedMotion: true });
  assert.deepEqual(first.calls, later.calls, 'all decorative positions and alpha stay steady');
  shots.update(0.2, 1000, () => null, 0);
  assert.equal(shots.get(0).x, 120, 'motion preference does not freeze actual projectiles');
});

test('weapon silhouettes remain distinct without glow at the real low quality density', () => {
  const outlines = new Map();
  for (const kind of ['tracer', 'rail', 'missile', 'plasma', 'ion']) {
    const shots = createProjectiles({ particles: createParticles(8) }), recording = recorder();
    shots.launch(shot(kind)); shots.draw(recording.ctx, camera, 1, 100, 0.35);
    assert.ok(recording.calls.some(call => call[0] === 'stroke'), 'every shot retains a direction cue');
    assert.ok(!recording.calls.some(call => call[0] === 'drawImage'), 'no glow atlas is needed');
    outlines.set(kind, JSON.stringify(recording.calls.filter(call => ['moveTo', 'lineTo', 'arc'].includes(call[0]))));
  }
  assert.equal(new Set(outlines.values()).size, outlines.size, 'shape/length distinguishes these weapon families independently of color');
});

test('reduced effects suppress projectile bloom and repair packets even at full density', () => {
  const shots = createProjectiles({ particles: createParticles(8) }), beams = createBeams(8);
  shots.launch(shot('plasma'));
  beams.add({ kind: 'repair', x0: 100, y0: 100, x1: 500, y1: 100, colA: '#75bbf3', colB: '#ffffff', t0: 0, dur: 1000 });
  const recording = recorder();
  shots.draw(recording.ctx, camera, 1, 100, 1, { reducedEffects: true });
  beams.draw(recording.ctx, camera, 1, 100, 1, { reducedEffects: true });
  assert.ok(recording.calls.some(call => call[0] === 'stroke'));
  assert.ok(!recording.calls.some(call => call[0] === 'drawImage' || call[0] === 'fillRect'), 'quiet mode preserves essential paths without bloom or moving packets');
});

test('visual projectile capacity and expiration stay bounded during repeated salvos', () => {
  const shots = createProjectiles({ particles: createParticles(8), max: 8 });
  for (let id = 0; id < 100; id++) shots.launch(shot('missile', id));
  assert.equal(shots.count, 8);
  assert.equal(shots.get(0), undefined);
  assert.ok(shots.get(99));
  shots.update(0.1, 10000, () => null, 0);
  assert.equal(shots.count, 0);
});
