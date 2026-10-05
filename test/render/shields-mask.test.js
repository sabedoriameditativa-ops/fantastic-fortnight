import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

class FakeCanvas {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() {
    const noop = () => {};
    return new Proxy({}, { get: (t, k) => (typeof k === 'string' ? noop : undefined), set: () => true });
  }
}
const saved = globalThis.OffscreenCanvas;
before(() => { globalThis.OffscreenCanvas = FakeCanvas; });
after(() => { globalThis.OffscreenCanvas = saved; });

describe('shield hex mask cache', () => {
  test('is quantized to a few power-of-two radii and bounded; clear() releases it', async () => {
    const { createShields } = await import('../../client/battle/render/shields.js');
    const sh = createShields({ particles: { color: () => 0, spawn: () => {} } });
    const seen = new Set();
    for (let r = 20; r <= 900; r += 7) seen.add(sh.hexMask(r));
    assert.ok(seen.size <= 5, `distinct masks ${seen.size}`);
    assert.ok(sh.maskCacheSize <= 5);
    assert.equal(sh.hexMask(100), sh.hexMask(120), 'same bucket → same canvas');
    assert.equal(sh.hexMask(100).width, 256, 'bucket radius 128 → 256 px canvas');
    assert.equal(sh.hexMask(600).width, 1024, 'largest bucket caps at radius 512');
    sh.clear();
    assert.equal(sh.maskCacheSize, 0);
  });
});
