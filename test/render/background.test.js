import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBackground } from '../../client/battle/background.js';

// Record actual baked pixels and painter order, without requiring a browser.
// Frame calls remain observable separately from offscreen cache construction.
let allocations = 0;
class Canvas {
  constructor(width, height) {
    allocations++;
    this.width = width; this.height = height; this.ops = [];
    const grad = { addColorStop() {} };
    const self = this;
    this.context = new Proxy({
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: pixels => { self.pixels = pixels; },
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      drawImage: (...args) => self.ops.push({ kind: 'image', args }),
      ellipse: (...args) => self.ops.push({ kind: 'ellipse', args }),
      fillRect: (...args) => self.ops.push({ kind: 'rect', args }),
    }, { get: (target, key) => key in target ? target[key] : () => {} });
  }
  getContext() { return this.context; }
}
const saved = globalThis.OffscreenCanvas;
before(() => { globalThis.OffscreenCanvas = Canvas; });
after(() => { globalThis.OffscreenCanvas = saved; });
const world = { w: 2800, h: 1575 };
function camera() {
  return { x: 1400, y: 787.5, zoom: 0.5, vx: 0, vy: 0, vw: 1400, vh: 788, shakeX: 0, shakeY: 0,
    worldToScreenX(x) { return (x - this.x) * this.zoom + this.vw / 2; },
    worldToScreenY(y) { return (y - this.y) * this.zoom + this.vh / 2; },
    visibleRect() { return { x0: 0, y0: 0, x1: world.w, y1: world.h }; },
  };
}
function ringed() {
  for (let seed = 0; seed < 100; seed++) {
    const bg = createBackground({ seed: `background-${seed}`, world });
    if (bg.planet?.ring && bg.planet?.moon) return bg;
  }
  assert.fail('seeded ringed planet fixture unavailable');
}

test('ring atlas has transparent margins and draws its far half before the opaque globe', () => {
  const bg = ringed(), frame = new Canvas(1400, 788);
  bg.draw(frame.context, camera(), 0, { reducedMotion: true });
  const atlas = bg.planet.canvas;
  const globeIndex = atlas.ops.findIndex(op => op.kind === 'image');
  assert.ok(globeIndex > 0, 'far rings precede the globe');
  const rings = atlas.ops.filter(op => op.kind === 'ellipse' && op.args[2] > 250);
  assert.ok(rings.length > 20);
  assert.ok(rings.every(op => op.args[2] + 8 < atlas.width / 2), 'all inclined rings fit inside the atlas');
  assert.ok(atlas.ops.slice(0, globeIndex).some(op => op.kind === 'ellipse' && op.args[5] === Math.PI));
  assert.ok(atlas.ops.slice(globeIndex + 1).some(op => op.kind === 'ellipse' && op.args[5] === 0));
  const globe = atlas.ops[globeIndex].args[0], { data, width, height } = globe.pixels;
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  assert.equal(data[center + 3], 255, 'night-side disc must also occlude background stars');
  assert.equal(data[3], 0, 'corners are transparent');
  let darkest = 255, brightest = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 255) {
    const light = data[i] + data[i + 1] + data[i + 2];
    darkest = Math.min(darkest, light); brightest = Math.max(brightest, light);
  }
  assert.ok(brightest > darkest * 4 + 35, 'a day/night terminator survives baked surface detail');
  bg.dispose();
});

test('low quality and reduced effects omit foreground stars, moon and comet; warmed caches do not grow', () => {
  const bg = ringed(), frame = new Canvas(1400, 788), cam = camera();
  bg.draw(frame.context, cam, 0, { quality: 0.35 });
  assert.equal(bg.planet.moonCanvas, null, 'quiet mode does not allocate a moon');
  assert.equal(frame.ops.filter(op => op.kind === 'rect').length, 1, 'only the background clear; no direct starfield');
  const baked = allocations, planet = bg.planet.canvas;
  for (let i = 1; i <= 12; i++) {
    frame.ops.length = 0;
    bg.draw(frame.context, cam, i * 40000, { quality: 1, reducedEffects: true });
    assert.equal(frame.ops.filter(op => op.kind === 'rect').length, 1);
  }
  assert.equal(allocations, baked, 'no repeated texture/comet allocations');
  assert.equal(bg.planet.canvas, planet);
  assert.ok(bg.planet.toneCanvas.ops.some(op => op.kind === 'image' && op.args[0] === planet), 'quiet tone uses the opaque atlas');
  bg.draw(frame.context, cam, 600000, { quality: 1, reducedMotion: true });
  assert.ok(bg.planet.moonCanvas, 'full quality enables the seed moon');
  bg.draw(frame.context, cam, 610000, { highContrast: true });
  const warm = allocations;
  for (let i = 0; i < 10; i++) bg.draw(frame.context, cam, 610000 + i * 1000, { highContrast: true });
  assert.equal(allocations, warm);
  bg.dispose();
  assert.equal(bg.planet.canvas, null);
  assert.equal(bg.planet.moonCanvas, null);
  assert.equal(bg.planet.toneCanvas, null);
});

test('the same seed bakes identical planet surfaces without touching simulation randomness', () => {
  const a = ringed(), b = ringed(), cam = camera();
  const frame = new Canvas(1400, 788);
  a.draw(frame.context, cam, 0, { reducedMotion: true });
  b.draw(frame.context, cam, 0, { reducedMotion: true });
  const surface = bg => bg.planet.canvas.ops.find(op => op.kind === 'image').args[0].pixels.data;
  assert.deepEqual(surface(a), surface(b));
  assert.equal(a.planet.lightA, b.planet.lightA);
  a.dispose(); b.dispose();
});
