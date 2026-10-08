import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParticles } from '../../client/battle/render/particles.js';
import { createProjectiles, KIND_BY_TYPE } from '../../client/battle/render/projectiles.js';
import { createExplosions } from '../../client/battle/render/explosions.js';
import { createShields } from '../../client/battle/render/shields.js';
import { drawShipDetails, SHIP_DEFS } from '../../client/battle/sprites.js';
import { palette } from '../../client/battle/render/palette.js';

function recorder() {
  const calls = [];
  return { calls, ctx: new Proxy({}, {
    get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]),
    set: (target, key, value) => { target[key] = value; return true; },
  }) };
}
const cam = {
  zoom: 1, vx: 0, vy: 0, vw: 1280, vh: 720,
  isVisible: () => true, visibleRect: () => ({ x0: -1000, y0: -1000, x1: 2000, y1: 2000 }),
  worldToScreenX: (x) => x, worldToScreenY: (y) => y,
};

test('directional biological shots keep a straight trajectory and never seek a target', () => {
  const particles = createParticles(20), shots = createProjectiles({ particles });
  const p = shots.launch({ id: 1, kind: 'ltorpedo', x: 0, y: 0, tx: 500, ty: 500, directional: true, dstId: 0, col: '#ffffff', speed: 100, now: 0 });
  for (let i = 1; i <= 10; i++) shots.update(0.1, i * 100, () => { throw new Error('directional shot must not look up a target'); }, 0);
  assert.ok(Math.abs(p.x - p.y) < 1e-8, 'no visual serpentine deviation');
  assert.ok(Math.abs(p.x - Math.SQRT1_2 * 100) < 1e-8);
  assert.equal(particles.count, 0, 'zero density suppresses decorative trails');
});

test('low quality draws every projectile without glow and suppresses rail trails', () => {
  const particles = createParticles(50), shots = createProjectiles({ particles });
  const kinds = [...new Set(Object.values(KIND_BY_TYPE)), 'ltorpedo', 'spore'];
  kinds.forEach((kind, id) => shots.launch({ id, kind, x: 100, y: 100, tx: 500, ty: 100, dstId: 0, col: '#ffffff', speed: 100, now: 0 }));
  shots.update(0.1, 100, () => null, 0);
  assert.equal(particles.count, 0, 'rail emission also honors density=0');
  const { ctx, calls } = recorder();
  shots.draw(ctx, cam, 1, 100, 0.2);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, kinds.length);
  assert.equal(calls.filter(([name]) => name === 'drawImage').length, 0);
  assert.equal(shots.count, kinds.length, 'quality does not remove simulated shot representations');
});

test('reduced effects omit explosion flashes but preserve readable impact rings', () => {
  const explosions = createExplosions({ particles: createParticles(20) });
  explosions.flash({ x: 100, y: 100, r: 400, col: '#ffffff', t0: 0, dur: 300 });
  explosions.ring({ x: 100, y: 100, r0: 10, r1: 100, col: '#ffffff', t0: 0, dur: 300 });
  const { ctx, calls } = recorder();
  explosions.draw(ctx, cam, 1, 50, true);
  assert.equal(calls.filter(([name]) => name === 'drawImage').length, 0);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 1);
});

test('reduced shield hits use a quiet directional arc instead of a flashing mask', () => {
  const shields = createShields({ particles: createParticles(20) });
  shields.ripple(1, 0, 0, 1);
  const { ctx, calls } = recorder();
  shields.drawRipples(ctx, cam, 1, 50, () => ({ x: 100, y: 100, r: 150, color: '#ffffff' }), true);
  assert.equal(calls.filter(([name]) => name === 'drawImage').length, 0);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 1);
});

test('reduced motion freezes decorative engine flutter at different timestamps', () => {
  const def = SHIP_DEFS.ter_ace, pal = palette('terran', 0);
  const first = recorder(), second = recorder();
  for (const [r, time] of [[first, 100], [second, 999]]) drawShipDetails(r.ctx, def, pal, 50, 50, 1, 0, 1, 1, { id: 1, thrust: 1 }, time, { anims: false, glow: false, reducedMotion: true });
  assert.deepEqual(first.calls, second.calls);
  assert.ok(first.calls.some(([name]) => name === 'fill'), 'thruster silhouette remains visible');
});
